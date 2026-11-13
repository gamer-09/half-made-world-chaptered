/**
 * Chapter audit — checks a chapter file word for word against the archive.
 *
 * The chapter gate reveals an entry only when a chapter actually names it, so
 * the manifest has to agree with the prose. This tool reads a chapter and every
 * entry name and runs the same four passes the gate uses:
 *
 *   1-word names   ("Virtue", "Griffen")
 *   2-word names   ("D Grade")
 *   3-word names   ("Eva Aldermere Divina")
 *   4-word names   ("3rd Circle Rune Star")
 *   longer names   matched as a full phrase ("The Six Pillars of Angels")
 *
 * Matching is on normalized words, so "D-grade" in prose matches the entry
 * "D Grade" and "6 Pillars" matches "Six Pillars". A name counts only when the
 * chapter capitalizes it the way a proper noun is capitalized (its first
 * meaningful word is capital in the prose), so the common noun "seal" does not
 * reveal the skill entry "Seal".
 *
 * For each pass it reports how many entries the chapter names and, using the
 * client manifest, how many of those the chapter actually reveals. Manifest
 * aliases count as the chapter naming the entry, so "Starfruit" reveals
 * "Angel Sustenance". Pass `--check` to exit non-zero when a named entry is
 * still locked at or before the chapter it appears in — the bug this tool
 * exists to catch.
 *
 * Partial name matches ("Aetherblade Lord" inside "Aetherblade Lord Angel")
 * are reported separately for review: add an alias in the manifest, or leave
 * the entry locked if the prose only brushes past it.
 *
 * Run: node server/chapter-audit.js [chapter ...] [--check]
 */
const fs = require('fs');
const path = require('path');

const SERVER_DIR = __dirname;
const HUB_DIR = path.resolve(SERVER_DIR, '..');
const REPO_ROOT = path.resolve(HUB_DIR, '..');
const WORLD_FILE = path.join(SERVER_DIR, 'data', 'world.json');
const MANIFEST_FILE = path.join(HUB_DIR, 'client', 'src', 'chapters', 'manifest.ts');

const CHAPTER_FILES = {
  0: 'chapter-0.md',
  1: 'chapter-1.md',
  2: 'chapter-2.md',
  3: 'chapter-3.md',
};

const PASSES = [1, 2, 3, 4];
const MAX_PHRASE_WORDS = 8;
const MAX_POSITIONS = 8;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'no', 'not', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with',
]);

// Digits and ordinals become words so "6 Pillars" and "Six Pillars" agree.
const NUMERALS = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
  11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
  16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen', 20: 'twenty',
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
  '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth',
};

function splitWords(text) {
  return String(text || '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Split prose into lowercase match words plus the case data the matcher needs. */
function prepareText(text) {
  const raw = splitWords(text);
  const words = [];
  const numbers = [];
  const capitals = [];
  for (const token of raw) {
    const lower = token.toLowerCase();
    const value = NUMERALS[lower];
    words.push(value ?? lower);
    numbers.push(value !== undefined);
    capitals.push(/^[A-Z]/.test(token));
  }
  return { words, numbers, capitals, count: words.length };
}

const textCache = new Map();

function textContext(text) {
  let context = textCache.get(text);
  if (context) return context;
  const prepared = prepareText(text);
  const index = new Map();
  for (let width = 1; width <= MAX_PHRASE_WORDS; width += 1) {
    for (let i = 0; i + width <= prepared.count; i += 1) {
      const key = prepared.words.slice(i, i + width).join(' ');
      const at = index.get(key);
      if (!at) index.set(key, [i]);
      else if (at.length < MAX_POSITIONS) at.push(i);
    }
  }
  context = { ...prepared, index };
  if (textCache.size >= 8) textCache.clear();
  textCache.set(text, context);
  return context;
}

/** Split an entry name into match words and decide whether case matters. */
function prepareName(name) {
  const raw = splitWords(name);
  const words = [];
  const numbers = [];
  let capIndex = -1;
  let requireCapital = false;
  for (let i = 0; i < raw.length; i += 1) {
    const lower = raw[i].toLowerCase();
    const value = NUMERALS[lower];
    words.push(value ?? lower);
    numbers.push(value !== undefined);
    if (capIndex === -1 && !STOPWORDS.has(words[i])) {
      capIndex = i;
      // A digit ("3rd") has no case; a lowercase word sets no expectation.
      requireCapital = !numbers[i] && /^[A-Z]/.test(raw[i]);
    }
  }
  return { words, capIndex, requireCapital };
}

/** True when the chapter contains this name as a capitalised phrase. */
function nameInText(preparedName, context) {
  if (!preparedName.words.length) return false;
  const at = context.index.get(preparedName.words.join(' '));
  if (!at) return false;
  if (!preparedName.requireCapital) return true;
  const offset = preparedName.capIndex;
  return at.some((start) => context.numbers[start + offset] || context.capitals[start + offset]);
}

function hasOnlyStopwords(words) {
  return words.every((word) => STOPWORDS.has(word));
}

/** Longest 2..4-word leading slice of an entry name that the chapter contains. */
function partialMatch(preparedName, context) {
  const words = preparedName.words;
  const longest = Math.min(4, words.length - 1);
  for (let width = longest; width >= 2; width -= 1) {
    const slice = words.slice(0, width);
    if (!context.index.has(slice.join(' ')) || hasOnlyStopwords(slice)) continue;
    return { phrase: slice.join(' '), width };
  }
  return null;
}

/** Pull ENTRY_RULES out of the client manifest and evaluate its literals. */
function loadManifestRules(file = MANIFEST_FILE) {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('export const ENTRY_RULES');
  if (start === -1) throw new Error('ENTRY_RULES not found in manifest');
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n};', open);
  if (open === -1 || end === -1) throw new Error('ENTRY_RULES object is not terminated as expected');
  const body = source.slice(open, end + 2).replace(/\bLOCKED\b/g, '9999');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${body});`)();
}

function revealAt(rule) {
  if (rule && typeof rule.at === 'number') return rule.at;
  return Infinity;
}

/**
 * Compare every entry name against one chapter text.
 *
 * Returns exact matches grouped by name width, the matches the manifest does
 * not reveal at this chapter, and partial-name candidates for review.
 */
function auditChapter(entries, text, rules = {}, chapter = null) {
  const context = textContext(text);
  const passes = new Map(PASSES.map((width) => [width, []]));
  const longer = [];
  const missing = [];
  const partials = [];

  for (const entry of entries) {
    const name = prepareName(entry.name);
    if (!name.words.length) continue;

    const rule = rules[entry.name];
    const revealedAt = revealAt(rule);
    const visible = chapter === null || revealedAt <= chapter;
    // A manifest alias (e.g. "starfruit" for Angel Sustenance) counts as the
    // chapter naming the entry, the same way the gate treats it.
    const candidates = [entry.name, ...(rule?.alias ?? [])];
    const matched = candidates.some((candidate) => nameInText(prepareName(candidate), context));

    if (matched) {
      const record = {
        name: entry.name,
        category: entry.category,
        width: name.words.length,
        revealedAt,
        visible,
      };
      if (name.words.length <= 4) passes.get(name.words.length).push(record);
      else longer.push(record);
      if (!visible) missing.push(record);
      continue;
    }

    if (chapter !== null && revealedAt <= chapter) continue;
    const partial = partialMatch(name, context);
    if (!partial || partial.width / name.words.length < 2 / 3) continue;
    partials.push({
      name: entry.name,
      category: entry.category,
      phrase: partial.phrase,
      width: partial.width,
      nameWords: name.words.length,
    });
  }

  return { chapter, words: context.count, passes, longer, missing, partials };
}

function loadEntries() {
  return JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
}

function readChapter(chapter) {
  const file = CHAPTER_FILES[chapter];
  if (!file) return null;
  try {
    return fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

function report(result) {
  console.log(`Chapter ${result.chapter} — ${result.words.toLocaleString()} words`);
  for (const width of PASSES) {
    const records = result.passes.get(width);
    const shown = records.filter((r) => r.visible).length;
    const mark = shown === records.length ? '' : `  MISSING ${records.length - shown}`;
    console.log(`  ${width}-word names: ${records.length} named, ${shown} revealed${mark}`);
  }
  if (result.longer.length) {
    const shown = result.longer.filter((r) => r.visible).length;
    const mark = shown === result.longer.length ? '' : `  MISSING ${result.longer.length - shown}`;
    console.log(`  longer names:   ${result.longer.length} named, ${shown} revealed${mark}`);
  }
  if (result.missing.length) {
    console.log('  named in this chapter but still locked:');
    for (const r of result.missing) {
      const at = Number.isFinite(r.revealedAt) ? `at ${r.revealedAt}` : 'no rule';
      console.log(`    - ${r.name} [${r.category}] (${r.width} words, ${at})`);
    }
  }
  if (result.partials.length) {
    console.log('  partial-name candidates (add an alias or a rule if the chapter names them):');
    for (const p of result.partials) {
      console.log(`    - ${p.name} [${p.category}] ← "${p.phrase}" (${p.width}/${p.nameWords} words)`);
    }
  }
  console.log('');
}

function main(argv) {
  const check = argv.includes('--check');
  const requested = argv
    .filter((arg) => !arg.startsWith('--'))
    .map((arg) => Number(arg))
    .filter((n) => Number.isInteger(n) && n in CHAPTER_FILES);
  const chapters = requested.length ? requested : Object.keys(CHAPTER_FILES).map(Number);

  const entries = loadEntries();
  const rules = loadManifestRules();
  let failures = 0;

  for (const chapter of chapters) {
    const text = readChapter(chapter);
    if (!text) {
      console.log(`Chapter ${chapter} — no source file, skipped\n`);
      continue;
    }
    const result = auditChapter(entries, text, rules, chapter);
    report(result);
    failures += result.missing.length;
  }

  if (check && failures) {
    console.error(`${failures} entr${failures === 1 ? 'y is' : 'ies are'} named by a chapter but still locked.`);
    process.exitCode = 1;
    return;
  }
  if (check) console.log('All named entries are revealed by the chapter that names them.');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  auditChapter,
  loadManifestRules,
  prepareText,
  prepareName,
  nameInText,
  textContext,
  partialMatch,
  PASSES,
  CHAPTER_FILES,
};
