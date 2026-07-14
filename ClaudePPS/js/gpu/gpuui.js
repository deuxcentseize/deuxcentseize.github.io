/* gpuui.js — binds the DOM to GPUApp. Handles WebGPU availability, the speed
 * controls (substeps / render-every / display-stride / turbo), parameters,
 * presets, colour + highlight config, recording and playback. */
(function (PPS) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  // Shared download helper (app.js isn't loaded on this page).
  if (!PPS.download) {
    PPS.download = function (blob, name) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
  }

  // Baseline: the CPU build measured ~150 steps/s at 12,000 particles.
  const CPU_BASELINE_PPS = 12000 * 150;

  const DEFAULT_PARAMS = { count: 100000, density: 0.08, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 1 };
  const PARAM_SCHEMA = [
    { key: 'alpha', label: 'alpha (α)', min: 0, max: 360, step: 1, live: true },
    { key: 'beta', label: 'beta (β)', min: 0, max: 60, step: 0.5, live: true },
    { key: 'v', label: 'v (step length)', min: 0, max: 3, step: 0.01, live: true },
    { key: 'r', label: 'r (radius)', min: 1, max: 20, step: 0.5, live: false },
    { key: 'count', label: 'particles', min: 1000, max: 2000000, step: 1000, live: false },
    { key: 'density', label: 'density', min: 0.02, max: 0.2, step: 0.005, live: false },
    { key: 'seed', label: 'seed', min: 1, max: 99999, step: 1, live: false },
  ];

  function fmtBig(x) {
    if (!isFinite(x)) return '–';
    if (x >= 1e9) return (x / 1e9).toFixed(2) + ' B';
    if (x >= 1e6) return (x / 1e6).toFixed(1) + ' M';
    if (x >= 1e3) return (x / 1e3).toFixed(0) + ' K';
    return String(Math.round(x));
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function hexToRGBn(hex) {
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  }
  function rgbnToHex(c) {
    return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const canvas = $('view');
    let app;
    try {
      // Ensure the canvas has a backing size before first configure.
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * Math.min(window.devicePixelRatio || 1, 2)));
      canvas.height = Math.max(1, Math.round(rect.height * Math.min(window.devicePixelRatio || 1, 2)));
      app = await PPS.GPUApp.create(canvas);
      app.init(Object.assign({}, DEFAULT_PARAMS));
    } catch (e) {
      $('gpu-error').style.display = 'flex';
      $('gpu-error-msg').textContent = String(e.message || e);
      return;
    }
    PPS.gpuApp = app;
    const badge = $('gpu-badge');
    const integrated = app.engine.looksIntegrated();
    badge.textContent = 'GPU: ' + app.engine.gpuLabel();
    badge.title = JSON.stringify(app.engine.adapterInfo);
    if (integrated) {
      badge.style.background = '#3a1616';
      badge.style.borderColor = '#5a2020';
      badge.style.color = '#ff9b9b';
      badge.textContent = '⚠ Integrated GPU: ' + app.engine.gpuLabel() + ' — run launch-gpu.bat to use your discrete GPU';
      badge.style.maxWidth = '520px';
      badge.style.cursor = 'help';
    } else {
      badge.style.color = 'var(--accent)';
    }

    let lastGood = Object.assign({}, app.engine.params);
    const paramInputs = {};

    // ---- parameters ----
    (function buildParams() {
      const box = $('params-container');
      for (const spec of PARAM_SCHEMA) {
        const wrap = el('div', 'param');
        const label = el('div', 'label');
        label.appendChild(el('span', 'name', spec.label));
        const right = el('span');
        right.innerHTML = '<span class="val"></span>' + (spec.live ? '' : ' <span class="reset-tag">↻</span>');
        label.appendChild(right);
        const input = el('input');
        input.type = 'range'; input.min = spec.min; input.max = spec.max; input.step = spec.step;
        input.value = app.engine.params[spec.key];
        wrap.appendChild(label); wrap.appendChild(input); box.appendChild(wrap);
        const valSpan = right.querySelector('.val');
        valSpan.textContent = fmtVal(spec, app.engine.params[spec.key]);
        paramInputs[spec.key] = { input, valSpan, spec };

        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          valSpan.textContent = fmtVal(spec, v);
          if (spec.live) app.setLive({ [spec.key]: v });
        });
        input.addEventListener('change', () => {
          if (spec.live) return;
          const v = (spec.key === 'count' || spec.key === 'seed') ? Math.round(parseFloat(input.value)) : parseFloat(input.value);
          try {
            app.rebuild({ [spec.key]: v });
            lastGood = Object.assign({}, app.engine.params);
          } catch (err) {
            alert(err.message);
            app.init(lastGood);
            syncParams();
          }
        });
      }
    })();
    function fmtVal(spec, v) {
      if (spec.key === 'count') return fmtBig(v);
      return spec.step < 1 ? v : Math.round(v);
    }
    function syncParams() {
      for (const key in paramInputs) {
        const { input, valSpan, spec } = paramInputs[key];
        input.value = app.engine.params[key];
        valSpan.textContent = fmtVal(spec, app.engine.params[key]);
      }
    }

    // ---- transport ----
    const btnPlay = $('btn-play');
    function setPlaying(p) {
      app.playing = p;
      btnPlay.textContent = p ? '⏸ Pause' : '▶ Play';
      btnPlay.classList.toggle('active', p);
    }
    btnPlay.onclick = () => setPlaying(!app.playing);
    $('btn-step').onclick = () => app.manualStep();
    $('btn-reset').onclick = () => { app.rebuild({}); syncParams(); };

    // ---- speed controls ----
    bindRange('substeps', 'substeps-val', (v) => { app.substeps = v; });
    bindRange('rendevery', 'rendevery-val', (v) => { app.renderEvery = v; });
    bindRange('stride', 'stride-val', (v) => { app.displayStride = v; });
    $('turbo').addEventListener('change', (e) => { app.turbo = e.target.checked; });
    $('btn-bench').onclick = async () => {
      const btn = $('btn-bench'), out = $('bench-out');
      btn.disabled = true; out.textContent = 'Benchmarking…';
      try {
        const res = await app.benchmark([100000, 500000, 1000000], 200);
        let peak = 0;
        out.innerHTML = res.map((r) => {
          if (r.error) return fmtBig(r.n) + ': ' + r.error;
          if (r.pps > peak) peak = r.pps;
          return fmtBig(r.n) + ' particles → ' + fmtBig(r.pps) + ' p·steps/s (' + r.sps + ' steps/s)';
        }).join('<br>');
        out.innerHTML += '<br><b>peak ≈ ' + fmtBig(peak / CPU_BASELINE_PPS) + '× the CPU build</b>';
        syncParams();
      } catch (e) { out.textContent = 'Benchmark failed: ' + (e.message || e); }
      btn.disabled = false;
    };
    function bindRange(id, valId, fn) {
      const inp = $(id), out = $(valId);
      inp.addEventListener('input', () => { const v = parseInt(inp.value); out.textContent = v; fn(v); });
    }

    // ---- presets ----
    (function () {
      const sel = $('preset-select');
      PPS.PRESETS.forEach((p, i) => { const o = el('option'); o.value = i; o.textContent = p.name; sel.appendChild(o); });
      const notes = $('preset-notes');
      const show = () => { notes.textContent = PPS.PRESETS[sel.value].notes; };
      sel.addEventListener('change', show); show();
      $('btn-apply-preset').onclick = () => {
        try { app.applyPreset(PPS.PRESETS[sel.value]); lastGood = Object.assign({}, app.engine.params); syncParams(); }
        catch (e) { alert(e.message); app.init(lastGood); syncParams(); }
      };
    })();

    // ---- colour + highlights ----
    $('color-mode').addEventListener('change', (e) => {
      app.colorMode = parseInt(e.target.value);
      $('classic-thresholds').classList.toggle('hidden', app.colorMode !== 0);
    });
    ['th-t1', 'th-t2', 'th-t3'].forEach((id, k) => {
      $(id).addEventListener('input', () => { app.thresholds['t' + (k + 1)] = parseFloat($(id).value) || 0; });
    });
    (function buildHighlights() {
      const defs = [
        ['birth', 'Cell birth (dN↑)'], ['death', 'Cell death (dN↓)'],
        ['nucleus', 'Dense nucleus (N≥)'], ['lonely', 'Lonely (N≤)'], ['spinner', 'Spinner (|net|≥)'],
      ];
      const box = $('hl-container');
      for (const [key, label] of defs) {
        const h = app.highlights[key];
        const row = el('div', 'rule');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = h.on;
        cb.addEventListener('change', () => { h.on = cb.checked; });
        const name = el('span', 'rname', label);
        const th = el('input', 'rthresh'); th.type = 'number'; th.value = h.t;
        th.addEventListener('input', () => { h.t = parseFloat(th.value) || 0; });
        const col = el('input'); col.type = 'color'; col.value = rgbnToHex(h.col);
        col.addEventListener('input', () => { h.col = hexToRGBn(col.value); });
        row.appendChild(cb); row.appendChild(name); row.appendChild(th); row.appendChild(col);
        box.appendChild(row);
      }
    })();
    $('btn-clear-tracked').onclick = () => app.clearTracked();

    // ---- recording ----
    const recQuant = $('rec-quant');
    function updateFootBpp() {
      const q = parseInt(recQuant.value);
      $('foot-bpp').textContent = (q === 8 ? 2 : q === 12 ? 3 : 4) + ' B/particle @ ' + q + '-bit';
    }
    recQuant.addEventListener('change', updateFootBpp); updateFootBpp();

    function updateRecInfo() {
      const rec = app.recorder, info = $('rec-info');
      if (app.recording) info.textContent = 'Recording… ' + rec.frames.length + ' frames · ' + fmtBytes(rec.sizeBytes());
      else if (rec.frames.length > 0) info.textContent = 'Captured ' + rec.frames.length + ' frames · ' + rec.bytesPerParticle() + ' B/particle · ' + fmtBytes(rec.sizeBytes());
      else info.textContent = 'Not recording.';
    }
    app.onRecInfo = updateRecInfo;
    $('btn-rec-start').onclick = () => {
      app.startRecording(parseInt($('rec-everyN').value) || 1, parseInt(recQuant.value));
      $('btn-rec-start').disabled = true; $('btn-rec-stop').disabled = false; $('btn-rec-export').disabled = true;
      updateRecInfo();
    };
    $('btn-rec-stop').onclick = () => {
      app.stopRecording();
      $('btn-rec-start').disabled = false; $('btn-rec-stop').disabled = true;
      $('btn-rec-export').disabled = app.recorder.frames.length === 0;
      updateRecInfo();
    };
    $('btn-rec-export').onclick = () => app.exportRecording();
    $('rec-file').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const header = await app.loadRecording(reader.result);
          $('playback-panel').classList.remove('hidden');
          $('playback-badge').classList.remove('hidden');
          $('pb-slider').max = app.recorder.frames.length - 1;
          $('pb-slider').value = 0;
          setPlaying(false);
          $('pb-info').textContent = header.count.toLocaleString() + ' particles · every ' + header.everyN + ' steps · ' + app.recorder.frames.length + ' frames';
          syncParams();
        } catch (err) { alert('Could not load recording: ' + err.message); }
      };
      reader.readAsArrayBuffer(file); e.target.value = '';
    });

    const pbSlider = $('pb-slider'), pbPlay = $('btn-pb-play');
    app.onPlaybackFrame = (idx, total) => {
      pbSlider.value = idx;
      $('pb-info').textContent = 'frame ' + (idx + 1) + ' / ' + total + ' · sim step ≈ ' + (idx * app.recorder.everyN);
    };
    pbSlider.addEventListener('input', () => { app.pbPlaying = false; pbPlay.textContent = '▶'; app.pbIndex = parseInt(pbSlider.value); });
    pbPlay.onclick = () => { app.pbPlaying = !app.pbPlaying; pbPlay.textContent = app.pbPlaying ? '⏸' : '▶'; };
    $('pb-speed').addEventListener('input', (e) => { app.pbSpeed = Math.max(1, parseInt(e.target.value) || 1); });
    $('btn-exit-playback').onclick = () => {
      app.exitPlayback();
      $('playback-panel').classList.add('hidden');
      $('playback-badge').classList.add('hidden');
      setPlaying(true);
      syncParams();
    };

    // ---- canvas interaction ----
    let dragging = false, moved = 0, lastX = 0, lastY = 0;
    canvas.addEventListener('mousedown', (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      app.panByPixels(dx, dy); lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (dragging && moved < 4 && app.mode === 'live') {
        const rect = canvas.getBoundingClientRect();
        app.pick(e.clientX - rect.left, e.clientY - rect.top).catch(() => {});
      }
      dragging = false;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      app.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!app.playing); }
      else if (e.key === 's') app.manualStep();
      else if (e.key === 'r') { app.rebuild({}); syncParams(); }
      else if (e.key === 'f') app.fit();
    });
    app._fitPending = true;

    // ---- stats ----
    app.onStats = (s) => {
      $('stat-fps').textContent = s.fps.toFixed(0);
      $('stat-sps').textContent = fmtBig(s.sps);
      $('stat-pps').textContent = fmtBig(s.pps);
      $('stat-step').textContent = s.step.toLocaleString();
      $('stat-count').textContent = s.count.toLocaleString();
      $('stat-tracked').textContent = s.tracked;
      $('tp-big').textContent = fmtBig(s.pps) + ' particle-steps/s';
      const ratio = s.pps / CPU_BASELINE_PPS;
      $('tp-cmp').textContent = '≈ ' + fmtBig(ratio) + '× the CPU build (12k @ ~150 steps/s)';
    };

    // ---- URL parameters (for launchers / sharing a heavy config) ----
    // e.g. gpu.html?count=1000000&substeps=2000&turbo=1  or  gpu.html?bench=1
    (function applyUrlParams() {
      const q = new URLSearchParams(location.search);
      if (q.has('count')) {
        try { app.rebuild({ count: parseInt(q.get('count')) }); lastGood = Object.assign({}, app.engine.params); }
        catch (e) { alert(e.message); app.init(lastGood); }
      }
      if (q.has('substeps')) { app.substeps = parseInt(q.get('substeps')) || app.substeps; $('substeps').value = app.substeps; $('substeps-val').textContent = app.substeps; }
      if (q.has('rendevery')) { app.renderEvery = parseInt(q.get('rendevery')) || 1; $('rendevery').value = app.renderEvery; $('rendevery-val').textContent = app.renderEvery; }
      if (q.has('stride')) { app.displayStride = parseInt(q.get('stride')) || 1; $('stride').value = app.displayStride; $('stride-val').textContent = app.displayStride; }
      if (q.has('turbo')) { app.turbo = q.get('turbo') !== '0'; $('turbo').checked = app.turbo; }
      syncParams();
      if (q.has('bench')) setTimeout(() => $('btn-bench').click(), 600);
    })();

    setPlaying(true);
  });
})((window.PPS = window.PPS || {}));
