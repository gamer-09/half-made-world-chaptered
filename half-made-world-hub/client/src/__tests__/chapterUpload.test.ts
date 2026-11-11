import { describe, expect, it } from 'vitest';
import { hasChapterProse } from '../hooks/useChapterGate';

describe('hasChapterProse', () => {
  it('rejects a bare chapter heading typed into the upload box', () => {
    expect(hasChapterProse('chapter 1')).toBe(false);
    expect(hasChapterProse('  Chapter 1  ')).toBe(false);
    expect(hasChapterProse('Chapter 3 — The First Day')).toBe(false);
    expect(hasChapterProse('Ch. 2')).toBe(false);
  });

  it('accepts real chapter prose, with or without a heading', () => {
    expect(
      hasChapterProse(
        'Chapter 1\n\nThe Awakening\n\nJaiden woke before dawn and found the altar already glowing.',
      ),
    ).toBe(true);
    expect(
      hasChapterProse('Jaiden woke before dawn and found the altar already glowing in the square.'),
    ).toBe(true);
  });

  it('rejects an empty upload', () => {
    expect(hasChapterProse('')).toBe(false);
    expect(hasChapterProse('   \n  ')).toBe(false);
  });
});
