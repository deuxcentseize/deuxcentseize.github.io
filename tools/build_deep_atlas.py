#!/usr/bin/env python3
"""
build_deep_atlas.py — builds the Deep Atlas: the long tail behind the curated core.

Sources:
  - IMDb non-commercial datasets (title.basics/ratings/crew, name.basics)
    -> film, television, documentary, shorts   (popularity = vote counts)
  - Wikidata via the QLever SPARQL endpoint
    -> books, albums, songs, games, paintings, sculpture, architecture,
       photographs, plays, operas, ballets, musicals, comics/manga, anime,
       battles, disasters, space missions, matches, memes
       (popularity = Wikipedia sitelink counts)

Output: ../data/deep/{leaf}-{i}.js shard files + ../data/deep/index.js manifest.

Thresholds are the knobs at the top: lower them and re-run to grow toward
millions; raise them to tighten "worth experiencing".
"""
import gzip, json, math, os, re, sys, time, unicodedata, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "deep")
DL = r"C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Desktop-Claude-Misc-2\67f1de28-2708-4da4-b104-f1817848a38e\scratchpad\dl"
CACHE = os.path.join(DL, "wd-cache")
QLEVER = "https://qlever.dev/api/wikidata"

# ------------------------------- knobs -------------------------------------
IMDB_MIN_VOTES = 250          # per-title vote floor
SHARD_SIZE = 2500             # items per shard file

# ------------------------------- id scheme ---------------------------------
# Must match js/core.js SLUG/MKID exactly.
COMBINING = re.compile(r"[̀-ͯ]")
NONALNUM = re.compile(r"[^a-z0-9]+")

def slug(s):
    s = str(s).lower()
    s = unicodedata.normalize("NFD", s)
    s = COMBINING.sub("", s)
    s = s.replace("&", " and ")
    s = s.replace("'", "").replace("’", "")
    s = NONALNUM.sub("-", s).strip("-")
    return s

def mkid(title, year):
    if isinstance(year, int) and year != 0:
        y = ("bc" + str(-year)) if year < 0 else str(year)
    elif isinstance(year, str) and year:
        y = slug(year)
    else:
        y = ""
    return slug(title) + ("-" + y if y else "")

# ------------------------------- scoring -----------------------------------
def imdb_pop(votes):
    return max(1, min(100, round(8 + 88 * (math.log10(votes) - 2.4) / 4.1)))

def imdb_imp(pop, rating):
    return max(1, min(100, round(0.55 * pop + 5.5 * (rating - 4.5))))

def bayes_rating(rating, votes, prior=6.9, weight=2500):
    return (votes * rating + weight * prior) / (votes + weight)

def wd_pop(sl):
    return max(1, min(100, round(10 + 87 * (math.log2(max(sl, 4)) - 2) / 6.23)))

# ------------------------------- QLever ------------------------------------
PREFIXES = (
    "PREFIX wdt: <http://www.wikidata.org/prop/direct/> "
    "PREFIX wd: <http://www.wikidata.org/entity/> "
    "PREFIX wikibase: <http://wikiba.se/ontology#> "
    "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> "
)

def sparql(query, tries=3):
    body = (PREFIXES + query).encode("utf-8")
    for attempt in range(tries):
        try:
            req = urllib.request.Request(QLEVER, data=body, headers={
                "Content-Type": "application/sparql-query",
                "Accept": "application/sparql-results+json",
                "User-Agent": "all-the-media-atlas/1.0 (personal offline build)"
            })
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:
            print("  retry %d: %s" % (attempt + 1, e), flush=True)
            time.sleep(4 * (attempt + 1))
    raise RuntimeError("SPARQL failed")

def fetch_class(name, class_ids, min_sl, creator_props, date_props, want_genre=True, closure=False):
    """Returns rows: (title, year, creator, sitelinks, [genres])."""
    os.makedirs(CACHE, exist_ok=True)
    cache_file = os.path.join(CACHE, "%s.json" % name)
    if os.path.exists(cache_file):
        with open(cache_file, encoding="utf-8") as f:
            return json.load(f)
    p31 = "wdt:P31/wdt:P279*" if closure else "wdt:P31"
    values = " ".join("wd:%s" % c for c in class_ids)
    copt = ""
    for i, p in enumerate(creator_props):
        copt += ("OPTIONAL { ?item wdt:%s ?cr%d . ?cr%d rdfs:label ?cl%d . "
                 "FILTER(LANG(?cl%d)=\"en\") } " % (p, i, i, i, i))
    dopt = ""
    for i, p in enumerate(date_props):
        dopt += "OPTIONAL { ?item wdt:%s ?d%d } " % (p, i)
    gopt = ("OPTIONAL { ?item wdt:P136 ?ge . ?ge rdfs:label ?gl . FILTER(LANG(?gl)=\"en\") } "
            if want_genre else "")
    csel = " ".join("(SAMPLE(?cl%d) AS ?c%d)" % (i, i) for i in range(len(creator_props)))
    dsel = " ".join("(SAMPLE(?d%d) AS ?y%d)" % (i, i) for i in range(len(date_props)))
    gsel = "(GROUP_CONCAT(DISTINCT ?gl; SEPARATOR=\"|\") AS ?g)" if want_genre else ""
    tmpl = ("SELECT ?item (SAMPLE(?label) AS ?t) (MAX(?links) AS ?sl) %s %s %s WHERE { "
            "VALUES ?cls { %s } ?item " + p31 + " ?cls . "
            "?item wikibase:sitelinks ?links . FILTER(?links >= %d) "
            "?item rdfs:label ?label . FILTER(LANG(?label)=\"en\") "
            "%s %s %s } GROUP BY ?item")
    q = tmpl % (csel, dsel, gsel, values, min_sl, copt, dopt, gopt)
    print("fetching %s ..." % name, flush=True)
    data = sparql(q)
    rows = []
    for b in data["results"]["bindings"]:
        def get(k):
            return b[k]["value"] if k in b else ""
        title = get("t")
        if not title:
            continue
        year = 0
        for i in range(len(date_props)):
            v = get("y%d" % i)
            if v:
                m = re.match(r"(-?\d{1,5})", v)
                if m:
                    year = int(m.group(1))
                    break
        creator = ""
        for i in range(len(creator_props)):
            v = get("c%d" % i)
            if v:
                creator = v
                break
        genres = [g for g in get("g").split("|") if g] if want_genre else []
        rows.append([title, year, creator, int(get("sl") or 0), genres])
    print("  %s: %d rows" % (name, len(rows)), flush=True)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    return rows

# --------------------------- leaf assignment --------------------------------
def book_leaf(year, genres):
    g = " ".join(genres).lower()
    if any(k in g for k in ("play", "tragedy", "theatre", "stage work", "farce")):
        return "plays"
    if any(k in g for k in ("epic poem", "poetry", "sonnet", "elegy")):
        return "poetry"
    if any(k in g for k in ("science fiction", "fantasy", "speculative", "dystopia", "horror")):
        return "sff"
    if any(k in g for k in ("crime", "mystery", "detective", "thriller", "spy", "noir")):
        return "crime-thriller"
    if any(k in g for k in ("children", "picture book", "young adult", "juvenile")):
        return "ya-childrens"
    if "poetry" in g or "poem" in g:
        return "poetry"
    if any(k in g for k in ("non-fiction", "nonfiction", "essay", "biography", "memoir", "history book", "popular science")):
        return "nonfiction"
    if year and year <= 1920:
        return "classic-novel"
    if year and year <= 500:
        return "myth-epic"
    return "modern-lit"

def classical_leaf(year, genres):
    g = " ".join(genres).lower()
    for key, leaf in (("film score", "soundtracks"), ("soundtrack", "soundtracks"),
                      ("jazz", "jazz"), ("folk", "folk-world"), ("pop", "pop"),
                      ("rock", "rock-indie")):
        if key in g:
            return leaf
    return "classical"

def stage_leaf(year, genres):
    g = " ".join(genres).lower()
    return "musicals" if "musical" in g else "opera-ballet"

def play_leaf(year, genres):
    g = " ".join(genres).lower()
    if "ballet" in g:
        return "opera-ballet"
    if "musical" in g:
        return "musicals"
    return "plays"

def music_leaf(year, genres):
    g = " ".join(genres).lower()
    pairs = [("hip hop", "hiphop"), ("rap", "hiphop"), ("jazz", "jazz"), ("blues", "jazz"),
             ("soul", "soul-funk"), ("funk", "soul-funk"), ("r&b", "soul-funk"),
             ("rhythm and blues", "soul-funk"), ("disco", "soul-funk"),
             ("metal", "metal-punk"), ("punk", "metal-punk"), ("hardcore", "metal-punk"),
             ("electronic", "electronic"), ("house", "electronic"), ("techno", "electronic"),
             ("ambient", "electronic"), ("trance", "electronic"), ("dubstep", "electronic"),
             ("drum and bass", "electronic"), ("edm", "electronic"), ("synth", "electronic"),
             ("folk", "folk-world"), ("country", "folk-world"), ("reggae", "folk-world"),
             ("world", "folk-world"), ("latin", "folk-world"), ("afrobeat", "folk-world"),
             ("classical", "classical"), ("orchestral", "classical"), ("symphony", "classical"),
             ("soundtrack", "soundtracks"), ("film score", "soundtracks"),
             ("pop", "pop"),
             ("rock", "rock-indie"), ("indie", "rock-indie"), ("alternative", "rock-indie"),
             ("grunge", "rock-indie"), ("psychedelic", "rock-indie"), ("shoegaze", "rock-indie")]
    for key, leaf in pairs:
        if key in g:
            return leaf
    return "rock-indie" if (year and year < 2000) else "pop"

def game_leaf(year, genres):
    g = " ".join(genres).lower()
    if year and year < 1990:
        return "vg-retro"
    if any(k in g for k in ("role-playing", "rpg", "adventure game", "action-adventure")):
        return "vg-rpg-adventure"
    if any(k in g for k in ("mmo", "massively multiplayer", "battle royale", "multiplayer online")):
        return "vg-online"
    if any(k in g for k in ("indie", "puzzle", "platform game", "roguelike", "metroidvania")):
        return "vg-indie"
    return "vg-action"

# --------------------------- IMDb ------------------------------------------
def read_tsv_gz(path):
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        header = f.readline().rstrip("\n").split("\t")
        idx = {h: i for i, h in enumerate(header)}
        for line in f:
            yield line.rstrip("\n").split("\t"), idx

def build_imdb(items, seen):
    print("parsing IMDb ratings ...", flush=True)
    ratings = {}
    for row, idx in read_tsv_gz(os.path.join(DL, "title.ratings.tsv.gz")):
        v = int(row[idx["numVotes"]])
        if v >= IMDB_MIN_VOTES:
            ratings[row[idx["tconst"]]] = (float(row[idx["averageRating"]]), v)
    print("  %d titles over %d votes" % (len(ratings), IMDB_MIN_VOTES), flush=True)

    print("parsing IMDb basics ...", flush=True)
    kept = {}
    for row, idx in read_tsv_gz(os.path.join(DL, "title.basics.tsv.gz")):
        t = row[idx["tconst"]]
        if t not in ratings:
            continue
        tt = row[idx["titleType"]]
        if tt not in ("movie", "tvMovie", "tvSeries", "tvMiniSeries", "short"):
            continue
        if row[idx["isAdult"]] == "1":
            continue
        year_s = row[idx["startYear"]]
        year = int(year_s) if year_s.isdigit() else 0
        title = row[idx["primaryTitle"]]
        genres = [] if row[idx["genres"]] == r"\N" else row[idx["genres"]].split(",")
        gl = [g.lower() for g in genres]
        if tt == "short":
            leaf = "shorts-mv"
        elif "documentary" in gl:
            leaf = "documentary"
        elif tt in ("tvSeries", "tvMiniSeries"):
            leaf = "tv-comedy" if ("comedy" in gl or "animation" in gl) else "tv-drama"
        elif "animation" in gl:
            leaf = "animation-film"
        elif "horror" in gl:
            leaf = "film-horror"
        elif year and year <= 1975:
            leaf = "film-golden"
        else:
            leaf = "film-modern"
        kept[t] = (title, year, leaf, genres)
    print("  %d titles kept" % len(kept), flush=True)

    print("parsing IMDb crew ...", flush=True)
    directors = {}
    need = set()
    for row, idx in read_tsv_gz(os.path.join(DL, "title.crew.tsv.gz")):
        t = row[idx["tconst"]]
        if t in kept:
            d = row[idx["directors"]]
            if d != r"\N":
                first = d.split(",")[0]
                directors[t] = first
                need.add(first)
    print("parsing IMDb names (%d needed) ..." % len(need), flush=True)
    names = {}
    for row, idx in read_tsv_gz(os.path.join(DL, "name.basics.tsv.gz")):
        n = row[idx["nconst"]]
        if n in need:
            names[n] = row[idx["primaryName"]]

    by_leaf_scores = {}
    for t, (title, year, leaf, genres) in kept.items():
        rating, votes = ratings[t]
        by_leaf_scores.setdefault(leaf, []).append(bayes_rating(rating, votes))
    pct = {leaf: sorted(v) for leaf, v in by_leaf_scores.items()}

    def percentile(leaf, score):
        arr = pct[leaf]
        import bisect
        return max(1, min(100, round(100 * bisect.bisect_left(arr, score) / len(arr))))

    added = 0
    for t, (title, year, leaf, genres) in kept.items():
        rating, votes = ratings[t]
        iid = mkid(title, year)
        if iid in seen:
            continue
        seen.add(iid)
        pop = imdb_pop(votes)
        creator = names.get(directors.get(t, ""), "")
        items.setdefault(leaf, []).append([
            title, year, creator, pop, imdb_imp(pop, rating),
            percentile(leaf, bayes_rating(rating, votes)),
            "|".join(g.lower() for g in genres),
            round(rating, 1)   # real community rating (IMDb)
        ])
        added += 1
    print("IMDb contributed %d works" % added, flush=True)

# --------------------------- Wikidata classes -------------------------------
WD_CLASSES = [
    # name, class ids, min sitelinks, creator props, date props, leaf resolver, closure
    ("books",      ["Q7725634", "Q8261", "Q49084"], 4, ["P50"], ["P577", "P571"], book_leaf, False),
    ("poems-c",    ["Q5185279"], 5, ["P50"], ["P577", "P571"], lambda y, g: "poetry", True),
    ("plays2",     ["Q116476516", "Q25379"], 4, ["P50"], ["P577", "P571"], play_leaf, False),
    ("albums",     ["Q482994"], 4, ["P175"], ["P577"], music_leaf, False),
    ("songs",      ["Q134556", "Q7366"], 5, ["P175"], ["P577"], music_leaf, False),
    ("dramamusical", ["Q58483083"], 4, ["P86", "P50"], ["P577", "P571"], stage_leaf, True),
    ("compositions", ["Q105543609"], 8, ["P86"], ["P577", "P571"], classical_leaf, True),
    ("games",      ["Q7889"], 4, ["P178"], ["P577"], game_leaf, False),
    ("paintings",  ["Q3305213"], 3, ["P170"], ["P571"], lambda y, g: "painting-old" if (y and y < 1860) else "painting-modern", False),
    ("sculptures", ["Q860861"], 3, ["P170"], ["P571"], lambda y, g: "sculpture", False),
    ("buildings-c",["Q41176"], 18, ["P84"], ["P571"], lambda y, g: "architecture", True),
    ("photos-c",   ["Q125191"], 3, ["P170"], ["P571"], lambda y, g: "photography", True),
    ("comics",     ["Q1004", "Q725377", "Q14406742"], 5, ["P50", "P170"], ["P577", "P571"], lambda y, g: "comics-manga", False),
    ("manga",      ["Q8274", "Q21198342"], 5, ["P50", "P170"], ["P577", "P571"], lambda y, g: "comics-manga", False),
    ("anime-tv",   ["Q63952888"], 5, ["P170"], ["P577", "P580"], lambda y, g: "anime-tv", False),
    ("anime-film", ["Q20650540"], 5, ["P57"], ["P577"], lambda y, g: "anime-film", False),
    ("battles",    ["Q178561"], 12, [], ["P585", "P580", "P571"], lambda y, g: "conflict", False),
    ("earthquakes",["Q7944"], 12, [], ["P585"], lambda y, g: "disasters", False),
    ("aviation",   ["Q744913"], 10, [], ["P585"], lambda y, g: "disasters", False),
    ("spaceflights",["Q752783"], 8, [], ["P619", "P585"], lambda y, g: "space", False),
    ("footballmatches", ["Q17633526"], 5, [], ["P585"], lambda y, g: "football", False),
    ("memes",      ["Q2927074"], 4, [], ["P571"], lambda y, g: "memes", False),
]

def build_wikidata(items, seen):
    for name, classes, min_sl, cprops, dprops, resolver, closure in WD_CLASSES:
        try:
            rows = fetch_class(name, classes, min_sl, cprops, dprops, closure=closure)
        except Exception as e:
            print("  !! %s failed: %s (skipping)" % (name, e), flush=True)
            continue
        rows.sort(key=lambda r: -r[3])
        by_leaf = {}
        for title, year, creator, sl, genres in rows:
            iid = mkid(title, year)
            if iid in seen or len(title) > 120:
                continue
            seen.add(iid)
            leaf = resolver(year, genres)
            by_leaf.setdefault(leaf, []).append([title, year, creator, sl, genres])
        for leaf, lrows in by_leaf.items():
            n = len(lrows)
            for rank, (title, year, creator, sl, genres) in enumerate(lrows):
                pop = wd_pop(sl)
                fld = max(1, min(100, round(100 * (n - rank) / n)))
                items.setdefault(leaf, []).append([
                    title, year, creator, pop, pop, fld,
                    "|".join(genres[:3]).lower(),
                    round(5.4 + 3.4 * fld / 100, 1)   # estimated rating (no vote data)
                ])

# --------------------------- emit -------------------------------------------
def emit(items):
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    manifest = {}
    total = 0
    for leaf, rows in sorted(items.items()):
        rows.sort(key=lambda r: -r[3])
        shards = 0
        for i in range(0, len(rows), SHARD_SIZE):
            chunk = rows[i:i + SHARD_SIZE]
            path = os.path.join(OUT, "%s-%d.js" % (leaf, shards))
            with open(path, "w", encoding="utf-8") as f:
                f.write("DEEPDATA.push({l:%s,r:%s});\n" % (
                    json.dumps(leaf),
                    json.dumps(chunk, ensure_ascii=False, separators=(",", ":"))))
            shards += 1
        manifest[leaf] = {"n": len(rows), "ps": sum(r[3] for r in rows), "s": shards}
        total += len(rows)
        print("  %-18s %7d works, %d shards" % (leaf, len(rows), shards), flush=True)
    with open(os.path.join(OUT, "index.js"), "w", encoding="utf-8") as f:
        f.write("window.DEEPINDEX=%s;\nwindow.DEEPV=%d;\n" % (
            json.dumps(manifest, separators=(",", ":")), int(time.time())))
    print("TOTAL deep atlas: %d works" % total, flush=True)

def main():
    items = {}   # leaf -> rows [title, year, creator, pop, imp, fld, "tag|tag"]
    seen = set()
    if "--no-wikidata" not in sys.argv:
        build_wikidata(items, seen)
    if "--no-imdb" not in sys.argv:
        build_imdb(items, seen)
    emit(items)

if __name__ == "__main__":
    main()
