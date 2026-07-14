/* shaders.js — WGSL for the WebGPU Primordial Particle System.
 *
 * The whole simulation is GPU-resident. Three compute entry points run per step:
 *   clearGrid — zero the per-cell atomic counters
 *   scatter   — bin each particle into a fixed-capacity cell bucket (atomicAdd)
 *   simulate  — for each particle, scan the 3x3 cell block, count L/R neighbours,
 *               apply Δφ = α + β·N·sign(R−L) and advance (toroidal)
 *
 * A fixed-capacity grid (no prefix-sum / no GPU sort) keeps everything in one
 * command pass; many steps are encoded per submit for throughput. Rendering is a
 * separate point-list pipeline that reads the position/N/net buffers directly and
 * colours in the vertex shader, plus an instanced-quad pipeline for tracked
 * markers. */
(function (PPS) {
  'use strict';

  const R_STRUCT = `
struct R {
  cam: vec2<f32>,
  canvas: vec2<f32>,
  zoom: f32, mode: f32, stride: f32, n: f32,
  th: vec4<f32>,            // t1, t2, t3, densityMax
  turnMax: f32, hlMask: f32, markerPx: f32, pad1: f32,
  hlA: vec4<f32>,           // birth, death, nucleus, lonely thresholds
  hlB: vec4<f32>,           // spinner threshold, _, _, _
  colLow: vec4<f32>, colMid: vec4<f32>, colHigh: vec4<f32>, colTop: vec4<f32>,
  colBirth: vec4<f32>, colDeath: vec4<f32>, colNucleus: vec4<f32>,
  colLonely: vec4<f32>, colSpinner: vec4<f32>,
};
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
};
const TAU: f32 = 6.28318530718;

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(vec3<f32>(c.x) + K.xyz) * 6.0 - vec3<f32>(K.w));
  return c.z * mix(vec3<f32>(K.x), clamp(p - vec3<f32>(K.x), vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(c.y));
}
fn ramp(t: f32) -> vec3<f32> {
  let h = (1.0 - clamp(t, 0.0, 1.0)) * 0.66;
  return hsv2rgb(vec3<f32>(h, 0.9, 1.0));
}
`;

  PPS.GPU_SHADERS = {
    compute: `
const TAU: f32 = 6.28318530718;
struct U {
  world: vec2<f32>,
  cell: vec2<f32>,
  grid: vec2<u32>,
  capn: vec2<u32>,
  motion: vec4<f32>,   // alpha(rad), beta(rad), v, r
  extra: vec4<f32>,    // r2, halfW, halfH, moveEnabled
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> posIn: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> angIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> posOut: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> angOut: array<f32>;
@group(0) @binding(5) var<storage, read_write> nOut: array<i32>;
@group(0) @binding(6) var<storage, read_write> netOut: array<i32>;
@group(0) @binding(7) var<storage, read_write> cellCount: array<atomic<u32>>;
// Bins store neighbour POSITIONS (not indices) so the hot loop reads contiguous
// memory instead of gathering posIn[j] at random — a big win on every GPU.
@group(0) @binding(8) var<storage, read_write> cellBins: array<vec2<f32>>;

@compute @workgroup_size(64)
fn clearGrid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.grid.x * u.grid.y) { return; }
  atomicStore(&cellCount[i], 0u);
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.capn.y) { return; }
  let p = posIn[i];
  let cx = clamp(i32(floor(p.x / u.cell.x)), 0, i32(u.grid.x) - 1);
  let cy = clamp(i32(floor(p.y / u.cell.y)), 0, i32(u.grid.y) - 1);
  let cell = u32(cy) * u.grid.x + u32(cx);
  let slot = atomicAdd(&cellCount[cell], 1u);
  if (slot < u.capn.x) {
    cellBins[cell * u.capn.x + slot] = p;
  }
}

@compute @workgroup_size(256)
fn simulate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.capn.y) { return; }
  let xi = posIn[i].x;
  let yi = posIn[i].y;
  let ai = angIn[i];
  let hx = cos(ai);
  let hy = sin(ai);
  let W = u.world.x; let H = u.world.y;
  let halfW = u.extra.y; let halfH = u.extra.z;
  let r2 = u.extra.x;
  let cols = i32(u.grid.x); let rows = i32(u.grid.y);
  let cap = u.capn.x;
  let cx = clamp(i32(floor(xi / u.cell.x)), 0, cols - 1);
  let cy = clamp(i32(floor(yi / u.cell.y)), 0, rows - 1);
  var L: i32 = 0;
  var R: i32 = 0;
  for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
    var ny = cy + dy;
    if (ny < 0) { ny = ny + rows; } else if (ny >= rows) { ny = ny - rows; }
    for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
      var nx = cx + dx;
      if (nx < 0) { nx = nx + cols; } else if (nx >= cols) { nx = nx - cols; }
      let cell = u32(ny) * u.grid.x + u32(nx);
      let cnt = min(atomicLoad(&cellCount[cell]), cap);
      let base = cell * cap;
      for (var s: u32 = 0u; s < cnt; s = s + 1u) {
        let q = cellBins[base + s];
        var ddx = q.x - xi;
        var ddy = q.y - yi;
        if (ddx > halfW) { ddx = ddx - W; } else if (ddx < -halfW) { ddx = ddx + W; }
        if (ddy > halfH) { ddy = ddy - H; } else if (ddy < -halfH) { ddy = ddy + H; }
        let d2 = ddx * ddx + ddy * ddy;
        // d2 > 0 skips the particle's own bin entry (self at distance 0).
        if (d2 > 0.0 && d2 <= r2) {
          if (hx * ddy - hy * ddx > 0.0) { L = L + 1; } else { R = R + 1; }
        }
      }
    }
  }
  let N = L + R;
  nOut[i] = N;
  netOut[i] = R - L;
  var sgn: f32 = 0.0;
  if (R > L) { sgn = 1.0; } else if (R < L) { sgn = -1.0; }
  var na = ai + u.motion.x + u.motion.y * f32(N) * sgn;
  na = na - TAU * floor(na / TAU);
  if (u.extra.w > 0.5) {
    var nxp = xi + u.motion.z * cos(na);
    var nyp = yi + u.motion.z * sin(na);
    nxp = nxp - W * floor(nxp / W);
    nyp = nyp - H * floor(nyp / H);
    posOut[i] = vec2<f32>(nxp, nyp);
    angOut[i] = na;
  } else {
    posOut[i] = vec2<f32>(xi, yi);
    angOut[i] = ai;
  }
}
`,

    render: R_STRUCT + `
@group(0) @binding(0) var<uniform> r: R;
@group(0) @binding(1) var<storage, read> pos: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> ang: array<f32>;
@group(0) @binding(3) var<storage, read> nCur: array<i32>;
@group(0) @binding(4) var<storage, read> nPrev: array<i32>;
@group(0) @binding(5) var<storage, read> net: array<i32>;

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var out: VOut;
  let idx = vid * u32(r.stride);
  let n = u32(r.n);
  if (idx >= n) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec4<f32>(0.0);
    return out;
  }
  let p = pos[idx];
  let screen = (p - r.cam) * r.zoom + r.canvas * 0.5;
  out.pos = vec4<f32>(screen.x / r.canvas.x * 2.0 - 1.0, 1.0 - screen.y / r.canvas.y * 2.0, 0.0, 1.0);

  let N = nCur[idx];
  let dN = N - nPrev[idx];
  let nt = net[idx];
  let mode = u32(r.mode);
  var col: vec3<f32>;
  if (mode == 0u) {
    if (f32(N) <= r.th.x) { col = r.colLow.rgb; }
    else if (f32(N) <= r.th.y) { col = r.colMid.rgb; }
    else if (f32(N) <= r.th.z) { col = r.colHigh.rgb; }
    else { col = r.colTop.rgb; }
  } else if (mode == 1u) {
    col = ramp(f32(N) / max(r.th.w, 1.0));
  } else if (mode == 2u) {
    col = hsv2rgb(vec3<f32>(ang[idx] / TAU, 0.85, 1.0));
  } else {
    col = ramp(abs(f32(nt)) / max(r.turnMax, 1.0));
  }
  let mask = u32(r.hlMask);
  if ((mask & 1u) != 0u && dN >= i32(r.hlA.x)) { col = r.colBirth.rgb; }
  if ((mask & 2u) != 0u && dN <= -i32(r.hlA.y)) { col = r.colDeath.rgb; }
  if ((mask & 4u) != 0u && N >= i32(r.hlA.z)) { col = r.colNucleus.rgb; }
  if ((mask & 8u) != 0u && N <= i32(r.hlA.w)) { col = r.colLonely.rgb; }
  if ((mask & 16u) != 0u && abs(nt) >= i32(r.hlB.x)) { col = r.colSpinner.rgb; }
  out.color = vec4<f32>(col, 1.0);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> { return in.color; }
`,

    marker: R_STRUCT + `
@group(0) @binding(0) var<uniform> r: R;
@group(0) @binding(1) var<storage, read> pos: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> ids: array<u32>;

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> VOut {
  let id = ids[inst];
  let p = pos[id];
  let screen = (p - r.cam) * r.zoom + r.canvas * 0.5;
  let sz = r.markerPx;
  var corner = vec2<f32>(-sz, -sz);
  if (vid == 1u) { corner = vec2<f32>(sz, -sz); }
  else if (vid == 2u) { corner = vec2<f32>(sz, sz); }
  else if (vid == 3u) { corner = vec2<f32>(-sz, -sz); }
  else if (vid == 4u) { corner = vec2<f32>(sz, sz); }
  else if (vid == 5u) { corner = vec2<f32>(-sz, sz); }
  let sc = screen + corner;
  var out: VOut;
  out.pos = vec4<f32>(sc.x / r.canvas.x * 2.0 - 1.0, 1.0 - sc.y / r.canvas.y * 2.0, 0.0, 1.0);
  // Hollow-ish marker: bright ring colour.
  out.color = vec4<f32>(1.0, 1.0, 1.0, 1.0);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> { return in.color; }
`,
  };
})((window.PPS = window.PPS || {}));
