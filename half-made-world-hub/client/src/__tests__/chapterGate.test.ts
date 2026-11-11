import { describe, expect, it } from 'vitest';
import { applyGate, entryRevealAt, type GateConfig } from '../chapters/gate';
import type { Entry, Relationship } from '../types';

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
});
