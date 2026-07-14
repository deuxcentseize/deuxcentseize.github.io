/* engine.js — turns the raw catalog into an interlinked atlas.
   Edges are derived, Wikipedia-style, from what points at what:
     - hand links            (strongest)
     - shared creator
     - shared constellations (weighted by tightness)
     - same leaf + shared tags
   PageRank over the resulting weighted graph = "interlinkage",
   the atlas's analogue of Wikipedia's link-mass. */

"use strict";

window.ATLAS = (function () {

  var items = [];          // processed items
  var byId = new Map();
  var leaves = new Map();  // leafId -> node (with .path = [two, ten, leaf], .name)
  var tens = [];           // level-two nodes ("The Written Word", ...)
  var twos = [];           // level-one nodes ("The Made" / "The Happened")
  var clustersById = new Map();
  var adj = new Map();     // id -> Map(id -> {w, r:[reasons]})
  var byLeafLive = new Map();    // leafId -> [items], maintained incrementally
  var creatorLive = new Map();   // lowercased creator -> [items]
  var built = false;

  /* ---------- taxonomy walk ---------- */
  function indexTaxonomy() {
    TAXONOMY.children.forEach(function (two) {
      twos.push(two);
      two.children.forEach(function (ten) {
        ten.two = two;
        tens.push(ten);
        ten.children.forEach(function (leaf) {
          leaf.ten = ten;
          leaf.two = two;
          leaves.set(leaf.id, leaf);
        });
      });
    });
    CLUSTERS.forEach(function (c) { clustersById.set(c.id, c); });
  }

  /* ---------- item processing ---------- */
  function yearSort(y) {
    if (typeof y === "number") return y;
    var m = String(y).match(/-?\d+/);
    if (!m) return 9999;
    var n = parseInt(m[0], 10);
    if (String(y).indexOf("-") === 0 && n > 0) n = -n;
    return n;
  }
  function yearLabel(y) {
    if (typeof y === "number") return y < 0 ? "c." + (-y) + " BC" : String(y);
    if (y === "ancient") return "ancient";
    return String(y);
  }

  function processItems() {
    var problems = [];
    CATALOG.forEach(function (raw) {
      var leaf = leaves.get(raw.d);
      if (!leaf) { problems.push("unknown leaf '" + raw.d + "' for " + raw.t); return; }
      var id = MKID(raw.t, raw.y);
      if (byId.has(id)) { problems.push("duplicate id " + id); return; }
      var it = {
        id: id, t: raw.t, y: raw.y, ys: yearSort(raw.y), yl: yearLabel(raw.y),
        c: raw.c, p: raw.p, m: raw.m, f: raw.f,
        r: Math.round((5.2 + 3.6 * raw.f / 100) * 10) / 10, // estimated community rating
        g: raw.g, k: raw.k.filter(function (k, i, a) { return a.indexOf(k) === i; }),
        l: raw.l.filter(function (x) { return typeof x === "string" && x.length > 1; }),
        n: raw.n,
        leaf: leaf, pr: 0, prPct: 0
      };
      it.k.forEach(function (kid) {
        if (!clustersById.has(kid)) problems.push("unknown constellation '" + kid + "' on " + it.t);
      });
      items.push(it);
      byId.set(id, it);
      if (!byLeafLive.has(leaf.id)) byLeafLive.set(leaf.id, []);
      byLeafLive.get(leaf.id).push(it);
      if (it.c) {
        var ck = it.c.toLowerCase();
        if (!creatorLive.has(ck)) creatorLive.set(ck, []);
        creatorLive.get(ck).push(it);
      }
    });
    // drop links that point nowhere (log once)
    items.forEach(function (it) {
      it.l = it.l.filter(function (lid) {
        if (byId.has(lid)) return true;
        problems.push("dangling link " + it.id + " -> " + lid);
        return false;
      });
    });
    if (problems.length) console.warn("[atlas] " + problems.length + " data notes:\n" + problems.join("\n"));
  }

  /* ---------- graph ---------- */
  function edge(a, b) {
    var m = adj.get(a);
    if (!m) { m = new Map(); adj.set(a, m); }
    var e = m.get(b);
    if (!e) { e = { w: 0, r: [] }; m.set(b, e); }
    return e;
  }
  function addEdge(a, b, w, reason) {
    if (a === b) return;
    var e1 = edge(a, b), e2 = edge(b, a);
    e1.w += w; e2.w += w;
    if (reason && e1.r.length < 3 && e1.r.indexOf(reason) < 0) e1.r.push(reason);
    if (reason && e2.r.length < 3 && e2.r.indexOf(reason) < 0) e2.r.push(reason);
  }

  function buildGraph() {
    var t0 = Date.now();
    // 1. hand links
    items.forEach(function (it) {
      it.l.forEach(function (lid) { addEdge(it.id, lid, 2.6, "hand-linked kin"); });
    });
    // 2. shared creator
    var byCreator = new Map();
    items.forEach(function (it) {
      if (!it.c) return;
      var key = it.c.toLowerCase();
      if (!byCreator.has(key)) byCreator.set(key, []);
      byCreator.get(key).push(it);
    });
    byCreator.forEach(function (group) {
      if (group.length < 2 || group.length > 20) return;
      for (var i = 0; i < group.length; i++)
        for (var j = i + 1; j < group.length; j++)
          addEdge(group[i].id, group[j].id, 2.0, "same creator: " + group[i].c);
    });
    // 3. constellations
    var byCluster = new Map();
    items.forEach(function (it) {
      it.k.forEach(function (kid) {
        if (!byCluster.has(kid)) byCluster.set(kid, []);
        byCluster.get(kid).push(it);
      });
    });
    byCluster.forEach(function (group, kid) {
      var c = clustersById.get(kid);
      if (!c || group.length < 2) return;
      // per-pair pull shrinks with community size: being one of ninety in a
      // broad canon binds far less than being one of twelve in a tight cult
      var sizeFactor = Math.min(1, 3 / Math.sqrt(group.length - 1));
      for (var i = 0; i < group.length; i++)
        for (var j = i + 1; j < group.length; j++)
          addEdge(group[i].id, group[j].id, c.w * sizeFactor, c.name);
    });
    // 4. same leaf + shared tags
    var byLeaf = new Map();
    items.forEach(function (it) {
      if (!byLeaf.has(it.leaf.id)) byLeaf.set(it.leaf.id, []);
      byLeaf.get(it.leaf.id).push(it);
    });
    byLeaf.forEach(function (group) {
      for (var i = 0; i < group.length; i++) {
        for (var j = i + 1; j < group.length; j++) {
          var a = group[i], b = group[j], shared = 0;
          for (var x = 0; x < a.g.length; x++) if (b.g.indexOf(a.g[x]) >= 0) shared++;
          var w = 0.22 + Math.min(shared, 3) * 0.3;
          addEdge(a.id, b.id, w, shared ? "same field, shared themes" : "same field");
        }
      }
    });
    built = true;
    var edges = 0; adj.forEach(function (m) { edges += m.size; });
    console.log("[atlas] graph: " + items.length + " works, " + (edges / 2) + " links, " + (Date.now() - t0) + "ms");
  }

  /* ---------- pagerank ----------
     Personalised: the teleport vector is popularity-weighted, so link-mass
     has to flow *from* widely consumed works. A node becomes central by
     being pointed at from the popular part of the graph, not merely by
     sitting in a dense clique. */
  function pagerank() {
    var t0 = Date.now();
    var n = items.length, d = 0.85;
    var pr = new Map(), outW = new Map(), tele = new Map(), popSum = 0;
    items.forEach(function (it) { popSum += it.p; });
    // sqrt of edge weight: centrality should come from breadth of connection,
    // not from a couple of very thick strands
    items.forEach(function (it) {
      pr.set(it.id, 1 / n);
      tele.set(it.id, it.p / popSum);
      var m = adj.get(it.id), sum = 0;
      if (m) m.forEach(function (e) { sum += Math.sqrt(e.w); });
      outW.set(it.id, sum);
    });
    for (var iter = 0; iter < 40; iter++) {
      var next = new Map(), dangling = 0;
      items.forEach(function (it) { next.set(it.id, (1 - d) * tele.get(it.id)); });
      items.forEach(function (it) {
        var m = adj.get(it.id), p = pr.get(it.id), ow = outW.get(it.id);
        if (!m || !ow) { dangling += p; return; }
        m.forEach(function (e, tid) {
          next.set(tid, next.get(tid) + d * p * (Math.sqrt(e.w) / ow));
        });
      });
      items.forEach(function (it) { next.set(it.id, next.get(it.id) + d * dangling * tele.get(it.id)); });
      pr = next;
    }
    items.forEach(function (it) { it.pr = pr.get(it.id); });
    var sorted = items.slice().sort(function (a, b) { return a.pr - b.pr; });
    sorted.forEach(function (it, i) { it.prPct = Math.round(100 * i / (sorted.length - 1)); });
    console.log("[atlas] pagerank in " + (Date.now() - t0) + "ms");
  }

  /* ---------- deep atlas absorption ----------
     Rows arrive from data/deep shards: [title, year, creator, pop, imp, fld, "tag|tag"].
     Deep works join the same id-space and ledger; they get live creator edges
     into whatever is already loaded, and synthetic same-field orbits. */
  function addDeepRows(leafId, rows) {
    var leaf = leaves.get(leafId);
    if (!leaf) { console.warn("[deep] unknown leaf " + leafId); return; }
    var arr = byLeafLive.get(leafId);
    if (!arr) { arr = []; byLeafLive.set(leafId, arr); }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r[0]) continue;
      var id = MKID(r[0], r[1]);
      if (byId.has(id)) continue;
      var alt = id.indexOf("the-") === 0 ? id.slice(4) : "the-" + id;
      if (byId.has(alt)) continue;
      var it = {
        id: id, t: r[0], y: r[1] || 0, ys: yearSort(r[1] || 9999), yl: r[1] ? yearLabel(r[1]) : "—",
        c: r[2] || "", p: r[3], m: r[4], f: r[5],
        r: r[7] != null ? r[7] : Math.round((5.2 + 3.6 * r[5] / 100) * 10) / 10,
        g: r[6] ? String(r[6]).split("|") : [], k: [], l: [], n: "",
        leaf: leaf, dp: true, pr: 0, prPct: Math.min(99, Math.round(r[3] * 0.95))
      };
      items.push(it);
      byId.set(id, it);
      arr.push(it);
      if (it.c) {
        var ck = it.c.toLowerCase();
        var group = creatorLive.get(ck);
        if (group) {
          for (var j = 0; j < group.length && j < 10; j++)
            addEdge(id, group[j].id, 2.0, "same creator: " + it.c);
          group.push(it);
        } else {
          creatorLive.set(ck, [it]);
        }
      }
    }
  }

  /* ---------- neighbours / orbit ---------- */
  function orbit(id, count) {
    var self = byId.get(id);
    var want = count || 24;
    var out = [];
    var m = adj.get(id);
    if (m) {
      m.forEach(function (e, tid) {
        var it = byId.get(tid);
        if (!it) return;
        var score = e.w * (0.6 + 0.4 * it.p / 100);
        out.push({ item: it, w: e.w, score: score, reasons: e.r,
                   pct: Math.min(97, Math.round(100 * (1 - Math.exp(-score / 2.6)))) });
      });
      out.sort(function (a, b) { return b.score - a.score; });
      out = out.slice(0, want);
    }
    // synthetic same-field kin for thinly linked (mostly deep) works
    if (self && out.length < Math.min(want, 12)) {
      var have = { }; have[id] = 1;
      out.forEach(function (o) { have[o.item.id] = 1; });
      var pool = byLeafLive.get(self.leaf.id) || [];
      var cands = [];
      for (var i = 0; i < pool.length && i < 900; i++) {
        var c = pool[i];
        if (have[c.id]) continue;
        var shared = 0;
        for (var x = 0; x < self.g.length; x++) if (c.g.indexOf(self.g[x]) >= 0) shared++;
        var score = (0.35 + 0.3 * Math.min(shared, 3)) * (0.5 + 0.5 * c.p / 100);
        cands.push({ item: c, w: score, score: score,
                     reasons: [shared ? "same field, shared themes" : "same field"],
                     pct: Math.min(97, Math.round(100 * (1 - Math.exp(-score / 2.6)))) });
      }
      cands.sort(function (a, b) { return b.score - a.score; });
      out = out.concat(cands.slice(0, Math.min(want, 12) - out.length));
    }
    return out;
  }
  function edgeBetween(a, b) {
    var m = adj.get(a);
    return m ? m.get(b) : null;
  }

  /* ---------- areas & sorting ---------- */
  function areasAt(slice) {
    if (slice === "one") return [{ id: "all", name: "Everything", node: TAXONOMY }];
    if (slice === "two") return twos.map(function (n) { return { id: n.id, name: n.name, node: n }; });
    if (slice === "ten") return tens.map(function (n) { return { id: n.id, name: n.name, node: n }; });
    var out = [];
    leaves.forEach(function (n) { out.push({ id: n.id, name: n.ten.name + " · " + n.name, node: n }); });
    return out;
  }
  function itemsIn(areaNode) {
    if (areaNode === TAXONOMY) return items.slice();
    return items.filter(function (it) {
      return it.leaf === areaNode || it.leaf.ten === areaNode || it.leaf.two === areaNode;
    });
  }
  function comparator(metric) {
    if (metric === "year") return function (a, b) { return a.ys - b.ys || b.p - a.p; };
    if (metric === "pr") return function (a, b) { return b.pr - a.pr || b.p - a.p; };
    if (metric === "rate") return function (a, b) { return b.r - a.r || b.p - a.p; };
    var key = metric === "imp" ? "m" : metric === "fld" ? "f" : "p";
    return function (a, b) { return b[key] - a[key] || b.p - a.p; };
  }

  /* ---------- search ---------- */
  function haystack(it) {
    if (!it._hay) {
      var kn = it.k.map(function (kid) { var c = clustersById.get(kid); return c ? c.name : ""; }).join(" ");
      it._hay = (it.t + " " + it.c + " " + it.g.join(" ") + " " + it.leaf.name + " " + kn + " " + it.yl).toLowerCase();
    }
    return it._hay;
  }
  function search(q) {
    var toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    var res = items.filter(function (it) {
      var h = haystack(it);
      return toks.every(function (t) { return h.indexOf(t) >= 0; });
    });
    var ql = q.toLowerCase();
    res.sort(function (a, b) {
      var as = (a.t.toLowerCase().indexOf(ql) === 0 ? 1000 : 0) + a.p;
      var bs = (b.t.toLowerCase().indexOf(ql) === 0 ? 1000 : 0) + b.p;
      return bs - as;
    });
    return res.slice(0, 120);
  }

  /* ---------- boot ---------- */
  function init() {
    indexTaxonomy();
    processItems();
    buildGraph();
    pagerank();
  }

  return {
    init: init,
    items: function () { return items; },
    get: function (id) { return byId.get(id); },
    leaves: function () { return leaves; },
    tens: function () { return tens; },
    twos: function () { return twos; },
    cluster: function (id) { return clustersById.get(id); },
    clusters: function () { return CLUSTERS; },
    clusterMembers: function (kid) {
      return items.filter(function (it) { return it.k.indexOf(kid) >= 0; })
                  .sort(function (a, b) { return b.p - a.p; });
    },
    areasAt: areasAt,
    itemsIn: itemsIn,
    comparator: comparator,
    orbit: orbit,
    edgeBetween: edgeBetween,
    search: search,
    addDeepRows: addDeepRows,
    leavesUnder: function (node) {
      if (node === TAXONOMY) { var all = []; leaves.forEach(function (n) { all.push(n.id); }); return all; }
      if (node.children && node.children[0] && node.children[0].children)
        return node.children.reduce(function (a, t) { return a.concat(t.children.map(function (l) { return l.id; })); }, []);
      if (node.children) return node.children.map(function (l) { return l.id; });
      return [node.id];
    }
  };
})();
