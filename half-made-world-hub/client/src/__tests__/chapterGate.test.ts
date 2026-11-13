import { describe, expect, it } from 'vitest';
import { applyGate, entryRevealAt, type GateConfig } from '../chapters/gate';
import type { Entry, Relationship } from '../types';

const chapterOneEntryNames = [
  'Jaiden Marlock',
  'Sofia Marlock',
  'Bella Ruven',
  'Thalor Elwin',
  'Kael von Ashen',
  'Auralis Ruby',
  'The Angel Veyn Vow',
  'The Academy Grounds',
  'The Two Sundering Altars',
  'Jaiden',
  'Bella',
];

function entry(name: string, fields: Entry['fields'] = []): Entry {
  return {
    id: name,
    category: 'Characters',
    name,
    subtitle: 'a subtitle',
    description: 'a description',
    fields,
    tags: [],
    createdAt: '',
    updatedAt: '',
  };
}

function relationship(source: string, target: string): Relationship {
  return { id: `${source}-${target}`, source, target, type: 'ally', label: '', description: '', createdAt: '', updatedAt: '' };
}

const noLinks = { relationships: [] as Relationship[], storyLinks: [] };

describe('chapter gate', () => {
  it('reveals nothing before anything is uploaded', () => {
    const data = { entries: [entry('Aldermere'), entry('The World Core')], ...noLinks };
    const gated = applyGate(data, { chapter: -1, uploaded: {} });

    expect(gated.entries).toHaveLength(0);
    expect(gated.stats.visibleEntries).toBe(0);
    expect(gated.stats.lockedEntries).toBe(2);
  });

  it('hides a curated entry until its chapter arrives', () => {
    const data = { entries: [entry('Jaiden Marlock', [{ label: 'Appearance', value: 'tall' }])], ...noLinks };
    const gated = applyGate(data, { chapter: 0, uploaded: {} });

    expect(gated.entries).toHaveLength(0);
    expect(gated.stats.lockedEntries).toBe(1);
    expect(gated.stats.visibleEntries).toBe(0);
  });

  it('locks subtitle, description, and unreached fields at the reveal chapter', () => {
    const data = {
      entries: [
        entry('Jaiden Marlock', [
          { label: 'Appearance', value: 'tall' },
          { label: 'Character Arc', value: 'the whole ending' },
        ]),
      ],
      ...noLinks,
    };
    const gated = applyGate(data, { chapter: 1, uploaded: {} });
    const e = gated.entries[0];

    expect(e.lockedSubtitle).toBe(true);
    expect(e.subtitle).toBe('');
    expect(e.lockedDescription).toBe(true);
    expect(e.description).toBe('');
    expect(e.fields.find((f) => f.label === 'Appearance')?.locked).toBeUndefined();
    const arc = e.fields.find((f) => f.label === 'Character Arc');
    expect(arc?.locked).toBe(true);
    expect(arc?.value).toBe('');
    expect(e.lockedFieldCount).toBe(1);
  });

  it('reveals an uncurated entry named in an unlocked chapter', () => {
    const config: GateConfig = { chapter: 5, uploaded: { 5: 'They whispered of Zorblax the Unnamed.' } };

    expect(entryRevealAt('Zorblax the Unnamed', { chapter: 4, uploaded: {} })).toBe(Infinity);
    const gated = applyGate({ entries: [entry('Zorblax the Unnamed')], ...noLinks }, config);

    expect(gated.entries).toHaveLength(1);
    expect(gated.entries[0].unlocksChapter).toBe(5);
  });

  it('keeps a held-back curated entry locked even when a chapter names it', () => {
    const config: GateConfig = { chapter: 5, uploaded: { 5: 'They spoke of Lisa at the gate.' } };
    const gated = applyGate({ entries: [entry('Lisa')], ...noLinks }, config);

    expect(gated.entries).toHaveLength(0);
    expect(gated.stats.lockedEntries).toBe(1);
  });

  it('drops links that touch a still-hidden entry', () => {
    const data = {
      entries: [entry('Aldermere'), entry('Jaiden Marlock')],
      relationships: [relationship('Aldermere', 'Jaiden Marlock'), relationship('Aldermere', 'Aldermere')],
      storyLinks: [],
    };
    const gated = applyGate(data, { chapter: 0, uploaded: {} });

    expect(gated.entries.map((e) => e.name)).toEqual(['Aldermere']);
    expect(gated.relationships).toHaveLength(1);
    expect(gated.relationships[0].target).toBe('Aldermere');
  });

  it('redeeming a code unlocks the chapter tier and manifest-gated entries, but not mention-gated entries', () => {
    const chapter = 1;
    const data = {
      entries: chapterOneEntryNames.map((name) => entry(name)),
      relationships: [] as Relationship[],
      storyLinks: [],
    };
    const gated = applyGate(data, { chapter, uploaded: {} });

    const revealed = gated.entries.map((e) => e.name);
    for (const name of chapterOneEntryNames) {
      if (name === 'Jaiden' || name === 'Bella') continue;
      expect(revealed).toContain(name);
    }

    expect(gated.entries.find((e) => e.name === 'Jaiden Marlock')?.lockedSubtitle).toBe(true);
    expect(gated.entries.find((e) => e.name === 'Jaiden Marlock')?.lockedDescription).toBe(true);
    expect(gated.entries.find((e) => e.name === 'Auralis Ruby')?.lockedSubtitle).toBe(true);
    expect(gated.entries.find((e) => e.name === 'Auralis Ruby')?.lockedDescription).toBe(true);
    expect(gated.entries.find((e) => e.name === 'The Academy Grounds')?.lockedSubtitle).toBeUndefined();
    expect(gated.entries.find((e) => e.name === 'Bella Ruven')?.lockedSubtitle).toBe(true);

    // The manifest rule at 1 means a code for chapter 1 reveals this entry.
    expect(entryRevealAt('Jaiden Marlock', { chapter: 0, uploaded: {} })).toBe(1);
    expect(entryRevealAt('Jaiden Marlock', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('Bella Rose', { chapter: 1, uploaded: {} })).toBe(Infinity);
    // A full-name lookup with no uploaded prose hits the manifest without falling back to the mention scan.
    expect(entryRevealAt('Sofia Marlock', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('Bella Ruven', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('Bella', { chapter: 1, uploaded: {} })).toBe(Infinity);

    expect(entryRevealAt('Thalor Elwin', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('Kael von Ashen', { chapter: 1, uploaded: {} })).toBe(0);
    expect(entryRevealAt('Auralis Ruby', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('The Angel Veyn Vow', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('The Academy Grounds', { chapter: 1, uploaded: {} })).toBe(1);
    expect(entryRevealAt('The Two Sundering Altars', { chapter: 1, uploaded: {} })).toBe(0);
    expect(entryRevealAt('Bella', { chapter: 1, uploaded: {} })).toBe(Infinity);
  });
});

describe('chapter gate — word-for-word matching', () => {
  const config = (text: string): GateConfig => ({ chapter: 3, uploaded: { 3: text } });

  it('matches hyphenated prose against a spaced entry name', () => {
    expect(entryRevealAt('E Grade Cohort', config('He scraped by as an E-grade cohort trainee.'))).toBe(3);
  });

  it('matches digit prose against a spelled-out number', () => {
    expect(entryRevealAt('Six Pillars of Testing', config('They swore on the 6 Pillars of Testing.'))).toBe(3);
  });

  it('matches an ordinal both ways round', () => {
    expect(entryRevealAt('Fourth Circle Rune Star', config('She reached the 4th Circle Rune Star at dawn.'))).toBe(3);
  });

  it('reveals a four-word name only when all four words appear', () => {
    expect(entryRevealAt('Third Circle Rune Star', config('The Third Circle Rune Star burned.'))).toBe(3);
    expect(entryRevealAt('Third Circle Rune Star', config('The Third Circle burned.'))).toBe(Infinity);
  });

  it('reveals a long name as one exact phrase', () => {
    expect(
      entryRevealAt('The Six Pillars of Angel Testing', config('The Six Pillars of Angel Testing convened.')),
    ).toBe(3);
    expect(
      entryRevealAt('The Six Pillars of Angel Testing', config('The Six Pillars of Angels convened.')),
    ).toBe(Infinity);
  });

  it('does not reveal a proper-noun entry from a lowercase common word', () => {
    expect(entryRevealAt('Seal', config('He broke the wax seal on the letter.'))).toBe(Infinity);
    expect(entryRevealAt('Seal', config('The Seal answered him.'))).toBe(3);
  });

  it('does not reveal an entry from a partial name', () => {
    expect(entryRevealAt('Obsidian Blade Lord Angel', config('The Obsidian Blade Lord watched.'))).toBe(Infinity);
    expect(entryRevealAt('Obsidian Blade Lord Angel', config('The Obsidian Blade Lord Angel watched.'))).toBe(3);
  });
});
