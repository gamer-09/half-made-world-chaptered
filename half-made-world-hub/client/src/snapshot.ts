import type { CategoryInfo, Entry, Relationship, StoryLink } from './types';
import { applyGate, getActiveGate, EMPTY_GATE, type GateStats } from './chapters/gate';

export type SnapshotData = {
  entries: Entry[];
  relationships: Relationship[];
  storyLinks: StoryLink[];
};

let cached: SnapshotData | null = null;
let cachedStats: GateStats | null = null;

/** Drop the in-memory copy so the next loadSnapshot() refetches. */
export function invalidateSnapshot() {
  cached = null;
  cachedStats = null;
}

/** Gate statistics for the slice currently loaded (null before first load). */
export function getGateStats(): GateStats | null {
  return cachedStats;
}

export async function loadSnapshot(): Promise<SnapshotData> {
  if (cached) return cached;

  let raw: SnapshotData | null = null;

  // Try the live server first (dev mode with the Node API running).
  try {
    const entries = await fetch('/api/entries', { cache: 'no-store' }).then((r) => r.json());
    const relationships = await fetch('/api/relationships', { cache: 'no-store' }).then((r) => r.json());
    const storyLinks = await fetch('/api/story-links', { cache: 'no-store' }).then((r) => r.json());
    if (entries?.length && relationships?.length && storyLinks?.length) {
      raw = { entries, relationships, storyLinks };
    }
  } catch {
    /* live server not available — fall through to snapshot */
  }

  // Fallback: load the bundled snapshot.json (view-only build / GitHub Pages).
  if (!raw) {
    const res = await fetch(import.meta.env.BASE_URL + 'snapshot.json');
    if (!res.ok) {
      throw new Error(`Failed to load the archive (${res.status})`);
    }
    const data = (await res.json()) as SnapshotData;
    if (!data?.entries || !data?.relationships || !data?.storyLinks) {
      throw new Error('The archive is missing data');
    }
    raw = data;
  }

  // Slice the archive through the active gate. With nothing uploaded the gate
  // is empty, so the archive ships sealed and the reader sees no entries.
  const gate = getActiveGate();
  const gated = applyGate(raw, gate ?? EMPTY_GATE);
  cachedStats = gated.stats;
  cached = { entries: gated.entries, relationships: gated.relationships, storyLinks: gated.storyLinks };
  return cached;
}

export function getSnapshot(): SnapshotData | null {
  return cached;
}

export function snapshotCategories(data: SnapshotData): CategoryInfo[] {
  const counts = new Map<string, number>();
  for (const entry of data.entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function snapshotEntries(
  data: SnapshotData,
  params?: { category?: string; search?: string },
): Entry[] {
  let list = data.entries;
  if (params?.category) list = list.filter((e) => e.category === params.category);
  if (params?.search) {
    const q = params.search.toLowerCase();
    list = list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.subtitle || '').toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)) ||
        e.fields.some(
          (f) =>
            (f.label && f.label.toLowerCase().includes(q)) ||
            (f.value && f.value.toLowerCase().includes(q)),
        ),
    );
  }
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
