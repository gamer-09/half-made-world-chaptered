import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateSnapshot, loadSnapshot } from '../snapshot';

const ENTRIES = [
  { id: 'seed-1', name: 'Test', category: 'Characters', description: '', subtitle: '', tags: [], fields: [] },
];
const RELATIONSHIPS = [{ id: 'rel-1', source: 'Test', target: 'Other', type: 'ally' }];
const STORY_LINKS = [{ id: 'link-1', source: 'Test', target: 'Other', type: 'setup' }];

/**
 * Stand-in for the dev server: each endpoint returns its own array, so a
 * non-empty archive comes back and the snapshot.json fallback is not used.
 */
function mockFetch() {
  const fn = vi.fn(async (url: string) => {
    const body = url.includes('/api/entries')
      ? ENTRIES
      : url.includes('/api/relationships')
        ? RELATIONSHIPS
        : url.includes('/api/story-links')
          ? STORY_LINKS
          : { entries: [], relationships: [], storyLinks: [] };
    return { ok: true, json: async () => body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('loadSnapshot', () => {
  beforeEach(() => {
    invalidateSnapshot();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches the archive to avoid refetching', async () => {
    const fetchMock = mockFetch();

    await loadSnapshot();
    await loadSnapshot();

    // four live endpoints (entries, relationships, story-links, chapter-codes), once each
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refetches after the cache is invalidated', async () => {
    const fetchMock = mockFetch();

    await loadSnapshot();
    invalidateSnapshot();
    await loadSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('asks the browser not to cache the live endpoints', async () => {
    const fetchMock = mockFetch();

    await loadSnapshot();

    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1]?.cache).toBe('no-store');
    }
  });
});
