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

test('commits and pushes only the chapter-code file', async () => {
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
    assert.deepStrictEqual(verbs, ['rev-parse', 'add', 'commit', 'rev-parse', 'push']);

    const commit = calls.find((args) => args[0] === 'commit');
    assert.ok(commit.includes('--'), 'commit is pathspec-scoped');
    for (const file of mod.CODE_FILES) assert.ok(commit.includes(file), `commit includes ${file}`);
    // The generated snapshot is gitignored; naming it would fail the commit.
    assert.deepStrictEqual(mod.CODE_FILES, ['half-made-world-hub/server/data/chapter-codes.json']);

    const push = calls.find((args) => args[0] === 'push');
    assert.deepStrictEqual(push.slice(0, 3), ['push', 'origin', 'main']);
  } finally {
    restore();
    mock.timers.reset();
  }
});

test('reports the git error, not a line-ending warning', async () => {
  withMockTimers();
  const { mod, restore } = loadWithGit((args) => {
    if (args[0] === 'rev-parse') return { stdout: 'true\n' };
    if (args[0] === 'commit') {
      return {
        error: new Error('Command failed: git commit'),
        stderr:
          "warning: in the working copy of 'chapter-codes.json', LF will be replaced by CRLF " +
          'the next time Git touches it\n' +
          'error: pathspec did not match any file(s) known to git\n',
      };
    }
    return {};
  });
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(String(line));
  try {
    await mod.scheduleChapterCodeCommit({ action: 'register', code: 'ch2-bbb' });
    mock.timers.tick(1000);
    await settle();

    assert.equal(logged.length, 1);
    assert.match(logged[0], /pathspec/);
    assert.doesNotMatch(logged[0], /LF will be replaced/);
  } finally {
    console.error = original;
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
