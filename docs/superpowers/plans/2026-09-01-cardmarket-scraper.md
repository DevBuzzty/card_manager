# Cardmarket Price Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every collection printing an accurate Cardmarket EUR *Trend* price per rarity, by scraping owned cards' Cardmarket product pages from a hidden Electron browser window on the user's own machine/IP.

**Architecture:** A pure, unit-tested matcher (`cardmarket-parse.cjs`) maps scraped version rows `{expansion, rarity, trend}` to a collection printing `(setName, rarity)`. A scraper module (`cardmarket-scraper.cjs`) drives a hidden `BrowserWindow` (persistent session), extracts rows in-page via `executeJavaScript` (real DOM), detects Cloudflare challenges (shows the window for the user, then resumes), and writes prices to SQLite with a `price_locked` flag the YGOPRODeck poller respects. Prices sync to Supabase → phone shows them.

**Tech Stack:** Electron (main process CommonJS `.cjs`), better-sqlite3, React (Vite) renderer, Node's built-in `node --test` for the pure matcher. No new runtime dependencies.

## Global Constraints

- Main-process files are **CommonJS `.cjs`**; renderer is **ESM** under `desktop/src/`. Do not convert either. (verbatim from CLAUDE.md)
- Any new IPC channel MUST be added in **both** `main.cjs` (handler) and `preload.cjs` (exposed wrapper). (verbatim from CLAUDE.md)
- `cards` primary key is `(id, set_code, language, rarity)`; a printing's identity includes rarity.
- Schema changes go in `database.cjs` as **additive** `IF NOT EXISTS` / add-missing-column migrations.
- Cardmarket **Trend** price is the value to store. Skip printings whose `cm_updated_at` is < **7 days** old on a bulk run.
- Scraper runs **sequentially**, **2–4 s polite delay** per page, on the user's residential IP; the user solves the occasional Cloudflare/captcha challenge manually.
- SQLite timestamps are naive UTC; the codebase appends `"Z"` before parsing. Reuse that convention for `cm_updated_at` age math.

---

### Task 1: Pure matcher + normalizers (TDD)

The tricky fuzzy logic — mapping a scraped version row to a collection printing — with no browser or HTML involved. Fully unit-tested.

**Files:**
- Create: `desktop/electron/cardmarket-parse.cjs`
- Test: `desktop/electron/cardmarket-parse.test.cjs`

**Interfaces:**
- Produces:
  - `normRarity(s: string) => string` — lowercased, letters only.
  - `normName(s: string) => string` — lowercased, alphanumerics only.
  - `RARITY_SYNONYMS: Record<string,string>` — maps Cardmarket rarity labels to our canonical rarity, both normalised.
  - `matchRow(rows: Array<{expansion:string, rarity:string, trend:number|null}>, setName: string, rarity: string) => {expansion,rarity,trend} | null` — the single confident match, else `null`.

- [ ] **Step 1: Write the failing test**

```js
// desktop/electron/cardmarket-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { normRarity, normName, matchRow } = require('./cardmarket-parse.cjs');

test('normRarity strips non-letters and lowercases', () => {
  assert.equal(normRarity('Ultra Rare'), 'ultrarare');
  assert.equal(normRarity("Collector's Rare"), 'collectorsrare');
});

test('normName strips punctuation and lowercases', () => {
  assert.equal(normName('Structure Deck: Wave of Light'), 'structuredeckwaveoflight');
});

const rows = [
  { expansion: 'Structure Deck: Wave of Light', rarity: 'Ultra Rare', trend: 0.30 },
  { expansion: 'Structure Deck: Wave of Light', rarity: 'Secret Rare', trend: 1.20 },
  { expansion: '25th Anniversary Rarity Collection', rarity: 'Quarter Century Secret Rare', trend: 9.0 },
];

test('matchRow picks the exact expansion + rarity row', () => {
  const m = matchRow(rows, 'Structure Deck: Wave of Light', 'Secret Rare');
  assert.equal(m.trend, 1.20);
});

test('matchRow matches expansion fuzzily (punctuation/case differ)', () => {
  const m = matchRow(rows, 'structure deck - wave of light', 'Ultra Rare');
  assert.equal(m.trend, 0.30);
});

test('matchRow maps a rarity synonym (Quarter Century)', () => {
  const m = matchRow(rows, '25th Anniversary Rarity Collection', 'Quarter Century Secret Rare');
  assert.equal(m.trend, 9.0);
});

test('matchRow returns null when rarity is absent in that expansion', () => {
  assert.equal(matchRow(rows, 'Structure Deck: Wave of Light', 'Ghost Rare'), null);
});

test('matchRow returns null when no expansion matches', () => {
  assert.equal(matchRow(rows, 'Some Other Set', 'Ultra Rare'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test desktop/electron/cardmarket-parse.test.cjs`
Expected: FAIL — `Cannot find module './cardmarket-parse.cjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// desktop/electron/cardmarket-parse.cjs
// Pure helpers for matching a scraped Cardmarket version row to a collection printing.
// No browser / HTML here — the DOM extraction lives in the scraper (executeJavaScript).

function normRarity(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Cardmarket rarity label (normalised) -> our canonical rarity (normalised). Extend as needed.
const RARITY_SYNONYMS = {
  common: 'common',
  rare: 'rare',
  superrare: 'superrare',
  ultrarare: 'ultrarare',
  secretrare: 'secretrare',
  ultimaterare: 'ultimaterare',
  ghostrare: 'ghostrare',
  collectorsrare: 'collectorsrare',
  starlightrare: 'starlightrare',
  quartercenturysecretrare: 'quartercenturysecretrare',
  prismaticsecretrare: 'prismaticsecretrare',
  goldrare: 'goldrare',
  platinumsecretrare: 'platinumsecretrare',
};

function rarityKey(s) {
  const n = normRarity(s);
  return RARITY_SYNONYMS[n] || n;
}

// Best confident match, or null. Requires the rarity to match exactly (after synonym mapping)
// and the expansion to match fuzzily (one contains the other after normalisation).
function matchRow(rows, setName, rarity) {
  const wantRar = rarityKey(rarity);
  const wantExp = normName(setName);
  if (!wantExp) return null;
  const candidates = (rows || []).filter(r => rarityKey(r.rarity) === wantRar);
  const hit = candidates.filter(r => {
    const e = normName(r.expansion);
    return e === wantExp || e.includes(wantExp) || wantExp.includes(e);
  });
  return hit.length === 1 ? hit[0] : null;
}

module.exports = { normRarity, normName, RARITY_SYNONYMS, matchRow };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test desktop/electron/cardmarket-parse.test.cjs`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/cardmarket-parse.cjs desktop/electron/cardmarket-parse.test.cjs
git commit -m "feat(cardmarket): pure version-row matcher + rarity/name normalizers"
```

---

### Task 2: DB migration — price lock columns + poller skip

Adds the three columns and makes the YGOPRODeck price poller leave locked rows alone.

**Files:**
- Modify: `desktop/electron/database.cjs` (the `required` add-missing-column list, ~line 154)
- Modify: `desktop/electron/main.cjs` (the price-poller `SELECT` of stalest cards, ~line 519)
- Test: `desktop/electron/migration.test.cjs`

**Interfaces:**
- Produces (schema): `cards.cm_url TEXT`, `cards.cm_updated_at DATETIME`, `cards.price_locked INTEGER DEFAULT 0`.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing test** (additive columns are created on an existing table)

```js
// desktop/electron/migration.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

// Mirrors the add-missing-column pattern in database.cjs for the three new columns.
function addPriceLockColumns(db) {
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  const adds = {
    cm_url: "ALTER TABLE cards ADD COLUMN cm_url TEXT",
    cm_updated_at: "ALTER TABLE cards ADD COLUMN cm_updated_at DATETIME",
    price_locked: "ALTER TABLE cards ADD COLUMN price_locked INTEGER DEFAULT 0",
  };
  for (const [name, sql] of Object.entries(adds)) if (!cols.includes(name)) db.exec(sql);
}

test('adds cm columns idempotently', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL)");
  addPriceLockColumns(db);
  addPriceLockColumns(db); // second call must not throw
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  assert.ok(cols.includes('cm_url'));
  assert.ok(cols.includes('cm_updated_at'));
  assert.ok(cols.includes('price_locked'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test desktop/electron/migration.test.cjs`
Expected: FAIL only if better-sqlite3 isn't built. If it fails to *find* better-sqlite3, run `npm --prefix desktop install` first. Otherwise this test passes immediately (it defines its own helper) — that's fine; it documents and guards the exact SQL we add to `database.cjs` in Step 3.

- [ ] **Step 3: Add the columns to `database.cjs`**

Find the `required` add-missing-column block (it lists columns like `'quantity','rarity','set_code',...`). Add the three columns using the SAME mechanism already there. If that block adds columns by name with a type map, add:

```js
// in the add-missing-column section of database.cjs (match the existing style):
// cm_url TEXT, cm_updated_at DATETIME, price_locked INTEGER DEFAULT 0
const priceLockCols = { cm_url: 'TEXT', cm_updated_at: 'DATETIME', price_locked: 'INTEGER DEFAULT 0' };
const existingCols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
for (const [name, type] of Object.entries(priceLockCols)) {
  if (!existingCols.includes(name)) db.exec(`ALTER TABLE cards ADD COLUMN ${name} ${type}`);
}
```

Place this AFTER the existing column-migration block and BEFORE the PK migrations, so `table_info` reflects the current table.

- [ ] **Step 4: Make the price poller skip locked rows in `main.cjs`**

Change the stalest-cards query (currently `SELECT id, set_code, language, rarity, price FROM cards WHERE deleted = 0 ORDER BY last_updated ASC LIMIT 50`) to also require the row is not locked:

```js
const cards = db.prepare('SELECT id, set_code, language, rarity, price FROM cards WHERE deleted = 0 AND (price_locked IS NULL OR price_locked = 0) ORDER BY last_updated ASC LIMIT 50').all();
```

- [ ] **Step 5: Verify**

Run: `node --test desktop/electron/migration.test.cjs` → PASS.
Then launch the app (`npm --prefix desktop run electron:dev`), open DevTools console on the main process log, and confirm no migration error; the three columns exist (the app starts normally).

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/database.cjs desktop/electron/main.cjs desktop/electron/migration.test.cjs
git commit -m "feat(cardmarket): cm_url/cm_updated_at/price_locked columns + poller skips locked rows"
```

---

### Task 3: Manual price override IPC

A locked, user-set price per printing — the always-correct fallback. Backend only; UI is Task 6.

**Files:**
- Modify: `desktop/electron/main.cjs` (new `set-card-price` handler)
- Modify: `desktop/electron/preload.cjs` (expose `setCardPrice`)

**Interfaces:**
- Produces (IPC): `set-card-price({ id, set_code, language, rarity, price }) => { success }` — sets `price`, `price_locked = 1` on that exact printing.
- Produces (preload): `window.api.setCardPrice(data)`.

- [ ] **Step 1: Add the handler in `main.cjs`** (near `update-card-meta`)

```js
ipcMain.handle('set-card-price', (event, { id, set_code, language, rarity, price }) => {
  try {
    if (!id || !set_code) return { success: false, error: 'Missing id or set_code' };
    db.prepare("UPDATE cards SET price = ?, price_locked = 1 WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
      .run(Number(price) || 0, String(id), set_code, language || 'DE', rarity || 'Unknown');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
```

- [ ] **Step 2: Expose it in `preload.cjs`** (in the `window.api` object)

```js
setCardPrice: (data) => ipcRenderer.invoke('set-card-price', data),
```

- [ ] **Step 3: Verify**

Launch `electron:dev`; in the renderer DevTools console run:
`await window.api.setCardPrice({ id:'46986414', set_code:'LOB-EN005', language:'DE', rarity:'Ultra Rare', price:12.5 })`
Expected: `{ success: true }`; the collection shows 12.50 € for that printing and the poller no longer overwrites it.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(cardmarket): set-card-price IPC (manual per-printing price + lock)"
```

---

### Task 4: Scraper module (hidden window, extract, run loop)

The engine: hidden `BrowserWindow` with persistent session, resolve a card's Cardmarket URL, extract version rows in-page, detect Cloudflare challenges, loop over stale owned cards, write matched Trend prices. Browser-only → verified live (no unit test).

**Files:**
- Create: `desktop/electron/cardmarket-scraper.cjs`

**Interfaces:**
- Consumes: `matchRow` from Task 1; `fetchCardData` from `api-handler.cjs`; the `cards` table.
- Produces: `runCardmarketScrape(db, { onProgress, shouldAbort, onChallenge }) => Promise<{updated, noMatch, errors}>` — bulk-scrapes owned, stale printings and writes Trend prices with `price_locked = 1`.

- [ ] **Step 1: Create the module**

```js
// desktop/electron/cardmarket-scraper.cjs
// Scrapes per-rarity Cardmarket EUR "Trend" prices for owned cards, via a hidden BrowserWindow
// (real Chromium on the user's residential IP). Sequential + polite; the user solves the rare
// Cloudflare/captcha challenge manually, then the run resumes.
const { BrowserWindow, session } = require('electron');
const { matchRow } = require('./cardmarket-parse.cjs');
const { fetchCardData } = require('./api-handler.cjs');

const BASE = 'https://www.cardmarket.com';
const DELAY_MS = 3000;                 // polite delay between pages
const FRESH_MS = 7 * 24 * 3600 * 1000; // skip printings priced < 7 days ago

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In-page DOM extraction. Cardmarket renders each printing as a row in the versions/offer table;
// this reads expansion name, rarity (from the rarity icon's title/aria-label), and the Trend price.
// NOTE: selectors are pinned against a live page during Step 3 and adjusted there.
const EXTRACT_JS = `(() => {
  const num = (t) => { const m = (t||'').replace(/\\./g,'').replace(',', '.').match(/[0-9]+(?:\\.[0-9]+)?/); return m ? parseFloat(m[0]) : null; };
  const rows = [];
  // Versions table rows (adjust selector against the real page in Step 3):
  document.querySelectorAll('.table-body > .row, table tbody tr').forEach(tr => {
    const exp = (tr.querySelector('[data-expansion], .expansion-name, a[href*="/Products/Singles/"]')?.textContent || '').trim();
    const rar = (tr.querySelector('[aria-label*="Rare"], [title*="Rare"], .icon[title]')?.getAttribute('title')
              || tr.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();
    const trendCell = Array.from(tr.querySelectorAll('td, .col')).map(c => c.textContent).join(' ');
    const trend = num(trendCell);
    if (exp || rar) rows.push({ expansion: exp, rarity: rar, trend });
  });
  return rows;
})()`;

function looksLikeChallenge(html, title) {
  const t = (title || '').toLowerCase(), h = (html || '').toLowerCase();
  return t.includes('just a moment') || t.includes('attention required')
      || h.includes('cf-challenge') || h.includes('challenge-platform') || h.includes('turnstile');
}

async function makeWindow() {
  const ses = session.fromPartition('persist:cardmarket'); // cookies survive between runs
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session: ses, sandbox: true } });
  return win;
}

// Navigate; if a Cloudflare/captcha challenge is up, surface the window and wait for the real page.
async function loadPage(win, url, onChallenge) {
  await win.loadURL(url);
  for (let i = 0; i < 60; i++) { // up to ~2 min for a human to solve
    const title = win.webContents.getTitle();
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => '');
    if (!looksLikeChallenge(html, title)) return true;
    if (i === 0) { win.show(); onChallenge && onChallenge(); }
    await sleep(2000);
  }
  return false; // still challenged after timeout
}

// Resolve a card's Cardmarket product/metacard URL via search (first Singles result).
async function resolveUrl(win, name, onChallenge) {
  const url = `${BASE}/en/YuGiOh/Products/Search?searchString=${encodeURIComponent(name)}`;
  if (!(await loadPage(win, url, onChallenge))) return null;
  const href = await win.webContents.executeJavaScript(
    `(document.querySelector('a[href*="/en/YuGiOh/Products/Singles/"]')||{}).href || null`
  ).catch(() => null);
  return href || null;
}

async function runCardmarketScrape(db, { onProgress, shouldAbort, onChallenge } = {}) {
  // Distinct owned cards (one page scrape covers all their printings).
  const cards = db.prepare(
    "SELECT DISTINCT id, name FROM cards WHERE deleted = 0 AND quantity > 0"
  ).all();
  const now = Date.now();
  let updated = 0, noMatch = 0, errors = 0;
  const win = await makeWindow();
  try {
    for (let i = 0; i < cards.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      onProgress && onProgress({ current: i + 1, total: cards.length, name: cards[i].name });
      const printings = db.prepare(
        "SELECT set_code, language, rarity, cm_updated_at FROM cards WHERE id = ? AND deleted = 0 AND quantity > 0"
      ).all(String(cards[i].id));
      // Skip if every printing was priced recently.
      const stale = printings.filter(p => !p.cm_updated_at || (now - new Date(p.cm_updated_at + 'Z').getTime()) > FRESH_MS);
      if (stale.length === 0) continue;
      try {
        const name = cards[i].name || (await fetchCardData(cards[i].id))?.data?.[0]?.name;
        if (!name) { noMatch++; continue; }
        const url = await resolveUrl(win, name, onChallenge);
        if (!url) { noMatch++; continue; }
        if (!(await loadPage(win, url, onChallenge))) { errors++; continue; }
        const rows = await win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []);
        for (const p of stale) {
          const setName = await setNameFor(cards[i].id, p.set_code);
          const hit = setName ? matchRow(rows, setName, p.rarity) : null;
          if (hit && hit.trend != null) {
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(hit.trend, url, String(cards[i].id), p.set_code, p.language, p.rarity);
            updated++;
          } else {
            db.prepare("UPDATE cards SET cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ? AND cm_url IS NULL")
              .run(String(cards[i].id), p.set_code, p.language, p.rarity); // mark attempted (no match)
            noMatch++;
          }
        }
      } catch (e) { errors++; }
      await sleep(DELAY_MS);
    }
  } finally { win.destroy(); }
  return { updated, noMatch, errors };
}

// Set NAME for a (passcode, set_code) via YGOPRODeck card_sets (cached in api-handler).
async function setNameFor(id, setCode) {
  try {
    const card = await fetchCardData(id);
    const sets = card?.data?.[0]?.card_sets || [];
    const hit = sets.find(s => s.set_code === setCode);
    return hit ? hit.set_name : null;
  } catch { return null; }
}

module.exports = { runCardmarketScrape };
```

- [ ] **Step 2: Wire a temporary dev trigger to capture a real page + pin selectors**

Temporarily, in `main.cjs`, add `ipcMain.handle('cm-dev-dump', async () => { /* open one product page, return outerHTML */ })` OR simplest: run the scraper once (via Task 5's button) with the window `show:true`, open its DevTools, and inspect the versions table. **Pin the three selectors in `EXTRACT_JS`** (expansion, rarity, trend) against the real DOM. Remove any temporary dev trigger before committing.

- [ ] **Step 3: Verify live**

With Task 5 wired, run the scrape on a small collection. Confirm in logs/DB that Trend prices land on the correct rarity rows (e.g. Maiden of White: Secret ≠ Ultra), and that a Cloudflare challenge shows the window and resumes after you solve it.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/cardmarket-scraper.cjs
git commit -m "feat(cardmarket): hidden-window scraper — resolve, extract, match, write Trend prices"
```

---

### Task 5: IPC wiring — trigger, progress, abort

Exposes the scraper to the renderer with progress + abort, reusing the `update-progress` channel.

**Files:**
- Modify: `desktop/electron/main.cjs` (import scraper; `scrape-cardmarket-prices` + `abort-cardmarket-scrape`)
- Modify: `desktop/electron/preload.cjs` (wrappers + progress listener)

**Interfaces:**
- Consumes: `runCardmarketScrape` from Task 4.
- Produces (IPC): `scrape-cardmarket-prices() => {updated,noMatch,errors}`; `abort-cardmarket-scrape()`.
- Produces (preload): `window.api.scrapeCardmarketPrices()`, `window.api.abortCardmarketScrape()`, and the existing `onUpdateProgress` covers progress.

- [ ] **Step 1: Handlers in `main.cjs`**

```js
const { runCardmarketScrape } = require('./cardmarket-scraper.cjs');
let cmAbort = false;
ipcMain.handle('abort-cardmarket-scrape', () => { cmAbort = true; return { success: true }; });
ipcMain.handle('scrape-cardmarket-prices', async (event) => {
  cmAbort = false;
  const send = (p) => { try { event.sender.send('update-progress', p); } catch (e) {} };
  const res = await runCardmarketScrape(db, {
    onProgress: (p) => send({ current: p.current, total: p.total }),
    shouldAbort: () => cmAbort,
    onChallenge: () => { try { event.sender.send('cm-challenge'); } catch (e) {} },
  });
  send({ current: 1, total: 1 }); // clears the bar
  return res;
});
```

- [ ] **Step 2: Wrappers in `preload.cjs`**

```js
scrapeCardmarketPrices: () => ipcRenderer.invoke('scrape-cardmarket-prices'),
abortCardmarketScrape: () => ipcRenderer.invoke('abort-cardmarket-scrape'),
onCmChallenge: (cb) => { const l = () => cb(); ipcRenderer.on('cm-challenge', l); return () => ipcRenderer.removeListener('cm-challenge', l); },
```

- [ ] **Step 3: Verify**

Launch `electron:dev`; in renderer console: `await window.api.scrapeCardmarketPrices()` → returns a summary object; progress events fire on `onUpdateProgress`.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(cardmarket): scrape/abort IPC + progress + challenge event"
```

---

### Task 6: Renderer — button, progress, manual field, badge

**Files:**
- Modify: `desktop/src/components/CollectionList.jsx` (Cardmarket button + progress + abort + challenge toast)
- Modify: `desktop/src/components/CardDetailModal.jsx` (manual price field per printing + "kein CM-Treffer" badge)

**Interfaces:**
- Consumes: `window.api.scrapeCardmarketPrices/abortCardmarketScrape/onCmChallenge/onUpdateProgress` (Task 5); `window.api.setCardPrice` (Task 3).

- [ ] **Step 1: Add the Cardmarket button + progress to `CollectionList.jsx`**

```jsx
// state
const [cmRunning, setCmRunning] = useState(false);
const [cmProgress, setCmProgress] = useState(null);
useEffect(() => {
  const off = window.api?.onUpdateProgress?.((p) => setCmProgress(p));
  const offCh = window.api?.onCmChallenge?.(() => alert('Cardmarket: bitte kurz das Captcha/Cloudflare im geöffneten Fenster lösen — es läuft dann automatisch weiter.'));
  return () => { off && off(); offCh && offCh(); };
}, []);
const runCardmarket = async () => {
  setCmRunning(true);
  try { const r = await window.api.scrapeCardmarketPrices(); alert(`Cardmarket fertig: ${r.updated} aktualisiert, ${r.noMatch} ohne Treffer, ${r.errors} Fehler.`); }
  finally { setCmRunning(false); setCmProgress(null); }
};
```

```jsx
{/* near the existing Update All / Fetch Missing buttons */}
<button onClick={cmRunning ? () => window.api.abortCardmarketScrape() : runCardmarket}
        className="px-3 py-1.5 rounded bg-space-violet/80 hover:bg-space-violet text-white text-sm">
  {cmRunning ? `Abbrechen${cmProgress ? ` (${cmProgress.current}/${cmProgress.total})` : ''}` : 'Cardmarket-Preise'}
</button>
```

- [ ] **Step 2: Add the manual price field + badge in `CardDetailModal.jsx`** (in the per-variant row, near quantity/delete)

```jsx
<input
  type="number" step="0.01" min="0"
  defaultValue={variant.price ?? 0}
  onBlur={async (e) => {
    const price = parseFloat(e.target.value);
    if (isNaN(price)) return;
    await window.api.setCardPrice({ id: card.id, set_code: variant.set_code, language: variant.language || 'DE', rarity: variant.rarity, price });
  }}
  className="w-16 bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white"
  title="Preis manuell setzen (überschreibt Auto-Preis)"
/>
{variant.cm_updated_at && !variant.cm_url && (
  <span className="text-[9px] text-yellow-500/80" title="Auf Cardmarket nicht eindeutig gefunden">kein CM-Treffer</span>
)}
```

- [ ] **Step 3: Verify**

`npm --prefix desktop run build` passes. In `electron:dev`: the "Cardmarket-Preise" button runs a scrape with a live progress count and an abort; editing a printing's price field persists and locks it; a card with no CM match shows the badge.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/CollectionList.jsx desktop/src/components/CardDetailModal.jsx
git commit -m "feat(cardmarket): collection scrape button + progress + manual price field/badge"
```

---

### Task 7: Supabase migration — price-lock columns on the cloud

So the phone renders the synced Cardmarket prices.

**Files:**
- Create: `supabase/cards_price_lock_migration.sql`
- Modify: `supabase/schema.sql` (add the three columns for fresh setups)

**Interfaces:** cloud `cards` gains `cm_url text`, `cm_updated_at timestamptz`, `price_locked boolean default false`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/cards_price_lock_migration.sql
-- Trusted per-rarity prices (Cardmarket scrape or manual) sync from desktop; the phone just reads them.
alter table public.cards add column if not exists cm_url text;
alter table public.cards add column if not exists cm_updated_at timestamptz;
alter table public.cards add column if not exists price_locked boolean not null default false;
```

- [ ] **Step 2: Update `schema.sql`** — add the three columns to the `create table public.cards (...)` body (above the primary key line).

- [ ] **Step 3: Verify** — user runs `cards_price_lock_migration.sql` in the Supabase SQL editor; no error; the columns appear.

- [ ] **Step 4: Commit**

```bash
git add supabase/cards_price_lock_migration.sql supabase/schema.sql
git commit -m "feat(cardmarket): supabase price-lock columns for synced Cardmarket prices"
```

---

## Self-Review

**Spec coverage:**
- Architecture / hidden window / persistent session → Task 4. ✓
- Matching (setName+rarity → row) → Task 1 (matcher) + Task 4 (in-page extraction + `setNameFor`). ✓
- Data model (cm_url, cm_updated_at, price_locked; poller skip; 7-day staleness) → Task 2 + Task 4. ✓
- Autonomy / Cloudflare / captcha (challenge detect → show window → resume; polite delay; progress; abort) → Task 4 + Task 5 + Task 6. ✓
- UI + fallback (button, progress, no-match badge, manual price field) → Task 6; manual price IPC → Task 3. ✓
- Supabase/phone sync → Task 7. ✓
- Testing (pure matcher unit tests; migration guard; live scrape manual) → Task 1, Task 2, Task 4 Step 3. ✓
- Risks/ToS → documented in spec; scraper is sequential + delayed + human-in-loop (Task 4 constants). ✓

**Placeholder scan:** The only intentionally-live-pinned part is the three CSS selectors in `EXTRACT_JS` (Task 4 Step 2), which cannot be finalized without the real (Cloudflare-gated) page — the plan makes pinning them an explicit step against the live DOM. Everything else is concrete.

**Type consistency:** `matchRow(rows, setName, rarity)`, `runCardmarketScrape(db, {onProgress, shouldAbort, onChallenge})`, `setCardPrice({id,set_code,language,rarity,price})`, and the `{updated,noMatch,errors}` summary are used identically across tasks.
