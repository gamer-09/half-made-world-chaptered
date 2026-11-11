import { useCallback, useMemo, useState } from 'react';
import type { GateConfig } from '../chapters/gate';

const STORAGE_KEY = 'hmw-chapter-gate';

export interface ChapterGateState {
  /** Highest uploaded chapter, inclusive. -1 means nothing uploaded yet. */
  chapter: number;
  /** Chapter prose the reader supplied, keyed by chapter number. */
  uploaded: Record<number, string>;
}

function defaultState(): ChapterGateState {
  return { chapter: -1, uploaded: {} };
}

function loadState(): ChapterGateState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<ChapterGateState>;
    return {
      chapter: typeof parsed.chapter === 'number' ? parsed.chapter : -1,
      uploaded: parsed.uploaded && typeof parsed.uploaded === 'object' ? parsed.uploaded : {},
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: ChapterGateState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Pull a chapter number out of a filename or pasted chapter text. */
export function parseChapterNumber(input: string): number | null {
  if (!input) return null;
  const name = input.slice(0, 400);
  const patterns = [
    /chapter[\s_-]*(\d{1,3})/i,
    /^\s*(\d{1,3})\s*[:.\-—–]/m,
    /\bpart[\s_-]*(\d{1,3})/i,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export interface ChapterGateApi extends ChapterGateState {
  config: GateConfig;
  /** Upload a chapter's prose. This is the only way to reveal anything. */
  upload: (chapter: number, text: string) => void;
  /** Lock everything again and forget every upload. */
  reset: () => void;
}

export function useChapterGate(): ChapterGateApi {
  const [state, setState] = useState<ChapterGateState>(loadState);

  const update = useCallback((next: ChapterGateState) => {
    saveState(next);
    setState(next);
  }, []);

  const upload = useCallback(
    (chapter: number, text: string) =>
      update({
        chapter: Math.max(state.chapter, chapter),
        uploaded: { ...state.uploaded, [chapter]: text },
      }),
    [state, update],
  );

  const reset = useCallback(() => update({ chapter: -1, uploaded: {} }), [update]);

  const config = useMemo<GateConfig>(
    () => ({ chapter: state.chapter, uploaded: state.uploaded }),
    [state],
  );

  return { ...state, config, upload, reset };
}
