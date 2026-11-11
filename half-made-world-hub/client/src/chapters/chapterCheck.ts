// Chapter verification — matches an uploaded chapter against compact word
// shingle fingerprints generated from the author's chapter files (see
// server/chapter-checks.js). Only hashes are shipped, so the gate can confirm a
// full chapter without bundling prose readers should not have yet.
export interface ChapterCheck {
  words: number;
  shingleWords: number;
  step: number;
  shingles: string[];
}

export type ChapterVerdict =
  | { status: 'ok'; coverage: number }
  | { status: 'incomplete'; coverage: number }
  | { status: 'wrong-chapter'; coverage: number; actualChapter: number; actualCoverage: number }
  | { status: 'no-reference'; coverage: number };

/** Fraction of the reference chapter an upload has to contain to count as full. */
export const FULL_CHAPTER_COVERAGE = 0.9;

const SHINGLE_WORDS = 6;
const MAX_SAMPLES = 600;

export function normalizeWords(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hashShingle(words: string[], start: number, width: number): string {
  const shingle = words.slice(start, start + width).join(' ');
  let hash = 2166136261;
  for (let i = 0; i < shingle.length; i += 1) {
    hash ^= shingle.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Build a fingerprint from reference text (used by tests and tooling). */
export function buildChapterCheck(text: string): ChapterCheck | null {
  const words = normalizeWords(text);
  const total = words.length - SHINGLE_WORDS + 1;
  if (total <= 0) return null;
  const step = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const shingles: string[] = [];
  for (let i = 0; i < total; i += step) shingles.push(hashShingle(words, i, SHINGLE_WORDS));
  return { words: words.length, shingleWords: SHINGLE_WORDS, step, shingles };
}

function coverageOf(present: Set<string>, check: ChapterCheck): number {
  const total = check.shingles.length;
  if (!total) return 0;
  let hits = 0;
  for (const shingle of check.shingles) if (present.has(shingle)) hits += 1;
  return hits / total;
}

/**
 * Read the uploaded text against every known chapter and decide whether it is
 * the complete chapter the reader selected.
 */
export function verifyChapter(
  text: string,
  chapter: number,
  checks: Record<string, ChapterCheck> | null | undefined,
): ChapterVerdict {
  const check = checks?.[String(chapter)];
  if (!check) return { status: 'no-reference', coverage: 0 };

  const words = normalizeWords(text);
  const width = check.shingleWords || SHINGLE_WORDS;
  const present = new Set<string>();
  for (let i = 0; i + width <= words.length; i += 1) {
    present.add(hashShingle(words, i, width));
  }

  const coverage = coverageOf(present, check);
  if (coverage >= FULL_CHAPTER_COVERAGE) return { status: 'ok', coverage };

  let best = { chapter, coverage };
  for (const [key, other] of Object.entries(checks || {})) {
    const n = Number(key);
    if (n === chapter) continue;
    const otherCoverage = coverageOf(present, other);
    if (otherCoverage > best.coverage) best = { chapter: n, coverage: otherCoverage };
  }
  if (best.coverage >= FULL_CHAPTER_COVERAGE) {
    return {
      status: 'wrong-chapter',
      coverage,
      actualChapter: best.chapter,
      actualCoverage: best.coverage,
    };
  }
  return { status: 'incomplete', coverage };
}
