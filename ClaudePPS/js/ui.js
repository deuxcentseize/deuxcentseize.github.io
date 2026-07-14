/* ui.js — binds the DOM to the App controller. Builds parameter sliders and the
 * highlight-rule editor dynamically; wires transport, presets, colour/tracking,
 * recording+playback, batch runs, and experiment persistence. */
(function (PPS) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  const PARAM_SCHEMA = [
    { key: 'alpha', label: 'alpha (α)', min: 0, max: 360, step: 1, live: true },
    { key: 'beta', label: 'beta (β)', min: 0, max: 60, step: 0.5, live: true },
    { key: 'v', label: 'v (step length)', min: 0, max: 3, step: 0.01, live: true },
    { key: 'r', label: 'r (radius)', min: 1, max: 20, step: 0.5, live: true },
    { key: 'count', label: 'particle count', min: 500, max: 60000, step: 500, live: false },
    { key: 'density', label: 'density', min: 0.02, max: 0.2, step: 0.005, live: false },
    { key: 'seed', label: 'seed', min: 1, max: 99999, step: 1, live: false },
  ];

  function packedToHex(c) {
    const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function hexToPacked(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = $('view');
    const app = new PPS.App(canvas);
    PPS.app = app; // expose for debugging

    const paramInputs = {};

    // ---------------- parameters ----------------
    (function buildParams() {
      const box = $('params-container');
      for (const spec of PARAM_SCHEMA) {
        const wrap = el('div', 'param');
        const label = el('div', 'label');
        const name = el('span', 'name', spec.label);
        const tag = spec.live ? '' : '<span class="reset-tag">↻ resets</span>';
        label.appendChild(name);
        const val2 = el('span');
        val2.innerHTML = '<span class="val"></span>' + tag;
        label.appendChild(val2);
        const input = el('input');
        input.type = 'range';
        input.min = spec.min; input.max = spec.max; input.step = spec.step;
        input.value = app.sim.params[spec.key];
        wrap.appendChild(label);
        wrap.appendChild(input);
        box.appendChild(wrap);

        const valSpan = val2.querySelector('.val');
        valSpan.textContent = app.sim.params[spec.key];
        paramInputs[spec.key] = { input, valSpan, spec };

        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          valSpan.textContent = spec.step < 1 ? v : Math.round(v);
          if (spec.live) app.setLive({ [spec.key]: v });
        });
        // Non-live params rebuild on release.
        input.addEventListener('change', () => {
          if (spec.live) return;
          const v = spec.key === 'count' || spec.key === 'seed'
            ? Math.round(parseFloat(input.value)) : parseFloat(input.value);
          app.rebuild({ [spec.key]: v });
        });
      }
    })();

    function syncParams() {
      for (const key in paramInputs) {
        const { input, valSpan, spec } = paramInputs[key];
        const v = app.sim.params[key];
        input.value = v;
        valSpan.textContent = spec.step < 1 ? v : Math.round(v);
      }
    }

    // ---------------- transport ----------------
    const btnPlay = $('btn-play');
    function setPlaying(p) {
      app.playing = p;
      btnPlay.textContent = p ? '⏸ Pause' : '▶ Play';
      btnPlay.classList.toggle('active', p);
    }
    btnPlay.onclick = () => setPlaying(!app.playing);
    $('btn-step').onclick = () => app.manualStep();
    $('btn-reset').onclick = () => app.reset();
    $('spf').addEventListener('input', (e) => {
      app.stepsPerFrame = Math.max(1, parseInt(e.target.value) || 1);
    });

    // ---------------- presets ----------------
    (function buildPresets() {
      const sel = $('preset-select');
      PPS.PRESETS.forEach((p, i) => {
        const o = el('option'); o.value = i; o.textContent = p.name; sel.appendChild(o);
      });
      const notes = $('preset-notes');
      const showNotes = () => { notes.textContent = PPS.PRESETS[sel.value].notes; };
      sel.addEventListener('change', showNotes);
      showNotes();
      $('btn-apply-preset').onclick = () => {
        app.applyPreset(PPS.PRESETS[sel.value]);
        syncParams();
        updateRecInfo();
      };
    })();

    // ---------------- colour & tracking ----------------
    const colorMode = $('color-mode');
    function refreshColorPanels() {
      const m = colorMode.value;
      $('classic-thresholds').classList.toggle('hidden', m !== 'classic');
      $('scalar-max').classList.toggle('hidden', !(m === 'density' || m === 'turn'));
      $('custom-panel').classList.toggle('hidden', m !== 'custom');
      if (m === 'density') $('scalar-max-input').value = app.coloring.densityMax;
      if (m === 'turn') $('scalar-max-input').value = app.coloring.turnMax;
    }
    colorMode.addEventListener('change', () => {
      app.coloring.setMode(colorMode.value);
      refreshColorPanels();
    });
    ['th-t1', 'th-t2', 'th-t3'].forEach((id, k) => {
      $(id).addEventListener('input', () => {
        app.coloring.thresholds['t' + (k + 1)] = parseFloat($(id).value) || 0;
        app.coloring._rebuildClassicLUT();
      });
    });
    $('scalar-max-input').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value) || 1;
      if (colorMode.value === 'density') app.coloring.densityMax = v;
      else app.coloring.turnMax = v;
    });
    const customExpr = $('custom-expr');
    customExpr.addEventListener('input', () => {
      app.coloring.setCustomExpr(customExpr.value);
      $('custom-error').textContent = app.coloring.customError;
    });

    // Highlight rules editor.
    function defaultRuleFor(type) {
      const white = PPS.rgb(255, 255, 255);
      switch (type) {
        case 'expr': return { name: 'custom', type: 'expr', expr: 'dN > 8', color: white, enabled: true };
        case 'birth': return { name: 'Cell birth', type: 'builtin', key: 'birth', threshold: 6, color: white, enabled: true };
        case 'death': return { name: 'Cell death', type: 'builtin', key: 'death', threshold: 6, color: PPS.rgb(255, 50, 50), enabled: true };
        case 'nucleus': return { name: 'Dense nucleus', type: 'builtin', key: 'nucleus', threshold: 40, color: PPS.rgb(255, 230, 0), enabled: true };
        case 'lonely': return { name: 'Lonely', type: 'builtin', key: 'lonely', threshold: 1, color: PPS.rgb(0, 255, 255), enabled: true };
        case 'spinner': return { name: 'Spinner', type: 'builtin', key: 'spinner', threshold: 10, color: PPS.rgb(255, 140, 0), enabled: true };
        case 'rare': return { name: 'Rare density', type: 'rare', threshold: 0.4, color: white, enabled: true };
      }
    }
    function renderRules() {
      const box = $('rules-container');
      box.innerHTML = '';
      app.coloring.rules.forEach((rule, idx) => {
        const row = el('div', 'rule');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = rule.enabled;
        cb.addEventListener('change', () => { rule.enabled = cb.checked; });
        row.appendChild(cb);

        const nameWrap = el('div', 'rname');
        if (rule.type === 'expr') {
          const ei = el('input'); ei.type = 'text'; ei.value = rule.expr;
          ei.title = 'expression → boolean (vars: N, dN, net, angle, x, y, id, age)';
          const err = el('div', 'rerr');
          ei.addEventListener('input', () => {
            rule.expr = ei.value;
            const errs = app.coloring.compileRules();
            err.textContent = rule.error || '';
          });
          nameWrap.appendChild(ei);
          nameWrap.appendChild(err);
        } else {
          nameWrap.appendChild(el('span', null, rule.name));
        }
        row.appendChild(nameWrap);

        if (rule.type === 'builtin' || rule.type === 'rare') {
          const th = el('input', 'rthresh'); th.type = 'number'; th.value = rule.threshold;
          th.step = rule.type === 'rare' ? 0.1 : 1;
          th.title = rule.type === 'rare' ? 'rarity cutoff (% of particles)' : 'threshold';
          th.addEventListener('input', () => { rule.threshold = parseFloat(th.value) || 0; });
          row.appendChild(th);
        }

        const col = el('input'); col.type = 'color'; col.value = packedToHex(rule.color);
        col.addEventListener('input', () => { rule.color = hexToPacked(col.value); });
        row.appendChild(col);

        const del = el('button', 'del', '✕');
        del.onclick = () => { app.coloring.rules.splice(idx, 1); renderRules(); };
        row.appendChild(del);

        box.appendChild(row);
      });
    }
    app.coloring.compileRules();
    renderRules();
    $('btn-add-rule').onclick = () => {
      const type = $('new-rule-type').value;
      app.coloring.rules.push(defaultRuleFor(type));
      app.coloring.compileRules();
      renderRules();
    };
    $('trails-toggle').addEventListener('change', (e) => {
      app.renderer.trails = e.target.checked;
      app.renderer.bg = e.target.checked ? { r: 0, g: 0, b: 0 } : { r: 8, g: 10, b: 16 };
      if (!e.target.checked) app.trailPaths.clear();
    });
    $('btn-clear-tracked').onclick = () => app.clearTracked();
    $('dot-size').addEventListener('input', (e) => {
      app.renderer.dotSize = parseInt(e.target.value);
      $('dot-size-val').textContent = e.target.value;
    });

    // ---------------- recording ----------------
    const recEveryN = $('rec-everyN');
    const recQuant = $('rec-quant');
    function updateFootBpp() {
      const q = parseInt(recQuant.value);
      const bpp = q === 8 ? 2 : q === 12 ? 3 : 4;
      $('foot-bpp').textContent = bpp + ' bytes/particle @ ' + q + '-bit';
    }
    recQuant.addEventListener('change', updateFootBpp);
    updateFootBpp();

    function updateRecInfo() {
      const rec = app.recorder;
      const info = $('rec-info');
      if (rec.recording) {
        info.textContent = 'Recording… ' + rec.frames.length + ' frames · ' +
          rec.bytesPerParticle() + ' B/particle · ' + fmtBytes(rec.sizeBytes());
      } else if (rec.frames.length > 0) {
        info.textContent = 'Captured ' + rec.frames.length + ' frames · ' +
          rec.bytesPerParticle() + ' B/particle · ' + fmtBytes(rec.sizeBytes());
      } else {
        info.textContent = 'Not recording.';
      }
    }
    app.onRecInfo = updateRecInfo;

    $('btn-rec-start').onclick = () => {
      app.startRecording(parseInt(recEveryN.value) || 1, parseInt(recQuant.value));
      $('btn-rec-start').disabled = true;
      $('btn-rec-stop').disabled = false;
      $('btn-rec-export').disabled = true;
      updateRecInfo();
    };
    $('btn-rec-stop').onclick = () => {
      app.stopRecording();
      $('btn-rec-start').disabled = false;
      $('btn-rec-stop').disabled = true;
      $('btn-rec-export').disabled = app.recorder.frames.length === 0;
      updateRecInfo();
    };
    $('btn-rec-export').onclick = () => app.exportRecording();

    $('rec-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const header = app.loadRecording(reader.result);
          enterPlaybackUI(header);
        } catch (err) {
          alert('Could not load recording: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
    });

    // Playback UI.
    const pbSlider = $('pb-slider');
    const pbInfo = $('pb-info');
    const pbPlay = $('btn-pb-play');
    function enterPlaybackUI(header) {
      $('playback-panel').classList.remove('hidden');
      $('playback-badge').classList.remove('hidden');
      pbSlider.max = app.recorder.frames.length - 1;
      pbSlider.value = 0;
      setPlaying(false);
      pbInfo.textContent = header.count + ' particles · every ' + header.everyN +
        ' steps · ' + app.recorder.frames.length + ' frames';
    }
    app.onPlaybackFrame = (index, total) => {
      pbSlider.value = index;
      pbInfo.textContent = 'frame ' + (index + 1) + ' / ' + total +
        ' · sim step ≈ ' + (index * app.recorder.everyN);
    };
    pbSlider.addEventListener('input', () => {
      app.pbPlaying = false;
      pbPlay.textContent = '▶';
      app.setPlaybackIndex(parseInt(pbSlider.value));
    });
    pbPlay.onclick = () => {
      app.pbPlaying = !app.pbPlaying;
      pbPlay.textContent = app.pbPlaying ? '⏸' : '▶';
    };
    $('btn-exit-playback').onclick = () => {
      app.exitPlayback();
      $('playback-panel').classList.add('hidden');
      $('playback-badge').classList.add('hidden');
    };

    // ---------------- batch ----------------
    const batchMode = $('batch-mode');
    batchMode.addEventListener('change', () => {
      $('batch-param-row').classList.toggle('hidden', batchMode.value !== 'param');
      $('batch-seed-row').classList.toggle('hidden', batchMode.value !== 'seed');
    });
    let lastBatchResults = [];
    function renderGallery(results) {
      const box = $('batch-results');
      box.innerHTML = '';
      results.forEach((r) => {
        const card = el('div', 'card');
        const img = el('img'); img.src = r.thumb; card.appendChild(img);
        card.appendChild(el('div', 'lbl', r.label));
        const m = r.metrics;
        card.appendChild(el('div', 'met',
          'meanN ' + m.meanN.toFixed(1) + ' · σ ' + m.stdN.toFixed(1) +
          '<br>clusters ' + m.clusters + ' · act ' + m.activity.toFixed(2) +
          (r.novelty != null ? '<br>novelty ' + r.novelty.toFixed(2) : '')));
        card.addEventListener('click', () => {
          app.applyPreset({ params: r.params });
          syncParams();
        });
        if (r.recording) {
          const dl = el('div', 'dl', '⬇ download .pps');
          dl.addEventListener('click', (ev) => {
            ev.stopPropagation();
            PPS.download(r.recording, 'batch-' + r.label.replace(/[^\w.-]/g, '_') + '.pps');
          });
          card.appendChild(dl);
        }
        box.appendChild(card);
      });
    }
    $('btn-batch-run').onclick = () => {
      const base = Object.assign({}, app.sim.params);
      const spec = {
        base,
        steps: parseInt($('batch-steps').value) || 300,
        mode: batchMode.value,
        record: $('batch-record').checked,
        everyN: parseInt(recEveryN.value) || 4,
        quant: parseInt(recQuant.value),
        thumbSize: 110,
      };
      if (batchMode.value === 'param') {
        spec.param = $('batch-param').value;
        spec.from = parseFloat($('batch-from').value);
        spec.to = parseFloat($('batch-to').value);
        spec.count = parseInt($('batch-count').value) || 6;
      } else {
        const seedsStr = $('batch-seeds').value.trim();
        if (seedsStr) spec.seeds = seedsStr.split(',').map((s) => parseInt(s.trim())).filter((x) => !isNaN(x));
        else spec.count = parseInt($('batch-count').value) || 6;
      }
      $('btn-batch-run').disabled = true;
      $('btn-batch-cancel').disabled = false;
      $('batch-results').innerHTML = '';
      const prog = $('batch-progress');
      const running = [];
      app.batch.run(spec, (done, total, result) => {
        prog.textContent = 'run ' + done + ' / ' + total + ' complete';
        running.push(result);
        renderGallery(running);
      }).then((results) => {
        lastBatchResults = results;
        prog.textContent = 'Done — ' + results.length + ' runs.';
        $('btn-batch-run').disabled = false;
        $('btn-batch-cancel').disabled = true;
      });
    };
    $('btn-batch-cancel').onclick = () => app.batch.cancel();
    $('btn-batch-sort').onclick = () => {
      if (lastBatchResults.length) renderGallery(app.batch.rankByNovelty());
    };

    // ---------------- experiments ----------------
    function renderExperiments() {
      const box = $('exp-list');
      box.innerHTML = '';
      const list = PPS.ExperimentStore.load();
      if (list.length === 0) {
        box.appendChild(el('p', 'note', 'No saved experiments yet.'));
        return;
      }
      list.forEach((exp, i) => {
        const row = el('div', 'exp');
        const p = exp.params;
        row.appendChild(el('div', 'en',
          '<b>' + escapeHtml(exp.name) + '</b><small>α' + p.alpha + ' β' + p.beta +
          ' v' + p.v + ' r' + p.r + ' · n' + p.count + ' seed' + p.seed + '</small>'));
        const load = el('button', null, 'load');
        load.onclick = () => { app.applyPreset({ params: exp.params }); syncParams(); };
        const del = el('button', null, '✕');
        del.onclick = () => { PPS.ExperimentStore.remove(i); renderExperiments(); };
        row.appendChild(load);
        row.appendChild(del);
        box.appendChild(row);
      });
    }
    $('btn-exp-save').onclick = () => {
      const name = $('exp-name').value.trim() || 'condition ' + new Date().toLocaleString();
      PPS.ExperimentStore.add({
        name,
        params: Object.assign({}, app.sim.params),
        created: new Date().toISOString(),
      });
      $('exp-name').value = '';
      renderExperiments();
    };
    $('btn-exp-export').onclick = () => {
      const blob = new Blob([PPS.ExperimentStore.exportAll()], { type: 'application/json' });
      PPS.download(blob, 'pps-experiments.json');
    };
    $('exp-import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { PPS.ExperimentStore.importJSON(reader.result); renderExperiments(); }
        catch (err) { alert('Import failed: ' + err.message); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    renderExperiments();

    // ---------------- canvas interaction ----------------
    let dragging = false, moved = 0, lastX = 0, lastY = 0;
    canvas.addEventListener('mousedown', (e) => {
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      app.renderer.panByPixels(dx, dy);
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (dragging && moved < 4 && app.mode === 'live') {
        const rect = canvas.getBoundingClientRect();
        app.pick(e.clientX - rect.left, e.clientY - rect.top, 10);
      }
      dragging = false;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      app.renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!app.playing); }
      else if (e.key === 's') app.manualStep();
      else if (e.key === 'r') app.reset();
      else if (e.key === 'f') {
        if (app.mode === 'live') app.renderer.fit(app.sim.W, app.sim.H);
        else app.renderer.fit(app.playSim.W, app.playSim.H);
      }
    });

    // ---------------- stats HUD ----------------
    app.onStats = (s) => {
      $('stat-fps').textContent = s.fps.toFixed(0);
      $('stat-sps').textContent = s.sps.toFixed(0);
      $('stat-step').textContent = s.step;
      $('stat-count').textContent = s.count.toLocaleString();
      $('stat-tracked').textContent = s.tracked;
      if (s.metrics) {
        $('stat-meanN').textContent = s.metrics.meanN.toFixed(1);
        $('stat-clusters').textContent = s.metrics.clusters;
      }
    };

    // Kick off in a running state so the demo comes alive immediately.
    refreshColorPanels();
    setPlaying(true);
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})((window.PPS = window.PPS || {}));
