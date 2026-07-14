/* gpupps.js — the WebGPU engine. Owns the device, all GPU buffers/pipelines,
 * the per-step compute pass and the render pass. Everything stays on the GPU;
 * the CPU only touches data for recording (readback) and picking.
 *
 * Buffers ping-pong: the "current" index always holds the latest state and is
 * both the render source and the next step's input. A fixed-capacity grid means
 * one command pass per step and many steps per submit. */
(function (PPS) {
  'use strict';

  const DEG = Math.PI / 180;
  const WG_CELL = 64;
  const WG_N = 256;

  class GPUEngine {
    static supported() {
      return typeof navigator !== 'undefined' && !!navigator.gpu;
    }

    static async create(canvas) {
      if (!GPUEngine.supported()) throw new Error('WebGPU is not available in this browser.');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No WebGPU adapter found.');
      // Resolve adapter identity (property in new Chrome, async in older).
      let info = {};
      try {
        info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
      } catch (e) { /* ignore */ }
      GPUEngine._pendingInfo = info;
      GPUEngine._isFallback = !!adapter.isFallbackAdapter;
      const lim = adapter.limits;
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
          maxBufferSize: lim.maxBufferSize,
          maxComputeWorkgroupsPerDimension: lim.maxComputeWorkgroupsPerDimension,
        },
      });
      const context = canvas.getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'opaque' });
      return new GPUEngine(device, adapter, canvas, context, format);
    }

    constructor(device, adapter, canvas, context, format) {
      this.device = device;
      this.adapter = adapter;
      this.canvas = canvas;
      this.context = context;
      this.format = format;
      this.limits = adapter.limits;
      this.adapterInfo = GPUEngine._pendingInfo || adapter.info || {};
      this.isFallback = GPUEngine._isFallback;
      this.cap = 32; // per-cell bucket capacity
      this._buildPipelines();
      this._uRenderArr = new Float32Array(60);
      this._readbackBusy = false;
    }

    // ---- pipelines / layouts (independent of particle count) ----
    _buildPipelines() {
      const d = this.device;
      const S = PPS.GPU_SHADERS;
      const computeMod = d.createShaderModule({ code: S.compute });
      const renderMod = d.createShaderModule({ code: S.render });
      const markerMod = d.createShaderModule({ code: S.marker });

      const st = 'storage', ro = 'read-only-storage', un = 'uniform';
      const cEntry = (b, type, vis) => ({ binding: b, visibility: vis, buffer: { type } });
      const COMP = GPUShaderStage.COMPUTE;
      const VERT = GPUShaderStage.VERTEX;

      this.computeBGL = d.createBindGroupLayout({
        entries: [
          cEntry(0, un, COMP), cEntry(1, ro, COMP), cEntry(2, ro, COMP),
          cEntry(3, st, COMP), cEntry(4, st, COMP), cEntry(5, st, COMP),
          cEntry(6, st, COMP), cEntry(7, st, COMP), cEntry(8, st, COMP),
        ],
      });
      const computePL = d.createPipelineLayout({ bindGroupLayouts: [this.computeBGL] });
      this.clearPipe = d.createComputePipeline({ layout: computePL, compute: { module: computeMod, entryPoint: 'clearGrid' } });
      this.scatterPipe = d.createComputePipeline({ layout: computePL, compute: { module: computeMod, entryPoint: 'scatter' } });
      this.simPipe = d.createComputePipeline({ layout: computePL, compute: { module: computeMod, entryPoint: 'simulate' } });

      this.renderBGL = d.createBindGroupLayout({
        entries: [
          cEntry(0, un, VERT), cEntry(1, ro, VERT), cEntry(2, ro, VERT),
          cEntry(3, ro, VERT), cEntry(4, ro, VERT), cEntry(5, ro, VERT),
        ],
      });
      const renderPL = d.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] });
      this.renderPipe = d.createRenderPipeline({
        layout: renderPL,
        vertex: { module: renderMod, entryPoint: 'vs' },
        fragment: { module: renderMod, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'point-list' },
      });

      this.markerBGL = d.createBindGroupLayout({
        entries: [cEntry(0, un, VERT), cEntry(1, ro, VERT), cEntry(2, ro, VERT)],
      });
      const markerPL = d.createPipelineLayout({ bindGroupLayouts: [this.markerBGL] });
      this.markerPipe = d.createRenderPipeline({
        layout: markerPL,
        vertex: { module: markerMod, entryPoint: 'vs' },
        fragment: { module: markerMod, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });
    }

    // Human-readable GPU identity from whatever fields the adapter exposes.
    gpuLabel() {
      const i = this.adapterInfo || {};
      const parts = [i.description, i.device, i.architecture, i.vendor].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'WebGPU device';
    }

    // Heuristic: does this look like an integrated GPU (not the discrete one)?
    looksIntegrated() {
      const s = (this.gpuLabel() + ' ' + JSON.stringify(this.adapterInfo)).toLowerCase();
      if (this.isFallback) return true;
      if (/nvidia|rtx|geforce|radeon rx|discrete/.test(s)) return false;
      return /intel|uhd|iris|integrated|microsoft basic|llvmpipe|swiftshader/.test(s);
    }

    // ---- (re)allocate for a given parameter set ----
    init(params) {
      this._destroyBuffers();
      const d = this.device;
      this.params = Object.assign({ count: 100000, density: 0.08, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 1 }, params);
      const n = this.params.count;
      this.n = n;
      this.W = this.H = Math.sqrt(n / this.params.density);
      const r = this.params.r;
      this.cols = Math.max(3, Math.floor(this.W / r));
      this.rows = Math.max(3, Math.floor(this.H / r));
      this.cellW = this.W / this.cols;
      this.cellH = this.H / this.rows;
      const cells = this.cols * this.rows;
      this.cells = cells;

      // Fit the per-cell capacity under the storage-binding limit.
      // Bins hold vec2<f32> positions -> 8 bytes per slot.
      const maxBind = this.limits.maxStorageBufferBindingSize;
      let cap = this.cap;
      while (cap > 8 && cells * cap * 8 > maxBind) cap = Math.floor(cap / 2);
      if (cells * cap * 8 > maxBind) {
        throw new Error('Particle count too large for this GPU (' +
          (cells * cap * 8 / 1048576).toFixed(0) + ' MB grid > ' + (maxBind / 1048576).toFixed(0) + ' MB limit). Reduce count.');
      }
      this.capActual = cap;
      if (n * 8 > maxBind) throw new Error('Particle count exceeds GPU buffer limit. Reduce count.');

      const B = (bytes, usage) => d.createBuffer({ size: Math.max(16, bytes), usage });
      const STOR = GPUBufferUsage.STORAGE;
      const COPY = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

      this.posA = B(8 * n, STOR | COPY);
      this.posB = B(8 * n, STOR | COPY);
      this.angA = B(4 * n, STOR | COPY);
      this.angB = B(4 * n, STOR | COPY);
      this.NA = B(4 * n, STOR);
      this.NB = B(4 * n, STOR);
      this.net = B(4 * n, STOR);
      this.cellCount = B(4 * cells, STOR);
      this.cellBins = B(8 * cells * cap, STOR); // vec2<f32> positions
      this.uCompute = B(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      this.uRender = B(240, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      this.trackedIds = B(4 * 512, STOR | GPUBufferUsage.COPY_DST);

      this._writeComputeUniform(1);
      this._makeBindGroups();
      this._seed();

      this.current = 0; // A holds latest
      this.step = 0;
      // Warm-up: compute N without moving so the first render is coloured.
      this.runSteps(1, 0);
      this.step = 0;
    }

    _seed() {
      const n = this.n;
      const rng = PPS.makeRNG(this.params.seed);
      const pos = new Float32Array(n * 2);
      const ang = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 2] = rng() * this.W;
        pos[i * 2 + 1] = rng() * this.H;
        ang[i] = rng() * Math.PI * 2;
      }
      this.device.queue.writeBuffer(this.posA, 0, pos);
      this.device.queue.writeBuffer(this.angA, 0, ang);
    }

    _writeComputeUniform(moveEnabled) {
      const buf = new ArrayBuffer(64);
      const f = new Float32Array(buf);
      const u = new Uint32Array(buf);
      const p = this.params;
      f[0] = this.W; f[1] = this.H;
      f[2] = this.cellW; f[3] = this.cellH;
      u[4] = this.cols; u[5] = this.rows;
      u[6] = this.capActual; u[7] = this.n;
      f[8] = p.alpha * DEG; f[9] = p.beta * DEG; f[10] = p.v; f[11] = p.r;
      f[12] = p.r * p.r; f[13] = this.W * 0.5; f[14] = this.H * 0.5; f[15] = moveEnabled;
      this.device.queue.writeBuffer(this.uCompute, 0, buf);
      this._move = moveEnabled;
    }

    setLive(partial) {
      if (partial.alpha != null) this.params.alpha = partial.alpha;
      if (partial.beta != null) this.params.beta = partial.beta;
      if (partial.v != null) this.params.v = partial.v;
      // Update the motion vec4 (offset 32) in-place.
      const p = this.params;
      this.device.queue.writeBuffer(this.uCompute, 32,
        new Float32Array([p.alpha * DEG, p.beta * DEG, p.v, p.r]));
    }

    _makeBindGroups() {
      const d = this.device;
      const mk = (posIn, angIn, posOut, angOut, nOut) => d.createBindGroup({
        layout: this.computeBGL,
        entries: [
          { binding: 0, resource: { buffer: this.uCompute } },
          { binding: 1, resource: { buffer: posIn } },
          { binding: 2, resource: { buffer: angIn } },
          { binding: 3, resource: { buffer: posOut } },
          { binding: 4, resource: { buffer: angOut } },
          { binding: 5, resource: { buffer: nOut } },
          { binding: 6, resource: { buffer: this.net } },
          { binding: 7, resource: { buffer: this.cellCount } },
          { binding: 8, resource: { buffer: this.cellBins } },
        ],
      });
      // current === 0 (A): read A -> write B, N to NB
      this.bgFwd = mk(this.posA, this.angA, this.posB, this.angB, this.NB);
      // current === 1 (B): read B -> write A, N to NA
      this.bgBwd = mk(this.posB, this.angB, this.posA, this.angA, this.NA);

      const rbg = (pos, ang, nCur, nPrev) => d.createBindGroup({
        layout: this.renderBGL,
        entries: [
          { binding: 0, resource: { buffer: this.uRender } },
          { binding: 1, resource: { buffer: pos } },
          { binding: 2, resource: { buffer: ang } },
          { binding: 3, resource: { buffer: nCur } },
          { binding: 4, resource: { buffer: nPrev } },
          { binding: 5, resource: { buffer: this.net } },
        ],
      });
      // renderBg[current]: current holds latest pos/ang/N.
      this.renderBg = [
        rbg(this.posA, this.angA, this.NA, this.NB), // current === 0
        rbg(this.posB, this.angB, this.NB, this.NA), // current === 1
      ];
      const mbg = (pos) => d.createBindGroup({
        layout: this.markerBGL,
        entries: [
          { binding: 0, resource: { buffer: this.uRender } },
          { binding: 1, resource: { buffer: pos } },
          { binding: 2, resource: { buffer: this.trackedIds } },
        ],
      });
      this.markerBg = [mbg(this.posA), mbg(this.posB)];
    }

    // Encode and submit `k` steps in a single command pass.
    runSteps(k, moveEnabled) {
      if (moveEnabled == null) moveEnabled = 1;
      if (this._move !== moveEnabled) this._writeComputeUniform(moveEnabled);
      const d = this.device;
      const cellGroups = Math.ceil(this.cells / WG_CELL);
      const nGroups = Math.ceil(this.n / WG_N);
      const enc = d.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (let s = 0; s < k; s++) {
        const bg = this.current === 0 ? this.bgFwd : this.bgBwd;
        pass.setBindGroup(0, bg);
        pass.setPipeline(this.clearPipe); pass.dispatchWorkgroups(cellGroups);
        pass.setPipeline(this.scatterPipe); pass.dispatchWorkgroups(nGroups);
        pass.setPipeline(this.simPipe); pass.dispatchWorkgroups(nGroups);
        this.current = 1 - this.current;
      }
      pass.end();
      d.queue.submit([enc.finish()]);
      if (moveEnabled > 0.5) this.step += k;
    }

    // Compute N for externally-uploaded positions (playback) without moving.
    countOnly() {
      this.runSteps(1, 0);
    }

    render(rp) {
      const a = this._uRenderArr;
      a[0] = rp.camX; a[1] = rp.camY;
      a[2] = this.canvas.width; a[3] = this.canvas.height;
      a[4] = rp.zoom; a[5] = rp.mode; a[6] = rp.stride; a[7] = this.n;
      a[8] = rp.t1; a[9] = rp.t2; a[10] = rp.t3; a[11] = rp.densityMax;
      a[12] = rp.turnMax; a[13] = rp.hlMask; a[14] = rp.markerPx; a[15] = 0;
      a[16] = rp.hlBirth; a[17] = rp.hlDeath; a[18] = rp.hlNucleus; a[19] = rp.hlLonely;
      a[20] = rp.hlSpinner; a[21] = 0; a[22] = 0; a[23] = 0;
      setCol(a, 24, rp.colLow); setCol(a, 28, rp.colMid); setCol(a, 32, rp.colHigh); setCol(a, 36, rp.colTop);
      setCol(a, 40, rp.colBirth); setCol(a, 44, rp.colDeath); setCol(a, 48, rp.colNucleus);
      setCol(a, 52, rp.colLonely); setCol(a, 56, rp.colSpinner);
      this.device.queue.writeBuffer(this.uRender, 0, a);

      const d = this.device;
      const enc = d.createCommandEncoder();
      const view = this.context.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view, clearValue: rp.bg || { r: 0.02, g: 0.03, b: 0.05, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      });
      pass.setPipeline(this.renderPipe);
      pass.setBindGroup(0, this.renderBg[this.current]);
      const drawCount = Math.ceil(this.n / Math.max(1, rp.stride));
      pass.draw(drawCount);
      if (rp.trackedCount > 0) {
        pass.setPipeline(this.markerPipe);
        pass.setBindGroup(0, this.markerBg[this.current]);
        pass.draw(6, rp.trackedCount);
      }
      pass.end();
      d.queue.submit([enc.finish()]);
    }

    setTracked(ids) {
      const arr = new Uint32Array(Math.max(1, ids.length));
      for (let i = 0; i < ids.length; i++) arr[i] = ids[i];
      this.device.queue.writeBuffer(this.trackedIds, 0, arr);
    }

    // Read current positions back to the CPU (for recording / picking).
    async readbackPositions() {
      const bytes = 8 * this.n;
      if (!this.staging || this.staging.size < bytes) {
        if (this.staging) this.staging.destroy();
        this.staging = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      }
      const src = this.current === 0 ? this.posA : this.posB;
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(src, 0, this.staging, 0, bytes);
      this.device.queue.submit([enc.finish()]);
      await this.staging.mapAsync(GPUMapMode.READ, 0, bytes);
      const out = new Float32Array(this.staging.getMappedRange(0, bytes).slice(0));
      this.staging.unmap();
      return out; // length 2n interleaved x,y
    }

    // Upload externally-decoded positions into the current buffer (playback).
    uploadPositions(interleaved) {
      const src = this.current === 0 ? this.posA : this.posB;
      this.device.queue.writeBuffer(src, 0, interleaved);
    }

    _destroyBuffers() {
      const names = ['posA', 'posB', 'angA', 'angB', 'NA', 'NB', 'net', 'cellCount', 'cellBins', 'uCompute', 'uRender', 'trackedIds', 'staging'];
      for (const nm of names) if (this[nm]) { this[nm].destroy(); this[nm] = null; }
    }
  }

  function setCol(a, off, c) {
    a[off] = c[0]; a[off + 1] = c[1]; a[off + 2] = c[2]; a[off + 3] = 1;
  }

  PPS.GPUEngine = GPUEngine;
})((window.PPS = window.PPS || {}));
