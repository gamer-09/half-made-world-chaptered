// Chapter gate — curated reveal manifest.
//
// The archive is written ahead of the story. This manifest records what each
// chapter actually puts on the page, so the hub can show a reader only the
// entries and details their chapters have earned. Anything not yet reached is
// rendered as "locked" instead of being spilled early.
//
// Rule shape (per entry, keyed by the archive entry's exact name):
//   at        chapter the entry becomes visible at all
//   subtitle  chapter the one-line subtitle appears (default: `at`)
//   desc      chapter the description appears (default: `at`)
//   fields    { fieldLabel: chapter } — when `fields` is present, ONLY the
//             listed fields are ever revealed; anything unlisted stays locked
//   lock      field labels that are locked no matter the chapter
//   alias     extra strings that count as naming this entry in chapter text
//
// Anything NOT listed here is revealed automatically if a chapter's text
// names it (see gate.ts) — the manifest exists to hold back the details a
// mention alone should not leak.

// ASCII/markdown aliases used here are not a general-purpose name resolver for every nickname the reader might imagine; they exist only so that a curated entry can get an alias when the chapter prose's own wording is not the exact canonical name. When there is ambiguity the canonical full name is the documented entry; the alias is a convenience, not a second identity.

/** Sentinel chapter number: "not revealed by any chapter so far". */
export const LOCKED = 9999;

export interface ChapterMeta {
  number: number;
  title: string;
  blurb: string;
}

export interface EntryRule {
  at?: number;
  subtitle?: number;
  desc?: number;
  fields?: Record<string, number>;
  lock?: string[];
  alias?: string[];
}

export const CHAPTERS: ChapterMeta[] = [
  {
    number: 0,
    title: 'The Making of the World',
    blurb: 'The prologue: the pulse, the Aelthar, the tearing of the world, and the boy it was all turning toward.',
  },
  {
    number: 1,
    title: 'The Awakening',
    blurb: 'Jaiden’s awakening day — the altar, the Guardian, and Bella’s impossible light.',
  },
  {
    number: 2,
    title: 'The Reading',
    blurb: 'Jaiden steps into the ring, and the altar finds two signatures in one body.',
  },
  {
    number: 3,
    title: 'The First Day',
    blurb: 'Veyn and Ren, the Wall, Rune Stars — and the quiet knowledge of what Jaiden is.',
  },
];

export const ENTRY_RULES: Record<string, EntryRule> = {
  // --- Realms (prologue lore) ----------------------------------------------
  'Human Realm': { at: 0, fields: { 'Notable places': 0, Ruler: LOCKED } },
  'Angel Realm': { at: 0, fields: { Inhabitants: 0, Ruler: LOCKED } },
  'Demon Realm': { at: 0, fields: { 'Notable places': 0, Ruler: LOCKED } },
  'Hidden Realm (Shadow Realm)': {
    at: 0,
    fields: { 'The portal': 0, Time: 0, Creator: 0, Location: 0, Inhabitants: 0 },
    lock: ['Notable places'],
  },

  // --- Locations ------------------------------------------------------------
  Aldermere: { at: 0, fields: { Ruler: LOCKED } },
  Aurelion: { at: 0, fields: { Ruler: LOCKED } },
  Vorath: { at: 0, fields: { Ruler: LOCKED } },
  'Elyndor Academy': { at: 0 },
  'The Sundering Altar': { at: 0, fields: { Type: 0, Description: 2 } },
  'The Academy Grounds': { at: 1, fields: {} },

  // --- Rules & Notes --------------------------------------------------------
  'The World Core': { at: 0 },
  'The World Barrier': { at: 0 },
  'The World Curse': { at: 0 },
  'The Three Forms of Veyn': { at: 0 },
  'Holy Energy and Corrupted Veyn': { at: 0 },
  'The Two Sundering Altars': {
    at: 0,
    fields: { 'Common Altar': 0, 'Awakening Age': 0, 'Academy Altar': 1, 'Why the Academy matters': 1 },
  },
  'Affinity & Awakening': { at: 0 },
  'The Aelthar': { at: 0 },
  'The Six Pillars of Angels': {
    at: 1,
    alias: ['Six Pillars of Angels', 'Six Pillars', 'Pillars of Angels'],
    desc: LOCKED,
    fields: { Type: 1 },
  },
  'Innate Abilities': { at: 3 },
  Humans: { at: 3 },
  'The Hybrid': { at: 3, fields: {} },
  'Rune Star Circles vs Grades': { at: 3 },

  // --- Magic Systems --------------------------------------------------------
  Veyn: { at: 0 },
  'Holy Energy': { at: 0 },
  'Corrupted Veyn': { at: 0 },
  Ren: { at: 0, fields: { Feel: 0, Vitality: 0, 'Dead/Null Zones': 3 } },
  Vitality: { at: 0 },

  // --- Races & beings -------------------------------------------------------
  Aelthar: { at: 0 },
  Shudon: {
    at: 0,
    fields: { Appearance: 0, Status: 0 },
    lock: ['Plot', 'Body', 'Control', 'Hostile', 'Unknown'],
  },
  'Angels (Overview)': { at: 0, fields: {} },
  'Demons (Overview)': { at: 0, fields: {} },

  // --- Races named in chapter 1 --------------------------------------------
  Pallantine: { at: 1, fields: { Appearance: 1 } },
  Veilborn: { at: 1, alias: ['dark elf'], fields: { Appearance: 1 } },
  Malakhim: { at: 1, fields: {} },
  Griffen: {
    at: 1,
    fields: { Appearance: 1, Location: 1, Realm: 1 },
    lock: ['Hostile', 'Threat Level'],
  },

  // --- Characters -----------------------------------------------------------
  'Aldric Malgrave': { at: 0 },
  'Kael von Ashen': {
    at: 0,
    subtitle: 1,
    fields: { Role: 0, Race: 0, Academy: 0, Location: 0, Appearance: 3, Class: 3, Grade: 3 },
  },
  'Jaiden Marlock': {
    at: 1,
    subtitle: 3,
    desc: 3,
    alias: ['Jaiden'],
    fields: {
      Appearance: 1,
      Personality: 1,
      'Core Conflict': 2,
      Abilities: 2,
      'Auralis Ruby': 2,
      'What He Wants': 3,
    },
    lock: [
      'Character Arc',
      'What He Needs',
      'Greatest Fear',
      'Fatal Flaw',
      'Relationships',
      'Story Relevance',
      'Lore Connections',
      'Surname Origin',
      'Twilight Veyn',
    ],
    // 'Jaiden' as a standalone word resolves here even when the reader
    // reached this chapter through the empty-text code path, because the
    // manifest rule itself carries the alias. The chapter 1 prose is where
    // the full name 'Jaiden Marlock' is introduced, so the full name is the
    // canonical mention-free path as well. The chapter 1 prose is where
    // the full name 'Jaiden Marlock' is introduced, so the full name is the
    // canonical mention-free path as well.
  },
  'Sofia Marlock': {
    at: 1,
    subtitle: 3,
    desc: 3,
    alias: ['Sofia'],
    fields: { Appearance: 1, Race: 1, 'Angel type': 1 },
    lock: ['Rank', 'Class', 'Grade'],
    // Chapter 1 names Sofia; the code path stores no text, so the alias
    // gates here too. The mention-only entry stays locked until its
    // chapter text is actually uploaded (or another rule opens it).
  },
  'Bella Ruven': {
    at: 1,
    subtitle: 3,
    desc: 3,
    fields: { Appearance: 1, Race: 1, 'Unusual Trait': 1 },
    lock: ['Artifact', 'Grade', 'Secret', 'Angel Rank', 'Family', 'Lineage', 'Birthplace', 'Class'],
    // The chapter 1 prose names the entry both as 'Bella Rose' and as 'Bella'.
    // The manifest opens at 1 so the empty-text code path can reveal the entry and
    // its fields. The two nicknames are aliases for the chapter prose's wording,
    // not separate entries.
  },
  'Thalor Elwin': {
    at: 1,
    fields: { Role: 1, Rank: 1, Title: 1, Pillar: 1, Race: 1 },
    lock: ['Appearance', 'Skills', 'Class', 'Ren Organ', 'Grade'],
  },
  'Eva Aldermere Divina': {
    at: 1,
    fields: { Class: 1, Race: 1, Parent: 1 },
    lock: ['Rune Star Circle', 'Power Level'],
  },
  // Named only in later books — held back for now.
  Lisa: { at: LOCKED },
  Ordium: { at: LOCKED },
  'Ruby Divina': { at: LOCKED },

  // --- Artifacts ------------------------------------------------------------
  'Auralis Ruby': {
    at: 0,
    subtitle: LOCKED,
    desc: LOCKED,
    alias: ['pendant', 'ruby', 'ruby pendant'],
    fields: { Keeper: 2, 'Seal Strength': 2 },
    lock: ['Crafted by', 'Break Chain', 'Recovery', 'Release Permanence'],
  },

  // --- Angels ---------------------------------------------------------------
  'Aetherblade Lord Angel': {
    at: 1,
    alias: ['Aetherblade Lord'],
    fields: { Appearance: 1, Type: 1 },
    lock: ['Skills'],
  },
  Virtue: {
    at: 1,
    fields: { Appearance: 1, Type: 1 },
    lock: ['Skills', 'Can be killed by'],
  },
  'The Angel Veyn Vow': {
    at: 1,
    fields: { Incantation: 1, Halo: 1 },
    lock: ['Nature', 'Seal', 'Breaking'],
  },

  // --- Demon ranks ----------------------------------------------------------
  Bloodward: {
    at: 1,
    fields: { Appearance: 1, Type: 1 },
    lock: ['Skills'],
  },
  Scourge: {
    at: 1,
    fields: { Appearance: 1, Type: 1 },
    lock: ['Skills'],
  },

  // --- Pillars --------------------------------------------------------------
  'Fifth Pillar, Horkous': {
    at: 1,
    alias: ['Fifth Pillar'],
    fields: { 'Held by': 1 },
  },

  // --- Rune Star circles ----------------------------------------------------
  '3rd Circle Rune Star': {
    at: 1,
    fields: { Circle: 1 },
  },

  // --- Grade system ---------------------------------------------------------
  'Grade System': { at: 0, fields: {} },
  'Grade-Based Combat Power': { at: 0, fields: {} },
  'E Grade': { at: 1 },
  'A Grade': { at: 1 },
  'D Grade': { at: 1, fields: { Role: 1 } },
  'The Wall': { at: 3 },

  // --- Classes --------------------------------------------------------------
  Classes: { at: 3 },
  Mage: { at: 0, fields: { Type: 0, 'Rune Star Circles': 0, Skills: 3 } },
  Clergy: { at: 0, fields: { Type: 0 }, lock: ['Skills', 'Grade Progression'] },
  Paladin: { at: 0, fields: { Type: 0 }, lock: ['Skills', 'Grade Progression'] },
  Berserker: { at: 0, fields: { Type: 0 }, lock: ['Skills', 'Grade Progression'] },
  Archer: { at: 1, fields: { Type: 1 }, lock: ['Skills', 'Grade Progression'] },
  Enchanter: { at: 1, fields: { Type: 1 }, lock: ['Skills', 'Grade Progression'] },
  Bladesinger: { at: 1, fields: { Type: 1 }, lock: ['Skills', 'Grade Progression'] },
  'Mage — Rune Star Circles': { at: 3 },

  // --- Class progression stages named in chapter 1 --------------------------
  'Berserker — Rage Ascension': {
    at: 1,
    alias: ['Rageborn'],
    fields: { Rageborn: 1 },
  },
  'Archer — Shot Mastery Tiers': {
    at: 1,
    alias: ['Enchanter Archer'],
    fields: { 'Enchanter Archer': 1 },
  },

  // --- Daily life -----------------------------------------------------------
  // Starfruit is described inside Angel Sustenance, so naming any of the
  // prized angel foods reveals that entry.
  'Angel Sustenance': {
    at: 1,
    alias: ['starfruit', 'moonbread', 'dewwine'],
  },

  // --- Character forms (deep spoilers, held for later books) ----------------
  'Jaiden Marlock — Normal': {
    at: 2,
    fields: { Seal: 2, Visual: 2 },
    lock: ['Abilities', 'Aura', 'Trigger', 'Cost', 'Duration', 'Risk', 'Story Role', 'Lore Connections'],
  },
  'Jaiden Marlock — Full Angel Form': { at: LOCKED },
  'Jaiden Marlock — Full Demon Form': { at: LOCKED },
  'Jaiden Marlock — Chaos Form': { at: LOCKED },
  'Jaiden Marlock — True Hybrid': { at: LOCKED },

  // --- Religion / lore ------------------------------------------------------
  'The World Core Faith': { at: 0, fields: {} },
  'The Fall of the Aelthar': { at: 0, fields: {} },
  'The Founding of Elyndor Academy': { at: 3, fields: {} },
  'The Three Great Catastrophes': { at: LOCKED },
};

/** Human-readable reason shown on a locked value. */
export function lockLabel(chapter: number | undefined): string {
  if (chapter === undefined || chapter === null || chapter >= LOCKED) return 'Not yet revealed';
  return `Revealed in Chapter ${chapter}`;
}
