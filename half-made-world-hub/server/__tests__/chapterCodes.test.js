// Registering a chapter code is refused when the code is already taken or when
// the chapter already has a code, so one code per chapter stays true.
// Run with: npm run test:server
const test = require('node:test');
const assert = require('node:assert/strict');

const { chapterCodeConflict } = require('../index.js');

const codes = { 'ch1-aaa': 1, 'ch2-bbb': 2 };

test('accepts an unused code on an unused chapter', () => {
  assert.equal(chapterCodeConflict(codes, 'ch3-ccc', 3), null);
});

test('rejects a code that is already registered', () => {
  const conflict = chapterCodeConflict(codes, 'ch1-aaa', 7);
  assert.equal(conflict.field, 'code');
  assert.match(conflict.error, /already registered/i);
});

test('rejects a second code for a chapter that already has one', () => {
  const conflict = chapterCodeConflict(codes, 'ch1-zzz', 1);
  assert.equal(conflict.field, 'chapter');
  assert.match(conflict.error, /Chapter 1 already has a code \(ch1-aaa\)/);
});

test('a code being edited may keep its own name and chapter', () => {
  assert.equal(chapterCodeConflict(codes, 'ch1-aaa', 1, 'ch1-aaa'), null);
});

test('a renamed code may keep its own chapter', () => {
  assert.equal(chapterCodeConflict(codes, 'ch1-renamed', 1, 'ch1-aaa'), null);
});

test('an edited code may not take another chapter that is taken', () => {
  const conflict = chapterCodeConflict(codes, 'ch1-aaa', 2, 'ch1-aaa');
  assert.equal(conflict.field, 'chapter');
  assert.match(conflict.error, /Chapter 2 already has a code \(ch2-bbb\)/);
});

test('an edited code may not take another code’s name', () => {
  const conflict = chapterCodeConflict(codes, 'ch2-bbb', 1, 'ch1-aaa');
  assert.equal(conflict.field, 'code');
});
