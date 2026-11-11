#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const serverDataDir = resolve(__dirname, '../server/data');
const clientPublicDir = resolve(__dirname, '../client/public');

const files = {
  entries: 'world.json',
  relationships: 'relationships.json',
  storyLinks: 'story-links.json',
};

const snapshot = {};
for (const [key, file] of Object.entries(files)) {
  const raw = await readFile(resolve(serverDataDir, file), 'utf8');
  snapshot[key] = JSON.parse(raw);
}

// Chapter codes are optional on disk; ship an empty map if absent.
try {
  const raw = await readFile(resolve(serverDataDir, 'chapter-codes.json'), 'utf8');
  snapshot.chapterCodes = JSON.parse(raw);
} catch {
  snapshot.chapterCodes = {};
}

await writeFile(
  resolve(clientPublicDir, 'snapshot.json'),
  JSON.stringify(snapshot, null, 2),
  'utf8',
);

console.log(`Wrote client/public/snapshot.json (${Object.keys(snapshot).length} keys)`);
