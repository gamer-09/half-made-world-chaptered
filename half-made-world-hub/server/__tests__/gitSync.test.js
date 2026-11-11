const { test, mock } = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');

const MODULE = require.resolve('../git-sync');

// git-sync captures execFile when it loads, so patch the module first and load a
// fresh copy. `handler` returns the fake stdout/stderr for one git invocation.
function loadWithGit(handler) {
  delete require.cache[MODULE];
  const original = cp.execFile;
  const calls = [];
  cp.execFile = (cmd, args, opts, cb) => {
    calls.push(args);
    const res = handler(args) || {};
    queueMicrotask(() => cb(res.error || null, res.stdout || '', res.stderr || ''));
  };
  const mod = require('../git-sync');
  return {
    mod,
    calls,
    restore() {
      cp.execFile = original;
      delete require.cache[MODULE];
    },
  };
}

// A finished commit chain resolves across several microtask turns; real
// setImmediate keeps those flowing even while setTimeout is mocked.
async function settle() {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function withMockTimers() {
  mock.timers.enable({ apis: ['setTimeout'] });
}

test('commits and pushes only the chapter-code files', async () => {
  withMockTimers();
  const { mod, calls, restore } = loadWithGit((args) => {
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
      return { stdout: 'true\n' };
    }
    if (args[0] === 'rev-parse') return { stdout: 'main\n' };
    return {};
  });
  try {
    await mod.scheduleChapterCodeCommit({ action: 'register', code: 'ch2-bbb' });
    mock.timers.tick(1000);
    await settle();

    const verbs = calls.map((args) => args[0]);
    assert.deepStrictEqual(verbs, ['rev-parse', 'status', 'add', 'commit', 'rev-parse', 'push']);

    const commit = calls.find((args) => args[0] === 'commit');
    assert.ok(commit.includes('--'), 'commit is pathspec-scoped');
    for (const file of mod.CODE_FILES) assert.ok(commit.includes(file), `commit includes ${file}`);
    for (const file of mod.ARCHIVE_DATA_FILES) {
      assert.ok(!commit.includes(file), `commit excludes ${file}`);
    }

    const push = calls.find((args) => args[0] === 'push');
    assert.deepStrictEqual(push.slice(0, 3), ['push', 'origin', 'main']);
  } finally {
    restore();
    mock.timers.reset();
  }
});

test('holds the push while archive data files are uncommitted', async () => {
  withMockTimers();
  const { mod, calls, restore } = loadWithGit((args) => {
    if (args[0] === 'rev-parse') return { stdout: 'true\n' };
    if (args[0] === 'status') return { stdout: ' M half-made-world-hub/server/data/world.json\n' };
    return {};
  });
  try {
    await mod.scheduleChapterCodeCommit({ action: 'register', code: 'ch2-bbb' });
    mock.timers.tick(1000);
    await settle();

    assert.deepStrictEqual(
      calls.map((args) => args[0]),
      ['rev-parse', 'status'],
    );
  } finally {
    restore();
    mock.timers.reset();
  }
});

test('does nothing when AUTO_PUSH_CHAPTER_CODES is false', async () => {
  const previous = process.env.AUTO_PUSH_CHAPTER_CODES;
  process.env.AUTO_PUSH_CHAPTER_CODES = 'false';
  const { mod, calls, restore } = loadWithGit(() => ({ stdout: 'true\n' }));
  try {
    await mod.scheduleChapterCodeCommit({ action: 'register', code: 'ch2-bbb' });
    assert.strictEqual(calls.length, 0);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AUTO_PUSH_CHAPTER_CODES;
    else process.env.AUTO_PUSH_CHAPTER_CODES = previous;
  }
});
