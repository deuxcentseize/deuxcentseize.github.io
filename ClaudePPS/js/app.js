/* app.js — the controller: owns simulation/renderer/coloring/recorder/batch,
 * the animation loop, tracking state, recording cadence and playback. It is
 * DOM-free apart from the canvas; ui.js drives it. */
(function (PPS) {
  'use strict';

  const DEFAULT_PARAMS = {
    count: 12000, density: 0.08, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 1,
  };

  class App {
    constructor(canvas) {
      this.canvas = canvas;
      this.sim = new PPS.Simulation(Object.assign({}, DEFAULT_PARAMS));
      this.renderer = new PPS.Renderer(canvas);
      this.coloring = new PPS.Coloring();
      this.recorder = new PPS.Recorder();
      this.batch = new PPS.BatchRunner();

      this.playing = false;
      this.stepsPerFrame = 1;
      this.mode = 'live'; // 'live' | 'playback'

      this.tracked = new Set();
      this.trailPaths = new Map(); // id -> [x0,y0,x1,y1,...]
      this.trailCap = 500;

      // Playback state.
      this.playSim = null;
      this.pbIndex = 0;
      this.pbPlaying = false;
      this.pbAccum = 0;

      // Perf counters.
      this._lastT = performance.now();
      this._frames = 0;
      this._stepsSince = 0;
      this._fps = 0;
      this._sps = 0;
      this._metrics = null;
      this._metricFrame = 0;

      // Callbacks (set by ui.js).
      this.onStats = null;
      this.onRecInfo = null;
      this.onPlaybackFrame = null;

      this.renderer.fit(this.sim.W, this.sim.H);
      // Re-fit once the canvas has real layout dimensions (guards against a
      // zero-sized rect at construction time).
      this._fitPending = true;
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    // ---- parameters ----
    rebuild(params) {
      const full = Object.assign({}, this.sim.params, params);
      this.sim = new PPS.Simulation(full);
      this.tracked.clear();
      this.trailPaths.clear();
      this.renderer.fit(this.sim.W, this.sim.H);
      this._metrics = null;
    }

    setLive(partial) {
      this.sim.setLiveParams(partial);
    }

    reset() {
      this.sim.reset(this.sim.params.seed);
      this.trailPaths.clear();
      this._metrics = null;
    }

    manualStep() {
      if (this.mode !== 'live') return;
      this.sim.stepOnce();
      if (this.recorder.recording && this.sim.step % this.recorder.everyN === 0) {
        this.recorder.capture(this.sim);
      }
      this._updateTrails();
      this._metrics = null;
    }

    applyPreset(preset) {
      this.stopRecording();
      this.rebuild(Object.assign({}, preset.params));
    }

    // ---- tracking ----
    pick(canvasX, canvasY, radiusPx) {
      const world = this.renderer.screenToWorld(canvasX, canvasY);
      const worldRadius = (radiusPx || 8) / this.renderer.zoom;
      const id = this.sim.findNearest(world.x, world.y, Math.max(worldRadius, this.sim.params.r));
      if (id < 0) return null;
      if (this.tracked.has(id)) {
        this.tracked.delete(id);
        this.trailPaths.delete(id);
      } else {
        this.tracked.add(id);
      }
      return id;
    }

    clearTracked() {
      this.tracked.clear();
      this.trailPaths.clear();
    }

    _updateTrails() {
      if (!this.renderer.trails || this.tracked.size === 0) return;
      for (const id of this.tracked) {
        let path = this.trailPaths.get(id);
        if (!path) {
          path = [];
          this.trailPaths.set(id, path);
        }
        path.push(this.sim.x[id], this.sim.y[id]);
        if (path.length > this.trailCap) path.splice(0, path.length - this.trailCap);
      }
    }

    // ---- recording ----
    startRecording(everyN, quant) {
      if (this.mode !== 'live') return;
      this.recorder.start(this.sim, everyN, quant);
      this.recorder.capture(this.sim); // capture initial frame
    }
    stopRecording() {
      if (this.recorder.recording) this.recorder.stop();
    }
    exportRecording() {
      const blob = this.recorder.toBlob();
      download(blob, 'run-' + Date.now() + '.pps');
    }
    loadRecording(arrayBuffer) {
      const header = this.recorder.fromBuffer(arrayBuffer);
      this.enterPlayback(header);
      return header;
    }

    // ---- playback ----
    enterPlayback(header) {
      this.playing = false;
      this.mode = 'playback';
      this.playSim = new PPS.Simulation(Object.assign({}, header.params));
      this.pbIndex = 0;
      this.pbPlaying = false;
      this.renderer.fit(this.playSim.W, this.playSim.H);
      this._renderPlaybackFrame();
    }
    exitPlayback() {
      this.mode = 'live';
      this.playSim = null;
      this.pbPlaying = false;
      this.renderer.fit(this.sim.W, this.sim.H);
    }
    setPlaybackIndex(i) {
      this.pbIndex = Math.max(0, Math.min(i, this.recorder.frames.length - 1));
      this._renderPlaybackFrame();
    }
    _renderPlaybackFrame() {
      if (!this.playSim || this.recorder.frames.length === 0) return;
      const ps = this.playSim;
      this.recorder.decodeFrame(this.pbIndex, ps.x, ps.y);
      ps.computeNeighborCounts();
      const colors = this.coloring.computeColors(ps);
      this.renderer.renderFrame(ps.x, ps.y, colors, ps.W, ps.H);
      if (this.onPlaybackFrame) {
        this.onPlaybackFrame(this.pbIndex, this.recorder.frames.length);
      }
    }

    // ---- main loop ----
    _loop(t) {
      const dt = t - this._lastT;
      this.renderer.resize();
      if (this._fitPending && this.renderer.W > 2) {
        const s = this.mode === 'live' ? this.sim : this.playSim;
        if (s) this.renderer.fit(s.W, s.H);
        this._fitPending = false;
      }

      if (this.mode === 'live') {
        if (this.playing) {
          const spf = this.stepsPerFrame;
          const rec = this.recorder;
          for (let s = 0; s < spf; s++) {
            this.sim.stepOnce();
            this._stepsSince++;
            if (rec.recording && this.sim.step % rec.everyN === 0) rec.capture(this.sim);
          }
          this._updateTrails();
        }
        const colors = this.coloring.computeColors(this.sim);
        this.renderer.render(this.sim, colors, this.tracked);
        if (this.renderer.trails && this.tracked.size) {
          const paths = [];
          for (const id of this.tracked) {
            const p = this.trailPaths.get(id);
            if (p) paths.push(p);
          }
          this.renderer.drawTrailPaths(paths, this.sim.W, this.sim.H);
        }
      } else {
        // Playback.
        if (this.pbPlaying) {
          this.pbAccum += 1;
          if (this.pbAccum >= 1) {
            this.pbAccum = 0;
            this.pbIndex++;
            if (this.pbIndex >= this.recorder.frames.length) this.pbIndex = 0;
            this._renderPlaybackFrame();
          }
        }
      }

      // Stats once per ~500ms.
      this._frames++;
      if (t - this._statT > 500 || !this._statT) {
        const elapsed = (t - (this._statT || this._lastT)) / 1000 || 1;
        this._fps = this._frames / elapsed;
        this._sps = this._stepsSince / elapsed;
        this._frames = 0;
        this._stepsSince = 0;
        this._statT = t;
        this._emitStats();
        if (this.recorder.recording && this.onRecInfo) this.onRecInfo();
      }

      this._lastT = t;
      requestAnimationFrame(this._loop);
    }

    _emitStats() {
      if (!this.onStats) return;
      // Recompute expensive metrics only every few emits.
      if (this.mode === 'live' && (this._metricFrame++ % 2 === 0 || !this._metrics)) {
        this._metrics = this.sim.computeMetrics();
      }
      this.onStats({
        fps: this._fps,
        sps: this._sps,
        step: this.sim.step,
        count: this.sim.params.count,
        tracked: this.tracked.size,
        metrics: this._metrics,
      });
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  PPS.App = App;
  PPS.download = download;
  PPS.DEFAULT_PARAMS = DEFAULT_PARAMS;
})((window.PPS = window.PPS || {}));
