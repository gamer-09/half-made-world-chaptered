const fs = require('fs');
const path = require('path');
const seed = require('./seed');
const relSeed = require('./seed-relationships');
const linkSeed = require('./seed-story-links');
const { scheduleSync } = require('./pipeline');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'world.json');
const REL_FILE = path.join(DATA_DIR, 'relationships.json');
const LINK_FILE = path.join(DATA_DIR, 'story-links.json');
const CODES_FILE = path.join(DATA_DIR, 'chapter-codes.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), 'utf-8');
  }
  if (!fs.existsSync(REL_FILE)) {
    fs.writeFileSync(REL_FILE, JSON.stringify(relSeed, null, 2), 'utf-8');
  }
  if (!fs.existsSync(LINK_FILE)) {
    fs.writeFileSync(LINK_FILE, JSON.stringify(linkSeed, null, 2), 'utf-8');
  }
  if (!fs.existsSync(CODES_FILE)) {
    fs.writeFileSync(CODES_FILE, JSON.stringify({}, null, 2), 'utf-8');
  }
}

function readJson(file, resetFn) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[storage] Failed to parse ${path.basename(file)}, reseeding:`, err.message);
    return resetFn();
  }
}

// --- Entries --------------------------------------------------------------
function loadWorld() {
  ensureDataFile();
  return readJson(DATA_FILE, resetWorld);
}

function saveWorld(world) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(world, null, 2), 'utf-8');
  scheduleSync('entries updated');
}

function resetWorld() {
  saveWorld(seed);
  return seed;
}

// --- Relationships --------------------------------------------------------
function loadRelationships() {
  ensureDataFile();
  return readJson(REL_FILE, resetRelationships);
}

function saveRelationships(list) {
  ensureDataFile();
  fs.writeFileSync(REL_FILE, JSON.stringify(list, null, 2), 'utf-8');
  scheduleSync('relationships updated');
}

function resetRelationships() {
  saveRelationships(relSeed);
  return relSeed;
}

// --- Story links ----------------------------------------------------------
function loadStoryLinks() {
  ensureDataFile();
  return readJson(LINK_FILE, resetStoryLinks);
}

function saveStoryLinks(list) {
  ensureDataFile();
  fs.writeFileSync(LINK_FILE, JSON.stringify(list, null, 2), 'utf-8');
  scheduleSync('story links updated');
}

function resetStoryLinks() {
  saveStoryLinks(linkSeed);
  return linkSeed;
}

// --- Chapter codes --------------------------------------------------------
function loadChapterCodes() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(CODES_FILE, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (err) {
    console.error('[storage] Failed to parse chapter-codes.json, resetting:', err.message);
  }
  return {};
}

function saveChapterCodes(map) {
  ensureDataFile();
  fs.writeFileSync(CODES_FILE, JSON.stringify(map || {}, null, 2), 'utf-8');
  try {
    const { scheduleSync } = require('./pipeline');
    scheduleSync('chapter codes updated');
  } catch {
    /* pipeline unavailable — skip sync */
  }
}

module.exports = {
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
  DATA_FILE,
  REL_FILE,
  LINK_FILE,
  CODES_FILE,
};
