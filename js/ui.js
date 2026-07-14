/* ui.js — rendering and interaction. */
"use strict";

window.UI = (function () {

  var V = {
    tab: "atlas",        // atlas | constellations | ledger
    slice: "ten",        // one | two | ten | hundred
    metric: "pop",       // pop | imp | fld | pr | year
    filter: "all",       // all | consumed | unmarked | want
    q: "",
    cluster: null,
    detail: null,
    expanded: {}
  };

  var root, main, drawer, covchipEl;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pct(x) { return Math.round(x); }

  /* ================= top bar ================= */

  function buildShell() {
    root = document.getElementById("root");
    root.innerHTML =
      '<header id="topbar">' +
        '<div class="tb-row1">' +
          '<div class="brand"><span class="b1">ALL THE MEDIA <span class="made-w">YOU HAVE CONSUMED</span></span>' +
          '<span class="b2">an atlas of everything, and a ledger of your share of it</span></div>' +
          '<div class="tb-search"><input id="q" type="search" placeholder="search everything — titles, creators, themes, constellations&hellip;" autocomplete="off"></div>' +
          '<nav class="tabs">' +
            '<button data-act="tab" data-v="atlas">Atlas</button>' +
            '<button data-act="tab" data-v="constellations">Constellations</button>' +
            '<button data-act="tab" data-v="ledger">Ledger</button>' +
          '</nav>' +
        '</div>' +
        '<div class="tb-row2">' +
          '<div class="ctl"><span class="lbl">Slice</span><div class="seg" id="seg-slice">' +
            '<button data-act="slice" data-v="one">One</button>' +
            '<button data-act="slice" data-v="two">Two</button>' +
            '<button data-act="slice" data-v="ten">Ten</button>' +
            '<button data-act="slice" data-v="hundred">~Hundred</button>' +
          '</div></div>' +
          '<div class="ctl"><span class="lbl">Rank by</span><div class="seg" id="seg-metric">' +
            '<button data-act="metric" data-v="pop" title="Gross popularity — how much of the species has consumed it">Popularity</button>' +
            '<button data-act="metric" data-v="imp" title="Gross importance — cultural-historical weight">Importance</button>' +
            '<button data-act="metric" data-v="fld" title="Canonical weight within its own field">In-field</button>' +
            '<button data-act="metric" data-v="rate" title="Community rating out of 10 — real vote data where a source has it (IMDb), estimated from canon weight elsewhere">Rating</button>' +
            '<button data-act="metric" data-v="pr" title="PageRank over the derived link graph — the Wikipedia-style measure">Interlinkage</button>' +
            '<button data-act="metric" data-v="year">Year</button>' +
          '</div></div>' +
          '<div class="ctl"><span class="lbl">Show</span><div class="seg" id="seg-filter">' +
            '<button data-act="filter" data-v="all">Everything</button>' +
            '<button data-act="filter" data-v="consumed">Consumed</button>' +
            '<button data-act="filter" data-v="unmarked">Unmarked</button>' +
            '<button data-act="filter" data-v="want">Wanted</button>' +
          '</div></div>' +
          '<div class="covchip" id="covchip"></div>' +
        '</div>' +
      '</header>' +
      '<div id="main"></div>' +
      '<aside id="drawer"></aside>' +
      '<footer id="foot">' +
        '<p><b>Method.</b> Every work carries five weights: <i>popularity</i> (gross consumption), <i>importance</i> (cultural mass), ' +
        '<i>in-field weight</i> (canon rank inside its own discipline), <i>rating</i> (community score out of 10 — real vote data where a ' +
        'source has it, estimated elsewhere) and <i>interlinkage</i> (PageRank over a graph derived from hand links, ' +
        'shared creators and shared constellations — the same what-links-to-what logic that makes Wikipedia navigable). ' +
        'The orbit on each work estimates cross-consumption: what someone who has met this has probably also met. ' +
        'Quick keys: &#10003; marks consumed, + marks want-to, right-click any title to toggle consumed, ' +
        'and the back button (browser or drawer) retraces your chain indefinitely. ' +
        'Core weights are editable opinions living in <code>js/items/*.js</code>; the deep atlas is rebuilt by <code>tools/build_deep_atlas.py</code>.</p>' +
        '<p class="sig">Life is just media simulator. Node traversal is a skill; here is a graph to practise on. — built for Jet, July 2026</p>' +
      '</footer>';
    main = document.getElementById("main");
    drawer = document.getElementById("drawer");
    covchipEl = document.getElementById("covchip");
  }

  function syncControls() {
    ["slice", "metric", "filter"].forEach(function (k) {
      var seg = document.getElementById("seg-" + k);
      Array.prototype.forEach.call(seg.children, function (b) {
        b.classList.toggle("on", b.getAttribute("data-v") === V[k]);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-v") === V.tab);
    });
    updateCovchip();
  }
  function coreItems() {
    return ATLAS.items().filter(function (it) { return !it.dp; });
  }
  function nodeById(id) {
    if (id === "all") return TAXONOMY;
    var hit = null;
    ATLAS.twos().forEach(function (n) { if (n.id === id) hit = n; });
    ATLAS.tens().forEach(function (n) { if (n.id === id) hit = n; });
    if (!hit) ATLAS.leaves().forEach(function (n) { if (n.id === id) hit = n; });
    return hit;
  }
  function fmt(n) { return n.toLocaleString("en-US"); }
  function updateCovchip() {
    var cov = LEDGER.coverageOf(coreItems());
    var c = LEDGER.counts();
    var grand = ATLAS.items().length +
      (window.DEEP ? Object.keys(window.DEEPINDEX || {}).reduce(function (a, k) {
        return a + DEEP.remaining(k);
      }, 0) : 0);
    covchipEl.innerHTML = "<b>" + cov.pct.toFixed(1) + "%</b> of the core canon &middot; " +
      (c[1] || 0) + " consumed &middot; " + fmt(grand) + " works charted";
  }

  /* ================= rows ================= */

  function applyFilter(list) {
    if (V.filter === "all") return list;
    return list.filter(function (it) {
      var s = LEDGER.stateOf(it.id);
      if (V.filter === "consumed") return s === 1 || s === 2;
      if (V.filter === "unmarked") return s === 0;
      if (V.filter === "want") return s === 3;
      return true;
    });
  }

  function metricCell(it) {
    if (V.metric === "pr")
      return '<span class="met"><span class="mbar"><i style="width:' + it.prPct + '%"></i></span><span class="mval">P' + it.prPct + "</span></span>";
    if (V.metric === "rate")
      return '<span class="met"><span class="mbar"><i style="width:' + Math.round(it.r * 10) + '%"></i></span><span class="mval">' + it.r.toFixed(1) + "</span></span>";
    if (V.metric === "year")
      return '<span class="met"><span class="mbar"><i style="width:' + it.p + '%"></i></span><span class="mval">' + esc(it.yl) + "</span></span>";
    var v = V.metric === "imp" ? it.m : V.metric === "fld" ? it.f : it.p;
    return '<span class="met"><span class="mbar"><i style="width:' + v + '%"></i></span><span class="mval">' + v + "</span></span>";
  }

  function quickMarks(id, s) {
    return '<span class="qk">' +
      '<button class="qc' + (s === 1 ? " on" : s === 2 ? " half" : "") + '" data-act="qc" data-id="' + id + '" title="consumed — right-clicking any title does this too">&#10003;</button>' +
      '<button class="qw' + (s === 3 ? " on" : "") + '" data-act="qw" data-id="' + id + '" title="want to">+</button>' +
      "</span>";
  }

  function rowHTML(it, rank, showChip) {
    var s = LEDGER.stateOf(it.id);
    return '<div class="row' + (s === 1 ? " done" : "") + (it.dp ? " deep" : "") + (V.detail === it.id ? " sel" : "") + '" data-id="' + it.id + '">' +
      quickMarks(it.id, s) +
      '<span class="rk">' + (rank || "") + "</span>" +
      '<span class="tt" data-act="open" data-id="' + it.id + '">' + esc(it.t) + "</span>" +
      '<span class="yr">' + esc(it.yl) + "</span>" +
      '<span class="cr">' + esc(it.c) + "</span>" +
      (showChip ? '<span class="chip">' + esc(it.leaf.name) + "</span>" : '<span class="chip" style="visibility:hidden"></span>') +
      metricCell(it) +
      "</div>";
  }

  function areaSectionHTML(area) {
    var node = area.node;
    var all = ATLAS.itemsIn(node);
    var list = applyFilter(all).sort(ATLAS.comparator(V.metric));
    var core = all.filter(function (it) { return !it.dp; });
    var cov = LEDGER.coverageOf(core);
    var deepRemaining = window.DEEP ? DEEP.remainingForLeaves(ATLAS.leavesUnder(node)) : 0;
    var isTwoLevel = node === TAXONOMY || ATLAS.twos().indexOf(node) >= 0;
    var dotColor = (node.two ? node.two.id : node.id) === "happened" ? "var(--hap)" : "var(--made)";
    if (node === TAXONOMY) dotColor = "var(--ink)";
    var cap = V.expanded[area.id] || 10;
    var shown = list.slice(0, cap);
    var html = '<section class="area">' +
      '<div class="area-h">' +
        '<span class="an"><span class="dot" style="color:' + dotColor + '">&#9679;</span>' + esc(area.name) + "</span>" +
        (node.blurb ? '<span class="area-blurb">' + esc(node.blurb) + "</span>" : "") +
        '<span class="ac">' + cov.n + " / " + core.length + " of the canon met" +
          (all.length > core.length ? " &middot; " + fmt(all.length - core.length) + " deep loaded" : "") +
          (deepRemaining ? " &middot; " + fmt(deepRemaining) + " deeper" : "") + "</span>" +
        '<span class="abar"><i style="width:' + pct(cov.pct) + '%"></i></span>' +
        '<span class="apct">' + cov.pct.toFixed(0) + "% of its weight</span>" +
        '<span class="agrow"></span>' +
      "</div>" +
      '<div class="rows">';
    if (!shown.length) html += '<div class="empty">nothing here under this filter</div>';
    shown.forEach(function (it, i) { html += rowHTML(it, i + 1, isTwoLevel || V.slice !== "hundred"); });
    html += "</div>";
    html += '<div class="showall">';
    if (list.length > shown.length)
      html += '<button data-act="showall" data-area="' + esc(area.id) + '">show more &#9662; (' + fmt(shown.length) + " of " + fmt(list.length) + " shown)</button> ";
    else if (cap > 10 && list.length > 10)
      html += '<button data-act="collapse" data-area="' + esc(area.id) + '">collapse &#9652;</button> ';
    if (deepRemaining)
      html += '<button data-act="deeparea" data-node="' + esc(area.id) + '">open the deep atlas: +' + fmt(deepRemaining) + " works</button>";
    html += "</div></section>";
    return html;
  }

  /* ================= main views ================= */

  function renderAtlas() {
    if (V.q.length >= 2) {
      var res = applyFilter(ATLAS.search(V.q));
      var unloadedDeep = window.DEEP ? DEEP.remainingForLeaves(ATLAS.leavesUnder(TAXONOMY)) : 0;
      var html = '<div class="viewhead"><span class="vh-t">Search: &ldquo;' + esc(V.q) + '&rdquo;</span>' +
        '<span class="vh-s">' + res.length + " works among " + fmt(ATLAS.items().length) + " loaded</span>" +
        (unloadedDeep ? '<button class="back" data-act="deepall">search deeper: load all +' + fmt(unloadedDeep) + " works</button>" : "") +
        '<button class="back" data-act="clearsearch">clear</button></div><section class="area"><div class="rows">';
      if (!res.length) html += '<div class="empty">nothing found in what is loaded — try the deep atlas, or add it to js/items/.</div>';
      res.forEach(function (it, i) { html += rowHTML(it, i + 1, true); });
      html += "</div></section>";
      main.innerHTML = html;
      return;
    }
    if (V.cluster) {
      var c = ATLAS.cluster(V.cluster);
      var members = applyFilter(ATLAS.clusterMembers(V.cluster)).sort(ATLAS.comparator(V.metric));
      var allMembers = ATLAS.clusterMembers(V.cluster);
      var cov = LEDGER.coverageOf(allMembers);
      var html = '<div class="viewhead"><span class="vh-t">' + esc(c.name) + "</span>" +
        '<span class="vh-s">' + esc(c.blurb) + " &middot; tightness " + c.w.toFixed(2) +
        " &middot; you have met " + cov.n + " of " + allMembers.length + "</span>" +
        '<button class="back" data-act="back">&larr; all constellations</button></div>' +
        '<section class="area"><div class="rows">';
      members.forEach(function (it, i) { html += rowHTML(it, i + 1, true); });
      html += "</div></section>";
      main.innerHTML = html;
      return;
    }
    var areas = ATLAS.areasAt(V.slice);
    main.innerHTML = areas.map(areaSectionHTML).join("");
  }

  function renderConstellations() {
    var cards = ATLAS.clusters().map(function (c) {
      var members = ATLAS.clusterMembers(c.id);
      if (!members.length) return "";
      var cov = LEDGER.coverageOf(members);
      var top = members.slice(0, 3).map(function (it) { return esc(it.t); }).join(" · ");
      return '<div class="constcard" data-act="cluster" data-k="' + c.id + '">' +
        '<div class="cn">' + esc(c.name) + "</div>" +
        '<div class="cm">' + members.length + " works &middot; tightness " + c.w.toFixed(2) +
          " &middot; " + cov.n + " met (" + cov.pct.toFixed(0) + "%)</div>" +
        '<div class="cb">' + esc(c.blurb) + "</div>" +
        '<div class="ct">' + top + "</div>" +
        '<div class="cbar"><i style="width:' + pct(cov.pct) + '%"></i></div>' +
        "</div>";
    }).join("");
    main.innerHTML = '<div class="viewhead"><span class="vh-t">Constellations</span>' +
      '<span class="vh-s">taste-communities — the engine behind cross-consumption. Click one to browse it; the tighter it is, the more knowing one member predicts knowing the rest.</span></div>' +
      '<div class="constgrid">' + cards + "</div>";
  }

  function renderLedger() {
    var c = LEDGER.counts();
    var covAll = LEDGER.coverageOf(coreItems());
    var allMarks = LEDGER.recent(1000000);
    var deepConsumed = allMarks.filter(function (r) {
      var it = ATLAS.get(r.id);
      return (r.e.s === 1 || r.e.s === 2) && (!it || it.dp);
    }).length;
    var html = '<div class="ledgrid">' +
      '<div class="stat"><div class="sv">' + (c[1] || 0) + '</div><div class="sk">consumed</div></div>' +
      '<div class="stat"><div class="sv">' + (c[2] || 0) + '</div><div class="sk">partial</div></div>' +
      '<div class="stat"><div class="sv alt">' + (c[3] || 0) + '</div><div class="sk">want to</div></div>' +
      '<div class="stat"><div class="sv">' + covAll.pct.toFixed(1) + '%</div><div class="sk">of the core canon</div></div>' +
      '<div class="stat"><div class="sv">' + deepConsumed + '</div><div class="sk">from the deep atlas</div></div>' +
      '<div class="stat"><div class="sv">' + (c.noted || 0) + '</div><div class="sk">notes kept</div></div>' +
      "</div>";

    html += '<div class="ledsec"><h3>Coverage — the Two (core canon)</h3>';
    ATLAS.twos().forEach(function (n) { html += covRow(n.name, ATLAS.itemsIn(n).filter(function (it) { return !it.dp; })); });
    html += '</div><div class="ledsec"><h3>Coverage — the Ten (core canon)</h3>';
    ATLAS.tens().forEach(function (n) { html += covRow(n.name, ATLAS.itemsIn(n).filter(function (it) { return !it.dp; })); });
    html += "</div>";

    html += '<div class="ledsec"><h3>Carry it with you</h3>' +
      '<div class="ledbtns">' +
        '<button data-act="export-json">Export ledger (JSON)</button>' +
        '<button data-act="export-csv">Export ledger (CSV)</button>' +
        '<button data-act="import">Import ledger&hellip;</button>' +
        '<button data-act="wipe" class="danger">Wipe ledger</button>' +
      "</div>" +
      '<p class="lednote">Export produces a dated JSON file of every mark, rating and note. Import merges by newest-wins, ' +
      "so you can continue on another machine or another decade. A bare JSON array of ids is also accepted and marked as consumed. " +
      "Everything lives in this browser's localStorage until you export it — export before you trust a machine you don't own.</p></div>";

    var rec = LEDGER.recent(40);
    html += '<div class="ledsec recent"><h3>Recent movements</h3>';
    if (!rec.length) html += '<div class="empty">Nothing marked yet. Go consume, then confess.</div>';
    rec.forEach(function (r) {
      var it = ATLAS.get(r.id), mt = r.e.meta || {};
      var title = it ? it.t : (mt.t || r.id);
      var yl = it ? it.yl : (mt.y || "");
      var s = r.e.s || 0;
      html += '<div class="row' + (s === 1 ? " done" : "") + '" data-id="' + r.id + '">' +
        quickMarks(r.id, s) +
        '<span class="tt"' + (it ? ' data-act="open" data-id="' + r.id + '"' : "") + ">" + esc(title) + "</span>" +
        '<span class="yr">' + esc(yl) + "</span>" +
        '<span class="cr">' + esc(LEDGER.STATE_NAMES[s]) + (r.e.r ? " · rated " + r.e.r : "") + (it ? "" : " · deep (not loaded)") + "</span>" +
        '<span class="yr">' + new Date(r.e.at).toISOString().slice(0, 10) + "</span>" +
        "</div>";
    });
    html += "</div>";
    main.innerHTML = html;
  }
  function covRow(name, list) {
    var cov = LEDGER.coverageOf(list);
    return '<div class="covrow"><span class="cvn">' + esc(name) + "</span>" +
      '<span class="cvb"><i style="width:' + pct(cov.pct) + '%"></i></span>' +
      '<span class="cvv">' + cov.n + "/" + cov.total + " &middot; " + cov.pct.toFixed(1) + "%</span></div>";
  }

  /* ================= drawer ================= */

  function metRow(label, val, width, hint) {
    return '<div class="dmet" title="' + esc(hint || "") + '"><span class="dmk">' + label + "</span>" +
      '<span class="mbar"><i style="width:' + width + '%"></i></span><span class="dmv">' + val + "</span></div>";
  }

  function renderDrawer() {
    document.body.classList.toggle("drawer-open", !!V.detail);
    if (!V.detail) { drawer.classList.remove("open"); return; }
    var it = ATLAS.get(V.detail);
    if (!it) return;
    var e = LEDGER.entry(it.id) || {};
    var s = e.s || 0;
    var orb = ATLAS.orbit(it.id, 14);
    var met = orb.filter(function (o) { var st = LEDGER.stateOf(o.item.id); return st === 1 || st === 2; }).length;

    var kchips = it.k.map(function (kid) {
      var c = ATLAS.cluster(kid);
      return c ? '<span class="chip k" data-act="cluster" data-k="' + kid + '">' + esc(c.name) + "</span>" : "";
    }).join("");
    var tchips = it.g.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("");

    var html = '<div class="dwrap">' +
      '<button class="dback" data-act="nav-back" title="back along the consumption chain — the browser back button works too">&larr;</button>' +
      '<button class="dclose" data-act="close-drawer">&times;</button>' +
      '<div class="dcrumb">' + esc(it.leaf.two.name) + ' <span class="dc-2">&rsaquo; ' + esc(it.leaf.ten.name) + " &rsaquo; " + esc(it.leaf.name) + "</span></div>" +
      '<div class="dtitle">' + esc(it.t) + "</div>" +
      '<div class="dmeta">' + esc(it.yl) + (it.c ? " &middot; " + esc(it.c) : "") +
        (it.dp ? " &middot; deep atlas (auto-charted)" : "") + "</div>" +
      (it.n ? '<div class="dnote">' + esc(it.n) + "</div>" : "") +
      '<div class="dtags">' + tchips + kchips + "</div>" +
      '<div class="dmets">' +
        metRow("Popularity", it.p + "/100", it.p, "gross consumption across the species") +
        metRow("Importance", it.m + "/100", it.m, "gross cultural-historical weight") +
        metRow("In-field weight", it.f + "/100", it.f, "canon rank within " + it.leaf.name) +
        metRow("Rating", it.r.toFixed(1) + "/10", Math.round(it.r * 10),
          "community rating — vote-derived where a source has votes (IMDb), estimated from canon weight elsewhere") +
        metRow("Interlinkage", (it.dp ? "~P" : "P") + it.prPct, it.prPct,
          it.dp ? "approximate for deep-atlas works (static, popularity-derived)"
                : "PageRank percentile over the derived link graph") +
      "</div>" +
      '<div class="dstates">' +
        '<button data-act="state" data-id="' + it.id + '" data-s="1" class="' + (s === 1 ? "on" : "") + '">&#9679; Consumed</button>' +
        '<button data-act="state" data-id="' + it.id + '" data-s="2" class="' + (s === 2 ? "on" : "") + '">&#9684; Partial</button>' +
        '<button data-act="state" data-id="' + it.id + '" data-s="3" class="' + (s === 3 ? "on want" : "") + '">&#9675; Want to</button>' +
        '<button data-act="state" data-id="' + it.id + '" data-s="0">Clear</button>' +
      "</div>" +
      '<div class="dpersonal">' +
        '<select id="dr-rating" data-id="' + it.id + '"><option value="">rate&hellip;</option>' +
          (function () {
            var opts = "";
            for (var n = 0; n <= 20; n++) {
              var v = n / 2;
              var stars = "&#9733;".repeat(Math.floor(v / 2)) + (v % 2 >= 1 ? "&#189;" : "");
              opts += '<option value="' + v + '"' + (e.r === v ? " selected" : "") + ">" +
                v.toFixed(1) + (stars ? " " + stars : "") + "</option>";
            }
            return opts;
          })() + "</select>" +
        '<textarea id="dr-note" data-id="' + it.id + '" placeholder="your note — saved on blur, exported with the ledger">' + esc(e.note || "") + "</textarea>" +
      "</div>" +
      '<div class="dsec"><h4>Orbit — <b>likely cross-consumption</b></h4>';
    orb.forEach(function (o) {
      var st = LEDGER.stateOf(o.item.id);
      html += '<div class="orb" data-id="' + o.item.id + '">' +
        quickMarks(o.item.id, st) +
        '<span class="ol">' + o.pct + "%</span>" +
        '<span class="on2" data-act="open" data-id="' + o.item.id + '">' + esc(o.item.t) + "</span>" +
        '<span class="or2">' + esc(o.reasons.slice(0, 2).join(" · ")) + "</span>" +
        "</div>";
    });
    html += '<canvas id="orbitcanvas" width="424" height="300"></canvas>' +
      '<div class="dorbnote">You have met ' + met + " of its " + orb.length + " nearest neighbours. Percentages are odds that a consumer of this has also consumed that.</div>" +
      "</div></div>";
    drawer.innerHTML = html;
    drawer.classList.add("open");
    drawGraph(it, orb);
  }

  /* ---------- neighbourhood canvas ---------- */
  function drawGraph(center, orb) {
    var cv = document.getElementById("orbitcanvas");
    if (!cv) return;
    var cssW = cv.clientWidth || 424, cssH = 300;
    var dpr = window.devicePixelRatio || 1;
    cv.width = cssW * dpr; cv.height = cssH * dpr;
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    var cx = cssW / 2, cy = cssH / 2;
    var nodes = orb.slice(0, 14);
    var maxS = nodes.length ? nodes[0].score : 1;
    var placed = nodes.map(function (o, i) {
      var ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      var rad = 52 + 82 * (1 - o.score / maxS) + (i % 2) * 12;
      return { o: o, x: cx + Math.cos(ang) * rad * (cssW / 300), y: cy + Math.sin(ang) * rad * 0.78 };
    });
    // neighbour-neighbour edges
    ctx.lineWidth = 0.5;
    for (var i = 0; i < placed.length; i++) {
      for (var j = i + 1; j < placed.length; j++) {
        var e = ATLAS.edgeBetween(placed[i].o.item.id, placed[j].o.item.id);
        if (e && e.w > 1.2) {
          ctx.strokeStyle = "rgba(92,200,255,0.10)";
          ctx.beginPath(); ctx.moveTo(placed[i].x, placed[i].y); ctx.lineTo(placed[j].x, placed[j].y); ctx.stroke();
        }
      }
    }
    // spokes
    placed.forEach(function (p) {
      ctx.strokeStyle = "rgba(240,168,68," + (0.08 + 0.30 * p.o.pct / 100) + ")";
      ctx.lineWidth = 0.6 + 1.6 * p.o.pct / 100;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
    });
    // nodes
    var hits = [];
    placed.forEach(function (p) {
      var st = LEDGER.stateOf(p.o.item.id);
      var r = 2.5 + p.o.item.p / 30;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
      ctx.fillStyle = st === 1 ? "#f0a844" : st === 2 ? "#b98336" : st === 3 ? "#5cc8ff" : "#39404d";
      ctx.fill();
      ctx.fillStyle = st ? "#e6e1d3" : "#8b93a1";
      ctx.font = "9.5px Consolas,monospace";
      var label = p.o.item.t.length > 17 ? p.o.item.t.slice(0, 16) + "…" : p.o.item.t;
      var tx = p.x > cx ? p.x + r + 3 : p.x - r - 3 - ctx.measureText(label).width;
      ctx.fillText(label, tx, p.y + 3);
      hits.push({ x: p.x, y: p.y, r: r + 8, id: p.o.item.id });
    });
    // centre
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 7);
    ctx.fillStyle = "#e6e1d3"; ctx.fill();
    ctx.font = "bold 10.5px Consolas,monospace";
    ctx.fillStyle = "#e6e1d3";
    var cl = center.t.length > 24 ? center.t.slice(0, 23) + "…" : center.t;
    ctx.fillText(cl, cx - ctx.measureText(cl).width / 2, cy + 20);
    cv._hits = hits;
    function hitAt(ev) {
      var rect = cv.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      for (var i = 0; i < hits.length; i++) {
        var dx = x - hits[i].x, dy = y - hits[i].y;
        if (dx * dx + dy * dy < hits[i].r * hits[i].r) return hits[i];
      }
      return null;
    }
    cv.onclick = function (ev) {
      var h = hitAt(ev);
      if (h) openDetail(h.id);
    };
    cv.oncontextmenu = function (ev) {
      var h = hitAt(ev);
      if (!h) return;
      ev.preventDefault();
      toggleState(h.id, 1);
      drawGraph(center, orb); // repaint node colours
    };
  }

  /* ================= actions ================= */

  function render() {
    syncControls();
    if (V.tab === "atlas") renderAtlas();
    else if (V.tab === "constellations") renderConstellations();
    else renderLedger();
    renderDrawer();
    LEDGER.savePrefs({ slice: V.slice, metric: V.metric, filter: V.filter, tab: V.tab });
  }

  function metaFor(id) {
    var it = ATLAS.get(id);
    if (!it || !it.dp) return null;
    return { t: it.t, y: it.yl, p: it.p, ln: it.leaf.name };
  }

  function openDetail(id, fromHistory) {
    V.detail = id;
    if (!fromHistory) { try { history.pushState({ d: id }, "", ""); } catch (err) {} }
    renderDrawer();
    // highlight row selection without full re-render
    Array.prototype.forEach.call(main.querySelectorAll(".row.sel"), function (r) { r.classList.remove("sel"); });
    Array.prototype.forEach.call(main.querySelectorAll('.row[data-id="' + id + '"]'), function (r) { r.classList.add("sel"); });
  }
  function closeDetail(fromHistory) {
    V.detail = null;
    if (!fromHistory) { try { history.pushState({ d: null }, "", ""); } catch (err) {} }
    renderDrawer();
  }

  function updateRowsFor(id) {
    var s = LEDGER.stateOf(id);
    Array.prototype.forEach.call(document.querySelectorAll('.row[data-id="' + id + '"], .orb[data-id="' + id + '"]'), function (r) {
      if (r.classList.contains("row")) r.classList.toggle("done", s === 1);
      var qc = r.querySelector(".qc"), qw = r.querySelector(".qw");
      if (qc) { qc.classList.toggle("on", s === 1); qc.classList.toggle("half", s === 2); }
      if (qw) qw.classList.toggle("on", s === 3);
    });
    updateCovchip();
    if (V.detail === id) renderDrawer();
  }

  function toggleState(id, target) {
    var s = LEDGER.stateOf(id);
    LEDGER.setState(id, s === target ? 0 : target, metaFor(id));
    updateRowsFor(id);
  }

  var fileInput = null;
  function pickImport() {
    if (!fileInput) {
      fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".json,application/json";
      fileInput.style.display = "none";
      document.body.appendChild(fileInput);
      fileInput.addEventListener("change", function () {
        var f = fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var res = LEDGER.importText(String(reader.result));
            alert("Imported: " + res.added + " added, " + res.updated + " updated" +
              (res.unknown ? ", " + res.unknown + " ids not in this atlas (kept anyway)" : "") + ".");
            render();
          } catch (err) {
            alert("Could not import: " + err.message);
          }
          fileInput.value = "";
        };
        reader.readAsText(f);
      });
    }
    fileInput.click();
  }

  function onClick(ev) {
    var el = ev.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "tab") { V.tab = el.getAttribute("data-v"); V.cluster = null; render(); }
    else if (act === "slice") { V.slice = el.getAttribute("data-v"); V.expanded = {}; render(); }
    else if (act === "metric") { V.metric = el.getAttribute("data-v"); render(); }
    else if (act === "filter") { V.filter = el.getAttribute("data-v"); render(); }
    else if (act === "cycle") { LEDGER.cycle(el.getAttribute("data-id"), metaFor(el.getAttribute("data-id"))); updateRowsFor(el.getAttribute("data-id")); }
    else if (act === "qc") { toggleState(el.getAttribute("data-id"), 1); }
    else if (act === "qw") { toggleState(el.getAttribute("data-id"), 3); }
    else if (act === "state") {
      LEDGER.setState(el.getAttribute("data-id"), parseInt(el.getAttribute("data-s"), 10), metaFor(el.getAttribute("data-id")));
      updateRowsFor(el.getAttribute("data-id"));
    }
    else if (act === "open") { openDetail(el.getAttribute("data-id")); }
    else if (act === "nav-back") { history.back(); }
    else if (act === "close-drawer") { closeDetail(); }
    else if (act === "showall") { V.expanded[el.getAttribute("data-area")] = (V.expanded[el.getAttribute("data-area")] || 10) + 2000; render(); }
    else if (act === "collapse") { delete V.expanded[el.getAttribute("data-area")]; render(); }
    else if (act === "deeparea") {
      var node = nodeById(el.getAttribute("data-node"));
      if (!node) return;
      el.textContent = "loading the deep atlas…";
      el.disabled = true;
      DEEP.loadLeaves(ATLAS.leavesUnder(node), function (done, total) {
        el.textContent = "loading the deep atlas… " + done + "/" + total + " fields";
      }, function () { render(); });
    }
    else if (act === "deepall") {
      el.textContent = "loading everything…";
      el.disabled = true;
      DEEP.loadAll(function (done, total) {
        el.textContent = "loading everything… " + done + "/" + total + " fields";
      }, function () { render(); });
    }
    else if (act === "cluster") { V.tab = "atlas"; V.cluster = el.getAttribute("data-k"); V.q = ""; document.getElementById("q").value = ""; render(); }
    else if (act === "back") { V.cluster = null; render(); }
    else if (act === "clearsearch") { V.q = ""; document.getElementById("q").value = ""; render(); }
    else if (act === "export-json") { LEDGER.exportJSON(); }
    else if (act === "export-csv") { LEDGER.exportCSV(); }
    else if (act === "import") { pickImport(); }
    else if (act === "wipe") {
      if (confirm("Wipe the whole ledger from this browser? Export first if any of it matters.")) { LEDGER.wipe(); render(); }
    }
  }

  var searchTimer = null;
  function onSearchInput(ev) {
    var v = ev.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      V.q = v;
      if (v && V.tab !== "atlas") V.tab = "atlas";
      if (v) V.cluster = null;
      render();
      document.getElementById("q").focus();
    }, 160);
  }

  function onChange(ev) {
    if (ev.target.id === "dr-rating") {
      var v = ev.target.value === "" ? 0 : parseFloat(ev.target.value);
      var id = ev.target.getAttribute("data-id");
      LEDGER.setRating(id, v, metaFor(id));
      updateCovchip();
    }
  }
  function onContextMenu(ev) {
    var t = ev.target.closest('[data-act="open"]');
    if (!t) return;
    var id = t.getAttribute("data-id");
    if (!id) return;
    ev.preventDefault();
    toggleState(id, 1);
  }
  function onPopState(ev) {
    var d = ev.state && ev.state.d ? ev.state.d : null;
    if (d) openDetail(d, true); else closeDetail(true);
  }
  function onFocusOut(ev) {
    if (ev.target.id === "dr-note") {
      var id = ev.target.getAttribute("data-id");
      LEDGER.setNote(id, ev.target.value.trim(), metaFor(id));
    }
  }
  function typing() {
    var a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  }
  function onKey(ev) {
    if (ev.key === "Escape" && V.detail) { closeDetail(); }
    if (ev.key === "Backspace" && !typing() && V.detail) { ev.preventDefault(); history.back(); }
    if (ev.key === "/" && !typing()) {
      ev.preventDefault(); document.getElementById("q").focus();
    }
  }

  function start() {
    var prefs = LEDGER.loadPrefs();
    if (prefs.slice) V.slice = prefs.slice;
    if (prefs.metric) V.metric = prefs.metric;
    if (prefs.filter) V.filter = prefs.filter;
    buildShell();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("popstate", onPopState);
    try { history.replaceState({ d: null }, "", ""); } catch (err) {}
    document.getElementById("q").addEventListener("input", onSearchInput);
    render();
  }

  return { start: start };
})();
