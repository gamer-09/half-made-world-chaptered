const express = require('express');
const WordExtractor = require('word-extractor');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {

  loadWorld,
  saveWorld,
  resetWorld,
  loadRelationships,
  saveRelationships,
  resetRelationships,
  loadStoryLinks,
  saveStoryLinks,
  resetStoryLinks,
  loadChapterCodes,
  saveChapterCodes,
} = require('./storage');
const { lintArchive, lintEntry } = require('./canon-rules');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 5001;

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

function cleanFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && typeof f === 'object' && f.label && f.value)
    .map((f) => ({ label: String(f.label).trim(), value: String(f.value).trim() }))
    .filter((f) => f.label && f.value);
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => String(t).trim()).filter(Boolean);
}

function matchesSearch(entry, q) {
  return (
    entry.name.toLowerCase().includes(q) ||
    (entry.subtitle || '').toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    (entry.tags || []).some((t) => t.toLowerCase().includes(q)) ||
    (entry.fields || []).some((f) => f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q))
  );
}

// --- Categories -----------------------------------------------------------
app.get('/api/categories', (req, res) => {
  const world = loadWorld();
  const counts = {};
  for (const entry of world) {
    counts[entry.category] = (counts[entry.category] || 0) + 1;
  }
  const list = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

// Delete a category and all of its entries, plus any relationships/story
// links that reference the removed entries.
app.delete('/api/categories/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const world = loadWorld();
  const removed = world.filter((e) => e.category === name);
  if (removed.length === 0) {
    return res.status(404).json({ error: 'Category not found or already empty' });
  }
  const removedNames = new Set(removed.map((e) => e.name));
  saveWorld(world.filter((e) => e.category !== name));

  let relationshipsRemoved = 0;
  const rels = loadRelationships();
  saveRelationships(
    rels.filter((r) => {
      const drop = removedNames.has(r.source) || removedNames.has(r.target);
      if (drop) relationshipsRemoved += 1;
      return !drop;
    }),
  );

  let storyLinksRemoved = 0;
  const links = loadStoryLinks();
  saveStoryLinks(
    links.filter((l) => {
      const drop = removedNames.has(l.source) || removedNames.has(l.target);
      if (drop) storyLinksRemoved += 1;
      return !drop;
    }),
  );

  res.json({ ok: true, deleted: removed.length, relationshipsRemoved, storyLinksRemoved });
});

// --- Entries --------------------------------------------------------------
app.get('/api/entries', (req, res) => {
  let world = loadWorld();
  const { category, search } = req.query;

  if (category) {
    world = world.filter((e) => e.category === category);
  }
  if (search) {
    const q = String(search).toLowerCase();
    world = world.filter((e) => matchesSearch(e, q));
  }

  res.json([...world].sort((a, b) => a.name.localeCompare(b.name)));
});

app.get('/api/entries/:id', (req, res) => {
  const world = loadWorld();
  const entry = world.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(entry);
});

app.post('/api/entries', (req, res) => {
  const { category, name, subtitle, description, fields, tags } = req.body || {};
  if (!category || !String(category).trim()) {
    return res.status(400).json({ error: 'A category is required' });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'A name is required' });
  }
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'A description is required' });
  }

  const entry = {
    id: uid(),
    category: String(category).trim(),
    name: String(name).trim(),
    subtitle: subtitle ? String(subtitle).trim() : '',
    description: String(description).trim(),
    fields: cleanFields(fields),
    tags: cleanTags(tags),
    createdAt: now(),
    updatedAt: now(),
  };

  const world = loadWorld();
  world.push(entry);
  saveWorld(world);
  res.status(201).json(entry);
});

app.put('/api/entries/:id', (req, res) => {
  const world = loadWorld();
  const idx = world.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found' });

  const existing = world[idx];
  const { category, name, subtitle, description, fields, tags } = req.body || {};

  const nextCategory = category !== undefined ? String(category).trim() : existing.category;
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  const nextDescription = description !== undefined ? String(description).trim() : existing.description;
  if (!nextCategory) return res.status(400).json({ error: 'A category is required' });
  if (!nextName) return res.status(400).json({ error: 'A name is required' });
  if (!nextDescription) return res.status(400).json({ error: 'A description is required' });

  const updated = {
    ...existing,
    category: nextCategory,
    name: nextName,
    subtitle: subtitle !== undefined ? String(subtitle).trim() : existing.subtitle,
    description: nextDescription,
    fields: fields !== undefined ? cleanFields(fields) : existing.fields,
    tags: tags !== undefined ? cleanTags(tags) : existing.tags,
    updatedAt: now(),
  };

  world[idx] = updated;
  saveWorld(world);
  res.json(updated);
});

app.delete('/api/entries/:id', (req, res) => {
  const world = loadWorld();
  const idx = world.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found' });
  const [removed] = world.splice(idx, 1);
  saveWorld(world);
  res.json(removed);
});

// --- Generic link validation (relationships + story links) ----------------
function validateLink(body, partial) {
  const { source, target, type, label, description, color } = body || {};
  const nextSource = source !== undefined ? String(source).trim() : null;
  const nextTarget = target !== undefined ? String(target).trim() : null;
  const nextType = type !== undefined ? String(type).trim() : null;
  const nextColor = color !== undefined ? String(color).trim() : '';
  if (partial) {
    if (nextSource !== null && !nextSource) return { error: 'A source is required' };
    if (nextTarget !== null && !nextTarget) return { error: 'A target is required' };
    if (nextType !== null && !nextType) return { error: 'A link type is required' };
  } else {
    if (!nextSource) return { error: 'A source is required' };
    if (!nextTarget) return { error: 'A target is required' };
    if (!nextType) return { error: 'A link type is required' };
  }
  if (nextSource !== null && nextTarget !== null && nextSource === nextTarget) {
    return { error: 'Source and target must be different' };
  }
  return {
    data: {
      source: nextSource,
      target: nextTarget,
      type: nextType,
      label: label !== undefined ? String(label).trim() : '',
      description: description !== undefined ? String(description).trim() : '',
      ...(color !== undefined ? { color: nextColor } : {}),
    },
  };
}

function makeLinkRoutes(collection, loader, saver, label) {
  app.get(`/api/${collection}`, (req, res) => {
    res.json(loader());
  });

  app.post(`/api/${collection}`, (req, res) => {
    const check = validateLink(req.body, false);
    if (check.error) return res.status(400).json({ error: check.error });
    const item = { id: uid(), ...check.data, createdAt: now(), updatedAt: now() };
    const list = loader();
    list.push(item);
    saver(list);
    res.status(201).json(item);
  });

  app.put(`/api/${collection}/:id`, (req, res) => {
    const list = loader();
    const idx = list.findIndex((r) => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: `${label} not found` });
    const existing = list[idx];
    const check = validateLink(req.body, true);
    if (check.error) return res.status(400).json({ error: check.error });
    const updated = { ...existing, ...check.data, updatedAt: now() };
    list[idx] = updated;
    saver(list);
    res.json(updated);
  });

  app.delete(`/api/${collection}/:id`, (req, res) => {
    const list = loader();
    const idx = list.findIndex((r) => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: `${label} not found` });
    const [removed] = list.splice(idx, 1);
    saver(list);
    res.json(removed);
  });
}

makeLinkRoutes('relationships', loadRelationships, saveRelationships, 'Relationship');
makeLinkRoutes('story-links', loadStoryLinks, saveStoryLinks, 'Story link');

// --- Chapter codes --------------------------------------------------------
app.get('/api/chapter-codes', (req, res) => {
  res.json(loadChapterCodes());
});

app.post('/api/chapter-codes', (req, res) => {
  const { code, chapter } = req.body || {};
  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: 'A code is required' });
  }
  const ch = Number(chapter);
  if (!Number.isFinite(ch) || ch < 0 || String(chapter ?? '').trim() === '') {
    return res.status(400).json({ error: 'A chapter number is required' });
  }
  const map = loadChapterCodes();
  const key = String(code).trim().toLowerCase();
  map[key] = ch;
  saveChapterCodes(map, { action: 'register', code: key });
  res.status(201).json({ ok: true, code: String(code).trim(), chapter: ch });
});

// Rename a code and/or retarget it to a different chapter.
app.put('/api/chapter-codes/:code', (req, res) => {
  const map = loadChapterCodes();
  const key = decodeURIComponent(req.params.code).toLowerCase().trim();
  if (!(key in map)) return res.status(404).json({ error: 'Code not found' });
  const { code, chapter } = req.body || {};
  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: 'A code is required' });
  }
  const ch = Number(chapter);
  if (!Number.isFinite(ch) || ch < 0 || String(chapter ?? '').trim() === '') {
    return res.status(400).json({ error: 'A chapter number is required' });
  }
  const nextKey = String(code).trim().toLowerCase();
  if (nextKey !== key && nextKey in map) {
    return res.status(409).json({ error: 'That code already exists' });
  }
  if (nextKey !== key) delete map[key];
  map[nextKey] = ch;
  saveChapterCodes(map, { action: 'update', code: nextKey });
  res.json({ ok: true, code: String(code).trim(), chapter: ch });
});

app.delete('/api/chapter-codes/:code', (req, res) => {
  const map = loadChapterCodes();
  const key = decodeURIComponent(req.params.code).toLowerCase().trim();
  if (!(key in map)) return res.status(404).json({ error: 'Code not found' });
  delete map[key];
  saveChapterCodes(map, { action: 'remove', code: key });
  res.json({ ok: true });
});

// --- Reset ----------------------------------------------------------------
app.post('/api/reset', (req, res) => {
  const world = resetWorld();
  const rels = resetRelationships();
  const links = resetStoryLinks();
  res.json({ ok: true, entries: world.length, relationships: rels.length, storyLinks: links.length });
});

// --- Archive search (chat-room style) -------------------------------------
function buildSnippet(text, q) {
  if (text == null || !q) return text;
  text = Array.isArray(text) ? text.join(', ') : String(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + q.length + 120);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

// A keyword matches a field when its stemmed token is in the field's token
// set, or (for multi-word keywords like "main character") appears literally.
function kwIn(kw, textLower, stems) {
  return kw.includes(' ') ? textLower.includes(kw) : stems.has(kw);
}

// Tokenize a field into raw AND stemmed words so plural/singular and
// punctuation variants all match ("Angels" -> angel, "abilities" -> ability).
function tokenStems(text) {
  const set = new Set();
  for (const w of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w) continue;
    set.add(w);
    set.add(stem(w));
  }
  return set;
}

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ entries: [], relationships: [], storyLinks: [], query: q, keywords: [] });

  // Keyword lookup rather than literal substring search — "Who betrayed
  // Lisa?" tokenizes to [betrayed, lisa] and matches any field containing
  // those words, not the exact sentence.
  const keywords = extractKeywords(q);
  if (!keywords.length) return res.json({ entries: [], relationships: [], storyLinks: [], query: q, keywords: [] });
  // The whole query with stop words removed — a literal phrase hit (e.g.
  // "umbrage forest" in a name) outranks single-keyword noise.
  const phrase = q.split(/\s+/).filter((w) => !STOPWORDS.has(w)).join(' ');

  const world = loadWorld();
  const rels = loadRelationships();
  const links = loadStoryLinks();

  const matchingEntries = world
    .map((e) => {
      const name = e.name.toLowerCase();
      const sub = (e.subtitle || '').toLowerCase();
      const cat = (e.category || '').toLowerCase();
      const desc = e.description.toLowerCase();
      const nameStems = tokenStems(e.name);
      const catStems = tokenStems(e.category);
      const subStems = tokenStems(e.subtitle);
      const descStems = tokenStems(e.description);
      const tagInfo = (e.tags || []).map((t) => ({ t, stems: tokenStems(t) }));
      const fieldInfo = (e.fields || []).map((f) => ({ f, stems: tokenStems(`${f.label} ${f.value}`) }));
      let score = 0;
      let catHit = false;
      const matched = new Set();
      const matchIn = [];
      const pushHit = (field, snippet) => {
        if (!snippet || matchIn.length >= 8) return;
        if (matchIn.some((h) => h.field === field && h.snippet === snippet)) return;
        matchIn.push({ field, snippet });
      };
      for (const kw of keywords) {
        let hit = false;
        // Name is the strongest signal — the user may have typed the entry name.
        if (kwIn(kw, name, nameStems)) {
          score += name === kw ? 30 : 15;
          hit = true;
          pushHit('name', e.name);
        }
        if (kwIn(kw, cat, catStems)) {
          score += 2;
          hit = true;
          catHit = true;
          pushHit('category', e.category);
        }
        if (kwIn(kw, sub, subStems)) {
          score += 3;
          hit = true;
          pushHit('subtitle', e.subtitle);
        }
        // Tags are curated keywords — a tag hit is a good signal.
        const tagHit = tagInfo.find((ti) => kwIn(kw, ti.t.toLowerCase(), ti.stems));
        if (tagHit) {
          score += 6;
          hit = true;
          pushHit('tags', tagHit.t);
        }
        if (kwIn(kw, desc, descStems)) {
          score += 3;
          hit = true;
          pushHit('description', buildSnippet(e.description, kw));
        }
        const fieldHit =
          kw.length > 2 && fieldInfo.find((fi) => kwIn(kw, `${fi.f.label} ${fi.f.value}`.toLowerCase(), fi.stems));
        if (fieldHit) {
          score += 3;
          hit = true;
          pushHit('field', `${fieldHit.f.label}: ${buildSnippet(fieldHit.f.value, kw)}`);
        }
        if (hit) matched.add(kw);
      }
      if (phrase.includes(' ')) {
        if (name.includes(phrase)) {
          score += 40;
          pushHit('name', e.name);
        } else if (desc.includes(phrase)) {
          score += 15;
          pushHit('description', buildSnippet(e.description, phrase));
        }
      }
      // A category hit means the question is about a whole taxonomy (e.g.
      // "which race…" -> the Race Types category). Lift every entry in that
      // category so the full set surfaces, not just the one that repeated the
      // keyword.
      if (catHit) score += 20;
      // Entries that touch several aspects of the question are more relevant
      // than ones that merely repeat a single common word.
      if (matched.size > 1) score += matched.size * 8;
      // Overview entries summarize their whole category — what "what is X" needs.
      if (name.includes('overview')) score += 8;
      return {
        score,
        entry: {
          id: e.id,
          category: e.category,
          name: e.name,
          subtitle: e.subtitle || '',
          description: e.description,
          fields: e.fields,
          tags: e.tags,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          matchIn,
        },
      };
    })
    // matchIn is only populated by real keyword/phrase hits — this keeps
    // the overview +8 bonus from surfacing entries that matched nothing.
    .filter((s) => s.entry.matchIn.length > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);

  // Relationships and story links share the same shape and matching rules.
  const scoreLinkLike = (item) => {
    const texts = {
      source: item.source.toLowerCase(),
      target: item.target.toLowerCase(),
      type: (item.type || '').toLowerCase(),
      label: (item.label || '').toLowerCase(),
      description: (item.description || '').toLowerCase(),
    };
    const stems = {
      source: tokenStems(item.source),
      target: tokenStems(item.target),
      type: tokenStems(item.type),
      label: tokenStems(item.label),
      description: tokenStems(item.description),
    };
    const weights = { source: 5, target: 5, type: 3, label: 3, description: 3 };
    let score = 0;
    const matched = new Set();
    const matchIn = [];
    const pushHit = (field, snippet) => {
      if (!snippet || matchIn.length >= 6) return;
      if (matchIn.some((h) => h.field === field && h.snippet === snippet)) return;
      matchIn.push({ field, snippet });
    };
    for (const kw of keywords) {
      let hit = false;
      for (const field of Object.keys(texts)) {
        if (!texts[field] || !kwIn(kw, texts[field], stems[field])) continue;
        score += weights[field];
        hit = true;
        pushHit(field, field === 'description' ? buildSnippet(item.description, kw) : item[field]);
      }
      if (hit) matched.add(kw);
    }
    if (matched.size > 1) score += matched.size * 4;
    return { score, item, matchIn };
  };

  const toLinkMatch = (r, matchIn) => ({
    id: r.id,
    source: r.source,
    target: r.target,
    type: r.type,
    label: r.label || '',
    description: r.description || '',
    color: r.color,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    matchIn,
  });

  const matchingRels = rels
    .map((r) => scoreLinkLike(r))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => toLinkMatch(s.item, s.matchIn));

  const matchingLinks = links
    .map((l) => scoreLinkLike(l))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => toLinkMatch(s.item, s.matchIn));

  // Broad keyword queries (synonym expansions especially) can match most of
  // the archive — cap what's returned for rendering, but report the real
  // totals so the answer can say "showing the top N of M".
  const totals = {
    entries: matchingEntries.length,
    relationships: matchingRels.length,
    storyLinks: matchingLinks.length,
  };

  res.json({
    entries: matchingEntries.slice(0, 50),
    relationships: matchingRels.slice(0, 25),
    storyLinks: matchingLinks.slice(0, 30),
    query: q,
    keywords,
    totals,
  });
});

// --- AI backend (any OpenAI-compatible chat-completions endpoint) -----------
// Groq is the default, but the server talks plain OpenAI-compatible HTTP, so
// AI_BASE_URL / AI_MODEL / AI_API_KEY can point at anything: a local Ollama or
// LM Studio server (no rate limits at all), OpenRouter, a Groq proxy, etc.
//
// A SECOND provider can be configured as a fallback (see the provider chain
// below). When the primary cannot answer — its free tier is rate-limited, the
// endpoint is down, a model returns nothing — the fallback is tried before the
// request fails. The fallback is OpenRouter by default and only joins the
// chain when it has an API key of its own, so a server with a single key
// behaves exactly as it did before.
// The AI features are split across two fixed backends:
//   • Explore / answer (Query Chat) → ALWAYS the HTTP chat-completions endpoint
//     (Groq by default) — never the opencode CLI.
//   • Planner (/api/ai/plan)        → ALWAYS the local opencode CLI
//     (`opencode run --format json`) — never the HTTP backend.
// AI_PROVIDER no longer switches between them; the routing is hard-wired per
// route. opencode uses whatever model/auth it is already configured with, so no
// API key is needed for the planner.
const OPENCODE_BIN = process.env.OPENCODE_BIN || resolveOpencodeBin();
// opencode's own model spec ("provider/model"), e.g. "opencode/big-pickle".
// Blank = whatever opencode is configured/defaults to. Note this is NOT the
// AI_MODEL value — that's an HTTP provider's model id (e.g. an OpenRouter
// model) and opencode would reject it.
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || '';
// Which opencode agent the planner runs as. "plan" is opencode's read-only
// agent: the planner only ever needs to answer with JSON, and a read-only
// agent cannot touch the archive while it is thinking. Set OPENCODE_AGENT to
// an empty value to use opencode's default agent instead; if the configured
// agent does not exist, the planner falls back to the default one.
const OPENCODE_AGENT = (process.env.OPENCODE_AGENT ?? 'plan').trim();
// How long one opencode CLI call may take. The prompt carries a slice of the
// whole archive, so a slow model can take minutes; the default is generous.
const OPENCODE_TIMEOUT_MS = Number(process.env.OPENCODE_TIMEOUT_MS ?? 480000);

// Prefer the real opencode executable over the .cmd/.ps1 npm shims: spawning
// the shim with a shell on Windows stops forwarding stdin reliably, which
// matters because the planner pipes a ~150KB prompt in.
function resolveOpencodeBin() {
  if (process.platform !== 'win32') return 'opencode';
  const candidates = [
    require('path').join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    require('path').join(process.env.USERPROFILE || '', '.opencode', 'bin', 'opencode.exe'),
  ];
  for (const c of candidates) {
    try {
      if (require('fs').existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return 'opencode';
}
// --- HTTP providers --------------------------------------------------------
// A provider is one OpenAI-compatible endpoint, its own API key, and its own
// chain of models to try on it.
function splitList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// A friendly name for the UI and the logs.
function providerLabel(baseUrl) {
  const host = String(baseUrl || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .toLowerCase();
  if (host.includes('groq')) return 'Groq';
  if (host.includes('openrouter')) return 'OpenRouter';
  if (host.includes('ollama')) return 'Ollama';
  if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) return 'Local model';
  return host;
}

function makeProvider({ name, baseUrl, apiKey, models }) {
  const url = String(baseUrl || '').replace(/\/+$/, '');
  return {
    name,
    label: providerLabel(url),
    baseUrl: url,
    apiKey: apiKey || '',
    models: [...new Set(models.filter(Boolean))],
    // 'reasoning_effort' is a Groq/gpt-oss field; only send it where it is accepted.
    sendReasoning: /groq\.com/i.test(url) || process.env.AI_REASONING === 'true',
    // OpenRouter reasoning models can be told to skip hidden reasoning; some
    // require it and are retried without the flag.
    reasoningOff: /openrouter\.ai/i.test(url) && process.env.AI_REASONING !== 'true',
  };
}

// The primary provider — the one everything has always used. The extra models
// in AI_FALLBACK_MODELS are tried on this same endpoint.
const AI_PRIMARY = makeProvider({
  name: 'primary',
  baseUrl: process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
  apiKey: process.env.AI_API_KEY || process.env.GROQ_API_KEY || '',
  models: [process.env.AI_MODEL || 'openai/gpt-oss-20b', ...splitList(process.env.AI_FALLBACK_MODELS)],
});

// The fallback provider — a second endpoint tried when the primary cannot
// answer. OpenRouter by default; point it anywhere with AI_FALLBACK_BASE_URL.
const AI_FALLBACK = makeProvider({
  name: 'fallback',
  baseUrl: process.env.AI_FALLBACK_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: process.env.AI_FALLBACK_API_KEY || process.env.OPENROUTER_API_KEY || '',
  models: [
    process.env.AI_FALLBACK_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
    ...splitList(process.env.AI_FALLBACK_MODEL_CHAIN),
  ],
});

// The provider chain, in order. A provider joins it only when it has a key and
// at least one model. The fallback is skipped when it is the same endpoint AND
// the same key as the primary — that case is already covered by the primary's
// own model chain.
function buildProviderChain(primary, fallback) {
  return [primary, fallback].filter(
    (p) =>
      p.apiKey &&
      p.models.length &&
      !(p === fallback && p.baseUrl === primary.baseUrl && p.apiKey === primary.apiKey),
  );
}

const AI_PROVIDERS = buildProviderChain(AI_PRIMARY, AI_FALLBACK);

// JSON mode (response_format) is on by default; disable it for endpoints that reject it.
const AI_JSON_MODE = process.env.AI_JSON_MODE !== 'false';

function aiConfigured() {
  // Explore / answer / Flavor Finder always use the HTTP backend, which needs a key.
  return AI_PROVIDERS.length > 0;
}

// The planner always uses the local opencode CLI — it needs no key, only a
// resolvable binary.
function plannerConfigured() {
  return Boolean(OPENCODE_BIN);
}

// Master switch for the Planning Room. It is OFF for now: the opencode CLI
// run over the archive context is not dependable yet (it can run for minutes
// and then answer with prose instead of the JSON the planner asks for).
// The planner's implementation is untouched — set AI_PLANNER_ENABLED=true to
// bring it back.
const AI_PLANNER_ENABLED = process.env.AI_PLANNER_ENABLED === 'true';

// Groq's free tier caps requests at ~8000 tokens per minute, so keep the
// archive context well under that (~1 token ≈ 4 chars).
const AI_CONTEXT_CHAR_BUDGET = 16000;
// The planner reads the WHOLE archive so it understands the world's general
// shape (not just keyword matches). The default is deliberately modest: the
// archive digest runs ~285k chars for the full 1090 entries, and pushing that
// much text through the opencode CLI takes minutes (and blows past the CLI
// timeout) even though the extra text adds little. 150k chars (~37k tokens)
// still gives the model a broad view of the world. Raise it with
// AI_FULL_CONTEXT_BUDGET if you have a fast model and a bigger budget; set 0
// to drop the digest and fall back to keyword matches only.
const AI_FULL_CONTEXT_BUDGET = Number(process.env.AI_FULL_CONTEXT_BUDGET ?? 150000);
const AI_DESC_LIMIT = 800;
const AI_FIELD_LIMIT = 300;
const AI_SUBTITLE_LIMIT = 200;

// Per-entry caps for the full digest: short enough that all ~1000 entries fit,
// long enough that each one conveys what it is and the facts a new entry must
// respect.
const DIGEST_DESC_LIMIT = 220;
const DIGEST_FIELD_LIMIT = 120;
const DIGEST_SUBTITLE_LIMIT = 120;
const DIGEST_FIELDS_PER_ENTRY = 8;

function truncateForBudget(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…';
}

// A compact digest of EVERY entry — grouped by category, one line each with its
// subtitle, a trimmed description, and its most important field values. This
// gives the planner general knowledge of the whole world (what exists, how
// things are described, what fields they use) rather than only the handful of
// entries that happen to match the request's keywords.
function buildArchiveDigest(budget = AI_FULL_CONTEXT_BUDGET) {
  if (!budget || budget <= 0) return '';
  const world = loadWorld();
  const byCat = new Map();
  for (const e of world) {
    const cat = e.category || 'Uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(e);
  }

  const lines = ['=== FULL ARCHIVE (every entry, for general knowledge) ==='];
  let used = lines[0].length;
  let included = 0;
  let omitted = 0;

  const addLine = (line) => {
    if (used + line.length + 1 > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));
  for (const cat of cats) {
    const entries = byCat.get(cat);
    if (!addLine(`## ${cat} (${entries.length})`)) {
      omitted += entries.length;
      continue;
    }
    for (const e of entries) {
      const parts = [e.name];
      if (e.subtitle) parts.push('— ' + truncateForBudget(e.subtitle, DIGEST_SUBTITLE_LIMIT));
      const head = '- ' + parts.join(' ');
      if (!addLine(head)) {
        omitted += 1;
        continue;
      }
      if (e.description) {
        addLine('    ' + truncateForBudget(e.description, DIGEST_DESC_LIMIT));
      }
      let shown = 0;
      for (const f of e.fields || []) {
        if (shown >= DIGEST_FIELDS_PER_ENTRY) break;
        if (addLine(`    ${f.label}: ${truncateForBudget(f.value, DIGEST_FIELD_LIMIT)}`)) shown += 1;
      }
      included += 1;
    }
  }

  if (omitted) {
    lines.push(`(digest trimmed: ${included} entries shown, ${omitted} omitted to fit the budget)`);
  }
  return lines.join('\n');
}

// Renders archive data into prompt lines while staying inside the char
// budget — items that no longer fit are dropped instead of blowing past
// Groq's token-per-minute limit (which fails the whole request).
function buildArchiveContext(data, budget = AI_CONTEXT_CHAR_BUDGET) {
  const lines = [];
  let used = 0;
  let dropped = false;

  const tryAdd = (line) => {
    if (used + line.length + 1 > budget) {
      dropped = true;
      return false;
    }
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  const addEntry = (e) => {
    if (!tryAdd('- ' + e.name + ' (' + (e.category || '') + ')')) return;
    if (e.subtitle) tryAdd('  Subtitle: ' + truncateForBudget(e.subtitle, AI_SUBTITLE_LIMIT));
    if (e.description) tryAdd('  Description: ' + truncateForBudget(e.description, AI_DESC_LIMIT));
    for (const f of e.fields || []) {
      tryAdd('  ' + f.label + ': ' + truncateForBudget(f.value, AI_FIELD_LIMIT));
    }
    if (e.tags && e.tags.length) tryAdd('  Tags: ' + e.tags.join(', '));
    tryAdd('');
  };

  const addEdge = (r) => {
    const label = r.label || r.type || '';
    if (!tryAdd('- ' + r.source + ' --[' + label + ']--> ' + r.target)) return;
    if (r.description) tryAdd('  Description: ' + truncateForBudget(r.description, AI_FIELD_LIMIT));
    tryAdd('');
  };

  if ((data.entries || []).length) {
    tryAdd('=== ENTRIES ===');
    for (const e of data.entries) addEntry(e);
  }
  if ((data.relationships || []).length) {
    tryAdd('=== RELATIONSHIPS ===');
    for (const r of data.relationships) addEdge(r);
  }
  if ((data.storyLinks || []).length) {
    tryAdd('=== STORY LINKS ===');
    for (const l of data.storyLinks) addEdge(l);
  }

  if (!lines.length) return '(no data found in the archive for this query)';
  if (dropped) lines.push('(context trimmed to fit the AI token limit)');
  return lines.join('\n');
}

// Shared model call. Reasoning effort is kept low by default so a reasoning
// model doesn't burn the completion budget on hidden reasoning before it
// writes the answer — Explore uses 'high' (with a bigger max_tokens and a
// smaller context) so it checks facts against the archive instead of assuming.
// Each provider carries its own model chain, so a free model that is
// rate-limited upstream falls through to the next one on that provider, and a
// provider that cannot answer at all falls through to the next provider.

// Run the locally installed opencode CLI headlessly and return its text answer.
// `opencode run --format json` streams one JSON event per line; the assistant's
// reply is the concatenation of the "text" parts. This uses opencode's own
// configured provider/model/auth, so no HTTP endpoint or API key is involved.
//
// Each call spins up a fresh opencode session on disk. `sessionSink`, when set,
// collects those ids so the plan handler can report (and later delete) the
// sessions a single plan created.
let opencodeSessionSink = null;
function askOpencode(prompt, agent = OPENCODE_AGENT) {
  return new Promise((resolve, reject) => {
    const args = ['run', '--format', 'json'];
    if (agent) args.push('--agent', agent);
    if (OPENCODE_MODEL) args.push('--model', OPENCODE_MODEL);
    // The prompt goes on stdin, not argv: the planner's full-archive context is
    // hundreds of KB and would blow past Windows' command-line length limit.
    // A real .exe needs no shell; only fall back to a shell for a bare name
    // (e.g. a shim on PATH).
    const useShell = !/\.exe$/i.test(OPENCODE_BIN);

    let child;
    try {
      child = spawn(OPENCODE_BIN, args, {
        shell: useShell,
        windowsHide: true,
        env: process.env,
      });
    } catch (err) {
      const e = new Error(`Could not start the opencode CLI (${err.message}).`);
      e.status = 0;
      return reject(e);
    }

    let stdout = '';
    let stderr = '';
    let done = false;
    let lingerTimer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (lingerTimer) clearTimeout(lingerTimer);

      const parsed = extractOpencodeText(stdout);
      if (opencodeSessionSink && parsed.sessionID && !opencodeSessionSink.includes(parsed.sessionID)) {
        opencodeSessionSink.push(parsed.sessionID);
      }
      if (parsed.text.trim()) return resolve(parsed.text);

      const detail = (stderr || stdout).trim().slice(0, 400);
      const e = new Error(
        `The opencode CLI returned no answer${detail ? ` (${detail})` : ''}.`,
      );
      e.status = 0;
      e.empty = true;
      reject(e);
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      const secs = Math.round(OPENCODE_TIMEOUT_MS / 1000);
      const e = new Error(
        `The local opencode CLI took too long to respond (over ${secs}s). ` +
          'Lower AI_FULL_CONTEXT_BUDGET to shrink the prompt, or raise OPENCODE_TIMEOUT_MS.',
      );
      e.status = 0;
      reject(e);
    }, OPENCODE_TIMEOUT_MS);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      // Do NOT stop at the first step_finish: a run can span several steps
      // (the agent narrates, calls a tool, then answers) and the answer only
      // arrives with the last message. The CLI exits on its own right after
      // its final step_finish; the safety net below only covers a process
      // that hangs after finishing.
      if (lingerTimer || done) return;
      if (!stdout.includes('"type":"step_finish"')) return;
      lingerTimer = setTimeout(() => {
        if (done) return;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        finish();
      }, 30000);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const e = new Error(`Could not run the opencode CLI at "${OPENCODE_BIN}" (${err.message}).`);
      e.status = 0;
      reject(e);
    });
    child.on('close', () => finish());

    // Feed the prompt and close stdin so opencode knows the message is complete.
    // Wait for the write to flush (backpressure) before ending.
    child.stdin.on('error', () => {
      /* a killed process can EPIPE the stdin — the close handler reports it */
    });
    if (!child.stdin.write(prompt)) {
      child.stdin.once('drain', () => child.stdin.end());
    } else {
      child.stdin.end();
    }
  });
}

// Run the CLI, and if opencode rejects the requested agent, retry once with
// its default agent so a missing/renamed agent never breaks the planner.
async function askOpencodeWithFallback(prompt) {
  try {
    return await askOpencode(prompt);
  } catch (err) {
    if (!OPENCODE_AGENT || !/agent/i.test(err.message || '')) throw err;
    return askOpencode(prompt, '');
  }
}

// Delete an opencode session from disk (`opencode session delete <id>`).
function runOpencodeSessionDelete(sessionID) {
  return new Promise((resolve, reject) => {
    const useShell = !/\.exe$/i.test(OPENCODE_BIN);
    let child;
    try {
      child = spawn(OPENCODE_BIN, ['session', 'delete', sessionID], {
        shell: useShell,
        windowsHide: true,
        env: process.env,
      });
    } catch (err) {
      return reject(new Error(`Could not start the opencode CLI (${err.message}).`));
    }
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('The opencode CLI took too long to delete the session.'));
    }, 30000);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run the opencode CLI (${err.message}).`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(stderr.trim().slice(0, 200) || `opencode exited with code ${code}.`));
    });
  });
}

// Parse the newline-delimited JSON event stream from `opencode run --format json`
// and join the assistant's text parts. Also surfaces the session id (every event
// carries it) so callers can track the sessions a run creates. Falls back to the
// raw stdout if the output isn't the expected event stream.
//
// A run can span several messages: an agent may narrate what it is about to do
// ("I'll start by...") in one message, call a tool, and answer in the next one.
// Only the LAST message is the answer, so the text is grouped by message id and
// the final group wins.
function extractOpencodeText(stdout) {
  const groups = new Map();
  let sessionID = '';
  let order = 0;
  for (const line of String(stdout).split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    let ev;
    try {
      ev = JSON.parse(s);
    } catch {
      continue;
    }
    if (!sessionID && typeof ev?.sessionID === 'string') sessionID = ev.sessionID;
    if (ev?.type === 'text' && typeof ev.part?.text === 'string') {
      const key = ev.part.messageID || `__part_${order}`;
      if (!groups.has(key)) groups.set(key, { seq: order++, text: '' });
      groups.get(key).text += ev.part.text;
    }
  }
  const all = [...groups.values()].sort((a, b) => a.seq - b.seq);
  const allText = all.map((g) => g.text).join('');
  const lastText = all.length ? all[all.length - 1].text : '';
  const text = lastText.trim() ? lastText : allText;
  if (text) return { text, sessionID };
  const raw = String(stdout).trim();
  return { text: raw, sessionID };
}

// One call to one specific model on one specific provider.
async function askModel(provider, model, prompt, maxTokens, reasoningEffort, extra, reasoningOff) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: maxTokens,
    ...(extra || {}),
  };
  if (provider.sendReasoning && reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (reasoningOff) body.reasoning = { enabled: false };

  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const e = new Error(
      err.name === 'AbortError'
        ? `The AI endpoint at ${provider.baseUrl} took too long to respond.`
        : `Could not reach the AI endpoint at ${provider.baseUrl} (${err.message}).`,
    );
    e.status = 0;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. an HTML gateway error) */
  }

  if (!res.ok) {
    const message =
      data?.error?.message || (text && text.slice(0, 400)) || `The AI endpoint returned ${res.status}.`;
    const err = new Error(message);
    err.status = res.status;
    if (data?.error?.code) err.code = data.error.code;
    throw err;
  }

  if (data?.usage) {
    console.log(
      `[ai] ${model} tokens: prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens}`,
    );
  }
  const answer = data?.choices?.[0]?.message?.content || '';
  if (!answer.trim()) {
    const used = data?.usage?.completion_tokens;
    const reason = used ? `it spent all ${used} completion tokens on reasoning` : 'it returned nothing';
    const e = new Error(`The AI returned an empty answer (${reason}) — try again or rephrase the request.`);
    e.empty = true;
    throw e;
  }
  return answer;
}

// Walk the provider chain: for each provider, try its models in order. Free
// models fail often (upstream 429s, empty answers from a reasoning model) and
// a free tier gets rate-limited, so a dead model just moves to the next one,
// and a dead provider just moves to the next provider (the fallback).
//
// An optional `validate` can reject a successful answer as unusable (e.g. the
// model returned prose that could not be parsed into the requested shape) —
// in that case the next provider/model is tried instead of failing the request.
//
// This is the HTTP path only — the planner's opencode backend is called
// directly, never through here.
async function askHttp(prompt, maxTokens = 1024, reasoningEffort = 'low', extra = {}, providers = AI_PROVIDERS, validate = null) {
  let lastErr = null;
  for (const provider of providers) {
    for (let i = 0; i < provider.models.length; i++) {
      const model = provider.models[i];
      const more = i < provider.models.length - 1;
      if (provider.reasoningOff) {
        try {
          const answer = await askModel(provider, model, prompt, maxTokens, reasoningEffort, extra, true);
          if (typeof validate === 'function') {
            try {
              if (!validate(answer)) throw new Error('The AI returned an unusable answer.');
            } catch (err) {
              if (err && err.message === 'The AI returned an unusable answer.') throw err;
              // If the validator throws for other reasons, treat as unusable too.
              throw new Error('The AI returned an unusable answer.');
            }
          }
          return { answer, provider, model };
        } catch (err) {
          lastErr = err;
          // A model that insists on reasoning refuses the flag — retry it without.
          if (!/reasoning is mandatory/i.test(err.message || '')) {
            if (more) continue;
            break; // this provider is out of models — try the next provider
          }
        }
      }
      try {
        const answer = await askModel(provider, model, prompt, maxTokens, reasoningEffort, extra, false);
        if (typeof validate === 'function') {
          try {
            if (!validate(answer)) throw new Error('The AI returned an unusable answer.');
          } catch (err) {
            if (err && err.message === 'The AI returned an unusable answer.') throw err;
            throw new Error('The AI returned an unusable answer.');
          }
        }
        return { answer, provider, model };
      } catch (err) {
        lastErr = err;
        if (more) continue;
        break; // this provider is out of models — try the next provider
      }
    }
  }
  throw lastErr || new Error('No AI models are configured.');
}

// Which provider/model answered, for the UI. A fallback answer should be
// visible as such instead of looking exactly like the usual one.
function providerInfo(result) {
  if (!result || !result.provider) return null;
  return { name: result.provider.name, label: result.provider.label, model: result.model || '' };
}

// Groq's free tier allows ~8000 tokens per minute and 200k per day; one
// high-reasoning call can use most of the minute on its own, so immediate
// follow-ups are often rejected — the tokens free up within a minute, so
// wait and retry instead of failing. (The daily cap can't be waited out in
// seconds, so that fails fast.)
//
// Auto-drop policy: each effort gets a bounded completion budget. If a call
// burns its whole budget on hidden reasoning without writing an answer, or
// gets rejected as too large for the rate limit, reasoning drops to 'medium'
// (which needs far fewer tokens) instead of burning the budget again.
const RATE_LIMIT_RETEST_MS = 65000;
const MAX_AI_ATTEMPTS = 4;
const COMPLETION_BUDGET = { high: 6000, medium: 4000, low: 3000 };
function isRateLimit(err) {
  const status = err?.status || 0;
  return status === 413 || status === 429 || /rate_limit_exceeded|tokens per minute|too large/i.test(err.message || '');
}
function isDailyLimit(err) {
  return /tokens per day|TPD/i.test(err.message || '');
}
// Groq reports reset windows as durations ("1h30m19.008s", "45.2s") in the
// error message and/or the x-ratelimit-reset-* headers. Turn whichever we
// can find into seconds so the client can show a live countdown.
function durationToSeconds(raw) {
  if (raw == null) return null;
  // Strip sentence punctuation the message regex may have swept in.
  const s = String(raw).trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}
function parseRetryAfterSeconds(err) {
  const fromMessage = /try again in ([0-9hms.]+)/i.exec(err.message || '');
  const messageSeconds = fromMessage ? durationToSeconds(fromMessage[1]) : null;
  let headerSeconds = null;
  const headers = err.headers;
  if (headers && typeof headers.get === 'function') {
    for (const name of ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests', 'retry-after']) {
      const parsed = durationToSeconds(headers.get(name));
      if (parsed != null) {
        headerSeconds = parsed;
        break;
      }
    }
  }
  const candidates = [messageSeconds, headerSeconds].filter((n) => n != null && n > 0);
  if (candidates.length) return Math.ceil(Math.max(...candidates));
  return isDailyLimit(err) ? 3600 : RATE_LIMIT_RETEST_MS / 1000;
}
function dropEffort(effort) {
  return effort === 'high' ? 'medium' : effort === 'medium' ? 'low' : null;
}
// The same walk, but resilient: a rate-limited call waits out the window and
// retries instead of failing the request. The provider chain is tried first,
// so a rate-limited primary moves on to the fallback provider immediately —
// there is no reason to wait when another provider could answer right now.
async function askHttpResilient(prompt, reasoningEffort, maxTokensOverride, extra) {
  let effort = reasoningEffort;
  // A caller can hand a specific budget (e.g. the planner needs a lower
  // reasoning effort but enough completion room to write a whole JSON plan).
  let maxTokens = maxTokensOverride || COMPLETION_BUDGET[effort];
  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    try {
      return await askHttp(prompt, maxTokens, effort, extra);
    } catch (err) {
      if (isDailyLimit(err)) throw err;
      // Too many tokens spent on reasoning with no answer — drop a level.
      if (/empty answer/.test(err.message || '')) {
        const next = dropEffort(effort);
        if (!next) throw err;
        console.log(`[ai] burned ${maxTokens} tokens on reasoning with no answer — dropping effort ${effort} -> ${next}`);
        effort = next;
        maxTokens = COMPLETION_BUDGET[effort];
        continue;
      }
      if (isRateLimit(err) && attempt < MAX_AI_ATTEMPTS) {
        // "Request too large" means this call is too heavy for the free
        // tier's window — shrink it (lower reasoning = smaller completion)
        // rather than waiting to send the same oversized request again.
        const next = effort === 'high' ? dropEffort(effort) : null;
        if (next) {
          console.log(`[ai] rate limited — request too large at effort=${effort}, dropping to ${next} and waiting ${RATE_LIMIT_RETEST_MS / 1000}s`);
          effort = next;
          maxTokens = COMPLETION_BUDGET[effort];
        } else {
          console.log(`[ai] rate limited (free Groq tier) — waiting ${RATE_LIMIT_RETEST_MS / 1000}s and retrying`);
        }
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETEST_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error('The AI kept hitting its usage limit — wait a minute and try again.');
}

function sendAiError(res, tag, err) {
  console.error(`[ai] ${tag} error:`, err.message);
  const status = err?.status || 0;
  if (status === 401) {
    return res
      .status(500)
      .json({ error: 'The AI API key was rejected. Check AI_API_KEY (or GROQ_API_KEY) on the server.' });
  }
  if (status === 413 || status === 429 || /rate_limit_exceeded|tokens per minute|too large/i.test(err.message || '')) {
    const daily = isDailyLimit(err);
    return res.status(429).json({
      error: daily
        ? "The AI's daily token budget is used up (free tier) — it resets after a few hours. Try again later."
        : 'The AI hit its usage limit (free tier). Wait a minute and try again.',
      retryAfterSeconds: parseRetryAfterSeconds(err),
      limit: daily ? 'day' : 'minute',
    });
  }
  res.status(500).json({ error: 'AI request failed: ' + (err.message || 'unknown error') });
}

// Which AI features are live right now. The client uses this to show the
// Planning Room as switched off instead of letting the user start a run that
// cannot finish.
app.get('/api/ai/status', (req, res) => {
  res.json({
    plannerEnabled: AI_PLANNER_ENABLED,
    plannerConfigured: plannerConfigured(),
    answerEnabled: aiConfigured(),
  });
});

app.post('/api/ai/answer', async (req, res) => {
  const { question, searchResult } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'A question is required.' });
  }
  if (!aiConfigured()) {
    return res
      .status(500)
      .json({ error: 'AI is not configured. Set AI_API_KEY (or GROQ_API_KEY) on the server.' });
  }

  const context = buildArchiveContext(searchResult || {});
  const prompt = `You are an assistant for a worldbuilding archive. Answer the user's question using ONLY the information below. Do not invent, assume, or bring in outside knowledge.

=== QUESTION ===
${question}

=== ARCHIVE DATA ===
${context}

=== RULES ===
- Answer in a clear, conversational tone.
- Only use facts from the ARCHIVE DATA above.
- Cite which entry, relationship, or story link the information comes from.
- If the ARCHIVE DATA is empty or nothing matches the question, do NOT just say "nothing matches." Instead, briefly explain what the archive contains in general (how many entries, what categories exist, what kinds of things are documented) and suggest what kinds of terms might find results — for example, try a character name, a place name, or a category. Do not invent facts about the world, but it is fine to describe the shape and scope of the archive itself.
- If the ARCHIVE DATA holds related facts but no explicit record that answers the question (e.g. a ranking, a "strongest", a title nobody is given), do NOT refuse. Reason from the documented facts and give your best judgment, clearly labelled as your own conclusion, not canon — e.g. "The archive never ranks them, but by its own logic X is the strongest because…". Name the specific facts you reasoned from and never invent facts to support the judgment.
- If a table would help (e.g. comparing several things), use valid GitHub-flavoured markdown: a header row, a separator row like | --- | --- |, then one row per item. Keep tables narrow (2–4 columns). Do not use HTML tags (<br>, <br/>, etc.) — use plain text.`;

  try {
    const { answer } = await askHttp(prompt);
    res.json({ answer });
  } catch (err) {
    sendAiError(res, 'answer', err);
  }
});

// --- AI explore: the AI gets the full archive and finds answers on its own ---
// Stopword filter as an explicit Set - plain JS, no regex escaping to break.
const STOPWORDS = new Set([
  'who', 'what', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were', 'does', 'do', 'did',
  'can', 'could', 'would', 'should', 'may', 'might', 'shall', 'will', 'tell', 'me', 'about',
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'with', 'and', 'or', 'that', 'this', 'it',
  'i', 'my', 'we', 'you', 'your', 'he', 'she', 'they', 'its', 'his', 'her', 'their',
  'be', 'been', 'being', 'have', 'has', 'had', 'from', 'by', 'at', 'as', 'if', 'into', 'not', 'please',
  'long', 'ago', 'far', 'much', 'many', 'get', 'got', 'use', 'used', 'there', 'here',
  'which', 'whose', 'whom', 'most', 'kinds', 'kind',
]);

function extractKeywords(question) {
  const words = String(question || '')
    .toLowerCase()
    // Drop filler phrases like "in order" so "order" doesn't match every
    // description that says "in order to" (or hijack "strongest in order").
    .replace(/\bin order\b/g, ' ')
    .replace(/[?!,;:'"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  // Expand shorthand terms ("mc") and stem singular/plural so a question like
  // "what do angels eat" still matches an entry named "Angel Sustenance".
  const expanded = new Set();
  const add = (term) => {
    if (!term || STOPWORDS.has(term)) return;
    expanded.add(term);
    const st = stem(term);
    if (st && !STOPWORDS.has(st)) expanded.add(st);
    // Multi-word terms also match on their component words.
    if (term.includes(' ')) {
      for (const part of term.split(' ')) add(part);
    }
  };
  for (const w of kept) {
    add(w);
    for (const syn of KEYWORD_SYNONYMS[w] || []) add(syn);
  }
  return [...expanded];
}

// Lightweight singular stem so plural/singular tag and name variants match
// (angels -> angel, abilities -> ability, classes -> class).
function stem(w) {
  const s = String(w).toLowerCase();
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y';
  if (s.endsWith('sses')) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) return s.slice(0, -1);
  return s;
}

// Shorthand/vague terms users type, expanded so keyword matching still finds
// entries tagged with the full term (e.g. "mc" -> entries tagged "main character").
const KEYWORD_SYNONYMS = {
  // "strongest"/"apex" are the archive's own vocabulary for top-tier races
  // (Cherubim and Fiends are tagged "apex"), so expand between them.
  strongest: ['apex', 'supreme'],
  stronger: ['apex'],
  apex: ['strongest', 'supreme'],
  mc: ['main character', 'protagonist'],
  'main character': ['mc', 'protagonist'],
  protagonist: ['mc', 'main character'],
  hero: ['protagonist', 'main character'],
  eat: ['food', 'meal', 'cuisine', 'diet', 'sustenance', 'drink', 'feast', 'nourishment', 'hunger'],
  eats: ['eat', 'food', 'meal', 'cuisine', 'diet'],
  eating: ['eat', 'food', 'meal', 'cuisine', 'diet'],
  food: ['eat', 'meal', 'cuisine', 'diet', 'sustenance'],
  meal: ['eat', 'food', 'cuisine'],
  cuisine: ['eat', 'food', 'meal'],
  diet: ['eat', 'food', 'sustenance'],
  sustenance: ['eat', 'food', 'diet'],
  drink: ['eat', 'food', 'beverage'],
  fight: ['combat', 'battle', 'war', 'weapon'],
  combat: ['fight', 'battle', 'war'],
  battle: ['fight', 'combat', 'war'],
  war: ['fight', 'combat', 'battle'],
  magic: ['veyn', 'spell', 'caster'],
  death: ['die', 'dead', 'funeral', 'burial'],
  die: ['death', 'dead'],
  money: ['currency', 'coin', 'price', 'gold', 'silver', 'economy'],
  currency: ['money', 'coin', 'gold', 'silver'],
  price: ['money', 'cost', 'coin', 'currency'],
};

// Compact index of EVERY entry in the archive, grouped by category (~5k
// tokens). Explore mode pairs this with details for the closest matches so
// the AI reasons over the whole archive while staying under Groq's free-tier
// per-request token limit.
function buildArchiveIndex(maxChars = 16000) {
  const world = loadWorld();
  const byCat = {};
  for (const e of world) {
    const cat = e.category || 'Uncategorized';
    (byCat[cat] = byCat[cat] || []).push(e.name);
  }
  const lines = ['TOTAL ENTRIES: ' + world.length];
  let chars = 0;
  let listed = 0;
  for (const cat of Object.keys(byCat).sort()) {
    const names = byCat[cat];
    const prefix = cat + ' (' + names.length + '): ';
    const remaining = maxChars - chars - prefix.length - 1;
    if (remaining <= 0) {
      lines.push(prefix + '… (' + names.length + ' entries, not listed due to size)');
      continue;
    }
    // Fit as many names as the budget allows instead of dropping the whole
    // category — every category stays visible in the index.
    let fitted = [];
    let used = 0;
    for (const n of names) {
      const add = n.length + (fitted.length ? 2 : 0);
      if (used + add > remaining) break;
      fitted.push(n);
      used += add;
    }
    if (fitted.length === names.length) {
      lines.push(prefix + names.join(', '));
      chars += prefix.length + used + 1;
    } else {
      lines.push(prefix + fitted.join(', ') + ', … (' + (names.length - fitted.length) + ' more)');
      chars += prefix.length + remaining + 1;
    }
    listed += fitted.length;
  }
  return lines.join('\n');
}

function broadSearch(question) {
  const keywords = extractKeywords(question);
  if (!keywords.length) return { entries: [], relationships: [], storyLinks: [] };
  const world = loadWorld();
  const rels = loadRelationships();
  const links = loadStoryLinks();

  // Tokenize a field into a set of raw AND stemmed words so plural/singular
  // and punctuation variants all match ("Angels" -> angel, "abilities" -> ability).
  const tokenStems = (text) => {
    const set = new Set();
    for (const w of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (!w) continue;
      set.add(w);
      set.add(stem(w));
    }
    return set;
  };

  const scoredEntries = world
    .map((e) => {
      const name = e.name.toLowerCase();
      const nameStems = tokenStems(e.name);
      const catStems = tokenStems(e.category);
      const subStems = tokenStems(e.subtitle);
      const descStems = tokenStems(e.description);
      const tagStems = new Set();
      for (const t of e.tags || []) for (const s of tokenStems(t)) tagStems.add(s);
      const fieldStems = new Set();
      for (const f of e.fields || []) {
        for (const s of tokenStems(f.label)) fieldStems.add(s);
        for (const s of tokenStems(f.value)) fieldStems.add(s);
      }
      let score = 0;
      const matched = new Set();
      let catHit = false;
      for (const kw of keywords) {
        let hit = false;
        // Name is the strongest signal — the user may have typed the entry name.
        if (name === kw) { score += 30; hit = true; }
        else if (nameStems.has(kw)) { score += 15; hit = true; }
        if (catStems.has(kw)) { score += 2; hit = true; catHit = true; }
        if (subStems.has(kw)) { score += 3; hit = true; }
        // Tags are curated keywords — a tag hit is a good signal.
        if (tagStems.has(kw)) { score += 6; hit = true; }
        if (descStems.has(kw)) { score += 3; hit = true; }
        if (kw.length > 2 && fieldStems.has(kw)) { score += 3; hit = true; }
        if (hit) matched.add(kw);
      }
      // A category hit means the question is about a whole taxonomy (e.g.
      // "which race…" -> the Race Types category). Lift every entry in that
      // category so the full set surfaces, not just the one that repeated the
      // keyword.
      if (catHit) score += 20;
      // Entries that touch several aspects of the question are more relevant
      // than ones that merely repeat a single common word.
      if (matched.size > 1) score += matched.size * 8;
      // Overview entries summarize their whole category — what "what is X" needs.
      if (name.includes('overview')) score += 8;
      // Boost character entries when the question hints at a person.
      if ((e.category || '').toLowerCase() === 'characters' && (keywords.includes('who') || keywords.includes('mc') || keywords.includes('character') || keywords.includes('main'))) {
        score += 2;
      }
      return { entry: e, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((s) => s.entry);

  const scoredRels = rels
    .map((r) => {
      const src = r.source.toLowerCase();
      const tgt = r.target.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (src.includes(kw) || tgt.includes(kw)) score += 3;
      }
      return { rel: r, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.rel);

  const scoredLinks = links
    .map((l) => {
      const src = l.source.toLowerCase();
      const tgt = l.target.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (src.includes(kw) || tgt.includes(kw)) score += 3;
      }
      return { link: l, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.link);

  return { entries: scoredEntries, relationships: scoredRels, storyLinks: scoredLinks };
}

// Keeps only recent, well-formed conversation turns (newest first, within a
// total char cap) so follow-up questions resolve against what was asked
// without pushing the prompt past Groq's free-tier token limit.
const AI_HISTORY_MAX_TURNS = 8;
const AI_HISTORY_CHAR_BUDGET = 1500;
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const turns = [];
  for (const t of raw) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant')) continue;
    if (typeof t.text !== 'string' || !t.text.trim()) continue;
    turns.push({ role: t.role, text: truncateForBudget(t.text, 400) });
    if (turns.length >= AI_HISTORY_MAX_TURNS) break;
  }
  // Drop the oldest turns first when over the total budget.
  let used = 0;
  const kept = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    used += turns[i].text.length;
    if (used > AI_HISTORY_CHAR_BUDGET) break;
    kept.unshift(turns[i]);
  }
  return kept;
}

app.post('/api/ai/explore', async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'A question is required.' });
  }
  if (!aiConfigured()) {
    return res
      .status(500)
      .json({ error: 'AI is not configured. Set AI_API_KEY (or GROQ_API_KEY) on the server.' });
  }

  // Recent conversation turns so follow-ups ("what about their diet?")
  // resolve against what was actually asked — capped so the prompt stays
  // inside Groq's free-tier token limit.
  const history = sanitizeHistory(req.body.history);
  // Follow-up questions often drop the subject ("and their powers?"), so
  // search using the current question plus the previous user turn.
  const priorUser = [...history].reverse().find((t) => t.role === 'user');
  const searchText = priorUser ? priorUser.text + ' ' + question : question;

  // Broad keyword search across the whole archive — wider than query mode so
  // vague questions like "who is the mc" still find relevant entries.
  const results = broadSearch(searchText);
  // Budget-aware context: details for the closest matches, PLUS a full index
  // of every entry name in the archive — the AI sees the whole world, not
  // just keyword hits. Budgets are kept tighter than the free-tier token cap
  // allows so 'high' reasoning has room to run: reasoning tokens count
  // against the same per-minute limit as the prompt and completion.
  const context = buildArchiveContext(results, 8000);
  const archiveIndex = buildArchiveIndex(13000);
  const historyBlock = history.length
    ? '=== CONVERSATION SO FAR ===\n\n' +
      history.map((t) => (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.text).join('\n') +
      '\n\n'
    : '';
  const prompt = `You are an explorer of a worldbuilding archive. You are given: (1) the CONVERSATION SO FAR (if any), (2) a FULL INDEX of every entry in the archive (names only, grouped by category) and (3) DETAILED SEARCH RESULTS for the entries most relevant to the question. Use the index to spot entries the search results missed — if an entry name in the index looks relevant but has no details below, mention it as a lead by name only, never as a fact about the entry. Answer the user's question using this data.

If the question is vague (e.g. "who is the mc"), interpret it in the most useful way based on what's in the data — look for main characters, protagonists, key figures, etc.

${historyBlock}=== QUESTION ===
${question}

=== FULL ARCHIVE INDEX (every entry, grouped by category) ===
${archiveIndex}

=== SEARCH RESULTS (closest matches for the question) ===
${context}

=== RULES ===
- Answer in a clear, conversational tone.
- Only use facts from the CONVERSATION, INDEX, and SEARCH RESULTS above.
- The FULL ARCHIVE INDEX contains names only. Treat every name in it as a lead to check, never as a fact about the entry. State something as fact only if it appears in SEARCH RESULTS (or was already established in CONVERSATION). When an index name has no details, say so and present it as a lead, not as an answer.
- If the question refers back to earlier in the conversation (an entry, a person, "it", "they", "that"), resolve the reference from CONVERSATION SO FAR first. Several archive entries can share words in their names or descriptions — make sure you are discussing the same entry the user asked about, and if it is ambiguous, name which entry you are using.
- Cite which entry, relationship, or story link the information comes from.
- Before stating any fact, check the SEARCH RESULTS (or CONVERSATION) text actually says it. If the text does not say it, do not state it as fact — never fill a gap with an assumption or knowledge from outside the data. A reasoned conclusion is allowed only when every step is a quoted fact and the conclusion is clearly labelled as your own, not canon (see the best-judgment rule below). Uncertainty is better than a confident wrong fact.
- Attribute precisely: every ability, field, or fact belongs to the exact entry it is written under. Overview entries often list several items in one line — attach each item only to the name it is explicitly paired with (e.g. if an overview says "the Malakhim carry Veyn-Regen", Veyn-Regen belongs to the Malakhim alone). If an entry does not state a fact about itself, do NOT borrow it from a sibling, a list, or another entry — say the entry does not list it instead.
- If an entry's own detail fields contradict each other, or two entries contradict each other on the same point, call it out explicitly: quote both sides, name both entries, and say the archive is inconsistent — do not silently pick one.
- Do NOT stitch facts from different entries into new cause-and-effect the archive never states (e.g. don't turn "Veyn returns to the core when a demon dies" into "running out of Veyn kills a demon"). If two entries touch the question, present each fact separately and say the archive does not link them.
- Quote numbers, prices, and exchange rates EXACTLY as the archive states them. Never approximate, round, or invent numeric values — if the archive says 100 Silver = 1 Gold, never say "roughly 10".
- If SEARCH RESULTS contain no explicit record that answers the question (no ranking, no stated "strongest", no title anyone is given) but DO contain documented facts about the subject, do NOT simply say there is no record. Reason from those documented facts and give a best-judgment answer, clearly labelled as your own conclusion, not canon — e.g. "There is no direct record, but by the archive's own logic X is the strongest because…". Name the specific entries/facts you reasoned from. Never invent facts to support the judgment. If instead nothing in the data concerns the question at all, say so plainly — do not force an answer out of unrelated entries.
- When judging strength, power, or rank, weigh each candidate by its DOCUMENTED feats and abilities (e.g. what it can destroy, survive, or create) — not by its current status. An extinct or fallen race may have been the most powerful; "extinct" is not a weakness. When the question is about a whole category (e.g. races), cover EVERY entry listed under that category in the index, not just the ones the search surfaced.
- If you genuinely cannot find anything relevant, say so plainly and point to the closest entries by name.
- Keep the answer focused (roughly 150 words; a ranking or list may run a little longer if needed). Answers are cut off if they run long, so stop before hitting the limit — do not enumerate the whole archive unless the user explicitly asks for a full list.
- If a table would help (e.g. comparing several things), use valid GitHub-flavoured markdown: a header row, a separator row like | --- | --- |, then one row per item. Keep tables narrow (2–4 columns) and short (max ~8 rows) unless the user asks for more. Do not use HTML tags (<br>, <br/>, etc.) — use plain text.`;

  try {
    // Starts at 'high' reasoning; askHttpResilient auto-drops to medium/low
    // if a single call burns too many tokens without answering or exceeds
    // the free tier's rate limit.
    const { answer } = await askHttpResilient(prompt, 'high');
    res.json({ answer });
  } catch (err) {
    sendAiError(res, 'explore', err);
  }
});

// --- AI planning (local development only) ---------------------------------
// The planner drafts NEW things for the world (a character, a place, a race, a
// faction, an item, an event — even a whole category/section) using the
// archive's own conventions, so a draft fits what is already written. Nothing
// it produces is ever saved: drafts are ephemeral and shown only in the local
// dev UI. Where a detail is the user's call rather than something the archive
// answers, the planner asks instead of inventing it.

// JSON mode guarantees syntactically valid JSON where the endpoint supports it
// (the model still reasons first, which is why the resilience wrapper can drop
// a level if it burns the whole budget thinking).
const JSON_MODE = AI_JSON_MODE ? { response_format: { type: 'json_object' } } : {};

// Models often wrap JSON in prose or code fences; pull the object back out.
function parseAiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  for (const candidate of [fenced, raw]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next shape */
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      /* give up */
    }
  }
  return null;
}

function stringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, limit);
}

// Models sometimes pad "empty" list fields with a literal "None"/"N/A".
function isPlaceholder(value) {
  return /^(none|n\/?a|nil|nothing|no concerns?|\(none\)|-)$/i.test(value.trim());
}

// What each category actually holds: entry count, the field labels its entries
// use (most common first), and every existing name — so a draft follows the
// world's own shape and never collides with a name already in use.
function collectCategoryStats() {
  const stats = new Map();
  for (const e of loadWorld()) {
    const cat = e.category || 'Uncategorized';
    let s = stats.get(cat);
    if (!s) {
      s = { count: 0, labels: new Map(), names: [] };
      stats.set(cat, s);
    }
    s.count += 1;
    if (e.name) s.names.push(e.name);
    for (const f of e.fields || []) {
      const label = String(f.label || '').trim();
      if (label) s.labels.set(label, (s.labels.get(label) || 0) + 1);
    }
  }
  return stats;
}

function topLabels(labels, limit = 14) {
  return [...labels.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, n]) => `${label} (${n})`)
    .join(', ');
}

function buildStructureSummary(stats) {
  return [...stats.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, s]) => `${cat} (${s.count})`)
    .join(', ');
}

// The model names a category loosely ("character", "races"); map that onto the
// archive's real category name so the right conventions are used.
function resolvePlanningCategory(kind, stats) {
  const wanted = String(kind || '').trim().toLowerCase();
  if (!wanted) return null;
  for (const name of stats.keys()) if (name.toLowerCase() === wanted) return name;
  for (const name of stats.keys()) {
    const l = name.toLowerCase();
    if (l.includes(wanted) || wanted.includes(l)) return name;
  }
  return null;
}

// Collapse a word to a comparable key: lowercase, letters/digits only, and no
// trailing plural "s" ("Races" -> "race").
function normalizeKey(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s$/, '');
}

// Common worldbuilding nouns that don't share letters with their archive
// category name (a "city" is a Location, a "faction" an Organization). Used
// only to steer the FIELD CONVENTIONS hint; the model may override it.
const CATEGORY_HINTS = [
  [/\b(?:city|cities|town|village|place|location|region|land|map|area|ruin|dungeon|forest|realm|plane|world)\b/i, 'Locations'],
  [/\b(?:faction|organization|organisation|guild|order|group|clan|army|military|company|sect)\b/i, 'Organizations'],
  [/\b(?:item|weapon|armou?r|equipment|artifact|artefact|relic)\b/i, 'Items'],
  [/\b(?:religio?n|god|deity|faith|worship|church|cult)\b/i, 'Religion'],
  [/\b(?:event|festival|holiday|calendar|date|era|age)\b/i, 'Calendar'],
  [/\b(?:race|species|people|folk)\b/i, 'Race Types'],
  [/\b(?:skill|ability|abilities|spell|technique|magic|power)\b/i, 'Class Skills'],
  [/\b(?:char(?:acter)?s?|person|hero|villain|protagonist|antagonist|npc|figure)\b/i, 'Characters'],
  [/\b(?:monster|beast|creature)\b/i, 'Monsters'],
  [/\b(?:law|laws|justice|crime|punish|rule)\b/i, 'Laws & Justice'],
  [/\b(?:culture|custom|tradition|etiquette)\b/i, 'Culture'],
  [/\b(?:economy|money|coin|trade|market|currency|price|cost)\b/i, 'Economy'],
];

// Work out which archive category a request is about WITHOUT spending an AI
// call: match the words the user typed against the category names, then against
// the synonym hints. Returning null is fine — the model still sees the full
// ARCHIVE STRUCTURE and picks the right conventions itself.
function pickPlanningCategory(request, stats) {
  const cats = [...stats.keys()];
  const lower = String(request || '').toLowerCase();
  const wordKeys = new Set(
    lower
      .split(/[^a-z0-9]+/)
      .map(normalizeKey)
      .filter(Boolean),
  );

  // 1. An exact category name (plural-insensitive) in the request text.
  for (const name of cats) {
    const key = normalizeKey(name);
    if (key && wordKeys.has(key)) return name;
  }

  // 2. A category name that shares a meaningful word with the request
  //    ("race" -> "Race Types", "character" -> "Characters").
  for (const name of cats) {
    const key = normalizeKey(name);
    if (!key) continue;
    for (const w of wordKeys) {
      if (w.length >= 4 && (key.startsWith(w) || key.includes(w))) return name;
    }
  }

  // 3. A synonym hint whose target category exists in the archive.
  for (const [re, target] of CATEGORY_HINTS) {
    if (re.test(lower) && stats.has(target)) return target;
  }

  return null;
}

function buildPlanningContext({ kind, results, stats, full = true }) {
  const lines = [];
  lines.push('ARCHIVE STRUCTURE (categories and entry counts):');
  lines.push(buildStructureSummary(stats));
  lines.push('');

  const category = resolvePlanningCategory(kind, stats);
  if (category) {
    const s = stats.get(category);
    lines.push(`FIELD CONVENTIONS FOR "${category}" (labels its entries use, with counts):`);
    lines.push(topLabels(s.labels) || '(no fields written yet)');
    lines.push('');
    lines.push(`EXISTING "${category}" NAMES (never reuse these): ${truncateForBudget(s.names.join(', '), 700)}`);
    lines.push('');
  }

  // The whole archive gives the planner general knowledge of the world — worth
  // its size when drafting. The triage pass only decides what to ask, so it
  // skips the digest and keeps the call cheap.
  if (full) {
    const digest = buildArchiveDigest();
    if (digest) {
      lines.push(digest);
      lines.push('');
    }
  }

  // Then the entries most relevant to this request, in full detail.
  lines.push('RELATED ENTRIES (closest matches for this request, full detail):');
  lines.push(buildArchiveContext(results, 3600));
  return lines.join('\n');
}

function normalizePlan(data, request) {
  const rawSections = Array.isArray(data?.sections)
    ? data.sections
        .map((s) => ({
          heading: String(s?.heading || '').trim(),
          points: stringList(s?.points, 12),
        }))
        .filter((s) => s.heading && s.points.length)
    : [];

  // Safety net: the model is told never to leave "[OPEN — …]" / "[NEW NAME]"
  // style placeholders in a draft, but small models do it anyway. Pull those
  // brackets out of the text and surface them as questions instead, so an open
  // decision can never sit in the plan disguised as content.
  const bracketQuestions = [];
  const cleanPoints = (points) =>
    points
      .map((p) => {
        // Only treat token-style brackets as placeholders ("[OPEN — …]",
        // "[NEW NAME]", "[TBD]"), never legitimate brackets inside prose.
        const found = [...p.matchAll(/\[([A-Z][^\]]{1,120})\]/g)].map((m) => m[1].trim());
        for (const inner of found) {
          if (!inner) continue;
          const bare = inner.replace(/^(open|tbd|to decide)\s*[—:-]\s*/i, '').trim();
          bracketQuestions.push(
            bare ? `Decide: ${bare}` : 'Fill in a detail you left open in the draft',
          );
        }
        return p
          .replace(/\s*\[[A-Z][^\]]{1,120}\]/g, '')
          .replace(/^([A-Za-z ]{2,30}):\s*$/, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      })
      .filter(Boolean);

  const sections = rawSections
    .map((s) => ({ heading: s.heading, points: cleanPoints(s.points) }))
    .filter((s) => s.points.length);

  let questions = Array.isArray(data?.questions)
    ? data.questions
        .map((q, i) => ({
          id: String(q?.id || `q${i + 1}`),
          question: String(q?.question || '').trim(),
          why: String(q?.why || '').trim(),
        }))
        .filter((q) => q.question)
        .slice(0, 4)
    : [];
  // Fold in any placeholder we had to strip, so it still reaches the user.
  for (const bq of bracketQuestions) {
    if (questions.length >= 4) break;
    if (questions.some((q) => q.question.toLowerCase() === bq.toLowerCase())) continue;
    questions.push({ id: `bq${questions.length + 1}`, question: bq, why: 'Left open in the draft' });
  }

  const summary = String(data?.summary || '').trim();
  if (!summary && !sections.length) {
    console.error('[ai] unparseable draft raw:', String(data?._raw || '').slice(0, 1200));
    throw new Error('The planner returned an unreadable draft — try again or rephrase the request.');
  }
  return {
    thinking: String(data?.thinking || '').trim(),
    title: String(data?.title || '').trim() || truncateForBudget(request, 80),
    summary,
    sections,
    questions,
    sources: stringList(data?.sources, 12).filter((s) => !isPlaceholder(s)),
    risks: stringList(data?.risks, 6).filter((r) => !isPlaceholder(r)),
  };
}

// Reads the triage step's verdict: whether the model wants the user's decisions
// first, plus the questions themselves. It only counts as "needs input" when
// there are actually questions to ask.
function normalizeTriage(data) {
  const questions = (Array.isArray(data?.questions) ? data.questions : [])
    .map((q, i) => ({
      id: typeof q?.id === 'string' && q.id.trim() ? q.id.trim() : `q${i + 1}`,
      question: typeof q?.question === 'string' ? q.question.trim() : '',
      why: typeof q?.why === 'string' ? q.why.trim() : '',
    }))
    .filter((q) => q.question)
    .slice(0, 4);
  const thinking = typeof data?.thinking === 'string' ? data.thinking.trim() : '';
  // Any question at all means the user should be consulted before drafting —
  // the model's own "needsInput" flag is advisory only (it sometimes says false
  // while still listing questions, which is exactly the "already planned it"
  // behaviour we don't want).
  const needsInput = questions.length > 0;
  return { needsInput, thinking, questions: needsInput ? questions : [] };
}

// Planning happens in two steps so the user's answers actually shape the draft:
//   1. Triage — the model decides whether it can draft right away or needs the
//      user's own decisions first. If it needs them, we return the questions
//      ALONE and draft nothing, so nothing is "already planned" before the
//      answers arrive.
//   2. Draft — once the user has answered (or waived) the questions, the model
//      writes the full plan with those decisions fixed.
// Everything except the model calls (structure, conventions, matching entries)
// is resolved locally, so each step is one small request.
//
// STATUS: the planner is currently switched OFF (AI_PLANNER_ENABLED=false) —
// the opencode CLI run is not reliable yet (it can run for minutes on the full
// archive context and then answer with prose instead of the requested JSON).
// The whole implementation below is kept intact and stays one env flag away
// from being switched back on.
app.post('/api/ai/plan', async (req, res) => {
  if (!AI_PLANNER_ENABLED) {
    return res.status(503).json({
      error:
        'The planner is temporarily switched off while it is being reworked. Everything else in the archive still works.',
    });
  }
  const request = truncateForBudget(req.body?.request, 600);
  if (!request) {
    return res.status(400).json({ error: 'Describe what you want to plan.' });
  }
  if (!plannerConfigured()) {
    return res.status(500).json({
      error:
        'The planner uses the local opencode CLI, which was not found. Install opencode or set OPENCODE_BIN to its path.',
    });
  }

  // Decisions the user made, fed back in on the second pass. They are fixed
  // inputs, so the draft must honour them. Their presence (even an empty list)
  // means "the user has already had the questions" — skip triage and draft.
  const answersProvided = Array.isArray(req.body?.answers);
  const answers = (answersProvided ? req.body.answers : [])
    .map((a) => ({
      question: typeof a?.question === 'string' ? a.question.trim() : '',
      answer: typeof a?.answer === 'string' ? a.answer.trim() : '',
    }))
    .filter((a) => a.question && a.answer)
    .slice(0, 4);
  const answersBlock = answers.length
    ? '=== DECISIONS THE USER ALREADY MADE (treat as fixed) ===\n' +
      answers
        .map((a) => `- ${truncateForBudget(a.question, 140)} → ${truncateForBudget(a.answer, 240)}`)
        .join('\n') +
      '\n\n'
    : '';

  const stats = collectCategoryStats();
  const results = broadSearch(request);
  const category = pickPlanningCategory(request, stats);
  const context = buildPlanningContext({ kind: category, results, stats });
  // Triage only decides what to ask, so it reads a lighter context (no full
  // archive digest) — much cheaper, and it still sees conventions + names.
  const triageContext = buildPlanningContext({ kind: category, results, stats, full: false });
  const kindBlock = category
    ? `=== LIKELY CATEGORY ===\nThis plan most resembles "${category}" — its field conventions and existing names are in the context below. If ARCHIVE STRUCTURE lists a category that fits better, follow that one's style instead (say which in "thinking").\n\n`
    : '=== LIKELY CATEGORY ===\nNo category obviously fits — use ARCHIVE STRUCTURE to pick the closest style, or treat this as a brand-new section and say so in "thinking".\n\n';

  const triagePrompt = `You are the planning assistant for a worldbuilding archive. The user wants to add something NEW:

"${request}"

Work through this before you answer:
1. WHAT IS IT? Say in your head what kind of thing this is (a character, a place, an item, a race, a faction, an event…).
2. WHICH CATEGORY? Decide which archive category it belongs to, using ARCHIVE STRUCTURE below. If it straddles two categories, pick the closest and say which in your thinking.
3. WHAT'S ALREADY SETTLED, AND WHAT'S OPEN? Read the conventions and existing entries below. For each detail: if the archive settles it, it is NOT a question. If the archive is silent AND it is the user's creative call, it IS a question. Never ask about a fact you can read below.
4. ASK THE OPEN DECISIONS THAT WOULD ACTUALLY CHANGE THE DRAFT — the creative calls only the user can make: motive, tone, name, power level, scope, or which existing entries it ties to.

Ask whenever even ONE such decision exists — and for a vague creative request (e.g. "an evil character", "a new race", "a city") you MUST ask, so the draft can be built smartly around the answers. Return no questions only when the request is already specific about what it is, its role, and how it fits into the world.

Return ONLY JSON (no prose, no code fences):
{
  "thinking": "1-2 sentences: what this is, which category it fits, and the open decisions you need from the user",
  "questions": [ { "id": "q1", "question": "under 20 words — open-ended, no suggested answers", "why": "a few words" } ]
}
Ask 2-4 questions whenever any decision would shape the draft; use "questions": [] only when the request is already specific enough to draft well as-is.

Do not call any tools, do not read any files, do not describe a plan — answer immediately with the JSON object and nothing else.

${kindBlock}=== ARCHIVE CONTEXT ===
${triageContext}`;

  const prompt = `You are the planning assistant for a worldbuilding archive. The user wants to add something NEW — a character, place, race, faction, item, event, relationship, or a whole category. Work the plan the same way every time, step by step. Nothing you write is saved: this is a draft for the user to react to.

STEP 1 — WHAT IS IT, AND WHICH CATEGORY? Decide what kind of thing this is, then which archive category it belongs to (use ARCHIVE STRUCTURE below; the LIKELY CATEGORY line is a hint you may override — say which you chose in "thinking").
STEP 2 — HOW DOES THAT CATEGORY READ? Follow the category's FIELD CONVENTIONS: build the draft from the fields/sections entries in that category actually have, in the same spirit, tone, scale, and vocabulary. An entry that uses labels the world never uses is wrong.
STEP 3 — CHECK THE NEIGHBOURS AND THE EDGES. Look for a name collision (never reuse a name from EXISTING NAMES) and for how it fits: does it slot into the existing web cleanly, or clash with something established?
STEP 4 — SEPARATE CANON FROM OPEN DECISIONS. For each detail: KNOWN = the archive settles it → use it and cite the source; OPEN = the archive is silent and it is the user's creative call → do not invent it, ask (see STEP 5). Never quietly decide something and write it as established.
STEP 5 — ASK ONLY THE DECISIONS THAT WOULD CHANGE THE DRAFT. Usually 2-4, and only genuinely new ones; never repeat anything under DECISIONS THE USER ALREADY MADE, and normally use [] once the user has answered.
STEP 6 — DRAFT IT IN THE CATEGORY'S SHAPE. Use only facts from the archive (STEP 4), honour the user's answers, and keep open things open.
STEP 7 — FLAG THE RISKS AND THE SOURCES. Name real conflicts with existing entries and gaps the user still needs to decide ("risks"), and list each existing entry you drew a fact from ("sources").

Return ONLY JSON (no prose, no code fences):
{
  "thinking": "2-4 first-person sentences: what this is, which category you chose, how the category reads, and how you handled it",
  "title": "short title for this plan",
  "summary": "2-3 sentences describing the draft",
  "sections": [ { "heading": "…", "points": ["…", "…"] } ],
  "questions": [ { "id": "q1", "question": "under 20 words — open-ended, no suggested answers", "why": "…" } ],
  "sources": ["names of existing entries you took facts from"],
  "risks": ["the entry it may conflict with, or the gap to decide"]
}

HOW TO DRAFT:
- Follow the category's FIELD CONVENTIONS: give the draft the fields/sections entries in that category actually have, in the same spirit. Keep the archive's tone, scale, and vocabulary.
- Facts about the existing world must come ONLY from RELATED ENTRIES; list each entry you used in "sources". Never invent existing canon.
- Never decide, as if it were canon, anything the archive does not answer and the user has not answered. Leave it open or ask about it in "questions". Never present a guess as established.
- Attribute precisely: a detail belongs to the entry it is written under — never borrow one from a sibling entry or an overview list.
- "questions" is ONLY for a genuinely NEW decision you could not have asked earlier; once the user has answered their questions you normally use []. Ask at most 4, only where an answer really changes the draft, each under 20 words, and never repeat anything under DECISIONS THE USER ALREADY MADE.
- "risks" names concrete conflicts with existing entries or gaps the user should decide; use [] if none.
- Keep the draft compact: at most 6 sections, at most 5 points each, each point one line.
- This plan is for something NEW: give it its own new name. Never reuse a name from the EXISTING NAMES list, and never write invented facts onto an existing entry — if the user seems to want an existing entry extended instead, say so in "risks" and leave the decision to them.
- The draft MUST include the new entry's name as its own point under the first section, formatted exactly "Name: <the name>" (matching how existing entries show a Name). If the user asked you to pick the name, or gave no name, INVENT a fitting new name yourself and put it there — never leave the name blank and never ask the user for it. A monster draft with no "Name:" line is wrong.
- NEVER write a placeholder into the draft. No "[NEW NAME]", no "[OPEN — …]", no "[user to describe]", no "[TBD]", no blank "…". If you do not know a value because the archive is silent and the user has not decided it, do NOT leave a bracket in the text — either (a) leave that detail out entirely, or (b) ask about it in "questions". A bracket in the final draft is always wrong.
- Every value you commit in a section (a name, a Realm, a Location, a Threat Level…) must be either a real fact from RELATED ENTRIES or something the user stated in DECISIONS. If neither, it belongs in "questions", not as an invented answer.
- If the user's own decision text corrects your assumption (e.g. they say a thing is not a realm but part of a forest), follow the user's correction exactly and use it in the draft; never keep the assumption you had.
- Never claim anything was added to the archive; this is a proposal only.
- "risks" must name real concerns only — never write "None"; use [] when there is nothing.

Do not call any tools, do not read any files, do not describe a plan — answer immediately with the JSON object and nothing else.

=== THE USER'S REQUEST ===
${request}

${answersBlock}=== ARCHIVE CONTEXT ===
${context}`;

  try {
    // Collect the opencode session ids this request creates (triage + draft),
    // so the client can offer to delete them. Harmless for the HTTP backend,
    // which creates no sessions.
    const planSessions = [];
    opencodeSessionSink = planSessions;

    // Step 1 — triage: only on the very first pass (no answers sent yet). If
    // the model needs the user's decisions, return the questions alone and
    // draft nothing, so nothing is "already planned" before the user answers.
    if (!answersProvided) {
      const triageRaw = await askOpencodeWithFallback(triagePrompt);
      const triage = normalizeTriage(parseAiJson(triageRaw));
      if (triage.needsInput) {
        return res.json({
          needsInput: true,
          thinking: triage.thinking,
          title: '',
          summary: '',
          sections: [],
          questions: triage.questions,
          sources: [],
          risks: [],
          sessions: planSessions,
        });
      }
    }

    // Step 2 — draft: the model both reasons about the world and emits the
    // whole JSON plan. opencode uses its own configured model (the planner is
    // opencode-only — there is no HTTP fallback).
    const raw = await askOpencodeWithFallback(prompt);
    const plan = normalizePlan({ ...parseAiJson(raw), _raw: raw }, request);
    res.json({ ...plan, needsInput: false, sessions: planSessions });
  } catch (err) {
    sendAiError(res, 'plan', err);
  } finally {
    opencodeSessionSink = null;
  }
});

// Delete the opencode session(s) a plan created on disk. The planner is
// stateless, so this simply shells out to `opencode session delete <id>` for
// each id the client reports. Only meaningful for the opencode backend.
app.post('/api/ai/plan/session/delete', async (req, res) => {
  if (!plannerConfigured()) {
    return res.json({ deleted: [] });
  }
  const ids = (Array.isArray(req.body?.sessions) ? req.body.sessions : [])
    .filter((s) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s))
    .slice(0, 20);
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    try {
      await runOpencodeSessionDelete(id);
      deleted.push(id);
    } catch (err) {
      failed.push({ id, error: err.message });
    }
  }
  res.json({ deleted, failed });
});

// --- Canon Guard (local dev only) -----------------------------------------
// Report-only consistency check over the archive. With a `draft` entry it
// lints that entry's neighbourhood (live feedback while editing); without one
// it audits the whole archive. Never writes anything.
app.post('/api/canon/lint', (req, res) => {
  try {
    const world = loadWorld();
    const links = loadStoryLinks();
    const rels = loadRelationships();
    const draft = req.body && typeof req.body.draft === 'object' ? req.body.draft : null;

    if (draft) {
      const entry = {
        id: typeof draft.id === 'string' && draft.id ? draft.id : 'draft',
        category: String(draft.category || ''),
        name: String(draft.name || ''),
        subtitle: String(draft.subtitle || ''),
        description: String(draft.description || ''),
        fields: cleanFields(draft.fields),
        tags: cleanTags(draft.tags),
        createdAt: now(),
        updatedAt: now(),
      };
      const findings = lintEntry({ world, links, rels, entry });
      return res.json({ findings, scopedTo: entry.name, total: world.length });
    }

    const findings = lintArchive({ world, links, rels });
    res.json({ findings, scopedTo: null, total: world.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Flavor Finder (local dev only) ---------------------------------------
// Four modes, all pure AI (no archive data, nothing written):
//   mode "descriptors" (default): a word/phrase/action -> evocative one- or
//     two-word descriptors a novelist might reach for.
//   mode "sound": a sound source -> the sound words for it ("boom", "thud").
//   mode "scene": a scene -> the same scene rewritten with more flavor.
//   mode "transform": a scene + instructions -> the same scene reshaped to
//     order ("turn this into dialogue", "make it shorter", "add interior
//     monologue"), keeping the story intact.
// Reuses the Query Chat HTTP backend.
app.post('/api/ai/flavor', async (req, res) => {
  const rawMode = typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : 'descriptors';
  const mode =
    rawMode === 'scene'
      ? 'scene'
      : rawMode === 'transform' || rawMode === 'adjust' || rawMode === 'rewrite' || rawMode === 'convert'
        ? 'transform'
        : rawMode === 'craft' || rawMode === 'advice' || rawMode === 'design'
          ? 'craft'
          : rawMode === 'sound' || rawMode === 'sounds'
            ? 'sound'
            : 'descriptors';
  const maxLen = mode === 'scene' ? 4000 : mode === 'transform' ? 6000 : mode === 'craft' ? 8000 : 200;
  const subject = truncateForBudget(req.body?.subject, maxLen);
  const instructions = truncateForBudget(req.body?.instructions, 600);
  if (!subject) {
    return res.status(400).json({
      error:
        mode === 'scene'
          ? 'Paste a scene to enrich.'
          : mode === 'transform'
            ? 'Paste the scene you want to transform.'
            : mode === 'craft'
              ? 'Describe the transition you want help with (POV, scene change, cutting between characters, returning to MC).'
              : mode === 'sound'
                ? 'Give it a sound to name — a door slamming, flowing water, a sword drawn.'
                : 'Give it a word, phrase, or action to describe.',
    });
  }
  if (mode === 'transform' && !instructions) {
    return res.status(400).json({
      error: 'Tell it how you want the scene changed — turn it into dialogue, make it shorter, add interior monologue, and so on.',
    });
  }
  if (!aiConfigured()) {
    return res.status(500).json({
      error: 'AI is not configured. Set AI_API_KEY (or GROQ_API_KEY) on the server.',
    });
  }

  try {
    const wantFlavor = mode === 'sound' && req.body?.flavor === true;
    if (mode === 'craft') {
      const prompt = `You are a pragmatic fiction writing coach focused on scene transitions, POV changes, and cutting between characters.

User question/request:
${subject}

Return ONLY valid JSON with this exact shape:
{
  "advice": "...",
  "suggestions": ["..."],
  "design": {
    "title": "...",
    "goal": "...",
    "steps": ["..."],
    "cues": ["..."],
    "pitfalls": ["..."],
    "notes": "..."
  },
  "scene": "...",
  "note": "..."
}

Rules:
- advice: 2-4 sentences of direct, actionable advice tailored to this exact request.
- suggestions: 3-6 short, concrete ideas (each 4-12 words). Prioritize the cleanest approach for returning to the MC.
- design: give a concrete plan. steps ordered. cues = sensory/time/dialogue cues to signal the shift. pitfalls to avoid. notes = extra guidance.
- scene: write a short original example scene (150-400 words) demonstrating the exact transition. Show leaving the MC, show the other POV/scene if requested, and show returning to the MC. Clean prose, no meta commentary inside scene text.
- note: 1 short sentence.
- Prefer section breaks, soft transitions, clear POV boundaries over "time passes". Handle cases like two people talking while MC absent, switching to side scene, cutting back to MC.
- Return ONLY JSON, no prose, no code fences.`;

      const result = await askHttp(prompt, 1600);
      const raw = result.answer;
      const parsed = parseAiJson(raw) || {};
      const advice = typeof parsed.advice === 'string' ? parsed.advice.trim() : '';
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((s) => String(s || '').trim()).filter((s) => s && s.length >= 3).slice(0, 6)
        : [];
      const design = parsed.design && typeof parsed.design === 'object' ? parsed.design : {};
      if (design && typeof design === 'object') {
        if (Array.isArray(design.steps)) design.steps = design.steps.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8);
        if (Array.isArray(design.cues)) design.cues = design.cues.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8);
        if (Array.isArray(design.pitfalls)) design.pitfalls = design.pitfalls.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8);
        if (typeof design.title !== 'string') design.title = '';
        if (typeof design.goal !== 'string') design.goal = '';
        if (typeof design.notes !== 'string') design.notes = '';
      }
      const scene = typeof parsed.scene === 'string' ? parsed.scene.trim() : '';
      const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';
      return res.json({ subject, mode: 'craft', advice, suggestions, design, scene, note, raw: (advice || scene) ? '' : String(raw || '').trim(), provider: providerInfo(result) });
    }

    if (mode === 'transform') {
      const prompt = `You are a line editor for a novelist writing dark fantasy prose. Reshape the scene below so it fits the change the author asked for, while keeping the story, characters, facts, and any named things intact unless the instructions say otherwise.

=== SCENE ===
${subject}

=== HOW TO CHANGE IT ===
${instructions}

=== RULES ===
- Return the reshaped scene in "scene": apply the requested transformation (for example: convert narration into dialogue, condense a long scene, expand a summary, add interior monologue, change tense or POV) and keep the same events and characters.
- Honour the instructions exactly. If they ask for dialogue, put the action into spoken lines; if they ask for brevity, cut without losing the story; if they ask for something else, do that.
- Do NOT invent new plot or new characters that the instructions did not ask for.
- Do NOT add a title, headings, notes, or commentary inside "scene" — just the prose.
- List the notable changes you made in "descriptors" (up to 12 short phrases), and one short line in "note" on what you did.

Return ONLY JSON (no prose, no code fences):
{
  "scene": "the full transformed scene",
  "descriptors": ["short phrase", "..."],
  "note": "one short line"
}`;
      const result = await askHttp(
        prompt,
        2000,
        'low',
        {},
        AI_PROVIDERS,
        (raw) => {
          const p = parseAiJson(raw);
          const scene = typeof p?.scene === 'string' ? p.scene.trim() : '';
          return Boolean(scene);
        },
      );
      const raw = result.answer;
      const parsed = parseAiJson(raw);
      const scene = typeof parsed?.scene === 'string' && parsed.scene.trim() ? parsed.scene.trim() : '';
      const descriptors = (Array.isArray(parsed?.descriptors) ? parsed.descriptors : [])
        .map((d) => String(d || '').trim())
        .filter(Boolean)
        .slice(0, 12);
      return res.json({
        subject,
        mode,
        instructions,
        scene,
        descriptors,
        note: typeof parsed?.note === 'string' ? parsed.note.trim() : '',
        raw: scene ? '' : String(raw || '').trim(),
        provider: providerInfo(result),
      });
    }

    if (mode === 'scene') {
      const prompt = `You are a line editor for a novelist writing dark fantasy prose. Rewrite the scene below so it reads with more flavor and life — vivid, specific, sensory — while keeping every fact, action, character, and line of dialogue exactly as written. Enrich the prose; never change what happens.

=== SCENE ===
${subject}

=== RULES ===
- Return the revised scene in "scene": same events, same facts, same dialogue. Add texture and rhythm, do not invent new plot.
- Make it more interesting: stronger verbs, concrete images, varied sentence length, restraint over purple excess.
- Do NOT add a title, headings, notes, or commentary inside "scene" — just the prose.
- Keep the same point of view and tense as the input.
- List the notable one- or two-word flavor choices you used in "descriptors" (up to 12), and one short line in "note" on what you changed.

Return ONLY JSON (no prose, no code fences):
{
  "scene": "the full rewritten scene",
  "descriptors": ["one or two words", "..."],
  "note": "one short line"
}`;
      const result = await askHttp(
        prompt,
        1600,
        'low',
        {},
        AI_PROVIDERS,
        (raw) => {
          const p = parseAiJson(raw);
          const scene = typeof p?.scene === 'string' ? p.scene.trim() : '';
          return Boolean(scene);
        },
      );
      const raw = result.answer;
      const parsed = parseAiJson(raw);
      const scene = typeof parsed?.scene === 'string' && parsed.scene.trim() ? parsed.scene.trim() : '';
      const descriptors = (Array.isArray(parsed?.descriptors) ? parsed.descriptors : [])
        .map((d) => String(d || '').trim())
        .filter((d) => d && d.split(/\s+/).length <= 2)
        .slice(0, 12);
      return res.json({
        subject,
        mode,
        scene,
        descriptors,
        note: typeof parsed?.note === 'string' ? parsed.note.trim() : '',
        raw: scene ? '' : String(raw || '').trim(),
        provider: providerInfo(result),
      });
    }

    const soundMode = mode === 'sound';
    const prompt = soundMode
      ? `You are a line editor compiling the sound vocabulary of published fiction. Given a sound, return the words novelists actually set on the page for it — the ones you meet in a printed novel, not in a sound-effects catalogue or a physics textbook.

=== SUBJECT ===
"${subject}"

=== RULES ===
- Return 10-12 words, each ONE or TWO words only, no sentences.
- Order them from the plainest to the rarest: the first two or three are what any reader would predict, the last ones are the words that make a reader look up. The rare half matters most.
- The register you want: clack, clunk, jangle, whump, creak, clatter. These show the register only — do NOT return them unless they genuinely fit the subject.
- Mix the kinds writers use: onomatopoeia typed on the page, sound verbs turned into nouns ("a rattle", "a hum", "a creak"), and blunt one-word impacts.
- Spread the list: the dull one and the sharp one, the close one and the one fading away, the single hit and the continuous one.
- Never repeat a word, and never give a near-duplicate of one already given.
- Every word must be something a reader's ear could pick up — not an emotion, not a judgement, not a state.
${wantFlavor ? '- "scene": 2-4 sentences of novelistic prose that renders this sound in a scene — the character hears it, and the sound carries the weight, distance and mood of the moment. Show it, do not explain it. No commentary inside the prose.' : '- "scene": leave it empty.'}
- No multi-word descriptions, no "the sound of", no explanations, no facts about any world.

Return ONLY JSON (no prose, no code fences):
{
  "descriptors": ["one or two words", "..."],
  "note": "one short line on the character of the sound and how these read, optional",
  "scene": "${wantFlavor ? '2-4 sentences of novelistic prose' : 'leave this empty'}"
}`
      : `You are a thesaurus for a novelist writing dark fantasy prose. Given a word, phrase, or action, return evocative one- or two-word descriptors that would add flavor to a sentence — how a writer might render it rather than name it plainly.

=== SUBJECT ===
"${subject}"

=== RULES ===
- Return the single best 6-12 descriptors, each ONE or TWO words only, no sentences.
- Favour vivid, concrete, slightly unusual choices over plain synonyms (e.g. "walked slowly" -> "lumbered, shuffled, crept, drifted, trudged"). Mix movement, mood, and texture.
- Every descriptor must plausibly apply to the subject — a phrase describing a way of doing it, or a mood/quality it carries. No filler, no duplicates, no near-duplicates.
- If the subject is a noun/thing, offer words that describe how it looks, feels, moves, or what it evokes. If it is an action, offer adverbs and verbs.
- Never invent a proper noun or a fact about any world.

Return ONLY JSON (no prose, no code fences):
{
  "descriptors": ["one or two words", "..."],
  "note": "one short line on how these read, optional"
}`;
    const result = await askHttp(prompt);
    const raw = result.answer;
    const parsed = parseAiJson(raw);
    // Drop repeats and near-repeats ("crunch" / "crunching" / "crunch-grind"),
    // which read as sloppy when they land in the same list.
    const descriptors = [];
    for (const d of Array.isArray(parsed?.descriptors) ? parsed.descriptors : []) {
      const word = String(d || '').trim();
      if (!word || word.split(/\s+/).length > 2) continue;
      if (descriptors.some((k) => k === word || k.startsWith(word) || word.startsWith(k))) continue;
      descriptors.push(word);
      if (descriptors.length >= 16) break;
    }
    res.json({
      subject,
      mode,
      scene: soundMode && typeof parsed?.scene === 'string' ? parsed.scene.trim() : '',
      descriptors,
      note: typeof parsed?.note === 'string' ? parsed.note.trim() : '',
      raw: descriptors.length ? '' : String(raw || '').trim(),
      provider: providerInfo(result),
    });
  } catch (err) {
    sendAiError(res, 'flavor', err);
  }
});

// --- Legacy .doc text extraction ------------------------------------------
app.post('/api/convert/doc', async (req, res) => {
  try {
    const { data } = req.body || {};
    if (typeof data !== 'string' || !data.trim()) {
      return res.status(400).json({ error: 'Missing base64 file data.' });
    }
    let buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 file data.' });
    }
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const parts = [
      doc.getBody && doc.getBody(),
      doc.getHeaders && doc.getHeaders(),
      doc.getFootnotes && doc.getFootnotes(),
      doc.getEndnotes && doc.getEndnotes(),
      doc.getTextboxes && doc.getTextboxes(),
    ].filter((s) => typeof s === 'string' && s.trim());
    res.json({ text: parts.join('\n\n') });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Could not convert that .doc file.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[half-made-world] server listening on http://localhost:${PORT}`);
  });
}

// Exported for tests/debug tooling (requiring this module does not start the server).
module.exports = { extractKeywords, broadSearch, buildArchiveContext, buildArchiveIndex, parseRetryAfterSeconds, durationToSeconds, parseAiJson, collectCategoryStats, resolvePlanningCategory, pickPlanningCategory, buildPlanningContext, normalizePlan, normalizeTriage, splitList, providerLabel, makeProvider, buildProviderChain, askHttp };