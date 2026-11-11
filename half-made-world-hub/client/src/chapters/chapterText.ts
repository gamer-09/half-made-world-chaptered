// Bundled chapter prose. Imported with Vite's `?raw` so the gate can scan the
// exact text the reader has unlocked. New chapters only need a file here (and a
// CHAPTERS entry in manifest.ts).
import ch0 from './text/chapter-0.md?raw';
import ch1 from './text/chapter-1.md?raw';
import ch2 from './text/chapter-2.md?raw';
import ch3 from './text/chapter-3.md?raw';

export const BUNDLED_TEXT: Record<number, string> = {
  0: ch0,
  1: ch1,
  2: ch2,
  3: ch3,
};
