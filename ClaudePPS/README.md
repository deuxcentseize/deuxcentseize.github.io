# Primordial Particle System — Lab

A fast, fully client-side demo and research playground for the **Primordial
Particle System (PPS)** — the self-organising "artificial life" model of
Thomas Schmickl, Martin Stefanec and Karl Crailsheim at the **Artificial Life
Lab, University of Graz** (*"How a life-like system emerges from a simple
particle motion law"*, Scientific Reports, 2016).

Open **`index.html`** in any modern browser. No build step, no server required
(though a static server such as `python -m http.server` avoids `file://`
quirks). Everything runs in the browser.

---

## The model

Every particle has a position and a heading. Each timestep:

```
N      = number of neighbours within radius r
L, R   = how many of those are on the left / right of the heading
Δφ     = α + β · N · sign(R − L)
φ  += Δφ ;   x += v·cos φ ;   y += v·sin φ
```

The world is toroidal (wraps at the edges). With the canonical parameters
`α = 180°, β = 17°, v = 0.67, r = 5, density ≈ 0.08`, the swarm spontaneously
forms **cells** with green membranes that grow, divide and dissolve — life-like
structure from a one-line rule.

## Performance

- **Uniform spatial grid** (cell size = r): each particle only tests the 3×3
  block of neighbouring cells, so neighbour search is O(n). Runs tens of
  thousands of particles at high step rates on the CPU.
- All state lives in flat **typed arrays**; positions are double-buffered for a
  correct synchronous update.
- Rendering writes particles straight into a **Uint32 `ImageData` buffer** and
  blits once per frame (no per-particle canvas calls).
- Everything is **deterministic** (seeded PRNG), so any interesting result is
  exactly reproducible from its parameters + seed.

## Features

### Simulation & viewport
- Play / pause / single-step / reset; adjustable **steps-per-frame**.
- Live parameters (`α, β, v, r`) update instantly; `count / density / seed`
  rebuild the world.
- **Pan** (drag), **zoom** (scroll), **fit** (`f`). Keyboard: `space` play,
  `s` step, `r` reset.
- Live HUD: fps, steps/s, step, particle count, mean N, cluster count, tracked.

### Colour coding & tracking (a core focus)
- **Colour modes:** Classic neighbour-count palette (brown → green → blue →
  magenta, thresholds editable live), density colormap, heading hue, turning
  bias, and a **custom expression** (`N, dN, net, angle, x, y, id, age`).
- **Highlight rules** for *novel situations* — predefined and editable on the
  fly: cell **birth** (`dN↑`), cell **death** (`dN↓`), dense **nucleus**,
  **lonely** wanderer, strong **spinner**, and **rare density**. Add your own
  rule from an arbitrary boolean expression at runtime, pick its colour, toggle
  it on/off.
- **Track particles**: click any particle to tag it (white ring); optional
  **trails** show its path (with toroidal-seam handling).

### Record a run (ultra-compact)
- Capture **every Nth timestep**, positions only, quantised:
  - **16-bit → 4 B/particle**, **12-bit → 3 B/particle**, **8-bit → 2 B/particle**
    (all single-digit bytes per particle, even at tens of thousands of
    particles per frame).
- Heading/colour are **not** stored — on playback the neighbour count `N` is
  recomputed from decoded positions, so the classic palette is fully
  reconstructed for free (~30× smaller than storing full state).
- **Export / import** a self-describing binary `.pps` file
  (`PPS1` magic + JSON header + frames). Scrub and replay recordings.

### Batch — consecutive simulations
- Sweep **one parameter** across a range, or run many **seeds**.
- Each config runs headless (chunked, UI stays responsive) then reports
  metrics (mean/σ of N, cluster count, activity) and a thumbnail.
- Optionally **record each run** to its own `.pps`.
- **Sort by novelty** to surface the most distinctive regimes; click a result
  to load it into the live sim.

### Experiments — save & share
- Save the current condition (parameters + seed) to `localStorage`, reload it
  later, and **export/import** the whole set as JSON to share reproducible
  results.

## GPU build — WebGPU (`gpu.html`)

A second, GPU-resident implementation for **massive particle counts** and
**huge throughput**. Open [`gpu.html`](gpu.html) (needs a WebGPU-capable browser —
recent Chrome/Edge). It falls back with a link to the CPU version if WebGPU is
absent.

**Design (my own, not DaVinci's):**
- The entire state lives in GPU storage buffers and never leaves. Each step is
  three compute dispatches — `clearGrid`, `scatter`, `simulate` — encoded
  back-to-back.
- Neighbour search uses a **fixed-capacity spatial grid** built with atomic
  counters (no GPU sort, no prefix-sum), so a whole step is one command pass.
- The bins store neighbour **positions**, not indices, so the hot loop reads
  contiguous memory instead of gathering — the key optimisation.
- Buffers ping-pong; **many steps are encoded per submit**, so the GPU runs
  flat-out with no per-step CPU work.
- Rendering is a separate `point-list` pipeline that reads the buffers directly
  and colours in the vertex shader (classic/density/heading/turn + the built-in
  highlight rules as uniforms), plus an instanced-quad pass for tracked markers.

**Throughput levers (the speed):**
- **substeps / frame** — steps the GPU runs per animation frame (main lever).
- **render every N frames** — hide most frames; the sim keeps running full speed.
- **display 1/N particles** — subsample what's drawn; the full set still simulates.
- **Turbo** — widen the compute budget and draw only occasionally.
- A **Benchmark** button measures particle-steps/sec on *your* GPU.

The HUD reports **particle-steps/sec** (n × steps/s), the fair throughput metric,
and its ratio to the CPU build.

### Running on your discrete GPU (Optimus laptops)

On a dual-GPU laptop the browser often binds WebGPU to the **integrated** GPU, so
the in-app badge (top-right) will warn if it detects one. To use the discrete
NVIDIA GPU:

- **Easiest:** double-click **`launch-gpu.bat`** — it serves the folder and opens
  Chrome/Edge with `--force-high-performance-gpu` on a fresh process so the flag
  actually takes effect, pointed at `gpu.html`.
- **Persistent:** run **`install-gpu-preference.ps1`** once (sets the Windows
  per-app graphics preference to *High performance* for Chrome & Edge — same as
  Settings ▸ System ▸ Display ▸ Graphics), then fully restart the browser.
- Verify with `nvidia-smi`: the browser should appear as a `C+G` process on the
  NVIDIA GPU, and utilisation climbs under load.

**Get the card's full clocks.** A mobile GPU idles/power-caps aggressively. For
peak throughput: plug in the laptop, set Windows **Power mode → Best
performance**, and (optionally) NVIDIA Control Panel ▸ Manage 3D settings ▸
**Power management mode → Prefer maximum performance**. A 45 W / 225 MHz sample
means it's throttled; uncapped it clocks several× higher.

**URL presets** let you launch a specific load, e.g.
`gpu.html?count=1000000&substeps=2000&turbo=1` or `gpu.html?bench=1`
(auto-runs the benchmark). Params: `count`, `substeps`, `rendevery`, `stride`, `turbo`, `bench`.

**Performance is hardware-dependent.** On a modern **discrete** GPU this design
reaches billions of particle-steps/sec — comfortably **>1000×** the single-thread
CPU build. On an **integrated** GPU (e.g. Intel) it's memory-bandwidth limited and
lands around 50–65 million particle-steps/sec (~30–60×), peaking near a few
hundred-thousand particles. Recording (needs a GPU→CPU readback) and picking are
the only operations that touch the CPU; both are correct and reuse the same
compact `.pps` format, with playback recomputing N on the GPU from decoded
positions.

## File layout

```
index.html          markup + panel skeleton
css/style.css        UI styling
js/rng.js            deterministic seeded PRNG
js/simulation.js     PPS core: spatial grid, step, metrics, picking
js/coloring.js       colour modes + highlight-rule engine
js/renderer.js       ImageData rendering, camera, trails
js/recorder.js       compact recording, playback decode, binary export/import
js/presets.js        curated "interesting conditions" + experiment storage
js/batch.js          parameter/seed sweeps with metrics + thumbnails
js/app.js            controller: loop, tracking, recording cadence, playback
js/ui.js             DOM wiring

gpu.html             WebGPU build page
js/gpu/shaders.js    WGSL: grid + PPS compute, point + marker render
js/gpu/gpupps.js     WebGPU engine: device, buffers, pipelines, step, readback
js/gpu/gpuapp.js     GPU controller: substeps/turbo loop, recording, playback, benchmark
js/gpu/gpuui.js      GPU DOM wiring
```

## Notes & limits
- Heading-based colour modes are unavailable during playback (headings aren't
  stored); classic/density modes work fully from positions alone.
- `localStorage` may be unavailable over `file://`; experiment save/load then
  degrades gracefully (export/import JSON still works).

## Reference
Schmickl, T., Stefanec, M. & Crailsheim, K. *How a life-like system emerges
from a simple particle motion law.* Sci Rep 6, 37969 (2016).
