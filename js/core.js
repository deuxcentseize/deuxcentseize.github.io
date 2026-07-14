/* core.js — taxonomy, constellations (taste-clusters), and the item helper.
   Everything else derives from what lives here. */

"use strict";

/* ---------------- taxonomy ----------------
   The whole of media, split in two, then ten, then ~seventy leaves.
   Slice "two"  -> children of root        (The Made / The Happened)
   Slice "ten"  -> grandchildren           (written, screen, sound, ...)
   Slice "hundred" -> leaves               (film-cult, memes, olympics, ...) */

window.TAXONOMY = {
  id: "all", name: "Everything", blurb: "All the media there has ever been.",
  children: [
    {
      id: "made", name: "The Made", blurb: "Works someone sat down and created.",
      children: [
        { id: "written", name: "The Written Word", children: [
          { id: "myth-epic",      name: "Myth, Epic & Scripture" },
          { id: "classic-novel",  name: "Classic Novels" },
          { id: "modern-lit",     name: "Modern Literature" },
          { id: "sff",            name: "Speculative Fiction" },
          { id: "crime-thriller", name: "Crime & Thriller" },
          { id: "ya-childrens",   name: "Children's & YA" },
          { id: "comics-manga",   name: "Comics & Manga" },
          { id: "poetry",         name: "Poetry" },
          { id: "plays",          name: "Plays (as texts)" },
          { id: "nonfiction",     name: "Nonfiction" },
          { id: "ideas",          name: "Philosophy & Ideas" },
        ]},
        { id: "screen", name: "The Moving Image", children: [
          { id: "film-golden",      name: "Film — The Golden Ages (to 1975)" },
          { id: "film-modern",      name: "Film — Modern Canon" },
          { id: "film-blockbuster", name: "Film — Spectacle & Franchise" },
          { id: "film-world",       name: "Film — World & Arthouse" },
          { id: "film-horror",      name: "Film — Horror" },
          { id: "film-cult",        name: "Film — Cult & Midnight" },
          { id: "animation-film",   name: "Animated Features" },
          { id: "anime-film",       name: "Anime — Films" },
          { id: "documentary",      name: "Documentary" },
          { id: "tv-drama",         name: "Television — Drama" },
          { id: "tv-comedy",        name: "Television — Comedy & Animation" },
          { id: "anime-tv",         name: "Anime — Series" },
          { id: "shorts-mv",        name: "Shorts & Music Video" },
        ]},
        { id: "sound", name: "Sound & Music", children: [
          { id: "classical",   name: "Classical" },
          { id: "jazz",        name: "Jazz & Blues" },
          { id: "soul-funk",   name: "Soul, Funk & R&B" },
          { id: "rock-indie",  name: "Rock & Indie" },
          { id: "metal-punk",  name: "Metal & Punk" },
          { id: "pop",         name: "Pop" },
          { id: "hiphop",      name: "Hip-Hop" },
          { id: "electronic",  name: "Electronic" },
          { id: "folk-world",  name: "Folk, Country & World" },
          { id: "soundtracks", name: "Scores & Soundtracks" },
        ]},
        { id: "art", name: "Image & Object", children: [
          { id: "painting-old",        name: "Painting — Old Masters" },
          { id: "painting-modern",     name: "Painting — Modern" },
          { id: "sculpture",           name: "Sculpture & Monument" },
          { id: "architecture",        name: "Architecture & Wonders" },
          { id: "photography",         name: "Photographs" },
          { id: "street-contemporary", name: "Street & Contemporary" },
        ]},
        { id: "games", name: "Play & Interaction", children: [
          { id: "vg-retro",         name: "Videogames — Arcade & Retro" },
          { id: "vg-rpg-adventure", name: "Videogames — RPG & Adventure" },
          { id: "vg-action",        name: "Videogames — Action & Story" },
          { id: "vg-online",        name: "Videogames — Online Worlds" },
          { id: "vg-indie",         name: "Videogames — Indie" },
          { id: "tabletop",         name: "Tabletop & Card" },
        ]},
        { id: "stage", name: "The Stage", children: [
          { id: "musicals",       name: "Musicals" },
          { id: "opera-ballet",   name: "Opera & Ballet" },
          { id: "standup",        name: "Stand-up" },
          { id: "live-spectacle", name: "Live Spectacle" },
        ]},
      ]
    },
    {
      id: "happened", name: "The Happened", blurb: "Events the world consumed together.",
      children: [
        { id: "sport", name: "Sport", children: [
          { id: "football",          name: "Football (the global one)" },
          { id: "american-football", name: "American Football" },
          { id: "basketball",        name: "Basketball" },
          { id: "baseball",          name: "Baseball" },
          { id: "cricket-rugby",     name: "Cricket & Rugby" },
          { id: "tennis-golf",       name: "Tennis & Golf" },
          { id: "combat",            name: "Combat Sports" },
          { id: "motorsport",        name: "Motorsport" },
          { id: "olympics",          name: "The Olympics" },
        ]},
        { id: "history", name: "History, Witnessed", children: [
          { id: "space",        name: "Space" },
          { id: "conflict",     name: "War & Conflict" },
          { id: "politics",     name: "Politics & Speeches" },
          { id: "disasters",    name: "Disasters" },
          { id: "science-tech", name: "Science & Technology Moments" },
        ]},
        { id: "spectacle", name: "Spectacle & Ceremony", children: [
          { id: "concerts",   name: "Concerts & Festivals" },
          { id: "broadcast",  name: "Broadcast Moments" },
          { id: "ceremonies", name: "Ceremonies" },
        ]},
        { id: "internet", name: "The Internet", children: [
          { id: "memes",           name: "Memes" },
          { id: "viral",           name: "Viral Video" },
          { id: "platform-events", name: "Mass Online Events" },
          { id: "online-culture",  name: "Online Culture" },
        ]},
      ]
    }
  ]
};

/* ---------------- constellations ----------------
   Taste-communities. Two works sharing a constellation are likely to be
   consumed by the same person — the tighter the weight w, the stronger the
   pull. Broad ones (w ~0.25) are "everyone has met these"; tight ones
   (w ~0.85) are "if you know one, you know them all". */

window.CLUSTERS = [
  // broad baselines
  { id:"canon-west",       name:"The Western Canon",        w:0.25, blurb:"The syllabus of everything. School put half of these in you." },
  { id:"blockbuster-core", name:"The Multiplex",            w:0.30, blurb:"The films everyone in the room has seen, whichever room." },
  { id:"pop-core",         name:"The Radio",                w:0.30, blurb:"Songs that were simply in the air." },
  { id:"gamer-core",       name:"The Console Under the TV", w:0.40, blurb:"Games that crossed out of gaming into furniture." },
  { id:"kids-canon",       name:"The Childhood Shelf",      w:0.40, blurb:"Consumed before you chose what to consume." },
  { id:"shared-news",      name:"Where Were You When",      w:0.40, blurb:"Events consumed live by more or less everyone alive at the time." },
  { id:"meme-literate",    name:"The Feed",                 w:0.35, blurb:"Baseline fluency of the online." },

  // film & tv
  { id:"film-buff",        name:"The Thousand-Film List",   w:0.50, blurb:"People working through the canon on purpose." },
  { id:"criterion-core",   name:"The Criterion Shelf",      w:0.65, blurb:"Restorations, essays in the booklet, spine numbers." },
  { id:"world-cinema",     name:"Subtitles Welcome",        w:0.45, blurb:"The one-inch barrier, long since jumped." },
  { id:"arthouse",         name:"The Arthouse",             w:0.50, blurb:"Slow cinema, uneasy endings, projector hum." },
  { id:"visual-maximalism",name:"Painterly Cinema",         w:0.75, blurb:"Films composed like altarpieces — every frame a canvas." },
  { id:"cult-canon",       name:"The Midnight Movie",       w:0.65, blurb:"Quoted at 1am, worn on t-shirts, never at the Oscars." },
  { id:"dorm-canon",       name:"The Dorm Room Poster",     w:0.60, blurb:"Fight Club, The Matrix, 1984 — the first canon you choose yourself." },
  { id:"horror-canon",     name:"The Horror Section",       w:0.60, blurb:"People who watch through, not between, their fingers." },
  { id:"a24-wave",         name:"The A24 Wave",             w:0.70, blurb:"Elevated dread and neon grief, 2013 onward." },
  { id:"prestige-tv",      name:"The Golden Age of TV",     w:0.60, blurb:"Difficult men, one-more-episode, recaps the morning after." },
  { id:"sitcom-comfort",   name:"The Comfort Rewatch",      w:0.55, blurb:"Sitcoms consumed as ambience, five times over." },
  { id:"brit-comedy",      name:"British Comedy",           w:0.70, blurb:"Cringe, understatement, and six-episode seasons." },
  { id:"adult-animation",  name:"Adult Animation",          w:0.65, blurb:"Cartoons that outgrew their timeslot." },
  { id:"nature-docs",      name:"The Attenborough Voice",   w:0.65, blurb:"Planet-scale awe, Sunday evenings." },
  { id:"true-crime",       name:"True Crime",               w:0.65, blurb:"Documentaries consumed like thrillers." },
  { id:"sports-docs",      name:"The Sports Documentary",   w:0.65, blurb:"Where sport is consumed twice — live, then narrated." },

  // anime & animation
  { id:"anime-gateway",    name:"Gateway Anime",            w:0.70, blurb:"The shows that recruit people into anime." },
  { id:"anime-deep",       name:"Deep Anime",               w:0.80, blurb:"Past the gateway: Eva, Bebop, Satoshi Kon." },
  { id:"ghibli",           name:"The Ghibli Shelf",         w:0.85, blurb:"Miyazaki's weather systems." },
  { id:"pixar-era",        name:"The Pixar Era",            w:0.60, blurb:"Computer-animated childhoods, 1995 onward." },

  // literature
  { id:"lit-canon",        name:"The Great Books",          w:0.50, blurb:"The novels that follow you from syllabus to deathbed." },
  { id:"russian-lit",      name:"The Russians",             w:0.80, blurb:"Long winters, longer patronymics." },
  { id:"postmodern-lit",   name:"The Big Difficult Novel",  w:0.80, blurb:"Footnotes, paranoia, a thousand pages." },
  { id:"dystopia-canon",   name:"The Dystopias",            w:0.70, blurb:"Warnings consumed as entertainment." },
  { id:"sff-canon",        name:"The SFF Shelf",            w:0.55, blurb:"Spaceships and swords, shelved together at last." },
  { id:"high-fantasy",     name:"High Fantasy",             w:0.70, blurb:"Maps in the front matter." },
  { id:"space-scifi",      name:"Hard SF & Space",          w:0.65, blurb:"Orbits calculated, aliens optional." },
  { id:"cyberpunk",        name:"Cyberpunk",                w:0.75, blurb:"High tech, low life, rain." },
  { id:"ya-wave",          name:"The YA Wave",              w:0.65, blurb:"Read at 14, defended at 30." },
  { id:"kids-books",       name:"Bedtime Canon",            w:0.55, blurb:"Read to you before you could read." },
  { id:"crime-noir",       name:"Noir & Detection",         w:0.65, blurb:"Bodies in libraries, men down mean streets." },
  { id:"comics-canon",     name:"The Graphic Canon",        w:0.65, blurb:"Comics that got shelved with the novels." },
  { id:"poetry-canon",     name:"The Poets",                w:0.70, blurb:"Memorised in fragments." },
  { id:"theatre-canon",    name:"The Repertory",            w:0.65, blurb:"Staged somewhere on earth every single night." },
  { id:"big-ideas",        name:"The Airport Big-Idea Book",w:0.60, blurb:"Nonfiction that rewires dinner-party conversation." },
  { id:"philosophy-core",  name:"The Philosophers",         w:0.70, blurb:"Underlined, argued with, half-finished." },

  // music
  { id:"classic-rock",     name:"Classic Rock Canon",       w:0.50, blurb:"Dad's vinyl, everyone's inheritance." },
  { id:"grunge-90s",       name:"The Alternative 90s",      w:0.70, blurb:"Flannel, feedback, MTV." },
  { id:"indie-2000s",      name:"The Indie 2000s",          w:0.70, blurb:"Landfill and gold, skinny jeans, blog buzz." },
  { id:"poptimist-2010s",  name:"The Poptimist 2010s",      w:0.60, blurb:"Pop taken seriously, streams in the billions." },
  { id:"hiphop-canon",     name:"The Hip-Hop Canon",        w:0.55, blurb:"From the Bronx outward — the classics." },
  { id:"hiphop-modern",    name:"Rap, Streaming Era",       w:0.60, blurb:"Playlists, features, first-week numbers." },
  { id:"rnb-soul",         name:"Soul & R&B",               w:0.60, blurb:"The voice, the groove, the church behind both." },
  { id:"electronic-heads", name:"The Electronic Heads",     w:0.65, blurb:"IDM forums, warehouse rooms, headphone commutes." },
  { id:"edm-2010s",        name:"The Festival Drop",        w:0.70, blurb:"EDM's imperial decade." },
  { id:"metalheads",       name:"The Metalheads",           w:0.70, blurb:"Denim, patches, devotion." },
  { id:"punk-canon",       name:"Punk",                     w:0.70, blurb:"Three chords, one sneer." },
  { id:"jazz-core",        name:"The Jazz Shelf",           w:0.70, blurb:"Blue Note sleeves and late nights." },
  { id:"classical-core",   name:"The Concert Hall",         w:0.60, blurb:"Music that outlived its century." },
  { id:"folk-canon",       name:"The Songwriters",          w:0.60, blurb:"Words first, voice cracked just right." },
  { id:"soundtrack-heads", name:"Score Listeners",          w:0.60, blurb:"People who consume films twice, once with eyes closed." },

  // stage & comedy
  { id:"musical-theatre",  name:"The Theatre Kids",         w:0.75, blurb:"Cast recordings known to the syllable." },
  { id:"standup-heads",    name:"The Comedy Nerds",         w:0.70, blurb:"Specials ranked, bits quoted." },

  // art
  { id:"art-history-core", name:"The Museum Postcard Rack", w:0.50, blurb:"Art you've consumed even if you've never sought it." },
  { id:"modern-art",       name:"The White Cube",           w:0.60, blurb:"Modernism onward — art that argues." },
  { id:"street-art",       name:"Street & Stunt Art",       w:0.70, blurb:"Art consumed as news." },
  { id:"photo-icons",      name:"The Photographs",          w:0.60, blurb:"Single frames the whole species remembers." },
  { id:"wonders",          name:"The Grand Tour",           w:0.45, blurb:"Buildings and monuments consumed by standing in front of them." },

  // games
  { id:"retro-arcade",     name:"The Arcade",               w:0.60, blurb:"Quarters, cabinets, high-score initials." },
  { id:"nintendo-core",    name:"The Nintendo Household",   w:0.70, blurb:"Consoles handed down like surnames." },
  { id:"playstation-prestige", name:"The Prestige Game",    w:0.70, blurb:"Cinematic single-player, credits that get watched." },
  { id:"pc-online",        name:"The PC Bang",              w:0.65, blurb:"Online worlds with populations of nations." },
  { id:"esports-fps",      name:"The Server Browser",       w:0.75, blurb:"Aim, angles, and the groove under pressure." },
  { id:"indie-games",      name:"The Indie Catalogue",      w:0.70, blurb:"One-dev miracles, pixel hearts." },
  { id:"souls-like",       name:"The Bonfire",              w:0.85, blurb:"Praise the sun; git gud." },
  { id:"tabletop-core",    name:"The Kitchen Table",        w:0.50, blurb:"Games older than their players." },

  // sport
  { id:"football-global",  name:"The Beautiful Game",       w:0.55, blurb:"The one sport the whole planet consumes." },
  { id:"nfl-fandom",       name:"The Gridiron",             w:0.65, blurb:"3-6-7 combinations, flyovers, what a display of humanity." },
  { id:"hoops",            name:"The Hardwood",             w:0.65, blurb:"Basketball's moments, replayed forever." },
  { id:"baseball-lore",    name:"The Ballpark",             w:0.65, blurb:"America's memory palace." },
  { id:"crickrugby",       name:"The Commonwealth Games",   w:0.70, blurb:"Cricket and rugby — empires at play." },
  { id:"individual-sports",name:"Centre Court",             w:0.60, blurb:"One human against one human, everyone watching." },
  { id:"fight-fans",       name:"The Fight Game",           w:0.65, blurb:"Twelve rounds or thirteen seconds." },
  { id:"f1-fandom",        name:"The Paddock",              w:0.70, blurb:"Motorsport's operas." },
  { id:"olympics-moments", name:"The Olympiad",             w:0.50, blurb:"Once every four years, the species checks in." },

  // history
  { id:"space-race",       name:"The Space Race",           w:0.60, blurb:"Humanity's best television." },
  { id:"wwii-memory",      name:"The War",                  w:0.55, blurb:"The conflict every culture still consumes." },
  { id:"cold-war",         name:"The Cold War",             w:0.60, blurb:"Half a century of held breath." },

  // internet
  { id:"internet-native",  name:"Terminally Online",        w:0.50, blurb:"People whose culture happened in tabs." },
  { id:"meme-canon",       name:"The Meme Canon",           w:0.60, blurb:"Images that became language." },
  { id:"viral-era",        name:"The Viral Era",            w:0.60, blurb:"YouTube 2006–2014: the shared clip economy." },
  { id:"mass-experiments", name:"The Mass Experiments",     w:0.85, blurb:"r/place, The Button — millions of hands on one object." },
  { id:"creepypasta",      name:"Creepypasta",              w:0.80, blurb:"Folklore, but with screenshots." },
  { id:"live-music-lore",  name:"Live Music Lore",          w:0.60, blurb:"Sets people claim to have attended." },
  { id:"broadcast-lore",   name:"Water-Cooler Broadcast",   w:0.50, blurb:"Television moments consumed simultaneously." },
];

/* ---------------- item helper ----------------
   I(leaf, title, year, creator, popularity, importance, inFieldWeight,
     tags, constellations, links?, note?)

   year:   number (negative = BCE), or a string era like "ancient".
   popularity   0–100  gross awareness/consumption across the species.
   importance   0–100  gross cultural-historical weight.
   inFieldWeight 0–100 canonical weight inside its own leaf.
   links: array of ids of hand-linked kin — id is slug(title)-year. */

window.CATALOG = [];

window.SLUG = function (s) {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
};

window.MKID = function (title, year) {
  var y = "";
  if (typeof year === "number" && year !== 0) y = year < 0 ? "bc" + (-year) : String(year);
  else if (typeof year === "string" && year) y = SLUG(year);
  return SLUG(title) + (y ? "-" + y : "");
};

window.I = function (leaf, title, year, creator, pop, imp, fld, tags, clusters, links, note) {
  CATALOG.push({
    d: leaf, t: title, y: year, c: creator || "",
    p: pop, m: imp, f: fld,
    g: tags || [], k: clusters || [], l: links || [], n: note || ""
  });
};
