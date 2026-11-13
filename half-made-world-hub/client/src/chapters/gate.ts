// Chapter gate — turns the full archive into the slice a reader has uploaded.
//
// Nothing is revealed up front. The only way in is to upload a chapter: its
// prose is scanned for entry names, and the curated manifest records what a
// mention alone should not leak. Everything is computed client-side from the
// bundled snapshot, so the same gate works in the dev server and in the
// view-only GitHub Pages build.
//
// The scan is word for word, in four passes by name length (see
// server/chapter-audit.js, which runs the same rules over the chapter files):
// one-word names, two-word names, three-word names, four-word names, then a
// full-phrase pass for longer names. Words are normalized on both sides, so
// "D-grade" in prose matches the entry "D Grade" and "6 Pillars" matches
// "Six Pillars". A name still has to be capitalized like a proper noun, so the
// common noun "seal" never reveals the skill entry "Seal".
import type { Entry, Relationship, StoryLink } from '../types';
import { ENTRY_RULES, LOCKED, type EntryRule } from './manifest';

export interface GateConfig {
  /** Highest uploaded chapter, inclusive. -1 means nothing uploaded yet. */
  chapter: number;
  /** Chapter prose the reader supplied, keyed by chapter number. */
  uploaded: Record<number, string>;
}

export interface GateStats {
  chapter: number;
  totalEntries: number;
  visibleEntries: number;
  lockedEntries: number;
  hiddenFields: number;
  /** Categories that currently have at least one visible entry. */
  visibleCategories: number;
  totalCategories: number;
}

export interface GatedArchive {
  entries: Entry[];
  relationships: Relationship[];
  storyLinks: StoryLink[];
  stats: GateStats;
}

export const EMPTY_GATE: GateConfig = { chapter: -1, uploaded: {} };

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'no', 'not', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with',
]);

// Digits and ordinals become words so "6 Pillars" and "Six Pillars" agree.
const NUMERALS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
  '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
  '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
  '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth',
};

const MAX_PHRASE_WORDS = 8;
const MAX_POSITIONS = 8;

function splitWords(text: string): string[] {
  return String(text || '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

interface TextContext {
  words: string[];
  numbers: boolean[];
  capitals: boolean[];
  /** Phrase → the first few places it starts in the prose. */
  index: Map<string, number[]>;
  count: number;
}

const textCache = new Map<string, TextContext>();

function textContext(text: string): TextContext {
  const cached = textCache.get(text);
  if (cached) return cached;

  const raw = splitWords(text);
  const words: string[] = [];
  const numbers: boolean[] = [];
  const capitals: boolean[] = [];
  for (const token of raw) {
    const lower = token.toLowerCase();
    const numeral = NUMERALS[lower];
    words.push(numeral ?? lower);
    numbers.push(numeral !== undefined);
    capitals.push(/^[A-Z]/.test(token));
  }

  const index = new Map<string, number[]>();
  for (let width = 1; width <= MAX_PHRASE_WORDS; width += 1) {
    for (let i = 0; i + width <= words.length; i += 1) {
      const key = words.slice(i, i + width).join(' ');
      const at = index.get(key);
      if (!at) index.set(key, [i]);
      else if (at.length < MAX_POSITIONS) at.push(i);
    }
  }

  const context: TextContext = {
    words,
    numbers,
    capitals,
    index,
    count: words.length,
  };
  // Uploaded chapters are large; keep the cache to the ones in play.
  if (textCache.size >= 8) textCache.clear();
  textCache.set(text, context);
  return context;
}

interface PreparedName {
  words: string[];
  /** Index of the first word that is not a stopword, or -1. */
  capIndex: number;
  /** True when that word is capitalized in the entry name. */
  requireCapital: boolean;
}

function prepareName(name: string): PreparedName {
  const raw = splitWords(name);
  const words: string[] = [];
  let capIndex = -1;
  let requireCapital = false;
  for (let i = 0; i < raw.length; i += 1) {
    const lower = raw[i].toLowerCase();
    const numeral = NUMERALS[lower];
    words.push(numeral ?? lower);
    if (capIndex === -1 && !STOPWORDS.has(words[i])) {
      capIndex = i;
      // A digit ("3rd") has no case; a lowercase word sets no expectation.
      requireCapital = numeral === undefined && /^[A-Z]/.test(raw[i]);
    }
  }
  return { words, capIndex, requireCapital };
}

/** True when the prose names this entry, word for word, as a proper noun. */
function mentions(text: string, name: string): boolean {
  const prepared = prepareName(name);
  if (!prepared.words.length) return false;
  const context = textContext(text);
  const at = context.index.get(prepared.words.join(' '));
  if (!at) return false;
  if (!prepared.requireCapital) return true;
  return at.some(
    (start) => context.numbers[start + prepared.capIndex] || context.capitals[start + prepared.capIndex],
  );
}


interface ChapterText {
  n: number;
  text: string;
}

/** Every chapter text the reader has uploaded, up to the highest chapter. */
export function unlockedTexts(config: GateConfig): ChapterText[] {
  const out: ChapterText[] = [];
  for (const [k, text] of Object.entries(config.uploaded || {})) {
    const n = Number(k);
    if (!Number.isFinite(n) || n > config.chapter) continue;
    if (text && text.trim()) out.push({ n, text });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** The chapter an entry first becomes visible, or Infinity if never. */
function revealAt(name: string, texts: ChapterText[]): number {
  const rule = ENTRY_RULES[name];
  if (rule && typeof rule.at === 'number') return rule.at;
  const candidates = [name, ...(rule?.alias ?? [])];
  let earliest = Infinity;
  for (const { n, text } of texts) {
    if (candidates.some((candidate) => mentions(text, candidate))) earliest = Math.min(earliest, n);
  }
  return earliest;
}

/** The chapter an entry first becomes visible, or Infinity if never. */
export function entryRevealAt(name: string, config: GateConfig): number {
  return revealAt(name, unlockedTexts(config));
}

function fieldRevealAt(rule: EntryRule | undefined, entryAt: number, label: string): number {
  if (rule?.lock?.includes(label)) return LOCKED;
  if (rule?.fields) return rule.fields[label] ?? LOCKED;
  return entryAt;
}

interface GateEntryResult {
  entry: Entry | null;
  hiddenFields: number;
}

function gateEntry(entry: Entry, config: GateConfig, texts: ChapterText[]): GateEntryResult {
  const at = revealAt(entry.name, texts);
  if (config.chapter < at) return { entry: null, hiddenFields: 0 };

  const rule = ENTRY_RULES[entry.name];
  const subtitleAt = rule?.subtitle ?? at;
  const descAt = rule?.desc ?? at;
  const subtitleLocked = config.chapter < subtitleAt;
  const descLocked = config.chapter < descAt;

  let hiddenFields = 0;
  const fields = (entry.fields || []).map((f) => {
    const u = fieldRevealAt(rule, at, f.label);
    if (config.chapter < u) {
      hiddenFields += 1;
      return { label: f.label, value: '', locked: true, unlocksChapter: u };
    }
    return f;
  });

  return {
    hiddenFields,
    entry: {
      ...entry,
      subtitle: subtitleLocked ? '' : entry.subtitle,
      subtitleUnlocksChapter: subtitleLocked ? subtitleAt : undefined,
      lockedSubtitle: subtitleLocked || undefined,
      description: descLocked ? '' : entry.description,
      descriptionUnlocksChapter: descLocked ? descAt : undefined,
      lockedDescription: descLocked || undefined,
      fields,
      lockedFieldCount: hiddenFields || undefined,
      unlocksChapter: at,
    },
  };
}

/** True when a link endpoint names an entry the reader cannot see yet. */
function makeEndpointHidden(hiddenLower: string[]): (name: string) => boolean {
  return (name: string) => {
    const n = name.toLowerCase().trim();
    if (!n) return false;
    for (const h of hiddenLower) {
      if (h === n || h.startsWith(n + ' ') || h.startsWith(n + '(') || h.startsWith(n + '-')) return true;
    }
    return false;
  };
}

export function applyGate(
  data: { entries: Entry[]; relationships: Relationship[]; storyLinks: StoryLink[] },
  config: GateConfig,
): GatedArchive {
  const totalEntries = data.entries.length;
  const totalCategories = new Set(data.entries.map((e) => e.category)).size;
  const texts = unlockedTexts(config);

  const entries: Entry[] = [];
  const hiddenLower: string[] = [];
  let hiddenFields = 0;

  for (const entry of data.entries) {
    const { entry: gated, hiddenFields: hf } = gateEntry(entry, config, texts);
    if (gated) {
      entries.push(gated);
      hiddenFields += hf;
    } else {
      hiddenLower.push(entry.name.toLowerCase());
    }
  }

  const endpointHidden = makeEndpointHidden(hiddenLower);
  const keep = (a: string, b: string) => !endpointHidden(a) && !endpointHidden(b);

  const relationships = data.relationships.filter((r) => keep(r.source, r.target));
  const storyLinks = data.storyLinks.filter((l) => keep(l.source, l.target));

  return {
    entries,
    relationships,
    storyLinks,
    stats: {
      chapter: config.chapter,
      totalEntries,
      visibleEntries: entries.length,
      lockedEntries: totalEntries - entries.length,
      hiddenFields,
      visibleCategories: new Set(entries.map((e) => e.category)).size,
      totalCategories,
    },
  };
}

// --- Active gate ----------------------------------------------------------
// The snapshot loader reads this so every consumer (browse, maps, chat search)
// sees the same gated slice without threading config through every call.
let active: GateConfig | null = null;

export function setActiveGate(config: GateConfig | null): void {
  active = config;
}

export function getActiveGate(): GateConfig | null {
  return active;
}
