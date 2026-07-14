/* gpuapp.js — controller for the WebGPU engine.
 *
 * Throughput levers (this is where the >1000x comes from):
 *   substeps      — simulation steps encoded per animation frame (GPU runs them
 *                   back-to-back with no CPU/JS per step)
 *   renderEvery   — only draw every Nth frame ("hide frames"); the sim keeps
 *                   running full speed in between
 *   displayStride — draw only 1 of every M particles ("hide particles")
 *   turbo         — widen the time budget and drop rendering to a trickle
 *
 * Reported throughput is particle-steps/sec (n × steps/sec), the fair metric. */
(function (PPS) {
  'use strict';

  function chunkFor(n) {
    // Bound the work per submit to avoid GPU watchdog resets on big n.
    return Math.max(1, Math.min(512, Math.floor(3e7 / n)));
  }

  class GPUApp {
    static async create(canvas) {
      const engine = await PPS.GPUEngine.create(canvas);
      return new GPUApp(engine, canvas);
    }

    constructor(engine, canvas) {
      this.engine = engine;
      this.canvas = canvas;
      this.recorder = new PPS.Recorder();

      this.playing = true;
      this.mode = 'live';
      this.substeps = 8;
      this.renderEvery = 1;
      this.displayStride = 1;
      this.turbo = false;

      this.camX = 0; this.camY = 0; this.zoom = 1;
      this.tracked = new Set();

      this.recording = false;
      this._lastCap = 0;

      this.pbIndex = 0; this.pbPlaying = false; this.pbSpeed = 4;

      // Colour/highlight config (parallels the CPU version, built into shaders).
      this.colorMode = 0; // 0 classic, 1 density, 2 heading, 3 turn
      this.thresholds = { t1: 13, t2: 15, t3: 35 };
      this.densityMax = 50; this.turnMax = 12;
      this.colors = {
        low: [0.59, 0.35, 0.16], mid: [0.16, 0.82, 0.31], high: [0.16, 0.51, 1.0], top: [0.92, 0.24, 0.86],
      };
      this.highlights = {
        birth: { on: false, t: 6, col: [1, 1, 1] },
        death: { on: false, t: 6, col: [1, 0.2, 0.2] },
        nucleus: { on: false, t: 40, col: [1, 0.9, 0] },
        lonely: { on: false, t: 1, col: [0, 1, 1] },
        spinner: { on: false, t: 10, col: [1, 0.55, 0] },
      };

      this._frames = 0; this._stepsSince = 0; this._statT = 0;
      this.fps = 0; this.sps = 0;
      this.onStats = null; this.onRecInfo = null; this.onPlaybackFrame = null;

      this._xBuf = null; this._yBuf = null; this._inter = null;
      this._running = false;
    }

    init(params) {
      this.engine.init(params);
      this.mode = 'live';
      this.tracked.clear();
      this.fit();
      if (!this._running) { this._running = true; this._tick(); }
    }

    rebuild(partial) {
      const full = Object.assign({}, this.engine.params, partial);
      this.stopRecording();
      this.init(full);
    }

    setLive(partial) { this.engine.setLive(partial); }

    applyPreset(preset) { this.rebuild(Object.assign({}, preset.params)); }

    // ---- camera ----
    fit() {
      const w = this.canvas.width, h = this.canvas.height;
      this.zoom = Math.min(w / this.engine.W, h / this.engine.H);
      this.camX = this.engine.W / 2; this.camY = this.engine.H / 2;
    }
    screenToWorld(cssX, cssY) {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = this.canvas.width / rect.width;
      const px = cssX * dpr, py = cssY * dpr;
      return {
        x: (px - this.canvas.width / 2) / this.zoom + this.camX,
        y: (py - this.canvas.height / 2) / this.zoom + this.camY,
      };
    }
    zoomAt(cssX, cssY, factor) {
      const before = this.screenToWorld(cssX, cssY);
      this.zoom *= factor;
      const after = this.screenToWorld(cssX, cssY);
      this.camX += before.x - after.x;
      this.camY += before.y - after.y;
    }
    panByPixels(dx, dy) {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = this.canvas.width / rect.width;
      this.camX -= (dx * dpr) / this.zoom;
      this.camY -= (dy * dpr) / this.zoom;
    }

    _syncCanvasSize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        if (this._fitPending) { this.fit(); this._fitPending = false; }
      }
    }

    // ---- tracking ----
    async pick(cssX, cssY) {
      const world = this.screenToWorld(cssX, cssY);
      const inter = await this.engine.readbackPositions();
      const n = this.engine.n;
      const W = this.engine.W, H = this.engine.H, hw = W / 2, hh = H / 2;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        let dx = inter[i * 2] - world.x, dy = inter[i * 2 + 1] - world.y;
        if (dx > hw) dx -= W; else if (dx < -hw) dx += W;
        if (dy > hh) dy -= H; else if (dy < -hh) dy += H;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      if (this.tracked.has(best)) this.tracked.delete(best); else this.tracked.add(best);
      this.engine.setTracked(Array.from(this.tracked));
    }
    clearTracked() { this.tracked.clear(); this.engine.setTracked([]); }

    // ---- recording ----
    startRecording(everyN, quant) {
      const e = this.engine;
      const shim = { params: e.params, W: e.W, H: e.H, step: e.step };
      this.recorder.start(shim, everyN, quant);
      this.recording = true;
      this._lastCap = e.step - everyN; // capture soon
    }
    stopRecording() {
      if (this.recording) { this.recorder.stop(); this.recording = false; }
    }
    exportRecording() {
      PPS.download(this.recorder.toBlob(), 'gpu-run-' + Date.now() + '.pps');
    }
    async loadRecording(buf) {
      const header = this.recorder.fromBuffer(buf);
      this.stopRecording();
      // Re-init the engine to the recording's dimensions, then play frames over it.
      this.engine.init(header.params);
      this.mode = 'playback';
      this.pbIndex = 0; this.pbPlaying = false;
      this.fit();
      this._renderPlayback();
      return header;
    }
    exitPlayback() {
      this.mode = 'live';
      this.init(Object.assign({}, this.engine.params));
    }

    async _captureFrame() {
      this.engine._readbackBusy = true;
      const inter = await this.engine.readbackPositions();
      const n = this.engine.n;
      if (!this._xBuf || this._xBuf.length !== n) {
        this._xBuf = new Float32Array(n); this._yBuf = new Float32Array(n);
      }
      for (let i = 0; i < n; i++) { this._xBuf[i] = inter[i * 2]; this._yBuf[i] = inter[i * 2 + 1]; }
      this.recorder.capture({ params: { count: n }, x: this._xBuf, y: this._yBuf, W: this.engine.W, H: this.engine.H });
      this.engine._readbackBusy = false;
    }

    _renderPlayback() {
      const frames = this.recorder.frames.length;
      if (frames === 0) return;
      const n = this.engine.n;
      const idx = ((Math.floor(this.pbIndex) % frames) + frames) % frames;
      if (!this._xBuf || this._xBuf.length !== n) {
        this._xBuf = new Float32Array(n); this._yBuf = new Float32Array(n);
      }
      if (!this._inter || this._inter.length !== 2 * n) this._inter = new Float32Array(2 * n);
      this.recorder.decodeFrame(idx, this._xBuf, this._yBuf);
      for (let i = 0; i < n; i++) { this._inter[i * 2] = this._xBuf[i]; this._inter[i * 2 + 1] = this._yBuf[i]; }
      this.engine.uploadPositions(this._inter);
      this.engine.countOnly();
      this.engine.render(this._renderParams());
      if (this.onPlaybackFrame) this.onPlaybackFrame(idx, frames);
    }

    _renderParams() {
      const h = this.highlights;
      let mask = 0;
      if (h.birth.on) mask |= 1;
      if (h.death.on) mask |= 2;
      if (h.nucleus.on) mask |= 4;
      if (h.lonely.on) mask |= 8;
      if (h.spinner.on) mask |= 16;
      return {
        camX: this.camX, camY: this.camY, zoom: this.zoom,
        mode: this.colorMode, stride: Math.max(1, this.displayStride),
        t1: this.thresholds.t1, t2: this.thresholds.t2, t3: this.thresholds.t3,
        densityMax: this.densityMax, turnMax: this.turnMax,
        hlMask: mask,
        hlBirth: h.birth.t, hlDeath: h.death.t, hlNucleus: h.nucleus.t, hlLonely: h.lonely.t, hlSpinner: h.spinner.t,
        colLow: this.colors.low, colMid: this.colors.mid, colHigh: this.colors.high, colTop: this.colors.top,
        colBirth: h.birth.col, colDeath: h.death.col, colNucleus: h.nucleus.col, colLonely: h.lonely.col, colSpinner: h.spinner.col,
        markerPx: 6,
        trackedCount: this.tracked.size,
        bg: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
      };
    }

    manualStep() {
      if (this.mode !== 'live') return;
      this.engine.runSteps(1, 1);
      this._stepsSince += 1;
    }

    // Headless throughput benchmark across particle counts. Pauses the loop,
    // times pure compute (no rendering, no readback), then restores state.
    async benchmark(sizes, steps) {
      const prev = Object.assign({}, this.engine.params);
      const wasPlaying = this.playing;
      this.playing = false; this.mode = 'live';
      const dev = this.engine.device;
      await dev.queue.onSubmittedWorkDone();
      const out = [];
      for (const n of sizes) {
        try {
          this.engine.init(Object.assign({}, prev, { count: n }));
          this.engine.runSteps(4, 1);
          await dev.queue.onSubmittedWorkDone();
          const chunk = chunkFor(n);
          const t0 = performance.now();
          let done = 0;
          while (done < steps) { const k = Math.min(chunk, steps - done); this.engine.runSteps(k, 1); done += k; }
          await dev.queue.onSubmittedWorkDone();
          const dt = (performance.now() - t0) / 1000;
          out.push({ n, sps: Math.round(steps / dt), pps: Math.round((n * steps) / dt) });
        } catch (e) {
          out.push({ n, error: String(e.message || e) });
        }
      }
      this.init(prev);
      this.playing = wasPlaying;
      return out;
    }

    // ---- main loop ----
    async _tick() {
      const t = performance.now();
      this._syncCanvasSize();

      if (this.mode === 'live') {
        if (this.playing) {
          const budget = t + (this.turbo ? 28 : 12);
          const target = this.substeps;
          const chunk = chunkFor(this.engine.n);
          let did = 0;
          while (did < target && performance.now() < budget) {
            const k = Math.min(chunk, target - did);
            this.engine.runSteps(k, 1);
            did += k;
          }
          await this.engine.device.queue.onSubmittedWorkDone();
          this._stepsSince += did;

          if (this.recording && !this.engine._readbackBusy &&
              this.engine.step - this._lastCap >= this.recorder.everyN) {
            await this._captureFrame();
            this._lastCap = this.engine.step;
          }
        }
        const renderEvery = this.turbo ? Math.max(this.renderEvery, 20) : this.renderEvery;
        if (this._frames % renderEvery === 0) this.engine.render(this._renderParams());
      } else {
        if (this.pbPlaying) this.pbIndex += this.pbSpeed;
        this._renderPlayback();
      }

      this._frames++;
      if (t - this._statT > 400) {
        const el = (t - (this._statT || t)) / 1000 || 1;
        this.fps = this._frames / (el);
        this.sps = this._stepsSince / el;
        this._frames = 0; this._stepsSince = 0; this._statT = t;
        if (this.onStats) this.onStats({
          fps: this.fps, sps: this.sps, pps: this.sps * this.engine.n,
          step: this.engine.step, count: this.engine.n, tracked: this.tracked.size,
        });
        if (this.recording && this.onRecInfo) this.onRecInfo();
      }
      requestAnimationFrame(() => this._tick());
    }
  }

  PPS.GPUApp = GPUApp;
})((window.PPS = window.PPS || {}));
