/* state.js — your ledger: what you have consumed, want, half-finished.
   Lives in localStorage; travels via JSON export/import. */

"use strict";

window.LEDGER = (function () {
  var KEY = "atm.ledger.v1";
  var PREFKEY = "atm.prefs.v1";
  var data = { entries: {} }; // id -> {s:0|1|2|3, at:ms, r?:1-10, note?:string}

  var STATE_NAMES = { 0: "unmarked", 1: "consumed", 2: "partial", 3: "want to" };
  var GLYPHS = { 0: "·", 1: "●", 2: "◐", 3: "○" };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.entries) data = parsed;
      }
    } catch (e) { console.warn("[ledger] load failed", e); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.warn("[ledger] save failed", e); }
  }

  function entry(id) { return data.entries[id]; }
  function stateOf(id) { var e = data.entries[id]; return e ? (e.s || 0) : 0; }
  function ensure(id) {
    if (!data.entries[id]) data.entries[id] = { s: 0, at: Date.now() };
    return data.entries[id];
  }
  function setState(id, s, meta) {
    var e = ensure(id);
    e.s = s; e.at = Date.now();
    if (meta && !e.meta) e.meta = meta; // snapshot for deep-atlas works: {t,y,p,ln}
    if (s === 0 && !e.r && !e.note) delete data.entries[id];
    save();
  }
  function cycle(id, meta) {
    var next = (stateOf(id) + 1) % 4;
    setState(id, next, meta);
    return next;
  }
  function setRating(id, r, meta) {
    var e = ensure(id);
    if (r) e.r = r; else delete e.r;
    if (meta && !e.meta) e.meta = meta;
    e.at = Date.now(); save();
  }
  function setNote(id, note, meta) {
    var e = ensure(id);
    if (note) e.note = note; else delete e.note;
    if (meta && !e.meta) e.meta = meta;
    e.at = Date.now(); save();
  }

  /* ---------- stats ---------- */
  function counts() {
    var c = { 1: 0, 2: 0, 3: 0, rated: 0, noted: 0 };
    Object.keys(data.entries).forEach(function (id) {
      var e = data.entries[id];
      if (e.s) c[e.s] = (c[e.s] || 0) + 1;
      if (e.r) c.rated++;
      if (e.note) c.noted++;
    });
    return c;
  }
  function coverageOf(list) {
    var n = 0, popAll = 0, popGot = 0;
    list.forEach(function (it) {
      popAll += it.p;
      var s = stateOf(it.id);
      if (s === 1) { n++; popGot += it.p; }
      else if (s === 2) { n++; popGot += it.p * 0.5; }
    });
    return { n: n, total: list.length, pct: popAll ? 100 * popGot / popAll : 0 };
  }
  function recent(limit) {
    var out = [];
    Object.keys(data.entries).forEach(function (id) {
      var e = data.entries[id];
      if (e.s || e.r || e.note) out.push({ id: id, e: e });
    });
    out.sort(function (a, b) { return b.e.at - a.e.at; });
    return out.slice(0, limit || 40);
  }

  /* ---------- export / import ---------- */
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  function exportJSON() {
    var payload = {
      app: "all-the-media", version: 1,
      exported: new Date().toISOString(),
      entries: data.entries
    };
    download("all-the-media-ledger-" + stamp() + ".json", JSON.stringify(payload, null, 2));
  }
  function csvCell(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var rows = [["id", "title", "year", "area", "field", "state", "rating", "marked", "note"]];
    Object.keys(data.entries).forEach(function (id) {
      var e = data.entries[id], it = ATLAS.get(id), mt = e.meta || {};
      rows.push([
        id, it ? it.t : (mt.t || "?"), it ? it.yl : (mt.y || ""),
        it ? it.leaf.two.name : "", it ? it.leaf.name : (mt.ln || ""),
        STATE_NAMES[e.s || 0], e.r || "",
        new Date(e.at).toISOString().slice(0, 10), e.note || ""
      ]);
    });
    download("all-the-media-ledger-" + stamp() + ".csv",
      rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n"), "text/csv");
  }
  function importText(text) {
    var parsed = JSON.parse(text);
    var incoming = null;
    if (Array.isArray(parsed)) {
      incoming = {};
      parsed.forEach(function (id) { if (typeof id === "string") incoming[id] = { s: 1, at: Date.now() }; });
    } else if (parsed && parsed.entries) {
      incoming = parsed.entries;
    } else if (parsed && typeof parsed === "object") {
      incoming = parsed; // raw entries map
    }
    if (!incoming) throw new Error("Unrecognised format");
    var added = 0, updated = 0, unknown = 0;
    Object.keys(incoming).forEach(function (id) {
      var inc = incoming[id];
      if (!inc || typeof inc !== "object") return;
      if (!ATLAS.get(id)) unknown++;
      var cur = data.entries[id];
      if (!cur) { data.entries[id] = inc; added++; }
      else if ((inc.at || 0) >= (cur.at || 0)) { data.entries[id] = inc; updated++; }
    });
    save();
    return { added: added, updated: updated, unknown: unknown };
  }
  function wipe() { data = { entries: {} }; save(); }

  /* ---------- ui prefs ---------- */
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFKEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREFKEY, JSON.stringify(p)); } catch (e) {}
  }

  load();

  return {
    entry: entry, stateOf: stateOf, setState: setState, cycle: cycle,
    setRating: setRating, setNote: setNote,
    counts: counts, coverageOf: coverageOf, recent: recent,
    exportJSON: exportJSON, exportCSV: exportCSV, importText: importText, wipe: wipe,
    loadPrefs: loadPrefs, savePrefs: savePrefs,
    GLYPHS: GLYPHS, STATE_NAMES: STATE_NAMES
  };
})();
