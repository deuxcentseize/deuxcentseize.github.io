# All the Media You Have Consumed

An atlas of everything — books, films, television, paintings, sculptures, music,
concerts, games, sport, historical moments, memes, mass online events — and a
ledger of your share of it. Fully local, no server, no account: one folder of
HTML and JavaScript.

Two layers:

- **The core canon** (~1,250 hand-curated works in `js/items/`) — hand-woven
  links, constellations, notes, live PageRank.
- **The Deep Atlas** (~250,000 auto-charted works in `data/deep/`) — built by
  `tools/build_deep_atlas.py` from the IMDb public datasets (film, TV,
  documentary, shorts — real vote counts and ratings) and Wikidata via SPARQL
  (books, albums, songs, games, paintings, sculpture, buildings, plays,
  operas, comics, anime, battles, disasters, space missions, memes — Wikipedia
  sitelink counts as the popularity signal). Loaded lazily per field, or all
  at once from the search view. Lower the thresholds at the top of the build
  script and re-run to grow toward a million.

## Run it

Double-click `index.html`. That's it — everything works from `file://`,
including the deep shards (they load as plain script tags).

(If you prefer a server: `python -m http.server 4517` in this folder, then
open http://localhost:4517.)

## What it does

- **The Atlas** — all of media sliced into **One / Two / Ten / ~Hundred**
  areas (The Made vs The Happened → ten domains → ~70 fields), each showing
  its top works by whichever ranking you pick.
- **Five rankings** per work:
  - **Popularity** — gross consumption across the species (0–100)
  - **Importance** — gross cultural-historical weight (0–100)
  - **In-field weight** — canon rank inside its own field (0–100)
  - **Rating** — community score out of 10 (real IMDb averages where votes
    exist; estimated from canon weight elsewhere)
  - **Interlinkage** — PageRank computed live over the derived link graph;
    the Wikipedia what-links-to-what measure, applied to all media
- **Fast marking** — ✓/+ quick-marks on every row and orbit entry,
  right-click any title (even nodes in the neighbourhood diagram) to toggle
  consumed, personal ratings from 0–10 in half-star steps, and an unlimited
  back-chain (browser back or the drawer's ←) when you spelunk down
  cross-consumption orbits.
- **The Orbit** — open any work and see its likely cross-consumption
  neighbours with reasons and odds ("if you've seen *The Fall* (2006),
  you've probably met *The Cell*, *Pan's Labyrinth*, *Baraka*…"), plus a
  clickable neighbourhood graph.
- **Constellations** — the taste-communities that power the orbit
  (The Midnight Movie, Painterly Cinema, The Russians, The Bonfire,
  The Mass Experiments…). Each has a *tightness*: how strongly knowing one
  member predicts knowing the rest.
- **The Ledger** — mark works consumed / partial / want-to, rate them,
  keep notes, watch your coverage per area and your pop-weighted
  **share of the culture**.
- **Export / import** — dated JSON (full fidelity, newest-wins merge) and
  CSV. A bare JSON array of ids also imports as "consumed". Your ledger
  lives in localStorage until you export it.

## How the graph is built (`js/engine.js`)

Edges between works are derived from four sources, then PageRank runs on
the result:

| source                      | weight            |
|-----------------------------|-------------------|
| hand link (`l:` field)      | 2.6               |
| same creator                | 2.0               |
| each shared constellation   | its tightness `w` |
| same field (+ shared tags)  | 0.22 – 1.12       |

Cross-consumption odds between A and B ≈ `edgeWeight × popularity(B)`,
squashed to a percentage. Broad constellations (The Multiplex, w 0.30) bind
weakly; tight ones (The Bonfire, w 0.85) bind hard.

## Extending the atlas

Everything is data. Add a line to any file in `js/items/`:

```js
I("film-cult", "Title", 1999, "Creator", 55, 60, 70,
  ["tag1","tag2"], ["cult-canon"], ["linked-work-id-1998"], "optional note");
//  leaf        title  year creator pop imp in-field tags  constellations  hand-links
```

Ids are `slug(title)-year` — that's what hand links point at. New
constellations go in `js/core.js`; new fields go in the taxonomy there too.
Unknown links and leaves are warned about in the browser console, never fatal.

All the numbers are editable opinions. Argue with them; that is what they
are for.

~700 works seeded across ten domains. The head of every distribution is
here; the tail is yours to grow.
