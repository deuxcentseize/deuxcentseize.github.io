/* simulation.js — Primordial Particle System (PPS) core.
 *
 * Model: Schmickl, Stefanec & Crailsheim, "How a life-like system emerges from
 * a simple particle motion law" (Scientific Reports, 2016; Artificial Life Lab,
 * Uni Graz). Each particle has a position and heading. Every step:
 *
 *   N   = number of neighbours within radius r
 *   L,R = how many of those are on the left / right of the heading
 *   dphi= alpha + beta * N * sign(R - L)
 *   phi += dphi ; x += v*cos(phi) ; y += v*sin(phi)
 *
 * With alpha=180deg, beta=17deg, v=0.67, r=5, density~0.08 the swarm
 * self-organises into growing, dividing, dying "cells".
 *
 * Performance: neighbour search uses a uniform spatial grid (cell size = r) so
 * each particle only tests the 3x3 block of cells around it. All state lives in
 * flat typed arrays; positions are double-buffered so a step reads the old
 * state and writes the new one (synchronous update, as the model requires). */
(function (PPS) {
  'use strict';

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  class Simulation {
    constructor(params) {
      this.params = Object.assign(
        {
          count: 10000,
          density: 0.08, // particles per unit^2 -> derives world size
          alpha: 180, // degrees
          beta: 17, // degrees
          v: 0.67, // step length
          r: 5, // interaction radius
          seed: 1,
        },
        params || {}
      );
      this.step = 0;
      this._allocate();
      this.reset(this.params.seed);
    }

    // ----- allocation --------------------------------------------------------
    _allocate() {
      const n = this.params.count;
      // World is square, sized so that count/area == density.
      this.W = this.H = Math.sqrt(n / this.params.density);

      this.x = new Float32Array(n);
      this.y = new Float32Array(n);
      this.a = new Float32Array(n); // heading (radians)
      // Double buffers for a synchronous update.
      this.x2 = new Float32Array(n);
      this.y2 = new Float32Array(n);
      this.a2 = new Float32Array(n);

      this.N = new Int16Array(n); // neighbour count (for colour/tracking)
      this.prevN = new Int16Array(n); // N last step (novelty: dN = N - prevN)
      this.net = new Int16Array(n); // R - L (turning bias)
      this.age = new Int32Array(n); // steps alive (never culled, but useful)

      this._buildGridArrays();
    }

    _buildGridArrays() {
      const r = this.params.r;
      this.cellSize = r;
      this.cols = Math.max(3, Math.floor(this.W / this.cellSize));
      this.rows = Math.max(3, Math.floor(this.H / this.cellSize));
      // Recompute effective cell size so cells tile the world exactly.
      this.cellW = this.W / this.cols;
      this.cellH = this.H / this.rows;
      const cells = this.cols * this.rows;
      this.cellCount = new Int32Array(cells);
      this.cellStart = new Int32Array(cells + 1);
      this.order = new Int32Array(this.params.count);
      this._cursor = new Int32Array(cells);
    }

    // ----- lifecycle ---------------------------------------------------------
    reset(seed) {
      if (seed != null) this.params.seed = seed >>> 0;
      const rng = PPS.makeRNG(this.params.seed);
      const n = this.params.count;
      for (let i = 0; i < n; i++) {
        this.x[i] = rng() * this.W;
        this.y[i] = rng() * this.H;
        this.a[i] = rng() * TAU;
        this.N[i] = 0;
        this.prevN[i] = 0;
        this.net[i] = 0;
        this.age[i] = 0;
      }
      this.step = 0;
    }

    // Change parameters that can be applied without re-seeding (alpha/beta/v/r).
    // count/density/seed need a full reset (handled by the caller).
    setLiveParams(p) {
      if (p.alpha != null) this.params.alpha = p.alpha;
      if (p.beta != null) this.params.beta = p.beta;
      if (p.v != null) this.params.v = p.v;
      if (p.r != null && p.r !== this.params.r) {
        this.params.r = p.r;
        this._buildGridArrays(); // radius change resizes the grid
      }
    }

    needsReallocation(p) {
      return (
        (p.count != null && p.count !== this.params.count) ||
        (p.density != null && p.density !== this.params.density)
      );
    }

    // ----- spatial grid ------------------------------------------------------
    buildGrid() {
      const { cols, rows, cellW, cellH } = this;
      const n = this.params.count;
      const cellCount = this.cellCount;
      const cellStart = this.cellStart;
      const order = this.order;
      const cursor = this._cursor;
      const x = this.x;
      const y = this.y;

      cellCount.fill(0);
      // First pass: count particles per cell.
      for (let i = 0; i < n; i++) {
        let cx = (x[i] / cellW) | 0;
        let cy = (y[i] / cellH) | 0;
        if (cx >= cols) cx = cols - 1;
        else if (cx < 0) cx = 0;
        if (cy >= rows) cy = rows - 1;
        else if (cy < 0) cy = 0;
        cellCount[cy * cols + cx]++;
      }
      // Prefix sum -> start offsets.
      let acc = 0;
      const cells = cols * rows;
      for (let c = 0; c < cells; c++) {
        cellStart[c] = acc;
        cursor[c] = acc;
        acc += cellCount[c];
      }
      cellStart[cells] = acc;
      // Second pass: scatter indices into the sorted order array.
      for (let i = 0; i < n; i++) {
        let cx = (x[i] / cellW) | 0;
        let cy = (y[i] / cellH) | 0;
        if (cx >= cols) cx = cols - 1;
        else if (cx < 0) cx = 0;
        if (cy >= rows) cy = rows - 1;
        else if (cy < 0) cy = 0;
        const c = cy * cols + cx;
        order[cursor[c]++] = i;
      }
    }

    // ----- one simulation step ----------------------------------------------
    stepOnce() {
      this.buildGrid();

      const n = this.params.count;
      const { cols, rows, cellW, cellH, W, H } = this;
      const r = this.params.r;
      const r2 = r * r;
      const halfW = W * 0.5;
      const halfH = H * 0.5;
      const alpha = this.params.alpha * DEG;
      const beta = this.params.beta * DEG;
      const v = this.params.v;

      const x = this.x;
      const y = this.y;
      const a = this.a;
      const x2 = this.x2;
      const y2 = this.y2;
      const a2 = this.a2;
      const Narr = this.N;
      const prevN = this.prevN;
      const netArr = this.net;
      const order = this.order;
      const cellStart = this.cellStart;

      for (let i = 0; i < n; i++) {
        const xi = x[i];
        const yi = y[i];
        const ai = a[i];
        const hx = Math.cos(ai);
        const hy = Math.sin(ai);

        let L = 0;
        let R = 0;

        let cx = (xi / cellW) | 0;
        let cy = (yi / cellH) | 0;
        if (cx >= cols) cx = cols - 1;
        if (cy >= rows) cy = rows - 1;

        // Scan the 3x3 block of cells (with toroidal wrap-around).
        for (let dy = -1; dy <= 1; dy++) {
          let ny = cy + dy;
          if (ny < 0) ny += rows;
          else if (ny >= rows) ny -= rows;
          const rowBase = ny * cols;
          for (let dx = -1; dx <= 1; dx++) {
            let nx = cx + dx;
            if (nx < 0) nx += cols;
            else if (nx >= cols) nx -= cols;
            const cell = rowBase + nx;
            const end = cellStart[cell + 1];
            for (let k = cellStart[cell]; k < end; k++) {
              const j = order[k];
              if (j === i) continue;
              let ddx = x[j] - xi;
              let ddy = y[j] - yi;
              // Minimum-image toroidal distance.
              if (ddx > halfW) ddx -= W;
              else if (ddx < -halfW) ddx += W;
              if (ddy > halfH) ddy -= H;
              else if (ddy < -halfH) ddy += H;
              if (ddx * ddx + ddy * ddy <= r2) {
                // Cross product of heading x displacement: >0 => left.
                if (hx * ddy - hy * ddx > 0) L++;
                else R++;
              }
            }
          }
        }

        const Nn = L + R;
        prevN[i] = Narr[i];
        Narr[i] = Nn;
        netArr[i] = R - L;

        const s = R > L ? 1 : R < L ? -1 : 0;
        let na = ai + alpha + beta * Nn * s;
        // Keep the angle bounded to avoid float drift over long runs.
        na = na - TAU * Math.floor(na / TAU);
        a2[i] = na;

        let nxp = xi + v * Math.cos(na);
        let nyp = yi + v * Math.sin(na);
        nxp = nxp - W * Math.floor(nxp / W); // wrap into [0, W)
        nyp = nyp - H * Math.floor(nyp / H);
        x2[i] = nxp;
        y2[i] = nyp;
      }

      // Swap buffers (new state becomes current).
      this.x = x2;
      this.x2 = x;
      this.y = y2;
      this.y2 = y;
      this.a = a2;
      this.a2 = a;

      // Age advances for all (particles persist; "birth/death" is emergent in
      // local density, tracked via N, not by allocation).
      const age = this.age;
      for (let i = 0; i < n; i++) age[i]++;
      this.step++;
    }

    // Count neighbours within r for every particle WITHOUT moving them. Used by
    // playback to reconstruct the classic N-palette from decoded positions only.
    computeNeighborCounts() {
      this.buildGrid();
      const n = this.params.count;
      const { cols, rows, cellW, cellH, W, H } = this;
      const r = this.params.r;
      const r2 = r * r;
      const halfW = W * 0.5;
      const halfH = H * 0.5;
      const x = this.x, y = this.y, Narr = this.N;
      const order = this.order, cellStart = this.cellStart;
      for (let i = 0; i < n; i++) {
        const xi = x[i], yi = y[i];
        let cx = (xi / cellW) | 0;
        let cy = (yi / cellH) | 0;
        if (cx >= cols) cx = cols - 1;
        if (cy >= rows) cy = rows - 1;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          let ny = cy + dy;
          if (ny < 0) ny += rows; else if (ny >= rows) ny -= rows;
          const rowBase = ny * cols;
          for (let dx = -1; dx <= 1; dx++) {
            let nx = cx + dx;
            if (nx < 0) nx += cols; else if (nx >= cols) nx -= cols;
            const cell = rowBase + nx;
            const end = cellStart[cell + 1];
            for (let k = cellStart[cell]; k < end; k++) {
              const j = order[k];
              if (j === i) continue;
              let ddx = x[j] - xi, ddy = y[j] - yi;
              if (ddx > halfW) ddx -= W; else if (ddx < -halfW) ddx += W;
              if (ddy > halfH) ddy -= H; else if (ddy < -halfH) ddy += H;
              if (ddx * ddx + ddy * ddy <= r2) cnt++;
            }
          }
        }
        Narr[i] = cnt;
      }
    }

    // ----- picking & metrics -------------------------------------------------
    // Nearest particle to a world coordinate (for click-to-track).
    findNearest(wx, wy, maxDist) {
      this.buildGrid();
      const { cols, rows, cellW, cellH, W, H } = this;
      const halfW = W * 0.5;
      const halfH = H * 0.5;
      let cx = (wx / cellW) | 0;
      let cy = (wy / cellH) | 0;
      if (cx >= cols) cx = cols - 1;
      if (cx < 0) cx = 0;
      if (cy >= rows) cy = rows - 1;
      if (cy < 0) cy = 0;
      const order = this.order;
      const cellStart = this.cellStart;
      let best = -1;
      let bestD = (maxDist != null ? maxDist * maxDist : Infinity);
      for (let dy = -1; dy <= 1; dy++) {
        let ny = cy + dy;
        if (ny < 0) ny += rows;
        else if (ny >= rows) ny -= rows;
        const rowBase = ny * cols;
        for (let dx = -1; dx <= 1; dx++) {
          let nx = cx + dx;
          if (nx < 0) nx += cols;
          else if (nx >= cols) nx -= cols;
          const cell = rowBase + nx;
          const end = cellStart[cell + 1];
          for (let k = cellStart[cell]; k < end; k++) {
            const j = order[k];
            let ddx = this.x[j] - wx;
            let ddy = this.y[j] - wy;
            if (ddx > halfW) ddx -= W;
            else if (ddx < -halfW) ddx += W;
            if (ddy > halfH) ddy -= H;
            else if (ddy < -halfH) ddy += H;
            const d = ddx * ddx + ddy * ddy;
            if (d < bestD) {
              bestD = d;
              best = j;
            }
          }
        }
      }
      return best;
    }

    // Aggregate metrics used by the batch runner and the live HUD.
    computeMetrics() {
      const n = this.params.count;
      const N = this.N;
      let sum = 0;
      let sumSq = 0;
      let minN = Infinity;
      let maxN = -Infinity;
      let activity = 0;
      for (let i = 0; i < n; i++) {
        const v = N[i];
        sum += v;
        sumSq += v * v;
        if (v < minN) minN = v;
        if (v > maxN) maxN = v;
        activity += Math.abs(this.net[i]);
      }
      const meanN = sum / n;
      const varN = sumSq / n - meanN * meanN;

      // Structure count: connected components of occupied grid cells.
      this.buildGrid();
      const clusters = this._countClusters();

      return {
        step: this.step,
        count: n,
        meanN,
        varN,
        stdN: Math.sqrt(Math.max(0, varN)),
        minN: isFinite(minN) ? minN : 0,
        maxN: isFinite(maxN) ? maxN : 0,
        activity: activity / n,
        clusters,
      };
    }

    // Union-find over occupied cells (8-connected, toroidal) -> blob count.
    _countClusters() {
      const { cols, rows } = this;
      const cells = cols * rows;
      const occupied = this.cellCount;
      const parent = this._cluParent || (this._cluParent = new Int32Array(cells));
      for (let c = 0; c < cells; c++) parent[c] = c;

      function find(a) {
        while (parent[a] !== a) {
          parent[a] = parent[parent[a]];
          a = parent[a];
        }
        return a;
      }
      function union(a, b) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      }

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const c = cy * cols + cx;
          if (occupied[c] === 0) continue;
          // Only need to union with right, down, and the two lower diagonals.
          const rx = (cx + 1) % cols;
          const dyr = (cy + 1) % rows;
          const right = cy * cols + rx;
          const down = dyr * cols + cx;
          const dr = dyr * cols + rx;
          const dlx = (cx - 1 + cols) % cols;
          const dl = dyr * cols + dlx;
          if (occupied[right]) union(c, right);
          if (occupied[down]) union(c, down);
          if (occupied[dr]) union(c, dr);
          if (occupied[dl]) union(c, dl);
        }
      }
      let count = 0;
      for (let c = 0; c < cells; c++) {
        if (occupied[c] !== 0 && find(c) === c) count++;
      }
      return count;
    }
  }

  PPS.Simulation = Simulation;
  PPS.TAU = TAU;
  PPS.DEG = DEG;
})((window.PPS = window.PPS || {}));
