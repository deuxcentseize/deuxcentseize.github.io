/* renderer.js — fast particle rendering via direct ImageData writes.
 *
 * Drawing tens of thousands of individual canvas ops is far too slow, so we
 * keep a Uint32 pixel buffer, splat each particle straight into it, and push
 * the whole frame with putImageData once. Supports pan/zoom, an optional
 * decaying-trail mode, and highlighted rendering of tracked particles.
 *
 * It can render either a live Simulation (uses precomputed colours) or decoded
 * playback frames (positions + a colour array supplied by the caller). */
(function (PPS) {
  'use strict';

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.dotSize = 2;
      this.bg = { r: 8, g: 10, b: 16 };
      this.trails = false;
      this.trailDecay = 4; // higher = faster fade (buffer >> decay)
      // Camera: world units -> screen pixels.
      this.camX = 0;
      this.camY = 0;
      this.zoom = 1;
      this._pixels = null;
      this._img = null;
      this._u32 = null;
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width === w && this.canvas.height === h && this._img) return;
      this.canvas.width = w;
      this.canvas.height = h;
      this._img = this.ctx.createImageData(w, h);
      this._u32 = new Uint32Array(this._img.data.buffer);
      this.W = w;
      this.H = h;
      this._clearBuffer();
    }

    _bgColor() {
      return (255 << 24) | (this.bg.b << 16) | (this.bg.g << 8) | this.bg.r;
    }

    _clearBuffer() {
      if (this._u32) this._u32.fill(this._bgColor());
    }

    // Fit the whole world into the viewport.
    fit(worldW, worldH) {
      const z = Math.min(this.W / worldW, this.H / worldH);
      this.zoom = z;
      this.camX = worldW / 2;
      this.camY = worldH / 2;
    }

    worldToScreen(wx, wy) {
      return {
        x: (wx - this.camX) * this.zoom + this.W / 2,
        y: (wy - this.camY) * this.zoom + this.H / 2,
      };
    }
    screenToWorld(sx, sy) {
      const dpr = this.W / this.canvas.getBoundingClientRect().width;
      sx *= dpr;
      sy *= dpr;
      return {
        x: (sx - this.W / 2) / this.zoom + this.camX,
        y: (sy - this.H / 2) / this.zoom + this.camY,
      };
    }

    zoomAt(screenX, screenY, factor) {
      const before = this.screenToWorld(screenX, screenY);
      this.zoom *= factor;
      const after = this.screenToWorld(screenX, screenY);
      this.camX += before.x - after.x;
      this.camY += before.y - after.y;
    }

    panByPixels(dx, dy) {
      const dpr = this.W / this.canvas.getBoundingClientRect().width;
      this.camX -= (dx * dpr) / this.zoom;
      this.camY -= (dy * dpr) / this.zoom;
    }

    _prepareFrame() {
      if (this.trails) {
        // Decay the previous frame toward the background instead of clearing.
        const u32 = this._u32;
        const buf = this._img.data;
        const d = this.trailDecay;
        const br = this.bg.r, bg = this.bg.g, bb = this.bg.b;
        for (let p = 0; p < buf.length; p += 4) {
          buf[p] += (br - buf[p]) >> d;
          buf[p + 1] += (bg - buf[p + 1]) >> d;
          buf[p + 2] += (bb - buf[p + 2]) >> d;
        }
      } else {
        this._clearBuffer();
      }
    }

    // Splat one dot (square of side `size`) centred at integer screen (sx,sy).
    _splat(sx, sy, color, size) {
      const W = this.W, H = this.H;
      const u32 = this._u32;
      const half = size >> 1;
      let x0 = sx - half, y0 = sy - half;
      let x1 = x0 + size, y1 = y0 + size;
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 > W) x1 = W;
      if (y1 > H) y1 = H;
      for (let y = y0; y < y1; y++) {
        let row = y * W;
        for (let x = x0; x < x1; x++) u32[row + x] = color;
      }
    }

    // Render a live simulation with a precomputed colour array.
    render(sim, colors, tracked) {
      this._prepareFrame();
      const n = sim.params.count;
      const x = sim.x, y = sim.y;
      const zoom = this.zoom;
      const ox = this.W / 2 - this.camX * zoom;
      const oy = this.H / 2 - this.camY * zoom;
      const size = this.dotSize;
      const W = this.W, H = this.H;
      const u32 = this._u32;

      if (size <= 1) {
        // Fast path: single pixel per particle.
        for (let i = 0; i < n; i++) {
          const sx = (x[i] * zoom + ox) | 0;
          if (sx < 0 || sx >= W) continue;
          const sy = (y[i] * zoom + oy) | 0;
          if (sy < 0 || sy >= H) continue;
          u32[sy * W + sx] = colors[i];
        }
      } else {
        for (let i = 0; i < n; i++) {
          const sx = (x[i] * zoom + ox) | 0;
          const sy = (y[i] * zoom + oy) | 0;
          if (sx < -size || sx >= W + size || sy < -size || sy >= H + size) continue;
          this._splat(sx, sy, colors[i], size);
        }
      }

      this._drawTracked(sim, tracked);
      this.ctx.putImageData(this._img, 0, 0);
    }

    // Render a decoded playback frame (positions + colours only).
    renderFrame(px, py, colors, worldW, worldH) {
      this._prepareFrame();
      const n = px.length;
      const zoom = this.zoom;
      const ox = this.W / 2 - this.camX * zoom;
      const oy = this.H / 2 - this.camY * zoom;
      const size = this.dotSize;
      const W = this.W, H = this.H;
      const u32 = this._u32;
      for (let i = 0; i < n; i++) {
        const sx = (px[i] * zoom + ox) | 0;
        const sy = (py[i] * zoom + oy) | 0;
        if (size <= 1) {
          if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
          u32[sy * W + sx] = colors[i];
        } else {
          if (sx < -size || sx >= W + size || sy < -size || sy >= H + size) continue;
          this._splat(sx, sy, colors[i], size);
        }
      }
      this.ctx.putImageData(this._img, 0, 0);
    }

    _drawTracked(sim, tracked) {
      if (!tracked || tracked.size === 0) return;
      const zoom = this.zoom;
      const ox = this.W / 2 - this.camX * zoom;
      const oy = this.H / 2 - this.camY * zoom;
      const ring = rgb(255, 255, 255);
      const size = Math.max(6, this.dotSize + 4);
      for (const id of tracked) {
        if (id >= sim.params.count) continue;
        const sx = (sim.x[id] * zoom + ox) | 0;
        const sy = (sim.y[id] * zoom + oy) | 0;
        this._drawRing(sx, sy, size, ring);
      }
    }

    _drawRing(cx, cy, size, color) {
      const half = size >> 1;
      for (let d = -half; d <= half; d++) {
        this._set(cx + d, cy - half, color); // top edge
        this._set(cx + d, cy + half, color); // bottom edge
        this._set(cx - half, cy + d, color); // left edge
        this._set(cx + half, cy + d, color); // right edge
      }
    }
    _set(x, y, c) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
      this._u32[y * this.W + x] = c;
    }

    // Draw poly-line trails for tracked particles (world-space points).
    drawTrailPaths(paths, worldW, worldH) {
      if (!paths || paths.length === 0) return;
      const ctx = this.ctx;
      const zoom = this.zoom;
      const ox = this.W / 2 - this.camX * zoom;
      const oy = this.H / 2 - this.camY * zoom;
      ctx.save();
      ctx.lineWidth = Math.max(1, zoom * 0.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      const seamX = worldW * 0.5;
      const seamY = worldH * 0.5;
      for (const path of paths) {
        if (path.length < 4) continue;
        ctx.beginPath();
        let prevX = null, prevY = null;
        for (let k = 0; k < path.length; k += 2) {
          const wx = path[k];
          const wy = path[k + 1];
          const sx = wx * zoom + ox;
          const sy = wy * zoom + oy;
          // Break the line if the particle wrapped across the toroidal seam.
          if (prevX === null || Math.abs(wx - prevX) > seamX || Math.abs(wy - prevY) > seamY) {
            ctx.moveTo(sx, sy);
          } else {
            ctx.lineTo(sx, sy);
          }
          prevX = wx;
          prevY = wy;
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function rgb(r, g, b) {
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  PPS.Renderer = Renderer;
})((window.PPS = window.PPS || {}));
