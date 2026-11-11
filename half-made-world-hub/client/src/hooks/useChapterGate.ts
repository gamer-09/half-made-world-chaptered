import { useCallback, useMemo, useState } from 'react';
import type { GateConfig } from '../chapters/gate';
import { CHAPTERS } from '../chapters/manifest';

const STORAGE_KEY = 'hmw-chapter-gate';

export interface ChapterGateState {
  /** Highest unlocked chapter, inclusive. -1 means nothing unlocked yet. */
  chapter: number;
  /** Extra chapter prose the reader supplied, keyed by chapter number. */
  uploaded: Record<number, string>;
  /** Author mode: bypass the gate and show the whole archive. */
  off: boolean;
}

function defaultState(): ChapterGateState {
  return { chapter: 0, uploaded: {}, off: false };
}

function loadState(): ChapterGateState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<ChapterGateState>;
    return {
      chapter: typeof parsed.chapter === 'number' ? parsed.chapter : 0,
      uploaded: parsed.uploaded && typeof parsed.uploaded === 'object' ? parsed.uploaded : {},
      off: Boolean(parsed.off),
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
  unlock: (chapter: number) => void;
  upload: (chapter: number, text: string) => void;
  reset: () => void;
  revealAll: () => void;
  enableGate: () => void;
  maxBundledChapter: number;
}

export function useChapterGate(): ChapterGateApi {
  const [state, setState] = useState<ChapterGateState>(loadState);

  const update = useCallback((next: ChapterGateState) => {
    saveState(next);
    setState(next);
  }, []);

  const unlock = useCallback(
    (chapter: number) => update({ ...state, chapter: Math.max(state.chapter, chapter), off: false }),
    [state, update],
  );

  const upload = useCallback(
    (chapter: number, text: string) =>
      update({
        chapter: Math.max(state.chapter, chapter),
        uploaded: { ...state.uploaded, [chapter]: text },
        off: false,
      }),
    [state, update],
  );

  const reset = useCallback(() => update({ chapter: -1, uploaded: {}, off: false }), [update]);
  const revealAll = useCallback(() => update({ ...state, off: true }), [state, update]);
  const enableGate = useCallback(() => update({ ...state, off: false }), [state, update]);

  const config = useMemo<GateConfig>(
    () => ({ chapter: state.off ? Infinity : state.chapter, uploaded: state.uploaded, off: state.off }),
    [state],
  );

  const maxBundledChapter = useMemo(
    () => CHAPTERS.reduce((m, c) => Math.max(m, c.number), 0),
    [],
  );

  return { ...state, config, unlock, upload, reset, revealAll, enableGate, maxBundledChapter };
}
