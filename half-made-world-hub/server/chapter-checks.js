// Chapter verification fingerprints.
//
// The hub has to tell a genuine, complete chapter from a heading or a partial
// paste without shipping the chapter prose itself. This module turns the
// author's chapter files into compact word-shingle fingerprints that the client
// can match an upload against — only hashes leave the build.
const fs = require('fs');
const path = require('path');

// Chapter sources live at the repository root, one level above the hub.
const REPO_ROOT = path.join(__dirname, '..', '..');
const CHAPTER_FILES = {
  0: 'chapter-0.md',
  1: 'chapter-1.md',
  2: 'chapter-2.md',
  3: 'chapter-3.md',
};

const SHINGLE_WORDS = 6;
const MAX_SAMPLES = 600;

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hashShingle(words, start, width) {
  const shingle = words.slice(start, start + width).join(' ');
  let hash = 2166136261;
  for (let i = 0; i < shingle.length; i += 1) {
    hash ^= shingle.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildCheck(text) {
  const words = normalizeWords(text);
  const total = words.length - SHINGLE_WORDS + 1;
  if (total <= 0) return null;
  const step = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const shingles = [];
  for (let i = 0; i < total; i += step) shingles.push(hashShingle(words, i, SHINGLE_WORDS));
  return { words: words.length, shingleWords: SHINGLE_WORDS, step, shingles };
}

function buildChapterChecks() {
  const checks = {};
  for (const [chapter, file] of Object.entries(CHAPTER_FILES)) {
    try {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
      const check = buildCheck(text);
      if (check) checks[chapter] = check;
    } catch {
      /* chapter source missing — that chapter simply cannot be verified */
    }
  }
  return checks;
}

module.exports = { buildChapterChecks, normalizeWords, hashShingle, SHINGLE_WORDS };
