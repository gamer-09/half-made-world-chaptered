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
 * Names the chapter capitalises that match no entry name or alias are reported
 * as missing entries. That is the other half of the same bug: the gate cannot
 * reveal a thing the archive never stored, so the prose and world.json have to
 * be reconciled.
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

// Filters for the missing-entry pass. A capitalised phrase has to look like a
// name: not a sentence opener, not a field label from a reading, not a role.
const COMMON_WORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'ah', 'ahh', 'ahhh', 'alright', 'also',
  'although', 'always', 'am', 'among', 'an', 'and', 'another', 'any', 'anyone', 'anything', 'are', 'around',
  'as', 'at', 'away', 'back', 'bad', 'be', 'beautiful', 'because', 'become', 'been', 'before', 'behind',
  'being', 'below', 'beside', 'between', 'beyond', 'big', 'both', 'bring', 'brought', 'but', 'buy', 'by',
  'call', 'called', 'came', 'can', 'cannot', 'care', 'carry', 'cause', 'change', 'child', 'children', 'city',
  'close', 'cold', 'come', 'comes', 'coming', 'could', 'course', 'day', 'days', 'dear', 'did', 'different',
  'do', 'does', 'doing', 'done', 'down', 'each', 'early', 'easy', 'else', 'end', 'enough', 'even', 'ever',
  'every', 'everybody', 'everyone', 'everything', 'face', 'fact', 'family', 'far', 'feel', 'few', 'find',
  'fine', 'first', 'five', 'food', 'for', 'forever', 'found', 'four', 'from', 'full', 'get', 'getting', 'give',
  'given', 'go', 'going', 'gone', 'good', 'got', 'great', 'group', 'grow', 'had', 'half', 'hand', 'happen',
  'happy', 'hard', 'has', 'have', 'he', 'head', 'hear', 'heard', 'hello', 'help', 'her', 'here', 'herself',
  'hey', 'hi', 'high', 'him', 'himself', 'his', 'hold', 'home', 'hope', 'house', 'how', 'however', 'huge',
  'human', 'hundred', 'i', 'idea', 'if', 'important', 'in', 'inside', 'instead', 'into', 'it', 'its',
  'itself', 'job', 'just', 'keep', 'kept', 'kind', 'know', 'known', 'large', 'last', 'late', 'later', 'least',
  'left', 'less', 'let', 'life', 'light', 'like', 'likely', 'line', 'little', 'live', 'long', 'look',
  'looking', 'lot', 'love', 'low', 'made', 'make', 'making', 'man', 'many', 'may', 'maybe', 'me', 'mean',
  'might', 'mind', 'minute', 'miss', 'moment', 'money', 'month', 'more', 'morning', 'most', 'mother', 'move',
  'much', 'must', 'my', 'name', 'near', 'need', 'never', 'new', 'next', 'nice', 'night', 'no', 'none', 'nor',
  'not', 'nothing', 'now', 'number', 'of', 'off', 'often', 'oh', 'ok', 'okay', 'old', 'on', 'once', 'one',
  'only', 'open', 'or', 'order', 'other', 'ouch', 'our', 'out', 'over', 'own', 'part', 'people', 'perhaps',
  'person', 'place', 'please', 'point', 'possible', 'power', 'probably', 'problem', 'put', 'question', 'quite',
  'rather', 'reach', 'read', 'ready', 'real', 'really', 'reason', 'right', 'room', 'run', 'said', 'same',
  'saw', 'say', 'says', 'school', 'second', 'see', 'seem', 'seemed', 'seen', 'sentence', 'set', 'several',
  'she', 'should', 'show', 'side', 'since', 'small', 'so', 'some', 'somebody', 'someone', 'something',
  'sometimes', 'somewhere', 'son', 'soon', 'sort', 'sound', 'still', 'such', 'sure', 'take', 'talk', 'tell',
  'than', 'thank', 'thanks', 'that', 'the', 'their', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'thing', 'think', 'this', 'those', 'though', 'thought', 'three', 'through', 'time', 'to', 'today',
  'together', 'tomorrow', 'tonight', 'too', 'took', 'top', 'toward', 'two', 'under', 'until', 'up', 'upon',
  'us', 'use', 'used', 'very', 'want', 'was', 'way', 'we', 'well', 'went', 'were', 'what', 'when', 'where',
  'whether', 'which', 'while', 'who', 'whole', 'why', 'will', 'with', 'within', 'without', 'woman', 'word',
  'work', 'world', 'would', 'wow', 'yeah', 'year', 'years', 'yep', 'yes', 'yet', 'you', 'young', 'your',
]);

const FIELD_WORDS = new Set([
  'affinity', 'age', 'angel', 'appearance', 'circle', 'class', 'corresponding', 'element', 'gender', 'grade',
  'level', 'name', 'power', 'race', 'rank', 'realm', 'rune', 'skill', 'skills', 'star', 'stage', 'starting',
  'title', 'type',
]);

const ROLE_WORDS = new Set([
  'acolyte', 'admiral', 'apprentice', 'attendant', 'bartender', 'butler', 'captain', 'chancellor', 'chief',
  'clerk', 'commander', 'dean', 'doctor', 'elder', 'general', 'guard', 'guards', 'headmaster', 'healer',
  'instructor', 'innkeeper', 'king', 'lady', 'lieutenant', 'lord', 'madam', 'maid', 'master', 'merchant',
  'mistress', 'monitor', 'nurse', 'officer', 'prefect', 'priest', 'priestess', 'prince', 'princess',
  'principal', 'professor', 'receptionist', 'sergeant', 'servant', 'soldier', 'soldiers',
  'student', 'students', 'teacher', 'valedictorian', 'waiter', 'waitress',
]);

const STRUCTURE_WORDS = new Set([
  'afterword', 'appendix', 'book', 'chapter', 'chapters', 'contents', 'epilogue', 'foreword', 'interlude',
  'part', 'prologue', 'scene',
]);

const TITLE_RE = /^(mr|mrs|ms|miss|sir|lady|lord|princess|prince|king|queen|doctor|dr|master|mistress|madam)\.?\s+/i;
const ORDINAL_RE = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+/i;
const POSSESSIVE_RE = /['\u2019]s\b/gi;
const CONTRACTION_RE = /['\u2019](d|m|ll|re|ve|t)\b/i;

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

function normalisePhrase(value) {
  return String(value || '')
    .replace(POSSESSIVE_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every word sequence inside an entry name or alias, so "Marlock" counts as known. */
function knownPhrases(entries, rules = {}) {
  const known = new Set();
  for (const entry of entries) {
    const sources = [entry.name, ...(rules[entry.name]?.alias ?? [])];
    for (const source of sources) {
      const words = normalisePhrase(source).split(' ').filter(Boolean);
      for (let width = 1; width <= words.length; width += 1) {
        for (let i = 0; i + width <= words.length; i += 1) {
          known.add(words.slice(i, i + width).join(' '));
        }
      }
    }
  }
  return known;
}

function isKnownPhrase(key, known) {
  if (known.has(key)) return true;
  // "Mages" and "Stars" are just plurals of archive words.
  return key.endsWith('s') && known.has(key.slice(0, -1));
}

function isShouted(word) {
  return word.length > 1 && /[A-Z]/.test(word) && word === word.toUpperCase();
}

function trimCandidate(raw) {
  let phrase = String(raw || '').replace(POSSESSIVE_RE, '').replace(TITLE_RE, '').replace(ORDINAL_RE, '').trim();
  const words = phrase.split(/\s+/).filter(Boolean);
  // Reading blocks label their values: "Starting Class grade", "Race Rank".
  while (words.length && FIELD_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  phrase = words.join(' ');
  return phrase;
}

function looksLikeName(phrase) {
  const words = normalisePhrase(phrase).split(' ').filter(Boolean);
  if (!words.length) return false;
  const significant = words.filter(
    (word) =>
      !COMMON_WORDS.has(word) &&
      !FIELD_WORDS.has(word) &&
      !ROLE_WORDS.has(word) &&
      !STRUCTURE_WORDS.has(word),
  );
  // A one-word name needs one real word; a phrase needs two, so "I Look" and
  // "Hey Bella" do not become names.
  return words.length === 1 ? significant.length === 1 : significant.length >= 2;
}

/**
 * Names the chapter capitalises that no entry name or alias covers.
 *
 * Multi-word names count from one mention. Single words need a second mention
 * or a reading `Name:` line, so "Infront" and stray sentence openers stay out.
 * A shorter candidate is dropped when a longer one starts with it, so
 * "Mr Grin" does not produce both "Grin" and "Grin Holly".
 */
function unarchivedNames(entries, text, rules = {}) {
  const known = knownPhrases(entries, rules);
  const found = new Map();

  const add = (raw, at, named = false) => {
    const rawKey = normalisePhrase(String(raw || '').replace(POSSESSIVE_RE, ''));
    if (rawKey && isKnownPhrase(rawKey, known)) return;
    const phrase = trimCandidate(raw);
    if (!phrase || !looksLikeName(phrase)) return;
    const key = normalisePhrase(phrase);
    if (!key || isKnownPhrase(key, known)) return;
    const record = found.get(key) ?? { name: phrase, count: 0, at, named: false };
    record.count += 1;
    record.named = record.named || named;
    if (at < record.at) record.at = at;
    found.set(key, record);
  };

  // Reading blocks spell names out, so trust them even on one mention.
  for (const match of text.matchAll(/^[ \t]*Name:[ \t]*(.+)$/gm)) {
    add(match[1].trim(), match.index, true);
  }

  const tokens = [];
  const re = /[A-Za-z][A-Za-z'\u2019-]*/g;
  let match;
  while ((match = re.exec(text))) tokens.push({ word: match[0], at: match.index });

  // A word the prose also writes in lowercase is a common word, not a name.
  const lowercaseWords = new Set(
    tokens.filter((token) => /^[a-z]/.test(token.word)).map((token) => token.word.toLowerCase()),
  );

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!/^[A-Z]/.test(token.word) || isShouted(token.word) || CONTRACTION_RE.test(token.word)) continue;

    const before = text.slice(0, token.at).replace(/[ \t]+$/, '');
    const boundary = before.replace(/["'\u201c\u201d\u2018\u2019\]]+$/, '');
    const prev = boundary.slice(-1);
    const sentenceStart = !prev || /[.!?\r\n]/.test(prev);

    const parts = [token.word];
    let j = i + 1;
    while (j < tokens.length) {
      const next = tokens[j];
      if (!/^[A-Z]/.test(next.word) || isShouted(next.word) || CONTRACTION_RE.test(next.word)) break;
      const gap = text.slice(tokens[j - 1].at + tokens[j - 1].word.length, next.at);
      // Never join across a line break: reading blocks stack fields one per line.
      if (!/^[ \t'\u2019-]*$/.test(gap)) break;
      parts.push(next.word);
      j += 1;
    }

    const singleAtStart = sentenceStart && parts.length === 1;
    if (singleAtStart && lowercaseWords.has(token.word.toLowerCase())) {
      i = j - 1;
      continue;
    }
    if (!sentenceStart || parts.length === 1) add(parts.join(' '), token.at);
    i = j - 1;
  }

  const keys = [...found.keys()];
  return keys
    .filter((key) => !keys.some((other) => other !== key && other.startsWith(key + ' ')))
    .map((key) => found.get(key))
    .filter((record) => record.named || record.name.split(' ').length > 1 || record.count >= 2)
    .sort((a, b) => a.at - b.at)
    .map((record) => ({ name: record.name, mentions: record.count }));
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
 * not reveal at this chapter, names with no archive entry, and partial-name
 * candidates for review.
 */
function auditChapter(entries, text, rules = {}, chapter = null) {
  const context = textContext(text);
  const passes = new Map(PASSES.map((width) => [width, []]));
  const longer = [];
  const missing = [];
  const partials = [];
  const unarchived = unarchivedNames(entries, text, rules);

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

  return { chapter, words: context.count, passes, longer, missing, partials, unarchived };
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
  if (result.unarchived.length) {
    console.log('  named in this chapter but missing from the archive:');
    for (const r of result.unarchived) {
      console.log(`    - ${r.name} (${r.mentions} mention${r.mentions === 1 ? '' : 's'})`);
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
  let locked = 0;
  let unarchived = 0;

  for (const chapter of chapters) {
    const text = readChapter(chapter);
    if (!text) {
      console.log(`Chapter ${chapter} — no source file, skipped\n`);
      continue;
    }
    const result = auditChapter(entries, text, rules, chapter);
    report(result);
    locked += result.missing.length;
    unarchived += result.unarchived.length;
  }

  if (check && locked) {
    console.error(`${locked} entr${locked === 1 ? 'y is' : 'ies are'} named by a chapter but still locked.`);
  }
  if (check && unarchived) {
    console.error(
      `${unarchived} name${unarchived === 1 ? ' is' : 's are'} used by a chapter but missing from the archive.`,
    );
  }
  if (check && (locked || unarchived)) {
    process.exitCode = 1;
    return;
  }
  if (check) console.log('All named entries are revealed, and every name has an archive entry.');
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
  unarchivedNames,
  knownPhrases,
  PASSES,
  CHAPTER_FILES,
};
