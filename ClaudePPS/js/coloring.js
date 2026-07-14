/* coloring.js — colour coding + novelty highlighting ("tracking").
 *
 * Produces a Uint32Array of ABGR pixel colours (one per particle) that the
 * renderer blits directly. Two layers:
 *
 *   1. Base colour mode  — classic PPS neighbour-count palette, heading hue,
 *      turning bias, continuous density colormap, or a custom expression.
 *   2. Highlight rules   — overlay that recolours particles matching a
 *      predicate (a "novel situation"). Built-in detectors are inlined for
 *      speed; user rules are compiled from an expression string on the fly.
 *
 * Everything a rule can see is exposed as a feature: N, dN, net, angle, speed,
 * x, y, id, age. New rules can be authored at runtime without a reload. */
(function (PPS) {
  'use strict';

  const TAU = Math.PI * 2;

  // Pack to little-endian ABGR (what a Uint32 view of ImageData expects).
  function rgb(r, g, b) {
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }
  function rgba(r, g, b, a) {
    return (a << 24) | (b << 16) | (g << 8) | r;
  }
  PPS.rgb = rgb;

  // HSV -> packed colour (used for heading hue and colormaps).
  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return rgb((r * 255) | 0, (g * 255) | 0, (b * 255) | 0);
  }

  // 256-entry hue lookup for heading colouring.
  const HUE_LUT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) HUE_LUT[i] = hsv(i / 256, 0.85, 1.0);

  // Turbo-ish continuous colormap for density (blue -> green -> red).
  const DENSITY_LUT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) DENSITY_LUT[i] = hsv(0.66 - 0.66 * (i / 255), 0.9, 1.0);

  class Coloring {
    constructor() {
      this.mode = 'classic';

      // Classic PPS palette: colour encodes local neighbour count N.
      // Defaults follow the Schmickl et al. figures (editable on the fly).
      this.thresholds = { t1: 13, t2: 15, t3: 35 };
      this.classColors = {
        low: rgb(150, 90, 40), // brown  : N <= t1  (sparse / cell wall)
        mid: rgb(40, 210, 80), // green  : t1 < N <= t2 (membrane)
        high: rgb(40, 130, 255), // blue : t2 < N <= t3 (cytoplasm)
        top: rgb(235, 60, 220), // magenta: N > t3 (dense nucleus)
      };

      this.densityMax = 50; // N mapped onto the density colormap
      this.turnMax = 12; // |net| mapped for the turn colormap

      this.customExpr = 'N'; // scalar expression -> density colormap
      this._customFn = null;
      this.customError = '';

      // Highlight rule set. Built-ins have fast inlined paths; `expr` rules are
      // compiled. `enabled` toggles each without deleting it.
      this.rules = PPS.defaultRules ? PPS.defaultRules() : [];

      this._colors = new Uint32Array(0);
    }

    setMode(m) {
      this.mode = m;
      if (m === 'custom') this._compileCustom();
    }

    setCustomExpr(expr) {
      this.customExpr = expr;
      this._compileCustom();
    }

    _compileCustom() {
      try {
        // Expression sees the feature names as locals via `with`.
        // Client-side demo only; not a security boundary.
        this._customFn = new Function(
          'N', 'dN', 'net', 'angle', 'speed', 'x', 'y', 'id', 'age',
          'return (' + (this.customExpr || '0') + ');'
        );
        // Smoke-test with dummy values.
        this._customFn(10, 0, 0, 0, 0, 0, 0, 0, 0);
        this.customError = '';
      } catch (e) {
        this._customFn = null;
        this.customError = String(e.message || e);
      }
    }

    // Recompile every enabled expression rule; returns list of errors.
    compileRules() {
      const errors = [];
      for (const rule of this.rules) {
        if (rule.type !== 'expr') continue;
        try {
          rule._fn = new Function(
            'N', 'dN', 'net', 'angle', 'speed', 'x', 'y', 'id', 'age',
            'return (' + (rule.expr || 'false') + ');'
          );
          rule._fn(10, 0, 0, 0, 0, 0, 0, 0, 0);
          rule.error = '';
        } catch (e) {
          rule._fn = null;
          rule.error = String(e.message || e);
          errors.push({ rule: rule.name, error: rule.error });
        }
      }
      return errors;
    }

    _rebuildClassicLUT() {
      const t = this.thresholds;
      const c = this.classColors;
      const lut = new Uint32Array(256);
      for (let N = 0; N < 256; N++) {
        if (N <= t.t1) lut[N] = c.low;
        else if (N <= t.t2) lut[N] = c.mid;
        else if (N <= t.t3) lut[N] = c.high;
        else lut[N] = c.top;
      }
      this._classicLUT = lut;
    }

    // Main entry: fill and return a colour-per-particle array for `sim`.
    computeColors(sim) {
      const n = sim.params.count;
      if (this._colors.length !== n) this._colors = new Uint32Array(n);
      const colors = this._colors;
      const N = sim.N;
      const prevN = sim.prevN;
      const net = sim.net;
      const a = sim.a;

      // ---- base layer -------------------------------------------------------
      if (this.mode === 'classic') {
        if (!this._classicLUT) this._rebuildClassicLUT();
        const lut = this._classicLUT;
        for (let i = 0; i < n; i++) {
          let v = N[i];
          if (v > 255) v = 255;
          colors[i] = lut[v];
        }
      } else if (this.mode === 'heading') {
        for (let i = 0; i < n; i++) {
          const idx = ((a[i] / TAU) * 256) & 255;
          colors[i] = HUE_LUT[idx];
        }
      } else if (this.mode === 'turn') {
        const scale = 255 / (this.turnMax || 1);
        for (let i = 0; i < n; i++) {
          let m = Math.abs(net[i]) * scale;
          if (m > 255) m = 255;
          colors[i] = DENSITY_LUT[m | 0];
        }
      } else if (this.mode === 'density') {
        const scale = 255 / (this.densityMax || 1);
        for (let i = 0; i < n; i++) {
          let m = N[i] * scale;
          if (m > 255) m = 255;
          colors[i] = DENSITY_LUT[m | 0];
        }
      } else if (this.mode === 'custom' && this._customFn) {
        const fn = this._customFn;
        const scale = 255 / (this.densityMax || 1);
        for (let i = 0; i < n; i++) {
          let val;
          try {
            val = fn(N[i], N[i] - prevN[i], net[i], a[i], 0, sim.x[i], sim.y[i], i, sim.age[i]);
          } catch (e) {
            val = 0;
          }
          let m = val * scale;
          if (m < 0) m = 0;
          else if (m > 255) m = 255;
          colors[i] = DENSITY_LUT[m | 0];
        }
      } else {
        colors.fill(rgb(200, 200, 200));
      }

      // ---- highlight overlay ------------------------------------------------
      this._applyHighlights(sim, colors);
      return colors;
    }

    _applyHighlights(sim, colors) {
      const active = this.rules.filter((r) => r.enabled);
      if (active.length === 0) return;
      const n = sim.params.count;
      const N = sim.N;
      const prevN = sim.prevN;
      const net = sim.net;

      // Rules are applied in order; later (higher priority) wins. We iterate
      // rules outer / particles inner so the fast built-ins vectorise well.
      for (const rule of active) {
        const col = rule.color;
        if (rule.type === 'builtin') {
          const T = rule.threshold;
          switch (rule.key) {
            case 'birth': // rapid local densification (cell forming/merging)
              for (let i = 0; i < n; i++) if (N[i] - prevN[i] >= T) colors[i] = col;
              break;
            case 'death': // rapid local rarefaction (cell dissolving)
              for (let i = 0; i < n; i++) if (N[i] - prevN[i] <= -T) colors[i] = col;
              break;
            case 'nucleus': // very dense core
              for (let i = 0; i < n; i++) if (N[i] >= T) colors[i] = col;
              break;
            case 'lonely': // isolated wanderers
              for (let i = 0; i < n; i++) if (N[i] <= T) colors[i] = col;
              break;
            case 'spinner': // strong turning bias
              for (let i = 0; i < n; i++) if (Math.abs(net[i]) >= T) colors[i] = col;
              break;
          }
        } else if (rule.type === 'rare') {
          // Highlight particles whose N value is globally rare this frame.
          this._applyRare(sim, colors, rule);
        } else if (rule.type === 'expr' && rule._fn) {
          const fn = rule._fn;
          for (let i = 0; i < n; i++) {
            let hit;
            try {
              hit = fn(N[i], N[i] - prevN[i], net[i], sim.a[i], 0, sim.x[i], sim.y[i], i, sim.age[i]);
            } catch (e) {
              hit = false;
            }
            if (hit) colors[i] = col;
          }
        }
      }
    }

    _applyRare(sim, colors, rule) {
      const n = sim.params.count;
      const N = sim.N;
      const hist = this._rareHist || (this._rareHist = new Int32Array(256));
      hist.fill(0);
      for (let i = 0; i < n; i++) {
        let v = N[i];
        if (v > 255) v = 255;
        hist[v]++;
      }
      // "Rare" = value occurring in fewer than `threshold`% of particles.
      const cutoff = Math.max(1, (n * (rule.threshold || 0.5)) / 100);
      const col = rule.color;
      for (let i = 0; i < n; i++) {
        let v = N[i];
        if (v > 255) v = 255;
        if (hist[v] > 0 && hist[v] < cutoff) colors[i] = col;
      }
    }
  }

  // Predefined highlight rules ("novel situations"), all editable at runtime.
  PPS.defaultRules = function defaultRules() {
    return [
      { name: 'Cell birth (dN↑)', type: 'builtin', key: 'birth', threshold: 6, color: rgb(255, 255, 255), enabled: false },
      { name: 'Cell death (dN↓)', type: 'builtin', key: 'death', threshold: 6, color: rgb(255, 40, 40), enabled: false },
      { name: 'Dense nucleus', type: 'builtin', key: 'nucleus', threshold: 40, color: rgb(255, 230, 0), enabled: false },
      { name: 'Lonely wanderer', type: 'builtin', key: 'lonely', threshold: 1, color: rgb(0, 255, 255), enabled: false },
      { name: 'Strong spinner', type: 'builtin', key: 'spinner', threshold: 10, color: rgb(255, 140, 0), enabled: false },
      { name: 'Rare density', type: 'rare', threshold: 0.4, color: rgb(255, 255, 255), enabled: false },
    ];
  };

  PPS.Coloring = Coloring;
  PPS.rgba = rgba;
})((window.PPS = window.PPS || {}));
