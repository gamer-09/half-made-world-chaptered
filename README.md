# Half-Made World — Chaptered

**[Open the live archive →](https://gamer-09.github.io/half-made-world-chaptered/)**

Reference archive for the *Half-Made World* fantasy novel — a searchable, editable knowledge base
for its lore, magic systems, and characters, built as an interactive web app so world details never
have to live buried in a single document again.

This is the **chaptered** edition: the hub only reveals what the story has reached. Upload your
chapters and the archive opens up alongside them — everything past your current chapter stays
locked. See [The chapter gate](#the-chapter-gate).

## What's in this repo

- **`half-made-world-hub/`** — the interactive archive app (React + TypeScript + Vite client, dark
  fantasy themed UI; Node + Express server, persists to a JSON file on disk).
- **`Half_made world ideas.docx`** — the original source document. Everything in the hub was seeded
  from this file; it remains here as the canonical starting reference.

The archive holds **1090 entries across 57 categories** — Demon/Angel/Class/Hybrid Skills, Titles,
Rules & Notes, Characters, Classes, Class Progression, Grade System, Rune Star Circles, Monsters,
Rifts, Locations, Items, Magic Systems, Realms, Coins, Clan, Economy, Organizations, Calendar, Combat
Mechanics, Laws & Justice, Academy, and many more — all browsable, searchable, and editable through
the UI. **28 characters**, **4387 story links**, and **81 relationships** tie it all together.

## Quick start

```bash
cd half-made-world-hub
npm run install:all   # installs server + client
npm run dev            # server on :5001, client on :5173
```

Open http://localhost:5173. On the first run the server writes `server/data/*.json` from the
bundled seeds, which were transcribed from the reference document; every edit after that is made
and saved through the UI itself.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts server + client dev servers |
| `npm run build` | Syncs the seeds, then typechecks and builds the client |
| `npm start` | Starts only the server (serves API) |
| `npm run install:all` | Installs dependencies for server and client |
| `npm run snapshot` | Rebuilds `client/public/snapshot.json` from `server/data/*.json` |
| `npm run sync:all` | Regenerates the seed files *and* the client snapshot from the live data |
| `npm run seeds:sync` | Regenerates the seed files only |
| `npm run seeds:check` | Exits non-zero if the seed files are out of sync with the data (used by CI) |
| `npm test --prefix client` | Runs the client unit tests (Vitest) |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the search box |
| `n` | Add an entry (author mode / local dev only — otherwise a "locked" toast) |
| `1` – `5` | Browse · Relationship Map · Story Web · Block Map · Query Chat |

## The chapter gate

The archive is written ahead of the story, so on its own it spoils things the reader hasn't
reached. The **chapter gate** holds that back: the hub shows only the entries and details the
chapters you've unlocked actually put on the page.

- **Unlock a chapter** from the bar under the header — bundled chapters (0–3) are listed, and any
  chapter you upload is added to the row. Unlocking chapter *N* reveals chapter *N* and everything
  before it, cumulatively.
- **Upload a chapter** (the *Upload* button) by choosing a file or pasting its text. The chapter
  number is read from the filename or the text (`chapter 4`, `4: …`, `Part 4`); you can always set
  it by hand. Uploaded prose is scanned for entry names, so an entry a chapter names but the
  curated list doesn't cover is revealed too.
- **Entries and details unlock at different times.** An entry can appear while its subtitle,
  description, or individual fields stay sealed — locked fields render as a "Revealed in
  Chapter N" note instead of their value. Entries the story hasn't reached at all are removed from
  the archive, and links that touch them are dropped.
- **Reveal rules** are a curated manifest (`client/src/chapters/manifest.ts`) plus an auto-scan of
  the unlocked chapter text. The manifest is authoritative for curated entries and is where you
  hold back details a mere mention shouldn't leak; the auto-scan only fills in uncurated entries.
- **Chapter codes.** A reader with no chapter file can enter a code instead; every chapter ends
  with one. Codes live in `server/data/chapter-codes.json` and are copied into the bundled
  `snapshot.json`. Locally, the *Register code* button opens a manager that can add, edit, and
  delete codes. Registering one saves the code, regenerates the snapshot, then commits just those
  two files and pushes, so the deployed site can redeem it. Set
  `AUTO_PUSH_CHAPTER_CODES=false` to save without pushing. The push is skipped (with a warning)
  while `server/data/world.json`, `relationships.json`, or `story-links.json` have uncommitted
  changes, since the snapshot would publish those edits too.
- **Author mode.** *Reveal all* bypasses the gate and restores the full archive — and editing —
  for local development. *Re-enable gate* and *Reset* lock it back down. Your chapter progress is
  remembered in `localStorage`.

While the gate is on, the hub is **read-only** even in local dev: the gate is the reader's mode,
so add/edit/delete only appear once you switch to author mode.

## Interface notes

- The backdrop is a real 3D world — a slowly turning planet lit by one sun, so the terminator
  sweeps across the three realms and the Hidden Realm where they meet, over a shader-driven
  aurora sky. It is rendered with three.js and degrades to a static gradient if the canvas
  cannot start.
- A lo-fi player sits in the header; it is on by default and remembers your choice.
- The archive keeps a "recently opened" list in `localStorage`, and the search box matches
  names, subtitles, descriptions, tags, and field values.

## Data model

Each entry has:

- `category` — which section it belongs to (Realms, Monsters, Classes, Items, …)
- `name` + `subtitle` — the title and a one-line tagline
- `description` — the main text
- `fields` — structured key/value details (e.g. Rank, Appearance, Skills)
- `tags` — freeform search tags

## Relationship Map

A dedicated **Relationship Map** view shows named characters as nodes and their connections as
colored, arrowed edges — who knows whom, who loves whom, who betrayed whom.

- **Drag** characters to rearrange the layout.
- **Hover** a character to trace all of its links; dim everything else.
- **Click a character** to open their full archive entry.
- **Click an edge** to read its story (with edit/delete actions).
- **Add relationships** through a structured form (source, target, type, label, notes) — types drive
  edge colors, e.g. `betrayed`, `ordered killed`, `right-hand of`, `unaware of`.

Relationships persist in `server/data/relationships.json`.

## Story Web

A **Story Web** page shows the *whole story* as one interactive map — every realm, location,
monster, being, rank, item, artifact, character, and plot thread as a node, connected by **4387**
colored, arrowed links like `located in`, `guards`, `rules`, `kills`, `sealed in`, `crafted by`, and
`story of`. Character relationship links are merged in too.

- **Category chips** above the map toggle whole categories on/off (e.g. hide Classes to declutter).
- **Drag** any node to rearrange; **hover** traces its connections; **click** a node opens its entry;
  **click** a link reads its story (with edit/delete).
- Node ring colors match the archive category colors; link colors match their type legend.
- **Add links** through the same structured form as relationships (any entry name is suggested).

Story links persist in `server/data/story-links.json`.

## Block Map

A **Block Map** view renders the world's geography as a rightward-flowing "blockchain": a genesis
block for *The World* sits at the far left, with each realm/category laid out as its own horizontal
chain of blocks (children in breadth-first order), packed left-to-right so the map grows wide rather
than tall. Realms and containment links (`located in`, `lives in`, `home of`, `part of`) drive the
hierarchy.

- **Scroll** to zoom, **drag** to pan, **hover** to trace a chain, **click** a block to open its
  entry, **Esc** to fit the whole map to screen.

## Query Chat (AI)

A **Query Chat** view lets you ask the archive plain-language questions. Its **query mode** is a
local keyword lookup — no AI is involved, and it works without any key. Its **explore mode** is
Groq-backed: it sends the whole archive to the server's `/api/ai/explore` route to have the AI find
the answer itself. Explore **always uses the HTTP (Groq) backend** and requires `AI_API_KEY` (or
`GROQ_API_KEY`) in the server environment; without a key, explore falls back to the local lookup.

## AI backend

Explore mode in Query Chat always uses the **HTTP backend**, by default Groq. Set `AI_API_KEY` (or
`GROQ_API_KEY`) to enable it. `AI_BASE_URL` / `AI_MODEL` point at any OpenAI-compatible
chat-completions endpoint (Groq is the default; OpenRouter and local Ollama/LM Studio all work), and
`AI_FALLBACK_MODELS` tries additional models in order when a free model is rate-limited.

Two optional toggles apply to the HTTP backend: `AI_REASONING=true` sends `reasoning_effort`
(Groq and gpt-oss models only), and `AI_JSON_MODE=false` disables JSON response mode. See
`.env.example` for the full list.

## World systems (as captured in the archive)

- **Ranks & roles** — angel and demon rank (Serapharch↔Lumen, Mordrach↔Gnash) measures *power*, not
  *profession*; most beings are civilians and any rank can leave the realm.
- **Grades (G–S)** — the universal power scale, with Early/Mid/Late/Peak sub-stages, the Wall, and
  Evolution Quests. Max level is 100.
- **Rune Star Circles (1–7)** — Mages progress by inscribing Rune Stars into their heart instead of
  using the Grade system; each circle maps to a rough Grade equivalent (1st≈F … 7th≈S).
- **Classes (19)** — Veyn and Ren classes, each with 10 class-skills and a 7-tier progression
  ladder. Angels/demons learn max 5 class-skills; humans learn all. Veyn & Ren can't mix (Smithing
  is the sole exception; angels/demons may unlock a Ren Organ at the cost of all Veyn).
- **Magic** — Veyn (neutral) → Holy Energy (angels/saints) and Corrupted Veyn (demons); Ren → Auric
  Ren (paladins).
- **Currency** — Sigils: 100 silver = 1 gold, 1,000 gold = 1 platinum.
- **Reference document** — `Half_made world ideas.docx` is the original source the archive was
  transcribed from. The live `server/data/*.json` files are the source of truth; the bundled seed
  data is synced from them with `npm run seeds:sync` (or verified with `npm run seeds:check`).

## API reference

**Entries**

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/entries` | List entries (`?category=&search=`) |
| GET | `/api/entries/:id` | Get one entry |
| POST | `/api/entries` | Create an entry |
| PUT | `/api/entries/:id` | Update an entry |
| DELETE | `/api/entries/:id` | Delete an entry |
| GET | `/api/categories` | Category names + entry counts |
| DELETE | `/api/categories/:name` | Delete a category and cascade-remove its entries, relationships, and story links |
| POST | `/api/reset` | Reset entries, relationships, and story links back to their original seeds |

**Relationships**

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/relationships` | List all relationships |
| POST | `/api/relationships` | Create a relationship `{ source, target, type, label, description }` |
| PUT | `/api/relationships/:id` | Update a relationship |
| DELETE | `/api/relationships/:id` | Delete a relationship |

**Story links**

Same CRUD shape as relationships, under `/api/story-links`.

**Search & AI**

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/search` | Full-text search across the archive (`?q=…`) |
| POST | `/api/ai/answer` | Answer a natural-language question from the archive contents |
| POST | `/api/ai/explore` | AI-guided exploration/discovery across the archive |
| POST | `/api/ai/flavor` | Flavor Finder — descriptors, scene rewrite, scene craft, or sound words |
| POST | `/api/ai/plan` | Draft a new entry that fits the archive (questions-first; local dev only) |
| POST | `/api/ai/plan/session/delete` | Delete the temporary AI session file(s) a plan created on disk |
| GET | `/api/ai/status` | Which AI features are live right now (planner enabled / configured) |
| POST | `/api/canon/lint` | Canon Guard — findings for the whole archive, or for one draft entry |

## Tests and CI

The client has a Vitest suite (`npm test --prefix client`) covering the search index, the
description renderer and markdown tables, the canon rules, and the chapter gate (entry/field
reveal, auto-scan, and link pruning).

Every push to `main` runs the GitHub Actions workflow in `.github/workflows/deploy-ghpages.yml`:
it installs the client dependencies, runs the unit tests, checks that the seed files still match
`server/data/*.json` (`npm run seeds:check`), builds the client, and deploys `client/dist` to
GitHub Pages. The same workflow is what keeps the live archive in step with the committed data.
