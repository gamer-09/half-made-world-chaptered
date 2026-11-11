import { describe, expect, it } from 'vitest';
import { hasChapterProse } from '../hooks/useChapterGate';
import { buildChapterCheck, verifyChapter } from '../chapters/chapterCheck';

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

describe('chapter verification', () => {
  const chapter1 = [
    'Jaiden woke before dawn and found the altar already glowing in the square.',
    'Sofia was waiting by the gate with her arms crossed and her disappointed face on.',
    'The Guardian read the runes twice, frowned, and asked him to step forward again.',
    'Bella Ruven stood at the back of the hall, and the light around her would not settle.',
    'By the ninth bell the whole Academy knew that something had gone very wrong.',
  ].join(' ');

  const chapter2 = [
    'The ring was chalk and salt and a circle of older runes that no one would explain.',
    'Jaiden stepped inside it and the altar found two signatures folded into one body.',
    'Veyn poured through him like cold water, and the crowd went quiet all at once.',
    'Kael von Ashen watched from the balcony and did not look surprised in the least.',
    'When the reading ended, the recorder wrote down a grade that had no precedent.',
  ].join(' ');

  const checks = {
    '1': buildChapterCheck(chapter1)!,
    '2': buildChapterCheck(chapter2)!,
  };

  it('accepts the complete chapter text', () => {
    expect(verifyChapter(chapter1, 1, checks).status).toBe('ok');
    expect(verifyChapter(`Chapter 1\n\n${chapter1}`, 1, checks).status).toBe('ok');
  });

  it('rejects a heading or a partial paste', () => {
    expect(verifyChapter('chapter 1', 1, checks).status).toBe('incomplete');

    const words = chapter1.split(' ');
    const half = words.slice(0, Math.floor(words.length / 2)).join(' ');
    const verdict = verifyChapter(half, 1, checks);

    expect(verdict.status).toBe('incomplete');
    expect(verdict.coverage).toBeLessThan(0.9);
  });

  it('names the chapter that was actually pasted', () => {
    const verdict = verifyChapter(chapter2, 1, checks);

    expect(verdict.status).toBe('wrong-chapter');
    if (verdict.status === 'wrong-chapter') expect(verdict.actualChapter).toBe(2);
  });

  it('leaves chapters with no reference fingerprint unverified', () => {
    expect(verifyChapter(chapter1, 7, checks).status).toBe('no-reference');
  });
});
