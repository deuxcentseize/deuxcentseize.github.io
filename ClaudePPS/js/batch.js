/* batch.js — run many consecutive simulations to hunt for interesting regimes.
 *
 * Two ways to define a batch:
 *   - Parameter sweep: vary one parameter across a range in K steps.
 *   - Seed sweep: same parameters, K different seeds.
 *
 * Each configuration runs headless (no per-step rendering) for `steps` steps,
 * then we snapshot metrics (mean/var of N, cluster count, activity) and a small
 * thumbnail. Results are ranked so genuinely different conditions surface. Runs
 * are chunked via requestAnimationFrame so the UI stays responsive, with a
 * progress callback. Optionally each run is recorded to a compact blob. */
(function (PPS) {
  'use strict';

  class BatchRunner {
    constructor() {
      this.running = false;
      this.cancelRequested = false;
      this.results = [];
    }

    // spec: {
    //   base: params, steps, thumbSize,
    //   mode: 'param' | 'seed',
    //   param, from, to, count,          // for 'param'
    //   seeds,                           // for 'seed' (array) OR count+baseSeed
    //   record, everyN, quant,           // optional per-run recording
    // }
    buildConfigs(spec) {
      const configs = [];
      if (spec.mode === 'param') {
        const k = Math.max(2, spec.count | 0);
        for (let i = 0; i < k; i++) {
          const t = k === 1 ? 0 : i / (k - 1);
          const val = spec.from + (spec.to - spec.from) * t;
          const p = Object.assign({}, spec.base);
          p[spec.param] = round(val, spec.param);
          configs.push({ label: spec.param + '=' + round(val, spec.param), params: p });
        }
      } else {
        const seeds = spec.seeds ||
          Array.from({ length: spec.count | 0 }, (_, i) => (spec.baseSeed || 1) + i);
        for (const s of seeds) {
          const p = Object.assign({}, spec.base, { seed: s });
          configs.push({ label: 'seed=' + s, params: p });
        }
      }
      return configs;
    }

    // Run asynchronously. onProgress(done, total, lastResult). Returns a promise.
    run(spec, onProgress) {
      this.running = true;
      this.cancelRequested = false;
      this.results = [];
      const configs = this.buildConfigs(spec);
      const steps = spec.steps | 0;
      const thumbSize = spec.thumbSize || 96;

      return new Promise((resolve) => {
        let ci = 0;
        const self = this;

        function nextConfig() {
          if (self.cancelRequested || ci >= configs.length) {
            self.running = false;
            resolve(self.results);
            return;
          }
          const cfg = configs[ci];
          const sim = new PPS.Simulation(cfg.params);
          let rec = null;
          if (spec.record) {
            rec = new PPS.Recorder();
            rec.start(sim, spec.everyN || 5, spec.quant || 12);
          }
          let s = 0;

          function chunk() {
            if (self.cancelRequested) {
              self.running = false;
              resolve(self.results);
              return;
            }
            const budget = performance.now() + 12; // ~12ms slices
            while (s < steps && performance.now() < budget) {
              sim.stepOnce();
              if (rec && s % rec.everyN === 0) rec.capture(sim);
              s++;
            }
            if (s < steps) {
              requestAnimationFrame(chunk);
              return;
            }
            if (rec) rec.stop();
            const metrics = sim.computeMetrics();
            const thumb = makeThumb(sim, thumbSize);
            const result = {
              label: cfg.label,
              params: cfg.params,
              metrics,
              thumb,
              recording: rec ? rec.toBlob() : null,
            };
            self.results.push(result);
            ci++;
            if (onProgress) onProgress(ci, configs.length, result);
            // Yield before the next configuration.
            requestAnimationFrame(nextConfig);
          }
          chunk();
        }
        nextConfig();
      });
    }

    cancel() {
      this.cancelRequested = true;
    }

    // Rank results by how far each is from the batch mean (novelty proxy).
    rankByNovelty() {
      const rs = this.results;
      if (rs.length === 0) return rs;
      const keys = ['meanN', 'stdN', 'clusters', 'activity'];
      const stats = {};
      for (const k of keys) {
        const vals = rs.map((r) => r.metrics[k]);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const varr = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
        stats[k] = { mean, std: Math.sqrt(varr) || 1 };
      }
      for (const r of rs) {
        let score = 0;
        for (const k of keys) {
          score += Math.abs((r.metrics[k] - stats[k].mean) / stats[k].std);
        }
        r.novelty = score;
      }
      return rs.slice().sort((a, b) => b.novelty - a.novelty);
    }
  }

  function round(v, param) {
    if (param === 'count') return Math.round(v);
    return Math.round(v * 1000) / 1000;
  }

  // Render a tiny classic-coloured thumbnail to a data URL.
  function makeThumb(sim, size) {
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const u32 = new Uint32Array(img.data.buffer);
    u32.fill((255 << 24) | (16 << 16) | (10 << 8) | 8);
    const coloring = new PPS.Coloring();
    const colors = coloring.computeColors(sim);
    const sx = size / sim.W;
    const sy = size / sim.H;
    const n = sim.params.count;
    for (let i = 0; i < n; i++) {
      const px = (sim.x[i] * sx) | 0;
      const py = (sim.y[i] * sy) | 0;
      if (px < 0 || px >= size || py < 0 || py >= size) continue;
      u32[py * size + px] = colors[i];
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  PPS.BatchRunner = BatchRunner;
})((window.PPS = window.PPS || {}));
