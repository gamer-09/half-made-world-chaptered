// Chapter gate — turns the full archive into the slice a reader has earned.
//
// Everything is computed client-side from the bundled snapshot, so the same
// gate works in the dev server and in the view-only GitHub Pages build.
import type { Entry, Relationship, StoryLink } from '../types';
import { ENTRY_RULES, LOCKED, type EntryRule } from './manifest';
import { BUNDLED_TEXT } from './chapterText';

export interface GateConfig {
  /** Highest unlocked chapter, inclusive. Infinity means "reveal everything". */
  chapter: number;
  /** Extra chapter prose keyed by chapter number (from uploads/paste). */
  uploaded: Record<number, string>;
  /** When true the gate is bypassed entirely (author mode). */
  off?: boolean;
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

const normName = (s: string) => s.replace(/[\u2014\u2013]/g, '-').replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-sensitive match of an exact name inside chapter prose. */
function mentions(text: string, name: string): boolean {
  const n = normName(name);
  if (!n) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

interface ChapterText {
  n: number;
  text: string;
}

/** Every chapter text the reader has unlocked, bundled + uploaded. */
export function unlockedTexts(config: GateConfig): ChapterText[] {
  const out: ChapterText[] = [];
  for (const [k, text] of Object.entries(BUNDLED_TEXT)) out.push({ n: Number(k), text });
  for (const [k, text] of Object.entries(config.uploaded || {})) {
    if (text && text.trim()) out.push({ n: Number(k), text });
  }
  return out.filter((c) => c.n <= config.chapter).sort((a, b) => a.n - b.n);
}

/** The chapter an entry first becomes visible, or Infinity if never. */
export function entryRevealAt(name: string, config: GateConfig): number {
  const rule = ENTRY_RULES[name];
  if (rule) return rule.at;
  let earliest = Infinity;
  for (const { n, text } of unlockedTexts(config)) {
    if (mentions(text, name)) earliest = Math.min(earliest, n);
  }
  return earliest;
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

function gateEntry(entry: Entry, config: GateConfig): GateEntryResult {
  const at = entryRevealAt(entry.name, config);
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

  if (config.off || config.chapter === Infinity) {
    return {
      ...data,
      stats: {
        chapter: config.chapter,
        totalEntries,
        visibleEntries: totalEntries,
        lockedEntries: 0,
        hiddenFields: 0,
        visibleCategories: totalCategories,
        totalCategories,
      },
    };
  }

  const entries: Entry[] = [];
  const hiddenLower: string[] = [];
  let hiddenFields = 0;

  for (const entry of data.entries) {
    const { entry: gated, hiddenFields: hf } = gateEntry(entry, config);
    if (gated) {
      entries.push(gated);
      hiddenFields += hf;
    } else {
      hiddenLower.push(entry.name.toLowerCase());
    }
  }

  const visible = new Set(entries.map((e) => e.name));
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

/** The chapter an entry is revealed in, for locked teasers in the UI. */
export function unlockChapterFor(name: string, config: GateConfig): number {
  return entryRevealAt(name, config);
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
