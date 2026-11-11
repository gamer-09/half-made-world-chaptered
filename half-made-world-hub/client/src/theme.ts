// Category colors for the Half-Made World archive.
// Grouped into warm/cool/family tones so related categories read together.
export const CATEGORY_COLORS: Record<string, string> = {
  // ── Geography & places ──
  Realms: '#c8a876',
  Locations: '#c8a876',
  'Hidden Realm': '#7f8fa3',

  // ── Tears in the world ──
  Rifts: '#b06bd6',

  // ── People ──
  Characters: '#c8a876',
  Humans: '#c8a876',
  Angels: '#e8d9a0',
  Demons: '#c25e4a',
  Beings: '#b08d57',
  Monsters: '#c25e4a',
  'Race Types': '#b08d57',

  // ── Story ──
  Plot: '#c25e4a',
  'Lore & Myths': '#a07850',
  Calendar: '#8f9bb3',
  'Clan': '#9b7bb8',

  // ── Magic & power ──
  'Magic Systems': '#7fb8c9',
  'Rules & Notes': '#7f8fa3',
  Classes: '#8fb878',
  'Class Skills': '#8fb878',
  'Class Progression': '#6b8e6b',
  'Grade System': '#8fb878',
  'Rune Star Circles': '#7fb8c9',
  'Innate Abilities': '#2dd4bf',
  'Skill Mechanics': '#7fb8c9',
  Concepts: '#7fb8c9',

  // ── Skills by race ──
  'Angel Skills': '#e8d9a0',
  'Demon Skills': '#c25e4a',
  'Hybrid Skills': '#d4a5a5',
  'Ruler Skills': '#c8a876',
  'Artifact Skills': '#c8a876',
  'Character Forms': '#d4a5a5',

  // ── Things ──
  Items: '#c8a876',
  Artifacts: '#facc15',
  Equipment: '#b08d57',
  Coins: '#facc15',
  Resources: '#8f9b6b',

  // ── Society ──
  Organizations: '#9b7bb8',
  Politics: '#9b7bb8',
  Economy: '#8fb878',
  'Laws & Justice': '#8f9bb3',
  Military: '#c25e4a',
  Intelligence: '#7f8fa3',
  'Social Classes': '#b08d57',
  Titles: '#facc15',

  // ── Life & world ──
  Academy: '#6b9bd1',
  Culture: '#d4894a',
  'Daily Life': '#d4894a',
  'Arts & Entertainment': '#d4894a',
  'Death & Burial': '#7f8fa3',
  'Marriage & Family': '#d4894a',
  Languages: '#8f9bb3',
  Nature: '#6b8e6b',
  Religion: '#c9a0dc',
  Travel: '#6b9bd1',
  Architecture: '#b08d57',
  Medical: '#e08080',
  Prisons: '#8a8a8a',
};

export const FALLBACK_COLOR = '#7f8fa3';

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLOR;
}

/** Deterministic brass accent derived from a name (for brand-new categories). */
export function categoryAccent(name: string): string {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  const palette = ['#c8a876', '#c25e4a', '#6b8e6b', '#7f8fa3', '#8f6b3c', '#c8a876'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}
