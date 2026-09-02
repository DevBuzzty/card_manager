# Cardmarket Bulk Prices (Hybrid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh every owned printing's Cardmarket EUR `trend` price daily from Cardmarket's free download files, resolving each printing's `idProduct` from the files where unambiguous and leaving only the ambiguous remainder to the existing scraper.

**Architecture:** A pure matching module (`cardmarket-bulk-parse.cjs`) + an I/O module (`cardmarket-bulk.cjs`) that downloads/caches three JSON files under `userData/cardmarket/`, resolves `cards.cm_product_id` (Step A) and applies `trend` prices in one transaction (Step B). The existing scraper (`cardmarket-scraper.cjs`) additionally captures `idProduct` from the product image URL and only works on printings whose `cm_product_id` is still NULL. `main.cjs` schedules the bulk run (30 s after start if last run > 24 h, re-checked hourly) and exposes two IPC channels; `CollectionList.jsx` gets a "Jetzt aktualisieren" button and a status line.

**Tech Stack:** Electron 40 main process (CommonJS `.cjs`), better-sqlite3, Node `https`, `node:test` for unit tests, React + Tailwind renderer.

**Spec:** `docs/superpowers/specs/2026-09-02-cardmarket-bulk-prices-design.md`

## Global Constraints

- All main-process files are **CommonJS `.cjs`** (package.json has `"type": "module"` — do not convert; renderer stays ESM).
- Work inside `desktop/`. Every command below is run from `C:\Users\Buzzty\Downloads\yugi\desktop` unless stated.
- **Run unit tests with Electron's Node** (better-sqlite3 is compiled for Electron's ABI; plain `node` fails with `NODE_MODULE_VERSION`):
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/<file>.test.cjs`
  (PowerShell: `$env:ELECTRON_RUN_AS_NODE=1; .\node_modules\.bin\electron --test electron\<file>.test.cjs`)
- `cards` primary key is composite **`(id, set_code, language, rarity)`**; every UPDATE must filter on all four.
- Price field to use from the price guide: **`trend`** (user decision). Never guess rarity by price.
- Price-guide cache max age **24 h**; product-list cache max age **7 days**; scheduler tick every **60 min**; first run **30 s** after `ready`.
- New column: `cards.cm_product_id INTEGER` (NULL = unresolved). New setting key: `cm_bulk_last_run` (ISO string). No Supabase migration.
- Bulk and scraper share the existing `cmRunning` guard in `main.cjs`; never run concurrently.
- Use the user's `rtk` prefix for git commands (`rtk git add …`, `rtk git commit …`). Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Surgical edits only: do not reformat or refactor neighbouring code.

## Reference data (from the real files, 2026-09-02)

- `price_guide_3.json` → `{ version, createdAt, priceGuides: [{ idProduct, idCategory, avg, low, trend, avg1, avg7, avg30, "avg-foil", … }] }`
- `products_singles_3.json` → `{ version, createdAt, products: [{ idProduct, name, idCategory: 5, categoryName: "Yugioh Single", idExpansion, idMetacard, dateAdded }] }` (86 809 rows; `name` is the English card name, **no rarity**)
- `products_nonsingles_3.json` → same shape, `categoryName` ∈ Booster / Display / Structure Deck / Starter Deck / Special Edition / Collector Tins / Promo Products / Lot / Event Tickets; e.g. `"Legend of Blue Eyes White Dragon Booster"` (idExpansion 1064), `"Legend of Blue Eyes White Dragon Booster Box"` (1064), `"Structure Deck: Dragon's Roar"` (1069), `"25th Anniversary Rarity Collection Booster"` (5404), `"25th Anniversary Rarity Collection Case (12 Booster Boxes)"` (5404).
- YGOPRODeck `https://db.ygoprodeck.com/api/v7/cardsets.php` → array of `{ set_name, set_code, num_of_cards, tcg_date }` where `set_code` is the **prefix** (e.g. `"LOB"`). A prefix can appear several times (`LOB` → "Legend of Blue Eyes White Dragon" **and** "Legend of Blue Eyes White Dragon (25th Anniversary Edition)").
- Ambiguity examples: "Dark Magician" in expansion 1064 has **4** products (102800, 577923, 578096, 578097); every RA01 (5404) card has **7** products (one per rarity). Both must stay unresolved by the file resolver.
- Product image URL shape on cardmarket.com: `https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg` — `idProduct` appears twice (directory + filename). **Verified live in Task 3.**

## File structure

| File | Responsibility |
|---|---|
| `electron/cardmarket-bulk-parse.cjs` (new, pure) | expansion-name derivation, expansion index, singles index, `resolveProduct`, `idProductFromImageUrl` |
| `electron/cardmarket-bulk-parse.test.cjs` (new) | unit tests for the above |
| `electron/cardmarket-bulk.cjs` (new) | file download + cache, `runBulkRefresh` (Steps A/B), `getBulkStatus` |
| `electron/cardmarket-bulk.test.cjs` (new) | integration test of `runBulkRefresh` with in-memory DB and injected file data |
| `electron/database.cjs` (modify) | `cm_product_id` migration |
| `electron/migration.test.cjs` (modify) | mirror test for the new column |
| `electron/api-handler.cjs` (modify) | export `cachedFetch` |
| `electron/cardmarket-scraper.cjs` (modify) | capture `idProduct`, write `cm_product_id`, select only unresolved printings |
| `electron/main.cjs` (modify) | scheduler, two IPC handlers |
| `electron/preload.cjs` (modify) | two wrappers |
| `src/components/CollectionList.jsx` (modify) | "Jetzt aktualisieren" button + status line, relabel scraper button |

---

### Task 1: Pure matching module `cardmarket-bulk-parse.cjs`

**Files:**
- Create: `electron/cardmarket-bulk-parse.cjs`
- Create: `electron/cardmarket-bulk-parse.test.cjs`

**Interfaces:**
- Consumes: `normName(s)` from `electron/cardmarket-parse.cjs` (lowercases, strips everything but `[a-z0-9]`).
- Produces:
  - `expansionNameFromProduct(name: string): string`
  - `buildExpansionIndex(nonsingles: Array<{name, idExpansion}>): Map<string /*normName*/, Set<number>>`
  - `buildSinglesIndex(singles: Array<{idProduct, name, idExpansion}>): Map<string /*normName*/, Array<{idProduct:number, idExpansion:number}>>`
  - `resolveProduct({ cardName: string, setNames: string[] }, { expansionIndex, singlesIndex }): { idProduct: number|null, reason: 'resolved'|'no-expansion'|'no-candidate'|'ambiguous' }`
  - `idProductFromImageUrl(url: string): number|null`

- [ ] **Step 1: Write the failing tests**

Create `electron/cardmarket-bulk-parse.test.cjs`:

```js
// desktop/electron/cardmarket-bulk-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const {
  expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl,
} = require('./cardmarket-bulk-parse.cjs');

test('expansionNameFromProduct strips sealed-product suffixes', () => {
  assert.equal(expansionNameFromProduct('Legend of Blue Eyes White Dragon Booster'), 'Legend of Blue Eyes White Dragon');
  assert.equal(expansionNameFromProduct('Legend of Blue Eyes White Dragon Booster Box'), 'Legend of Blue Eyes White Dragon');
  assert.equal(expansionNameFromProduct('25th Anniversary Rarity Collection Case (12 Booster Boxes)'), '25th Anniversary Rarity Collection');
  assert.equal(expansionNameFromProduct('25th Anniversary Rarity Collection Mini Box (5 Boosters)'), '25th Anniversary Rarity Collection');
  assert.equal(expansionNameFromProduct("Structure Deck: Dragon's Roar"), "Structure Deck: Dragon's Roar"); // no suffix -> unchanged
  assert.equal(expansionNameFromProduct('Duelist Pack: Yugi (Reprint) Booster'), 'Duelist Pack: Yugi (Reprint)');
  assert.equal(expansionNameFromProduct(''), '');
});

// Fixtures cut from the real 2026-09-02 files.
const nonsingles = [
  { name: 'Legend of Blue Eyes White Dragon Booster', idExpansion: 1064 },
  { name: 'Legend of Blue Eyes White Dragon Booster Box', idExpansion: 1064 },
  { name: "Structure Deck: Dragon's Roar", idExpansion: 1069 },
  { name: '25th Anniversary Rarity Collection Booster', idExpansion: 5404 },
  { name: '25th Anniversary Rarity Collection Case (12 Booster Boxes)', idExpansion: 5404 },
  { name: 'Duelist Pack: Yugi Booster', idExpansion: 1169 },
  { name: 'Duelist Pack: Yugi (Reprint) Booster', idExpansion: 1169 },
  { name: 'Metal Raiders Booster', idExpansion: 1077 },
];
const singles = [
  { idProduct: 102800, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 577923, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 578096, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 578097, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 102801, name: 'Dark Magician', idExpansion: 1077 },
  { idProduct: 741144, name: 'Lava Golem', idExpansion: 5404 },
  { idProduct: 741145, name: 'Lava Golem', idExpansion: 5404 },
  { idProduct: 300001, name: 'Armed Dragon LV3', idExpansion: 1069 },
];
const idx = { expansionIndex: buildExpansionIndex(nonsingles), singlesIndex: buildSinglesIndex(singles) };

test('buildExpansionIndex maps normalised expansion names to id sets', () => {
  assert.deepEqual([...idx.expansionIndex.get('legendofblueeyeswhitedragon')], [1064]);
  assert.deepEqual([...idx.expansionIndex.get('structuredeckdragonsroar')], [1069]);
  assert.deepEqual([...idx.expansionIndex.get('25thanniversaryraritycollection')], [5404]);
  assert.deepEqual([...idx.expansionIndex.get('metalraidersbooster')], [1077]); // raw product name is indexed too
  assert.equal(idx.expansionIndex.has(''), false);
});

test('buildSinglesIndex groups products by normalised card name', () => {
  assert.equal(idx.singlesIndex.get('darkmagician').length, 5);
  assert.deepEqual(idx.singlesIndex.get('armeddragonlv3'), [{ idProduct: 300001, idExpansion: 1069 }]);
});

test('resolveProduct: exactly one candidate -> resolved', () => {
  const r = resolveProduct({ cardName: 'Dark Magician', setNames: ['Metal Raiders'] }, idx);
  assert.deepEqual(r, { idProduct: 102801, reason: 'resolved' });
  const s = resolveProduct({ cardName: "Armed Dragon LV3", setNames: ["Structure Deck: Dragon's Roar"] }, idx);
  assert.equal(s.idProduct, 300001);
});

test('resolveProduct: several products in the expansion -> ambiguous, no guess', () => {
  const r = resolveProduct({ cardName: 'Dark Magician', setNames: ['Legend of Blue Eyes White Dragon'] }, idx);
  assert.deepEqual(r, { idProduct: null, reason: 'ambiguous' });
  const s = resolveProduct({ cardName: 'Lava Golem', setNames: ['25th Anniversary Rarity Collection'] }, idx);
  assert.equal(s.reason, 'ambiguous');
});

test('resolveProduct: unions all set names of a prefix (LOB + LOB 25th) before deciding', () => {
  // Both names map to expansion 1064 -> still 4 candidates -> ambiguous (not "no-expansion").
  const r = resolveProduct({ cardName: 'Dark Magician', setNames: ['Legend of Blue Eyes White Dragon', 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)'] }, idx);
  assert.equal(r.reason, 'ambiguous');
});

test('resolveProduct: unknown set name -> no-expansion; card missing in set -> no-candidate', () => {
  assert.deepEqual(resolveProduct({ cardName: 'Dark Magician', setNames: ['Some Unknown Set'] }, idx), { idProduct: null, reason: 'no-expansion' });
  assert.deepEqual(resolveProduct({ cardName: 'Lava Golem', setNames: ['Metal Raiders'] }, idx), { idProduct: null, reason: 'no-candidate' });
  assert.deepEqual(resolveProduct({ cardName: 'Dark Magician', setNames: [] }, idx), { idProduct: null, reason: 'no-expansion' });
});

test('idProductFromImageUrl reads the doubled id from the product image URL', () => {
  assert.equal(idProductFromImageUrl('https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg'), 102800);
  assert.equal(idProductFromImageUrl('https://product-images.s3.cardmarket.com/5/RA01/741144/741144.webp?v=2'), 741144);
  assert.equal(idProductFromImageUrl('https://static.cardmarket.com/img/placeholder.png'), null);
  assert.equal(idProductFromImageUrl(''), null);
  assert.equal(idProductFromImageUrl(null), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-bulk-parse.test.cjs`
Expected: FAIL with `Cannot find module './cardmarket-bulk-parse.cjs'`.

- [ ] **Step 3: Implement the module**

Create `electron/cardmarket-bulk-parse.cjs`:

```js
// desktop/electron/cardmarket-bulk-parse.cjs
// Pure helpers for resolving a printing's Cardmarket idProduct from the free download files
// (products_singles_3.json + products_nonsingles_3.json). No I/O, no Electron — unit-tested.
const { normName } = require('./cardmarket-parse.cjs');

// Cardmarket names sealed products "<Expansion> Booster", "<Expansion> Booster Box",
// "<Expansion> Case (12 Booster Boxes)", "<Expansion> Mini Box (5 Boosters)", … — strip the
// product-type tail to recover the expansion name. Structure/Starter Deck products carry the bare
// expansion name and pass through unchanged.
const SUFFIX_RE = /\s+(Booster Box|Booster|Special Edition|Tin|Pack|Set|Display|Bundle|Deck|Mini Box\b.*|Case\b.*)$/i;

function expansionNameFromProduct(name) {
  let s = String(name || '').trim();
  for (let i = 0; i < 3; i++) {            // "X Booster Box" -> "X Booster" -> "X"
    const t = s.replace(SUFFIX_RE, '').trim();
    if (t === s) break;
    s = t;
  }
  return s.replace(/[:\-–\s]+$/, '').trim();
}

// normName(expansion name) -> Set<idExpansion>. Several product variants of one expansion collapse
// onto the same key; a key pointing at >1 expansions is a genuine ambiguity handled by the caller.
function buildExpansionIndex(nonsingles) {
  const idx = new Map();
  const add = (key, id) => {
    if (!key) return;
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key).add(id);
  };
  for (const p of nonsingles || []) {
    if (p.idExpansion == null) continue;
    const id = Number(p.idExpansion);
    add(normName(expansionNameFromProduct(p.name)), id);
    add(normName(p.name), id); // raw name too: set names that legitimately end in "Set"/"Pack" ("2-Player Starter Set") still match
  }
  return idx;
}

// normName(card name) -> [{ idProduct, idExpansion }]
function buildSinglesIndex(singles) {
  const idx = new Map();
  for (const p of singles || []) {
    const key = normName(p.name);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({ idProduct: Number(p.idProduct), idExpansion: Number(p.idExpansion) });
  }
  return idx;
}

// Resolve one printing. `setNames` = every YGOPRODeck set_name sharing the printing's set-code
// prefix (e.g. LOB -> original + 25th Anniversary Edition). Exactly one product for the card in
// the union of those expansions -> resolved. Anything else -> null, never a guess.
function resolveProduct({ cardName, setNames }, { expansionIndex, singlesIndex }) {
  const expIds = new Set();
  for (const sn of setNames || []) {
    const ids = expansionIndex.get(normName(sn));
    if (ids) for (const id of ids) expIds.add(id);
  }
  if (expIds.size === 0) return { idProduct: null, reason: 'no-expansion' };
  const cands = (singlesIndex.get(normName(cardName)) || []).filter(p => expIds.has(p.idExpansion));
  if (cands.length === 0) return { idProduct: null, reason: 'no-candidate' };
  if (cands.length > 1) return { idProduct: null, reason: 'ambiguous' };
  return { idProduct: cands[0].idProduct, reason: 'resolved' };
}

// "https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg" -> 102800
function idProductFromImageUrl(url) {
  const m = String(url || '').match(/\/(\d+)\/\1\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i);
  return m ? Number(m[1]) : null;
}

module.exports = { expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-bulk-parse.test.cjs`
Expected: all tests `pass`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
rtk git add electron/cardmarket-bulk-parse.cjs electron/cardmarket-bulk-parse.test.cjs
rtk git commit -m "feat(prices): pure Cardmarket file resolver (expansion index, product resolution, image-url id)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `cm_product_id` migration

**Files:**
- Modify: `electron/database.cjs` (the `priceLockCols` block, around line 265–271)
- Modify: `electron/migration.test.cjs`

**Interfaces:**
- Produces: column `cards.cm_product_id INTEGER` (NULL default). Later tasks read/write it.

- [ ] **Step 1: Write the failing test**

Append to `electron/migration.test.cjs`:

```js
// Mirrors the extended priceLockCols block in database.cjs (cm_product_id added 2026-09-02).
function addCmProductIdColumn(db) {
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  if (!cols.includes('cm_product_id')) db.exec("ALTER TABLE cards ADD COLUMN cm_product_id INTEGER");
}

test('adds cm_product_id idempotently and defaults to NULL', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL)");
  db.exec("INSERT INTO cards VALUES ('46986414', 'LOB-DE005', 'DE', 'Ultra Rare', 1.5)");
  addCmProductIdColumn(db);
  addCmProductIdColumn(db); // second call must not throw
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  assert.ok(cols.includes('cm_product_id'));
  assert.equal(db.prepare("SELECT cm_product_id FROM cards").get().cm_product_id, null);
});
```

- [ ] **Step 2: Run it (it passes on its own — it mirrors the pattern; the real check is Step 3 + Step 4)**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/migration.test.cjs`
Expected: `pass 2`, `fail 0`.

- [ ] **Step 3: Extend the migration in `database.cjs`**

In `electron/database.cjs`, change the `priceLockCols` object (one line) from:

```js
        const priceLockCols = { cm_url: 'TEXT', cm_updated_at: 'DATETIME', price_locked: 'INTEGER DEFAULT 0' };
```
to:
```js
        // cm_product_id: Cardmarket idProduct of this exact printing (NULL = not yet resolved);
        // lets the daily bulk price refresh work from the free price-guide download without scraping.
        const priceLockCols = { cm_url: 'TEXT', cm_updated_at: 'DATETIME', price_locked: 'INTEGER DEFAULT 0', cm_product_id: 'INTEGER' };
```
The existing loop below it (`PRAGMA table_info` + `ALTER TABLE … ADD COLUMN` if missing) already adds it idempotently.

- [ ] **Step 4: Verify against the real app DB**

Run (from `desktop/`): `npm run electron:dev`, wait for the window, close it. Then:

```bash
python -c "import sqlite3,os; db=sqlite3.connect(os.path.expandvars(r'%APPDATA%\yugioh-card-manager\cards.db')); print([c[1] for c in db.execute('PRAGMA table_info(cards)') if c[1].startswith('cm_')])"
```
Expected output includes `'cm_product_id'`.

- [ ] **Step 5: Commit**

```bash
rtk git add electron/database.cjs electron/migration.test.cjs
rtk git commit -m "feat(prices): cards.cm_product_id migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Scraper captures `idProduct` and only works the unresolved remainder

**Files:**
- Modify: `electron/cardmarket-scraper.cjs` (`EXTRACT_JS` ~line 18–37; `runCardmarketScrape` ~line 80–155)

**Interfaces:**
- Consumes: `idProductFromImageUrl(url)` from Task 1; column `cm_product_id` from Task 2.
- Produces: scraper rows gain `imgSrc`; successful matches write `cm_product_id`; run selection = printings with `cm_product_id IS NULL`.

- [ ] **Step 1: Add the import**

At the top of `electron/cardmarket-scraper.cjs`, after the `cardmarket-parse.cjs` require, add:

```js
const { idProductFromImageUrl } = require('./cardmarket-bulk-parse.cjs');
```

- [ ] **Step 2: Capture the image URL in `EXTRACT_JS`**

Inside `EXTRACT_JS`, the line
```js
    const alt = col.querySelector('img')?.getAttribute('alt') || '';
```
becomes
```js
    const imgEl = col.querySelector('img');
    const alt = imgEl?.getAttribute('alt') || '';
    const imgSrc = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-echo') || '') : '';
```
and the push line
```js
    if (rarity || code) rows.push({ expansion: exp, code, rarity, trend: price });
```
becomes
```js
    if (rarity || code) rows.push({ expansion: exp, code, rarity, trend: price, imgSrc });
```

- [ ] **Step 3: Restrict the run to unresolved printings**

In `runCardmarketScrape`, change the outer cards query from
```js
    "SELECT c.id, c.name FROM cards c WHERE c.deleted = 0 AND c.quantity > 0 " +
```
to
```js
    "SELECT c.id, c.name FROM cards c WHERE c.deleted = 0 AND c.quantity > 0 AND c.cm_product_id IS NULL " +
```
Change the printings query from
```js
        "SELECT set_code, language, rarity, cm_updated_at FROM cards WHERE id = ? AND deleted = 0 AND quantity > 0"
```
to
```js
        "SELECT set_code, language, rarity, cm_updated_at, cm_product_id FROM cards WHERE id = ? AND deleted = 0 AND quantity > 0 AND cm_product_id IS NULL"
```
Update the comment above `stale` (keep the filter itself unchanged) by appending one line:
```js
      // Printings that already carry a cm_product_id are excluded above — the daily bulk refresh
      // (cardmarket-bulk.cjs) prices those from the price-guide file; scraping is only for the rest.
```

- [ ] **Step 4: Write `cm_product_id` on a match**

Replace the successful-match UPDATE
```js
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(hit.trend, url, String(cards[i].id), p.set_code, p.language, p.rarity);
```
with
```js
            const pid = idProductFromImageUrl(hit.imgSrc);
            if (!pid && !idLogged) { idLogged = true; console.warn('[cardmarket] no idProduct in image URL:', hit.imgSrc); }
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_product_id = COALESCE(?, cm_product_id), cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(hit.trend, url, pid, String(cards[i].id), p.set_code, p.language, p.rarity);
```
and declare `let idLogged = false;` next to `let updated = 0, noMatch = 0, errors = 0, scraped = 0;`.

- [ ] **Step 5: Run the existing parser tests (regression)**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-parse.test.cjs`
Expected: `fail 0`.

- [ ] **Step 6: LIVE verification of the image-URL assumption (required by the spec)**

1. `npm run electron:dev`. In the Collection tab set the dropdown to **"Ab Secret Rare"** (14 printings, ~1 min) and click **"Cardmarket-Preise"**. Solve the Cloudflare check if prompted. Wait for the summary alert.
2. Check the DB:
```bash
python -c "import sqlite3,os; db=sqlite3.connect(os.path.expandvars(r'%APPDATA%\yugioh-card-manager\cards.db')); print(db.execute(\"select count(*), sum(cm_product_id is not null) from cards where rarity='Secret Rare' and deleted=0 and quantity>0\").fetchone()); print(db.execute('select name, set_code, cm_product_id from cards where cm_product_id is not null limit 5').fetchall())"
```
Expected: second number > 0 and the ids are 5–7 digit integers. Also expected: no `[cardmarket] no idProduct in image URL` line in the Electron console.
3. **If the second number is 0** and the console shows the warning with a URL of a different shape: adjust the regex in `idProductFromImageUrl` (Task 1) to that shape, add the real URL to its test, re-run Task 1's tests, repeat this step. If the image URL carries no id at all, implement the fallback from the spec: after `EXTRACT_JS`, for each matched printing without `pid`, `await win.loadURL(hit.href)` (add `href: col.querySelector('a[href*="/Products/Singles/"]').href` to the extracted row) and read the id with `idProductFromImageUrl(document.querySelector('img[src*="product-images"]').src)`; count it as an extra page load with the same polite delay.

- [ ] **Step 7: Commit**

```bash
rtk git add electron/cardmarket-scraper.cjs
rtk git commit -m "feat(prices): scraper stores Cardmarket idProduct and only scrapes unresolved printings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Bulk module `cardmarket-bulk.cjs` (download, resolve, price)

**Files:**
- Create: `electron/cardmarket-bulk.cjs`
- Create: `electron/cardmarket-bulk.test.cjs`
- Modify: `electron/api-handler.cjs` (export `cachedFetch`, line 276)

**Interfaces:**
- Consumes: Task 1 exports; `cachedFetch(url, prefix, ttlHours)` and `fetchCardData(passcode)` from `api-handler.cjs`; columns from Task 2.
- Produces:
  - `runBulkRefresh(db, { userDataPath, force = false, files = null }) → Promise<{ resolved, priced, skipped, unresolved, reasons: Record<string, number>, error?: string, message?: string }>`
    - `files` (tests only): `{ guide: Array, singles: Array, nonsingles: Array, cardsets: Array }` bypasses all network/disk I/O.
  - `getBulkStatus(db) → { lastRun: string|null, resolvedCount: number, unresolvedCount: number }`

- [ ] **Step 1: Export `cachedFetch`**

In `electron/api-handler.cjs` change the last line
```js
module.exports = { fetchJson, fetchYugipediaSets, fetchJapaneseSets, fetchCardData };
```
to
```js
module.exports = { fetchJson, cachedFetch, fetchYugipediaSets, fetchJapaneseSets, fetchCardData };
```

- [ ] **Step 2: Write the failing integration test**

Create `electron/cardmarket-bulk.test.cjs`:

```js
// desktop/electron/cardmarket-bulk.test.cjs — runBulkRefresh against an in-memory DB with injected
// file data (no network, no disk). Run with ELECTRON_RUN_AS_NODE=1 (better-sqlite3 ABI).
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { runBulkRefresh, getBulkStatus } = require('./cardmarket-bulk.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE cards (id TEXT, name TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT,
      quantity INTEGER DEFAULT 1, price REAL, price_locked INTEGER DEFAULT 0, cm_url TEXT,
      cm_updated_at DATETIME, cm_product_id INTEGER, deleted INTEGER DEFAULT 0,
      PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  const ins = db.prepare("INSERT INTO cards (id, name, set_code, rarity, price, cm_product_id) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run('46986414', 'Dark Magician', 'MRD-DE001', 'Common', 0.5, null);       // unambiguous in files -> resolves to 102801
  ins.run('46986414', 'Dark Magician', 'LOB-DE005', 'Ultra Rare', 9.0, null);   // 4 products in LOB -> stays NULL
  ins.run('00102380', 'Lava Golem', 'RA01-DE001', 'Secret Rare', 3.0, 741145);  // already resolved -> priced from guide
  ins.run('12345678', 'Ghost Card', 'XXX-DE001', 'Common', 1.0, 999999);        // resolved but not in guide -> skipped
  return db;
}

const files = {
  cardsets: [
    { set_name: 'Metal Raiders', set_code: 'MRD' },
    { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB' },
    { set_name: 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)', set_code: 'LOB' },
    { set_name: '25th Anniversary Rarity Collection', set_code: 'RA01' },
  ],
  nonsingles: [
    { name: 'Metal Raiders Booster', idExpansion: 1077 },
    { name: 'Legend of Blue Eyes White Dragon Booster', idExpansion: 1064 },
    { name: '25th Anniversary Rarity Collection Booster', idExpansion: 5404 },
  ],
  singles: [
    { idProduct: 102800, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 577923, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 578096, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 578097, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 102801, name: 'Dark Magician', idExpansion: 1077 },
    { idProduct: 741145, name: 'Lava Golem', idExpansion: 5404 },
  ],
  guide: [
    { idProduct: 102801, trend: 0.42, low: 0.1 },
    { idProduct: 741145, trend: 12.5, low: 9.0 },
    { idProduct: 102800, trend: null, low: 20 },
  ],
};

test('runBulkRefresh resolves unambiguous printings, prices resolved ones with trend, skips the rest', async () => {
  const db = makeDb();
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res.error, undefined);
  assert.equal(res.resolved, 1);
  assert.equal(res.reasons.ambiguous, 1);
  assert.equal(res.priced, 2);      // 102801 (just resolved) + 741145
  assert.equal(res.skipped, 1);     // 999999 not in guide
  assert.equal(res.unresolved, 1);  // LOB Dark Magician

  const mrd = db.prepare("SELECT price, price_locked, cm_product_id, cm_updated_at FROM cards WHERE set_code = 'MRD-DE001'").get();
  assert.equal(mrd.cm_product_id, 102801);
  assert.equal(mrd.price, 0.42);
  assert.equal(mrd.price_locked, 1);
  assert.ok(mrd.cm_updated_at);

  const lob = db.prepare("SELECT price, cm_product_id FROM cards WHERE set_code = 'LOB-DE005'").get();
  assert.equal(lob.cm_product_id, null);
  assert.equal(lob.price, 9.0); // untouched

  const ra = db.prepare("SELECT price FROM cards WHERE set_code = 'RA01-DE001'").get();
  assert.equal(ra.price, 12.5);

  const ghost = db.prepare("SELECT price FROM cards WHERE set_code = 'XXX-DE001'").get();
  assert.equal(ghost.price, 1.0); // not in guide -> unchanged

  const st = getBulkStatus(db);
  assert.ok(st.lastRun);
  assert.equal(st.resolvedCount, 3);
  assert.equal(st.unresolvedCount, 1);
});

test('runBulkRefresh with a null trend leaves the price unchanged', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET cm_product_id = 102800 WHERE set_code = 'LOB-DE005'").run();
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(db.prepare("SELECT price FROM cards WHERE set_code = 'LOB-DE005'").get().price, 9.0);
  assert.equal(res.skipped, 2); // 102800 (null trend) + 999999
});

test('runBulkRefresh reports a download error and writes no last-run stamp', async () => {
  const db = makeDb();
  const res = await runBulkRefresh(db, { userDataPath: null, files: { error: new Error('boom') } });
  assert.equal(res.error, 'download');
  assert.equal(res.priced, 0);
  assert.equal(getBulkStatus(db).lastRun, null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-bulk.test.cjs`
Expected: FAIL with `Cannot find module './cardmarket-bulk.cjs'`.

- [ ] **Step 4: Implement the module**

Create `electron/cardmarket-bulk.cjs`:

```js
// desktop/electron/cardmarket-bulk.cjs
// Daily Cardmarket price refresh WITHOUT scraping: downloads Cardmarket's free JSON files, resolves
// each printing's idProduct where unambiguous (Step A) and applies the price-guide `trend` to every
// resolved printing in one transaction (Step B). Ambiguous printings stay NULL for the scraper.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { cachedFetch, fetchCardData } = require('./api-handler.cjs');
const { buildExpansionIndex, buildSinglesIndex, resolveProduct } = require('./cardmarket-bulk-parse.cjs');

const H = 3600 * 1000;
const FILES = {
  guide:      { url: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json',           file: 'price_guide_3.json',        maxAgeMs: 24 * H,     key: 'priceGuides' },
  singles:    { url: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_3.json',    file: 'products_singles_3.json',   maxAgeMs: 7 * 24 * H, key: 'products' },
  nonsingles: { url: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_3.json', file: 'products_nonsingles_3.json', maxAgeMs: 7 * 24 * H, key: 'products' },
};
const CARDSETS_URL = 'https://db.ygoprodeck.com/api/v7/cardsets.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0';

// Download to "<dest>.tmp", rename on success — a failed download never destroys a good cache.
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch (e) { reject(e); } }));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Return the array under spec.key, downloading when the cache is missing/stale (or forced).
// A stale cache is kept if the download fails; a corrupt/unexpected file is deleted and throws.
async function loadFile(dir, spec, force) {
  const p = path.join(dir, spec.file);
  let fresh = false;
  try { fresh = (Date.now() - fs.statSync(p).mtimeMs) < spec.maxAgeMs; } catch { /* missing */ }
  if (force || !fresh) {
    try { await download(spec.url, p); }
    catch (e) { if (!fs.existsSync(p)) throw e; console.warn('[cardmarket-bulk] download failed, using cached', spec.file, e.message); }
  }
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!json || !Array.isArray(json[spec.key])) throw new Error(`unexpected shape in ${spec.file}`);
    return json[spec.key];
  } catch (e) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    throw e;
  }
}

async function loadAll(userDataPath, force) {
  const dir = path.join(userDataPath, 'cardmarket');
  fs.mkdirSync(dir, { recursive: true });
  const guide = await loadFile(dir, FILES.guide, force);        // manual "Jetzt aktualisieren" re-pulls the guide only
  const singles = await loadFile(dir, FILES.singles, false);
  const nonsingles = await loadFile(dir, FILES.nonsingles, false);
  const cardsets = await cachedFetch(CARDSETS_URL, 'cardsets', 7 * 24);  // may be null if YGOPRODeck is down
  return { guide, singles, nonsingles, cardsets };
}

function countUnresolved(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deleted = 0 AND quantity > 0 AND cm_product_id IS NULL").get().n;
}

// Step A: resolve cm_product_id for unresolved printings from the files alone (no guessing).
async function resolveMissing(db, { singles, nonsingles, cardsets }) {
  const reasons = {};
  if (!Array.isArray(cardsets)) return { resolved: 0, reasons: { 'no-cardsets': 1 } };
  const rows = db.prepare(
    "SELECT id, name, set_code, language, rarity FROM cards WHERE deleted = 0 AND quantity > 0 AND cm_product_id IS NULL AND set_code != 'Unknown'"
  ).all();
  if (rows.length === 0) return { resolved: 0, reasons };

  const setsByPrefix = new Map();
  for (const s of cardsets) {
    const k = String(s.set_code || '').toUpperCase();
    if (!k) continue;
    if (!setsByPrefix.has(k)) setsByPrefix.set(k, []);
    setsByPrefix.get(k).push(s.set_name);
  }
  const idx = { expansionIndex: buildExpansionIndex(nonsingles), singlesIndex: buildSinglesIndex(singles) };

  const pending = [];
  for (const r of rows) {
    let cardName = r.name;
    if (!cardName) { try { cardName = (await fetchCardData(r.id))?.data?.[0]?.name || null; } catch { cardName = null; } }
    if (!cardName) { reasons['no-name'] = (reasons['no-name'] || 0) + 1; continue; }
    const setNames = setsByPrefix.get(String(r.set_code || '').split('-')[0].toUpperCase()) || [];
    const res = resolveProduct({ cardName, setNames }, idx);
    reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    if (res.idProduct) pending.push({ ...r, idProduct: res.idProduct });
  }
  const upd = db.prepare("UPDATE cards SET cm_product_id = ? WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?");
  db.transaction(() => { for (const p of pending) upd.run(p.idProduct, p.id, p.set_code, p.language, p.rarity); })();
  return { resolved: pending.length, reasons };
}

// Step B: price = trend for every resolved printing present in the guide with a non-null trend.
function applyPrices(db, guide) {
  const trendById = new Map();
  for (const g of guide) if (g && g.trend != null) trendById.set(Number(g.idProduct), Number(g.trend));
  const rows = db.prepare("SELECT id, set_code, language, rarity, cm_product_id FROM cards WHERE deleted = 0 AND cm_product_id IS NOT NULL").all();
  const upd = db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?");
  let priced = 0, skipped = 0;
  db.transaction(() => {
    for (const r of rows) {
      const t = trendById.get(Number(r.cm_product_id));
      if (t == null) { skipped++; continue; }
      upd.run(t, r.id, r.set_code, r.language, r.rarity);
      priced++;
    }
  })();
  return { priced, skipped };
}

// Entry point. `files` (tests only) injects { guide, singles, nonsingles, cardsets } or { error }.
async function runBulkRefresh(db, { userDataPath, force = false, files = null } = {}) {
  let data;
  try {
    if (files && files.error) throw files.error;
    data = files || await loadAll(userDataPath, force);
  } catch (e) {
    console.error('[cardmarket-bulk] load failed:', e.message);
    return { error: 'download', message: e.message, resolved: 0, priced: 0, skipped: 0, unresolved: countUnresolved(db), reasons: {} };
  }
  const a = await resolveMissing(db, data);
  const b = applyPrices(db, data.guide);
  db.prepare("INSERT INTO settings (key, value) VALUES ('cm_bulk_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date().toISOString());
  const out = { resolved: a.resolved, reasons: a.reasons, priced: b.priced, skipped: b.skipped, unresolved: countUnresolved(db) };
  console.log('[cardmarket-bulk]', JSON.stringify(out));
  return out;
}

function getBulkStatus(db) {
  const last = db.prepare("SELECT value FROM settings WHERE key = 'cm_bulk_last_run'").get();
  const c = db.prepare(
    "SELECT SUM(cm_product_id IS NOT NULL) AS r, SUM(cm_product_id IS NULL) AS u FROM cards WHERE deleted = 0 AND quantity > 0"
  ).get();
  return { lastRun: last ? last.value : null, resolvedCount: c.r || 0, unresolvedCount: c.u || 0 };
}

module.exports = { runBulkRefresh, getBulkStatus };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-bulk.test.cjs electron/cardmarket-bulk-parse.test.cjs`
Expected: `fail 0`.

Note: `require('./api-handler.cjs')` pulls in `database.cjs`, which only opens a DB when `initDatabase` is called — requiring it in the test is safe.

- [ ] **Step 6: Commit**

```bash
rtk git add electron/cardmarket-bulk.cjs electron/cardmarket-bulk.test.cjs electron/api-handler.cjs
rtk git commit -m "feat(prices): Cardmarket bulk refresh from price-guide download (resolve + trend)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Scheduler + IPC in `main.cjs`, wrappers in `preload.cjs`

**Files:**
- Modify: `electron/main.cjs` (require block line ~10; `let cmPollInterval;` line ~71; `app.whenReady` line ~80–85; after `startCardmarketPoller()` definition line ~576)
- Modify: `electron/preload.cjs` (after line 26 `onCmChallenge`)

**Interfaces:**
- Consumes: `runBulkRefresh`, `getBulkStatus` (Task 4); existing `cmRunning`, `getSetting`, `mainWindow`, `userDataPath`, `db`.
- Produces: IPC `cardmarket-bulk-refresh` → result of `runBulkRefresh` or `{ busy: true }`; IPC `cardmarket-bulk-status` → `getBulkStatus(db)`; `window.api.cardmarketBulkRefresh()`, `window.api.cardmarketBulkStatus()`.

- [ ] **Step 1: Require and interval variable**

After `const { runCardmarketScrape } = require('./cardmarket-scraper.cjs');` add:
```js
const { runBulkRefresh, getBulkStatus } = require('./cardmarket-bulk.cjs');
```
After `let cmPollInterval;` add:
```js
let cmBulkInterval;
```

- [ ] **Step 2: Start the scheduler**

In `app.whenReady().then(() => { … })`, after `startCardmarketPoller();` add:
```js
  startCardmarketBulkScheduler();
```

- [ ] **Step 3: Scheduler + IPC handlers**

Directly after the closing `}` of `function startCardmarketPoller()` insert:

```js
// Daily Cardmarket bulk refresh (no scraping): 30 s after start if the last run is older than 24 h,
// re-checked hourly so "daily" survives the app not being open at a fixed time. A failed download
// leaves cm_bulk_last_run untouched, so the next hourly tick simply retries.
function bulkDue() {
  const last = getSetting('cm_bulk_last_run');
  return !last || (Date.now() - new Date(last).getTime()) > 24 * 60 * 60 * 1000;
}
function notifyBulk(res) {
  if (res && res.priced > 0 && mainWindow) {
    const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards WHERE deleted = 0').get();
    mainWindow.webContents.send('price-update', { updates: [], totalValue: stats.totalValue || 0 });
  }
}
function startCardmarketBulkScheduler() {
  const tick = async () => {
    if (!mainWindow || cmRunning || !bulkDue()) return;
    cmRunning = true;
    try { notifyBulk(await runBulkRefresh(db, { userDataPath })); }
    catch (e) { console.error('Cardmarket bulk error:', e); }
    finally { cmRunning = false; }
  };
  setTimeout(tick, 30 * 1000);
  if (cmBulkInterval) clearInterval(cmBulkInterval);
  cmBulkInterval = setInterval(tick, 60 * 60 * 1000);
}

ipcMain.handle('cardmarket-bulk-refresh', async () => {
  if (cmRunning) return { busy: true };
  cmRunning = true;
  try { const res = await runBulkRefresh(db, { userDataPath, force: true }); notifyBulk(res); return res; }
  catch (e) { console.error('Cardmarket bulk error:', e); return { error: 'internal', message: String(e && e.message || e) }; }
  finally { cmRunning = false; }
});
ipcMain.handle('cardmarket-bulk-status', () => {
  try { return getBulkStatus(db); } catch (e) { return { lastRun: null, resolvedCount: 0, unresolvedCount: 0 }; }
});
```

- [ ] **Step 4: Preload wrappers**

In `electron/preload.cjs`, after the `onCmChallenge` line add:
```js
  cardmarketBulkRefresh: () => ipcRenderer.invoke('cardmarket-bulk-refresh'),
  cardmarketBulkStatus: () => ipcRenderer.invoke('cardmarket-bulk-status'),
```

- [ ] **Step 5: Verify the first automatic run**

`npm run electron:dev`. Within ~30–60 s the Electron console (terminal) must show a line like
`[cardmarket-bulk] {"resolved":…,"reasons":{…},"priced":…,"skipped":…,"unresolved":…}` (first run downloads ~26 MB; allow up to a minute on a slow line).
Then:
```bash
python -c "import sqlite3,os; db=sqlite3.connect(os.path.expandvars(r'%APPDATA%\yugioh-card-manager\cards.db')); print(db.execute('select value from settings where key=\"cm_bulk_last_run\"').fetchone()); print(db.execute('select sum(cm_product_id is not null), sum(cm_product_id is null) from cards where deleted=0 and quantity>0').fetchone())"
```
Expected: an ISO timestamp, and the resolved count is a large share of the 1187 printings (most Commons). Files exist under `%APPDATA%\yugioh-card-manager\cardmarket\`.
If the resolved share is unexpectedly small, print `reasons` from the console line: a high `no-expansion` count means the set-name ↔ booster-name normalisation misses common patterns — inspect a few set names via the python snippet `select distinct substr(set_code,1,instr(set_code,'-')-1) from cards where cm_product_id is null` and extend `SUFFIX_RE` (Task 1, with a test) accordingly.

- [ ] **Step 6: Commit**

```bash
rtk git add electron/main.cjs electron/preload.cjs
rtk git commit -m "feat(prices): schedule daily Cardmarket bulk refresh + IPC (refresh/status)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Collection UI — "Jetzt aktualisieren" + status line

**Files:**
- Modify: `src/components/CollectionList.jsx` (state ~line 49–53; effects ~line 56–70; `loadCollection` ~line 93–98; header buttons ~line 266–300)

**Interfaces:**
- Consumes: `window.api.cardmarketBulkRefresh()`, `window.api.cardmarketBulkStatus()` (Task 5).

- [ ] **Step 1: State + status loader**

After `const [cmAuto, setCmAuto] = useState(false);` add:
```js
  const [cmBulkBusy, setCmBulkBusy] = useState(false);
  const [cmStatus, setCmStatus] = useState(null); // { lastRun, resolvedCount, unresolvedCount }

  const loadCmStatus = async () => {
    const s = await window.api?.cardmarketBulkStatus?.();
    if (s) setCmStatus(s);
  };
  const relTime = (iso) => {
    if (!iso) return 'noch nie';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'gerade eben';
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60);
    if (h < 48) return `vor ${h} Std.`;
    return `vor ${Math.round(h / 24)} Tagen`;
  };
```

Inside `loadCollection`, after `setRawCards(result);` add:
```js
      loadCmStatus();
```

- [ ] **Step 2: Bulk handler**

After the `runCardmarket` function add:
```js
  const runBulk = async () => {
    setCmBulkBusy(true);
    try {
      const r = await window.api.cardmarketBulkRefresh();
      if (r?.busy) { alert('Cardmarket läuft gerade schon (Scraper oder Update). Bitte kurz warten.'); return; }
      if (r?.error) { alert(`Cardmarket-Update fehlgeschlagen: ${r.message || r.error}`); return; }
      alert(`Cardmarket-Update fertig: ${r.priced} Preise aus der Datei gesetzt, ${r.resolved} neu zugeordnet, ${r.unresolved} offen (per Scraper).`);
      loadCollection();
    } finally { setCmBulkBusy(false); }
  };
```

- [ ] **Step 3: Buttons + status line**

Replace the existing scraper button
```jsx
                    <button onClick={cmRunning ? () => window.api.abortCardmarketScrape() : runCardmarket}
                            className="px-3 py-1.5 rounded bg-space-violet/80 hover:bg-space-violet text-white text-sm">
                      {cmRunning ? `Abbrechen${cmProgress ? ` (${cmProgress.current}/${cmProgress.total})` : ''}` : 'Cardmarket-Preise'}
                    </button>
```
with
```jsx
                    <button onClick={cmRunning ? () => window.api.abortCardmarketScrape() : runCardmarket}
                            title="Nur die noch nicht zugeordneten Printings per Cardmarket-Seite nachladen"
                            className="px-3 py-1.5 rounded bg-gray-800 hover:bg-space-violet text-gray-300 hover:text-white text-sm border border-gray-700">
                      {cmRunning ? `Abbrechen${cmProgress ? ` (${cmProgress.current}/${cmProgress.total})` : ''}` : 'Rest scrapen'}
                    </button>
                    <button onClick={runBulk} disabled={cmBulkBusy || cmRunning}
                            title="Preise aller zugeordneten Printings aus Cardmarkets täglicher Preisdatei (Trend) übernehmen"
                            className="px-3 py-1.5 rounded bg-space-violet/80 hover:bg-space-violet text-white text-sm disabled:opacity-50">
                      {cmBulkBusy ? 'Aktualisiere…' : 'Jetzt aktualisieren'}
                    </button>
```
Change the Auto label text `Auto` to `Auto (Rest per Scraper)` and its `title` to
`"Offene Printings automatisch im Hintergrund scrapen (alle 10 Min. ein paar)"`.

Directly after the closing `</div>` of that button row (the one that follows the buttons, before `{/* Segment control */}`) insert the status line:
```jsx
            {cmStatus && (
              <div className="text-xs text-gray-500 -mt-2">
                Cardmarket: Letztes Update {relTime(cmStatus.lastRun)} · {cmStatus.resolvedCount} per Datei · {cmStatus.unresolvedCount} offen
              </div>
            )}
```
(If the header row's parent uses `space-y-*`, the `-mt-2` keeps the line tight; drop it if it overlaps.)

- [ ] **Step 4: Lint + visual check**

Run: `npm run lint`
Expected: no new errors in `CollectionList.jsx`.
Run: `npm run electron:dev` → Collection tab shows "Rest scrapen", "Jetzt aktualisieren" and the status line with real numbers. Click "Jetzt aktualisieren": finishes within seconds, alert shows counts, status line refreshes ("gerade eben").

- [ ] **Step 5: Commit**

```bash
rtk git add src/components/CollectionList.jsx
rtk git commit -m "feat(prices): Collection UI — Jetzt aktualisieren (bulk) + Cardmarket status line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end verification and docs

**Files:**
- Modify: `CLAUDE.md` (repo root; the "Price source" bullet in *Domain model*)
- Modify: `docs/superpowers/specs/2026-09-02-cardmarket-bulk-prices-design.md` (status line only)

- [ ] **Step 1: Full test run**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-parse.test.cjs electron/cardmarket-bulk-parse.test.cjs electron/cardmarket-bulk.test.cjs electron/migration.test.cjs`
Expected: `fail 0`.

- [ ] **Step 2: Live scenario**

1. `npm run electron:dev`; wait for the automatic bulk line in the console (or click "Jetzt aktualisieren").
2. Tick "Auto (Rest per Scraper)", set dropdown to "Alle Rarities", wait ≥ 10 min: the scraper poller must log/update only unresolved printings and the "offen" number in the status line must go down after a reload of the Collection tab.
3. Open a Common that was resolved by the file (status "per Datei"): its price should equal the Cardmarket trend shown on cardmarket.com for that expansion (spot-check one card in the browser).
4. Confirm the phone (Supabase sync) shows the new prices after the next sync — `price` is already a mirrored column; nothing new to configure.

- [ ] **Step 3: Update docs**

In `CLAUDE.md` (repo root), in the *Domain model* section, append to the "Price source" bullet:

```
  Per-rarity **Cardmarket EUR** prices come from `electron/cardmarket-bulk.cjs`: a daily bulk refresh reads Cardmarket's free `price_guide_3.json` (`trend`) for every printing with a known `cm_product_id`, resolving ids from `products_singles_3.json` + `products_nonsingles_3.json` where unambiguous. `electron/cardmarket-scraper.cjs` only scrapes printings whose `cm_product_id` is still NULL (several rarities of one card in one expansion) and stores the id it finds. Rows with `price_locked = 1` are skipped by the YGOPRODeck poller.
```

In the spec header change `**Status:** Approved (brainstorm), pending implementation plan` to `**Status:** Implemented 2026-09-xx` (fill in the actual date).

- [ ] **Step 4: Commit**

```bash
rtk git add CLAUDE.md docs/superpowers/specs/2026-09-02-cardmarket-bulk-prices-design.md
rtk git commit -m "docs: Cardmarket bulk price refresh (hybrid) — CLAUDE.md + spec status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
