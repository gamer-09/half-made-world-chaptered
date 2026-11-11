/**
 * Auto-push for chapter codes.
 *
 * A registered code only reaches readers once it is committed: the deployed
 * build ships the committed client/public/snapshot.json, and the server's
 * chapter-codes.json is the source of truth the snapshot is generated from.
 * So when an author registers, edits, or deletes a code locally, the hub
 * commits those two files and pushes them.
 *
 * Deliberately narrow:
 *   - only ever stages the two chapter-code artifacts by name (a pathspec
 *     commit), so unrelated work in the tree is never swept in;
 *   - refuses to run while archive data files are dirty, because syncAll()
 *     folds that data into snapshot.json and we would be publishing edits the
 *     author never committed;
 *   - failures are logged and swallowed — registering a code must never fail
 *     because git or the network did.
 *
 * Disable with AUTO_PUSH_CHAPTER_CODES=false.
 */
const path = require('path');
const { execFile } = require('child_process');

const REPO_DIR = path.resolve(__dirname, '..', '..');
const APP_DIR = 'half-made-world-hub';

// The only files a code change is allowed to publish.
const CODE_FILES = [
  `${APP_DIR}/server/data/chapter-codes.json`,
  `${APP_DIR}/client/public/snapshot.json`,
];

// If any of these are dirty, snapshot.json would carry uncommitted archive
// edits, so we hold the push until the author has dealt with them.
const ARCHIVE_DATA_FILES = [
  `${APP_DIR}/server/data/world.json`,
  `${APP_DIR}/server/data/relationships.json`,
  `${APP_DIR}/server/data/story-links.json`,
];

const DEBOUNCE_MS = 900;

let pendingMeta = null;
let timer = null;
let running = false;
let repoChecked = false;
let repoUsable = true;

function autoPushEnabled() {
  return String(process.env.AUTO_PUSH_CHAPTER_CODES ?? 'true').toLowerCase() !== 'false';
}

function git(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: REPO_DIR, windowsHide: true, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function firstLine(text) {
  return String(text || '').trim().split(/\r?\n/)[0] || '';
}

async function usableRepo() {
  if (repoChecked) return repoUsable;
  repoChecked = true;
  try {
    const inside = await git(['rev-parse', '--is-inside-work-tree']);
    repoUsable = inside === 'true';
    if (!repoUsable) console.warn('[git] chapter codes will not be pushed: not a git work tree');
  } catch (err) {
    repoUsable = false;
    console.warn(`[git] chapter codes will not be pushed: ${firstLine(err.stderr) || err.message}`);
  }
  return repoUsable;
}

function commitMessage(meta) {
  const action = meta.action || 'update';
  const code = meta.code ? ` ${meta.code}` : '';
  return (
    `chapter codes: ${action}${code}\n\n` +
    'Saved through the local hub, which commits and pushes chapter codes so the ' +
    'deployed site can redeem them.'
  );
}

async function commitOnce(meta) {
  try {
    const dirtyArchive = await git(['status', '--porcelain', '--', ...ARCHIVE_DATA_FILES]);
    if (dirtyArchive) {
      console.warn(
        '[git] chapter code saved but not pushed: archive data files have uncommitted ' +
          'changes that would be published inside snapshot.json',
      );
      return;
    }

    await git(['add', '--', ...CODE_FILES]);

    // Pathspec commit, so only these files can enter the commit.
    await git(['commit', '-m', commitMessage(meta), '--', ...CODE_FILES]);

    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    await git(['push', 'origin', branch || 'HEAD']);
    console.log(`[git] chapter codes pushed (${meta.action || 'update'}${meta.code ? ': ' + meta.code : ''})`);
  } catch (err) {
    const detail = firstLine(err.stderr) || err.message;
    // "nothing to commit" just means the file was already committed.
    if (/nothing to commit|no changes added/i.test(detail)) return;
    console.error(`[git] chapter code auto-commit failed: ${detail}`);
  }
}

async function flush() {
  if (running) return;
  running = true;
  try {
    const meta = pendingMeta;
    pendingMeta = null;
    if (meta) await commitOnce(meta);
  } finally {
    running = false;
    // A change arrived while we were pushing: run again once we're free.
    if (pendingMeta) scheduleChapterCodeCommit({});
  }
}

/**
 * Queue a commit for the chapter-code files. Bursts of edits coalesce into one
 * commit; the most recent action and code name the commit.
 */
async function scheduleChapterCodeCommit(meta = {}) {
  if (!autoPushEnabled()) return;
  if (!(await usableRepo())) return;

  pendingMeta = { ...(pendingMeta || {}), ...meta };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, DEBOUNCE_MS);
  if (timer.unref) timer.unref();
}

module.exports = { scheduleChapterCodeCommit, CODE_FILES, ARCHIVE_DATA_FILES };
