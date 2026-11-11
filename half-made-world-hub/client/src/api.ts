import type {
  CategoryInfo,
  Entry,
  EntryInput,
  Relationship,
  RelationshipInput,
  StoryLink,
  StoryLinkInput,
} from './types';
import { getSnapshot } from './snapshot';
import { searchArchive } from './search';

// The GitHub Pages (view-only) build ships without the Node server: archive
// search runs in the browser over the bundled snapshot, and the Groq-backed AI
// endpoints are unavailable.
export const viewOnlyBuild = !import.meta.env.DEV;

// Thrown when the AI is rate-limited; carries the seconds until it works again
// so the UI can show a countdown.
export class AiRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'AiRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message = data?.error || `Request failed (${res.status})`;
    if (res.status === 429 && typeof data?.retryAfterSeconds === 'number') {
      throw new AiRateLimitError(message, data.retryAfterSeconds);
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// --- Entries --------------------------------------------------------------
export async function fetchCategories(): Promise<CategoryInfo[]> {
  const res = await fetch('/api/categories');
  return handle<CategoryInfo[]>(res);
}

export async function deleteCategory(
  name: string,
): Promise<{ ok: boolean; deleted: number; relationshipsRemoved: number; storyLinksRemoved: number }> {
  const res = await fetch(`/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
  return handle(res);
}

export async function fetchEntries(params?: { category?: string; search?: string }): Promise<Entry[]> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set('category', params.category);
  if (params?.search) qs.set('search', params.search);
  const res = await fetch(`/api/entries?${qs.toString()}`);
  return handle<Entry[]>(res);
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  const res = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<Entry>(res);
}

export async function updateEntry(id: string, input: EntryInput): Promise<Entry> {
  const res = await fetch(`/api/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<Entry>(res);
}

export async function deleteEntry(id: string): Promise<Entry> {
  const res = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
  return handle<Entry>(res);
}

// --- Relationships --------------------------------------------------------
export async function fetchRelationships(): Promise<Relationship[]> {
  const res = await fetch('/api/relationships');
  return handle<Relationship[]>(res);
}

export async function createRelationship(input: RelationshipInput): Promise<Relationship> {
  const res = await fetch('/api/relationships', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<Relationship>(res);
}

export async function updateRelationship(id: string, input: RelationshipInput): Promise<Relationship> {
  const res = await fetch(`/api/relationships/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<Relationship>(res);
}

export async function deleteRelationship(id: string): Promise<Relationship> {
  const res = await fetch(`/api/relationships/${id}`, { method: 'DELETE' });
  return handle<Relationship>(res);
}

// --- Story links ----------------------------------------------------------
export async function fetchStoryLinks(): Promise<StoryLink[]> {
  const res = await fetch('/api/story-links');
  return handle<StoryLink[]>(res);
}

export async function createStoryLink(input: StoryLinkInput): Promise<StoryLink> {
  const res = await fetch('/api/story-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<StoryLink>(res);
}

export async function updateStoryLink(id: string, input: StoryLinkInput): Promise<StoryLink> {
  const res = await fetch(`/api/story-links/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<StoryLink>(res);
}

export async function deleteStoryLink(id: string): Promise<StoryLink> {
  const res = await fetch(`/api/story-links/${id}`, { method: 'DELETE' });
  return handle<StoryLink>(res);
}

export async function resetWorld(): Promise<{
  ok: boolean;
  entries: number;
  relationships: number;
  storyLinks: number;
}> {
  const res = await fetch('/api/reset', { method: 'POST' });
  return handle<{ ok: boolean; entries: number; relationships: number; storyLinks: number }>(res);
}

// --- Archive search (chat-room style) --------------------------------------
import type { Field } from './types';
export interface SearchMatch {
  id: string;
  category?: string;
  name?: string;
  subtitle?: string;
  description?: string;
  fields?: Field[];
  tags?: string[];
  source?: string;
  target?: string;
  type?: string;
  label?: string;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
  matchIn: { field: string; snippet: string }[];
}

export interface SearchResult {
  entries: SearchMatch[];
  relationships: SearchMatch[];
  storyLinks: SearchMatch[];
  query: string;
  keywords?: string[];
  totals?: { entries: number; relationships: number; storyLinks: number };
}

export async function queryArchive(q: string): Promise<SearchResult> {
  // The dev server exposes /api/search; the view-only build has no server, so
  // the same keyword search runs in the browser over the bundled snapshot.
  if (viewOnlyBuild) {
    const data = getSnapshot();
    if (!data) throw new Error('The archive is still loading — try again in a moment.');
    return searchArchive(q, data);
  }
  const qs = new URLSearchParams({ q });
  const res = await fetch(`/api/search?${qs.toString()}`);
  return handle<SearchResult>(res);
}

// --- AI answer (Groq-backed) ---------------------------------------------
export interface AiAnswerResponse {
  answer: string;
}

export async function askAi(question: string, searchResult: SearchResult): Promise<AiAnswerResponse> {
  const res = await fetch('/api/ai/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, searchResult }),
  });
  return handle<AiAnswerResponse>(res);
}

// --- AI explore: the AI searches the full archive on its own ---
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export async function askAiExplore(question: string, history: ChatTurn[] = []): Promise<AiAnswerResponse> {
  if (viewOnlyBuild) {
    throw new Error('The AI explorer needs the local server and is not available in the view-only build.');
  }
  const res = await fetch('/api/ai/explore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
  });
  return handle<AiAnswerResponse>(res);
}

