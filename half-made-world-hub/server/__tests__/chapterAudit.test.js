const test = require('node:test');
const assert = require('node:assert/strict');

const { auditChapter } = require('../chapter-audit');

function entry(name, category = 'Test') {
  return { name, category };
}

function names(result) {
  const out = [];
  for (const records of result.passes.values()) out.push(...records.map((r) => r.name));
  out.push(...result.longer.map((r) => r.name));
  return out.sort();
}

test('matches hyphens and numerals across prose and entry names', () => {
  const result = auditChapter(
    [entry('D Grade'), entry('Six Pillars of Testing')],
    'He was D-grade, sworn to the 6 Pillars of Testing.',
    { 'D Grade': { at: 1 }, 'Six Pillars of Testing': { at: 1 } },
    1,
  );

  assert.deepEqual(names(result), ['D Grade', 'Six Pillars of Testing']);
  assert.equal(result.missing.length, 0);
});

test('only counts a proper-noun capitalization', () => {
  const entries = [entry('Seal')];

  const common = auditChapter(entries, 'He broke the wax seal on the letter.', { Seal: { at: 1 } }, 1);
  assert.deepEqual(names(common), []);
  assert.deepEqual(common.missing, []);

  const proper = auditChapter(entries, 'The Seal answered him.', { Seal: { at: 1 } }, 1);
  assert.deepEqual(names(proper), ['Seal']);
});

test('groups matches into the four length passes plus longer names', () => {
  const result = auditChapter(
    [
      entry('One'),
      entry('Two Words'),
      entry('Three Word Name'),
      entry('Four Word Name Here'),
      entry('Five Word Name Goes Here'),
    ],
    'One. Two Words. Three Word Name. Four Word Name Here. Five Word Name Goes Here.',
    {
      One: { at: 1 },
      'Two Words': { at: 1 },
      'Three Word Name': { at: 1 },
      'Four Word Name Here': { at: 1 },
      'Five Word Name Goes Here': { at: 1 },
    },
    1,
  );

  assert.deepEqual(result.passes.get(1).map((r) => r.name), ['One']);
  assert.deepEqual(result.passes.get(2).map((r) => r.name), ['Two Words']);
  assert.deepEqual(result.passes.get(3).map((r) => r.name), ['Three Word Name']);
  assert.deepEqual(result.passes.get(4).map((r) => r.name), ['Four Word Name Here']);
  assert.deepEqual(result.longer.map((r) => r.name), ['Five Word Name Goes Here']);
});

test('reports a named entry the manifest still locks', () => {
  const result = auditChapter(
    [entry('Virtue'), entry('Scourge')],
    'The Virtue and the Scourge watched.',
    { Scourge: { at: 1 } },
    1,
  );

  assert.deepEqual(names(result), ['Scourge', 'Virtue']);
  assert.deepEqual(result.missing.map((r) => r.name), ['Virtue']);
});

test('treats a manifest alias as the chapter naming the entry', () => {
  const result = auditChapter(
    [entry('Angel Sustenance'), entry('Berserker — Rage Ascension')],
    'He ate a starfruit, and his stage was Rageborn.',
    {
      'Angel Sustenance': { at: 1, alias: ['starfruit'] },
      'Berserker — Rage Ascension': { at: 1, alias: ['Rageborn'] },
    },
    1,
  );

  assert.deepEqual(names(result), ['Angel Sustenance', 'Berserker — Rage Ascension']);
  assert.deepEqual(result.missing, []);
});

test('does not count a partial name as a match', () => {
  const result = auditChapter(
    [entry('Obsidian Blade Lord Angel')],
    'The Obsidian Blade Lord watched.',
    { 'Obsidian Blade Lord Angel': { at: 2 } },
    1,
  );

  assert.deepEqual(names(result), []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.partials.map((p) => p.name), ['Obsidian Blade Lord Angel']);
});

test('flags names the chapter uses that have no archive entry', () => {
  const result = auditChapter(
    [entry('Bella Ruven'), entry('Virtue')],
    'Bella Ruven listened. "My name is Grin Holly," he said. Ivy waved. Ivy smiled. Vareth waited. Vareth did not move.',
    {},
    1,
  );

  const flagged = result.unarchived.map((r) => r.name);
  assert.deepEqual(flagged, ['Grin Holly', 'Ivy', 'Vareth']);
  assert.equal(result.unarchived.find((r) => r.name === 'Ivy').mentions, 2);
});

test('does not flag roles, reading labels, plurals, or shouted lines as names', () => {
  const result = auditChapter(
    [entry('Malakhim'), entry('Mage'), entry('Archer')],
    'HEADMASTER.\n\nName: Ivy\n\nRace: Malakhim Angel\n\nClass: Archer Starting Class\n\nThe Mages carved Rune Stars.',
    {},
    1,
  );

  // Ivy is a reading name; the rest are labels, plurals, or all-caps.
  assert.deepEqual(result.unarchived.map((r) => r.name), ['Ivy']);
});

test('does not flag an alias the manifest already covers', () => {
  const result = auditChapter(
    [entry('Angel Sustenance')],
    'He ate a starfruit at breakfast.',
    { 'Angel Sustenance': { at: 1, alias: ['starfruit'] } },
    1,
  );

  assert.deepEqual(result.unarchived, []);
});

test('leaves common sentence openers and one-off words alone', () => {
  const result = auditChapter(
    [],
    'If it was quiet, everyone would just go. Please, forever, somewhere. Infront stood a man.',
    {},
    1,
  );

  assert.deepEqual(result.unarchived, []);
});
