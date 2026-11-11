/**
 * Auto-sync pipeline — keeps every derived artifact in step with the live data.
 *
 * Whenever the app adds, edits, or deletes data (entries, relationships, or
 * story links), storage.js calls scheduleSync(). This regenerates:
 *   - server/seed.js, seed-story-links.js, seed-relationships.js  (from data)
 *   - client/public/snapshot.json                                 (for the client)
 *
 * Only files whose bytes actually change are rewritten. Calls are debounced so
 * a burst of edits coalesces into one pass. Safe no-op if a target is missing.
 *
 * Run it by hand with: npm run sync:all   (or: node server/pipeline.js)
 */
const fs = require('fs');
const path = require('path');
const { generateSeeds } = require('./seed-generator');

const SERVER_DIR = __dirname;
const APP_DIR = path.resolve(SERVER_DIR, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');
const SNAPSHOT_FILE = path.join(APP_DIR, 'client', 'public', 'snapshot.json');

const SEED_TARGETS = [
  { file: path.join(SERVER_DIR, 'seed.js'), key: 'seed' },
  { file: path.join(SERVER_DIR, 'seed-story-links.js'), key: 'links' },
  { file: path.join(SERVER_DIR, 'seed-relationships.js'), key: 'rels' },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeIfChanged(file, content) {
  let existing = null;
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

// Regenerate every derived artifact from the on-disk data. Returns the list of
// file names that actually changed.
function readJsonOptional(file, fallback) {
  try {
    return readJson(file);
  } catch {
    return fallback;
  }
}

function syncAll() {
  const entries = readJson(path.join(DATA_DIR, 'world.json'));
  const rels = readJson(path.join(DATA_DIR, 'relationships.json'));
  const links = readJson(path.join(DATA_DIR, 'story-links.json'));
  const chapterCodes = readJsonOptional(path.join(DATA_DIR, 'chapter-codes.json'), {});

  const generated = generateSeeds({ world: entries, links, rels });
  const changed = [];
  for (const t of SEED_TARGETS) {
    if (writeIfChanged(t.file, generated[t.key])) changed.push(path.basename(t.file));
  }

  const snapshot = { entries, relationships: rels, storyLinks: links, chapterCodes };
  if (writeIfChanged(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2))) changed.push('snapshot.json');

  return changed;
}

let timer = null;
let pendingTag = '';

// Debounced auto-sync. Call after any data write; bursts coalesce into one pass.
function scheduleSync(tag = 'data changed') {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      const changed = syncAll();
      if (changed.length) console.log(`[sync] ${tag} → ${changed.join(', ')}`);
    } catch (err) {
      console.error('[sync] failed:', err.message);
    }
  }, 400);
  if (timer.unref) timer.unref();
}

if (require.main === module) {
  try {
    const changed = syncAll();
    console.log(changed.length ? 'Updated: ' + changed.join(', ') : 'Already in sync.');
  } catch (err) {
    console.error('Sync failed:', err.message);
    process.exit(1);
  }
}

module.exports = { syncAll, scheduleSync };
