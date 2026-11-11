/**
 * Live E2E verification: hard-refresh the deployed GitHub Pages site,
 * open a LONG entry, expand it, and assert every sentence renders
 * exactly once (the save-then-expand duplication regression).
 *
 * Usage: node scripts/e2e-live-expansion.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SITE = process.argv[3] || 'https://gamer-09.github.io/half-made-world-chaptered/';

// The entry to inspect — must exist in the deployed snapshot.
const TARGET_ENTRY = process.argv[2] || 'The World Core Faith'; // 12.5k chars, no ## sections (the buggy branch)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  // ── 1. Hard refresh: cold cache load of the live site ──
  await page.setCacheEnabled(false);
  console.log('Loading (hard refresh):', SITE);
  await page.goto(SITE, { waitUntil: 'networkidle0', timeout: 60000 });

  // Wait for the app shell to render
  await page.waitForSelector('.search-input', { timeout: 30000 });
  console.log('✓ app shell rendered');

  // Confirm the deployed bundle is the fixed one: the old buggy build
  // contained a second chunks.slice(1) render pass. We can't read the
  // bundle directly from here, but we verify behavior below instead.

  // ── 2. Search for the target entry ──
  await page.click('.search-input');
  await page.type('.search-input', TARGET_ENTRY);
  await new Promise((r) => setTimeout(r, 800)); // debounce

  // ── 3. Open the entry card ──
  await page.waitForSelector('.entry-card', { timeout: 15000 });
  const cards = await page.$$('.entry-card');
  let opened = false;
  for (const card of cards) {
    const name = await card.$eval('.entry-card-name', (el) => el.textContent || '');
    if (name.toLowerCase().includes(TARGET_ENTRY.toLowerCase())) {
      await card.click();
      opened = true;
      break;
    }
  }
  if (!opened) throw new Error('Target entry card not found: ' + TARGET_ENTRY);
  console.log('✓ opened entry:', TARGET_ENTRY);

  // Wait for the detail view
  await page.waitForSelector('.detail', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));

  // ── 4. Grab the collapsed-state text ──
  const collapsedText = await page.$eval('.detail', (el) => el.innerText || '');

  // ── 5. Expand fully (Read full description OR Expand all sections) ──
  const expandBtn = await page.$('.desc-expand-btn');
  if (!expandBtn) {
    console.log('! No expand button found — entry rendered fully expanded already');
  } else {
    const label = await expandBtn.evaluate((el) => el.textContent || '');
    console.log('✓ expand button found:', JSON.stringify(label.trim()));
    await expandBtn.click();
    await new Promise((r) => setTimeout(r, 600));
    // If sections view: click "Expand all sections" may need a second pass
    const more = await page.$('.desc-section-toggle');
    if (more && label.includes('Expand all')) {
      // already expanded all — nothing to do
    }
  }

  // ── 6. Count duplication in the expanded text ──
  const expandedText = await page.$eval('.detail', (el) => el.innerText || '');

  // Sentence-level duplication check: split into sentences, count repeats
  const sentences = expandedText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 60); // ignore short fragments/buttons

  const counts = new Map();
  for (const s of sentences) {
    const key = s.slice(0, 80);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1);

  console.log('');
  console.log('── RESULTS ──');
  console.log('collapsed length:', collapsedText.length, 'chars');
  console.log('expanded length:', expandedText.length, 'chars');
  console.log('expanded grew after expanding:', expandedText.length > collapsedText.length ? 'YES ✓' : 'NO (already expanded?)');
  console.log('sentences analyzed:', sentences.length);
  console.log('duplicated sentences (2+ occurrences):', duplicated.length);

  if (duplicated.length) {
    console.log('');
    console.log('DUPES FOUND:');
    for (const [s, n] of duplicated.slice(0, 10)) console.log('  x' + n + ' — ' + s);
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('✅ PASS — no sentence appears more than once in the expanded view.');
  }

  // Screenshot for the record
  await page.screenshot({ path: 'scripts/live-expansion-check.png', fullPage: false });
  console.log('screenshot: scripts/live-expansion-check.png');
} finally {
  await browser.close();
}
