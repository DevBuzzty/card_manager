# Spec A — Exemplare mit Edition und Zustand: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every physical card becomes a `card_copies` row with edition + condition; `cards.quantity` becomes a trigger-maintained cache; valuation uses fixed condition factors; price changes are recorded in `price_history`; desktop, Supabase and Android stay in sync — without any mandatory dialog in the scan flow.

**Architecture:** A new `card_copies` table (UUID per physical copy, pointing at the 4-column printing key of `cards`) is the source of truth for counts. SQLite and Postgres triggers recount `cards.quantity`/`deleted` on every copy change, so read paths keep working unchanged while write paths switch from "bump quantity" to "insert/soft-delete copies". `sync.cjs` gets a second stream for copies (UUID key, `updated_at` cursor, soft-delete, echo-skip) and stops pushing `quantity`. Pure valuation helpers (`valueOf`) exist in JS (main + renderer) and Kotlin and share one JSON factor table. A one-time desktop-only backfill creates the copies for the existing collection; the phone refuses to create copies for a printing that has none yet (prevents duplicates).

**Tech Stack:** Electron main = CommonJS `.cjs` + better-sqlite3 12; renderer = React 19 / Vite (ESM); Android = Kotlin 2.0 / Compose / OkHttp REST against Supabase (no supabase-kt); Supabase Postgres SQL applied by the user in the dashboard. Tests: Node `node:test`; SQLite tests must run under Electron's Node (`ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>` from `desktop/`, Git Bash); Kotlin JVM unit tests via `./gradlew :app:testDebugUnitTest` (JUnit 4).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-spec-a-copies-edition-condition-design.md`. Programme overview (cross-spec columns to pre-create): `docs/superpowers/specs/2026-09-05-supercharge-programme-overview.md`.
- Electron main files stay CommonJS `.cjs`; renderer stays ESM. Never convert one to the other.
- Printing identity is the 4-column key `(id, set_code, language, rarity)` everywhere. Never match on 3 columns in NEW code.
- **Never `DELETE FROM cards` or `DELETE FROM card_copies`** — soft-delete only (`deleted = 1` / `true`), otherwise deletions never reach the phone.
- Condition codes: exactly `MT NM EX GD LP PL PO`. Edition codes: exactly `first unlimited limited unknown`. Factors: MT 1.00, NM 1.00, EX 0.85, GD 0.70, LP 0.50, PL 0.35, PO 0.20. Edition has no factor in A.
- Defaults: `default_condition = 'NM'`, `default_edition = 'unknown'` (desktop `settings` table, Android `scanner_prefs`).
- `quantity` must NOT be in the sync push payload after Task 6. Pull patches only `deleted` on existing rows.
- Backfill runs ONLY on the desktop, guarded by setting `copies_migrated = '1'`. Cloud SQL creates no copies.
- Pre-create the cross-spec columns now (overview doc): `card_copies.container_id TEXT, page INTEGER, slot INTEGER, tags TEXT, note TEXT, needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT, for_sale INTEGER NOT NULL DEFAULT 0`; `price_history.variant TEXT NOT NULL DEFAULT 'base'` **inside the primary key**; `cards.price_first_ed REAL, cm_first_ed_updated_at DATETIME`; `portfolio_history.sealed_value REAL NOT NULL DEFAULT 0`. No UI for them in A.
- Supabase `cards` has no `user_id`; RLS policy is "any authenticated". New tables follow that exact pattern (`for all to authenticated using (true) with check (true)`), no `user_id` column.
- Kotlin: minSdk 26, compileSdk 34, Kotlin 2.0.0 / AGP 8.2.2 — do not add dependencies built against newer Kotlin. `org.json` is used for JSON; JVM unit tests need the real `org.json` artifact (added in Task 11).
- UI strings: German (Zustand, Edition, Exemplar, Übernehmen, Unbek., 1st Ed, Unlimited, Limited).
- Commit style: `feat(scope): …` / `fix(scope): …` / `test(scope): …` with scope `desktop`, `sync`, `android`, `cloud`. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Dev note: `electron .` cannot run while the installed app is open (both bind :4000).

## File Structure

| File | Responsibility |
|---|---|
| `desktop/electron/condition-factors.json` (new) | The one factor table `{ "MT":1, "NM":1, "EX":0.85, "GD":0.7, "LP":0.5, "PL":0.35, "PO":0.2 }`. Read by main (`require`), renderer (Vite JSON import), Kotlin test (file read). Lives in `electron/` (not `shared/`) because electron-builder only packages `dist/**`, `electron/**`. |
| `desktop/electron/valuation.cjs` (new) | `CONDITIONS`, `EDITIONS`, `conditionFactor`, `valueOf`, `factorCaseSql`, `totalValue(db)`, `copyCount(db)`. |
| `desktop/electron/copies-schema.cjs` (new) | `ensureCopiesSchema(db)` (tables, indexes, triggers), `backfillCopies(db)` (guarded), `getSetting/setSetting` local helpers. |
| `desktop/electron/copies.cjs` (new) | Copy mutations on an open db: `listCopies`, `groupCopies`, `addCopies`, `removeCopies` (standard-first rule), `moveCopies`, `updateCopyGroup`, `softDeletePrinting`, `defaults(db)`. |
| `desktop/electron/price-history.cjs` (new) | `recordPrice(db, printing, price, source)` with the "only if changed, one per day" rule. |
| `desktop/electron/database.cjs` | Calls `ensureCopiesSchema` + `backfillCopies`; adds `cards.price_first_ed`, `cm_first_ed_updated_at`, `portfolio_history.sealed_value`. |
| `desktop/electron/main.cjs` | Handlers switch to copies; new IPC `list-copies`, `add-copy`, `remove-copy`, `update-copy-group`, `get-defaults`; value columns in `get-collection`; `price_history` hooks; `totalValue(db)` everywhere. |
| `desktop/electron/preload.cjs` | Expose the new IPC. |
| `desktop/electron/sync.cjs` | Copies stream, `quantity` out of push, `deleted`-only patch, price_history push, valuation snapshot. |
| `desktop/electron/cardmarket-bulk.cjs`, `cardmarket-scraper.cjs` | Call `recordPrice` after a price write. |
| `desktop/src/utils/valuation.js` (new) | Renderer twin: `CONDITIONS`, `EDITIONS`, `EDITION_LABELS`, `conditionFactor`, `valueOf`, `groupCopies`. |
| `desktop/src/components/CopyChip.jsx` (new) | The `NM · Unbek.` chip with the two selects. |
| `desktop/src/components/StagingArea.jsx`, `CardDetailModal.jsx`, `CollectionList.jsx`, `CardTile.jsx`, `Settings.jsx`, `Portfolio.jsx`, `Statistics.jsx`, `Dashboard.jsx` | UI changes listed per task. |
| `supabase/card_copies_schema.sql`, `supabase/price_history_schema.sql` (new) | Cloud tables, recount trigger, RLS, RPC extension. User applies in dashboard. |
| `android/.../cloud/CopyRow.kt`, `cloud/Valuation.kt` (new) | Copy model + factor table + `valueOf`. |
| `android/.../cloud/CollectionRepository.kt` | `loadCopies`, `addCopies`, `removeCopies`, `updateCopyGroup`, `isMigrated`; `addScanned`/`addPrinting` create copies; `setQuantity` removed. |
| `android/.../ui/ScanStagingScreen.kt`, `CardDetailScreen.kt`, `CollectionScreen.kt`, `Dashboard.kt`, `PortfolioScreen.kt`, `UebersichtScreen.kt`, `SettingsScreen.kt`, `AddPrintingSection.kt`, `SearchScreen.kt`, new `ui/CopyChip.kt` | UI changes listed per task. |
| `android/app/src/test/java/com/example/yugiohscanner/ValuationTest.kt` (new) | JUnit test comparing Kotlin factors with the JSON file. |

---

### Task 1: Valuation core (factor table + JS helpers, main and renderer)

**Files:**
- Create: `desktop/electron/condition-factors.json`
- Create: `desktop/electron/valuation.cjs`
- Create: `desktop/electron/valuation.test.cjs`
- Create: `desktop/src/utils/valuation.js`
- Create: `desktop/src/utils/valuation.test.mjs`

**Interfaces:**
- Produces (main): `const { CONDITIONS, EDITIONS, conditionFactor, valueOf, factorCaseSql, totalValue, copyCount } = require('./valuation.cjs')`
  - `conditionFactor(code: string): number` — unknown/blank → 1.0
  - `valueOf(price: number|null, copies: Array<{condition: string, count?: number}>): number`
  - `factorCaseSql(col: string): string` — SQL `CASE <col> WHEN 'EX' THEN 0.85 … ELSE 1.0 END`
  - `totalValue(db): number` — Σ price × factor over live copies of live cards
  - `copyCount(db): number` — live copies
- Produces (renderer): `import { CONDITIONS, EDITIONS, EDITION_LABELS, conditionFactor, valueOf, groupCopies } from '../utils/valuation'`
  - `groupCopies(copies): Array<{edition, condition, count}>` sorted by edition order `first, limited, unlimited, unknown` then condition order `MT…PO`

- [ ] **Step 1: Create the factor table**

`desktop/electron/condition-factors.json`:
```json
{ "MT": 1, "NM": 1, "EX": 0.85, "GD": 0.7, "LP": 0.5, "PL": 0.35, "PO": 0.2 }
```

- [ ] **Step 2: Write the failing main-process test**

`desktop/electron/valuation.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { CONDITIONS, EDITIONS, conditionFactor, valueOf, factorCaseSql, totalValue, copyCount } = require('./valuation.cjs');

test('condition codes and factors', () => {
  assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
  assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
  assert.equal(conditionFactor('NM'), 1);
  assert.equal(conditionFactor('GD'), 0.7);
  assert.equal(conditionFactor(''), 1, 'blank condition counts as NM');
  assert.equal(conditionFactor('XX'), 1, 'unknown code counts as NM');
});

test('valueOf sums price × factor over copies (count optional)', () => {
  assert.equal(valueOf(10, [{ condition: 'NM' }, { condition: 'GD' }]), 17);
  assert.equal(valueOf(10, [{ condition: 'NM', count: 2 }, { condition: 'PO', count: 1 }]), 22);
  assert.equal(valueOf(null, [{ condition: 'NM' }]), 0);
  assert.equal(valueOf(10, []), 0);
});

test('factorCaseSql + totalValue/copyCount against a tiny db', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL, deleted INTEGER DEFAULT 0);
           CREATE TABLE card_copies (copy_id TEXT PRIMARY KEY, card_id TEXT, set_code TEXT, language TEXT, rarity TEXT, condition TEXT, deleted INTEGER DEFAULT 0);`);
  db.exec(`INSERT INTO cards VALUES ('1','LOB-DE001','DE','Ultra Rare',10,0);
           INSERT INTO card_copies VALUES ('a','1','LOB-DE001','DE','Ultra Rare','NM',0);
           INSERT INTO card_copies VALUES ('b','1','LOB-DE001','DE','Ultra Rare','GD',0);
           INSERT INTO card_copies VALUES ('c','1','LOB-DE001','DE','Ultra Rare','NM',1);`);
  assert.match(factorCaseSql('cp.condition'), /CASE cp\.condition WHEN 'MT' THEN 1/);
  assert.equal(totalValue(db), 17);
  assert.equal(copyCount(db), 2);
});
```

- [ ] **Step 3: Run it — expect "Cannot find module './valuation.cjs'"**

Run (from `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/valuation.test.cjs`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `valuation.cjs`**

`desktop/electron/valuation.cjs`:
```js
const FACTORS = require('./condition-factors.json');

const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];

function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

// copies: [{ condition, count? }] — count defaults to 1.
function valueOf(price, copies) {
  const p = Number(price) || 0;
  if (!p || !copies || copies.length === 0) return 0;
  let f = 0;
  for (const c of copies) f += conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(p * f * 100) / 100;
}

// SQL CASE expression turning a condition column into its factor (for SUM(price * factor)).
function factorCaseSql(col) {
  const whens = CONDITIONS.map(c => `WHEN '${c}' THEN ${FACTORS[c]}`).join(' ');
  return `CASE ${col} ${whens} ELSE 1.0 END`;
}

// Live copies of live printings, joined on the 4-column printing key.
const LIVE_JOIN = `FROM card_copies cp JOIN cards c
  ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
  WHERE cp.deleted = 0 AND c.deleted = 0`;

function totalValue(db) {
  const r = db.prepare(`SELECT COALESCE(SUM(COALESCE(c.price, 0) * ${factorCaseSql('cp.condition')}), 0) AS total ${LIVE_JOIN}`).get();
  return Math.round((r.total || 0) * 100) / 100;
}

function copyCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n ${LIVE_JOIN}`).get().n || 0;
}

module.exports = { FACTORS, CONDITIONS, EDITIONS, conditionFactor, valueOf, factorCaseSql, totalValue, copyCount };
```

- [ ] **Step 5: Run the test — expect 3 passing**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/valuation.test.cjs`
Expected: `pass 3`.

- [ ] **Step 6: Write the failing renderer test**

`desktop/src/utils/valuation.test.mjs`:
```js
import assert from 'node:assert';
import { CONDITIONS, EDITIONS, EDITION_LABELS, conditionFactor, valueOf, groupCopies } from './valuation.js';

assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
assert.equal(EDITION_LABELS.first, '1st Ed');
assert.equal(EDITION_LABELS.unknown, 'Unbek.');
assert.equal(conditionFactor('LP'), 0.5);
assert.equal(valueOf(4, [{ condition: 'NM' }, { condition: 'EX' }]), 7.4);

const groups = groupCopies([
  { copy_id: 'a', edition: 'unknown', condition: 'NM' },
  { copy_id: 'b', edition: 'first', condition: 'GD' },
  { copy_id: 'c', edition: 'unknown', condition: 'NM' },
]);
assert.deepStrictEqual(groups, [
  { edition: 'first', condition: 'GD', count: 1 },
  { edition: 'unknown', condition: 'NM', count: 2 },
]);
console.log('valuation renderer test: PASS');
```

- [ ] **Step 7: Run it — expect module-not-found**

Run (from `desktop/`): `node --test src/utils/valuation.test.mjs`
Expected: FAIL.

- [ ] **Step 8: Implement `valuation.js`**

`desktop/src/utils/valuation.js`:
```js
import FACTORS from '../../electron/condition-factors.json';

export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
export const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];
export const EDITION_LABELS = { first: '1st Ed', unlimited: 'Unlimited', limited: 'Limited', unknown: 'Unbek.' };

export function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

export function valueOf(price, copies) {
  const p = Number(price) || 0;
  if (!p || !copies || copies.length === 0) return 0;
  let f = 0;
  for (const c of copies) f += conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(p * f * 100) / 100;
}

// [{edition, condition, ...}] -> [{edition, condition, count}] in display order.
export function groupCopies(copies) {
  const m = new Map();
  for (const c of copies || []) {
    const key = `${c.edition || 'unknown'}|${c.condition || 'NM'}`;
    m.set(key, (m.get(key) || 0) + (Number(c.count) || 1));
  }
  return Array.from(m.entries())
    .map(([k, count]) => { const [edition, condition] = k.split('|'); return { edition, condition, count }; })
    .sort((a, b) => (EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition))
      || (CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)));
}
```

Node's ESM loader needs an import attribute for JSON in tests. Add to the top of `valuation.test.mjs` nothing; instead make the import work under both Vite and Node by changing the first line of `valuation.js` to:
```js
import FACTORS from '../../electron/condition-factors.json' with { type: 'json' };
```
(Vite 7 and Node 24 both accept `with { type: 'json' }`.)

- [ ] **Step 9: Run both tests — expect PASS**

Run: `node --test src/utils/valuation.test.mjs && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/valuation.test.cjs`
Expected: both pass. Also run `npm run lint` — no new errors.

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/condition-factors.json desktop/electron/valuation.cjs desktop/electron/valuation.test.cjs desktop/src/utils/valuation.js desktop/src/utils/valuation.test.mjs
git commit -m "feat(desktop): valuation core — shared condition factors, valueOf, SQL factor CASE

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: SQLite schema — `card_copies`, `price_history`, recount triggers, guarded backfill

**Files:**
- Create: `desktop/electron/copies-schema.cjs`
- Create: `desktop/electron/copies-schema.test.cjs`
- Modify: `desktop/electron/database.cjs:265-306` (after the `priceLockCols` block, before the `trg_cards_updated` trigger)

**Interfaces:**
- Produces: `const { ensureCopiesSchema, backfillCopies } = require('./copies-schema.cjs')`
  - `ensureCopiesSchema(db): void` — idempotent tables/indexes/triggers/columns
  - `backfillCopies(db): { created: number, skipped: boolean }` — guarded by `settings.copies_migrated`
- The trigger invariant later tasks rely on: after any INSERT/UPDATE/DELETE on `card_copies`, `cards.quantity = COUNT(live copies)` and `cards.deleted = (quantity == 0 ? 1 : 0)` for the affected printing(s).

- [ ] **Step 1: Write the failing test**

`desktop/electron/copies-schema.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema, backfillCopies } = require('./copies-schema.cjs');

// Minimal replica of the live cards/settings tables (4-col PK, as after the rarity migration).
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown',
             set_code TEXT, price REAL, language TEXT DEFAULT 'DE', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             deleted INTEGER DEFAULT 0, PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  return db;
}
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const card = (db) => db.prepare("SELECT quantity, deleted FROM cards WHERE id='1' AND set_code='LOB-DE001' AND language='DE' AND rarity='Ultra Rare'").get();

test('ensureCopiesSchema is idempotent and creates all columns', () => {
  const db = freshDb();
  ensureCopiesSchema(db); ensureCopiesSchema(db);
  const cc = cols(db, 'card_copies');
  for (const c of ['copy_id','card_id','set_code','language','rarity','edition','condition','created_at','updated_at','deleted',
                   'container_id','page','slot','tags','note','needs_review','review_reason','for_sale']) assert.ok(cc.includes(c), c);
  const ph = cols(db, 'price_history');
  for (const c of ['card_id','set_code','language','rarity','variant','day','price','source','recorded_at']) assert.ok(ph.includes(c), c);
  assert.ok(cols(db, 'cards').includes('price_first_ed'));
  assert.ok(cols(db, 'cards').includes('cm_first_ed_updated_at'));
  assert.ok(cols(db, 'portfolio_history').includes('sealed_value'));
});

test('triggers keep cards.quantity/deleted in step with live copies', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,5)");
  const ins = db.prepare("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition) VALUES (?, '1','LOB-DE001','DE','Ultra Rare','unknown','NM')");
  ins.run('a'); ins.run('b');
  assert.deepStrictEqual(card(db), { quantity: 2, deleted: 0 });
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE copy_id = 'a'").run();
  assert.deepStrictEqual(card(db), { quantity: 1, deleted: 0 });
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE copy_id = 'b'").run();
  assert.deepStrictEqual(card(db), { quantity: 0, deleted: 1 }, 'zero copies tombstones the printing');
  db.prepare("UPDATE card_copies SET deleted = 0 WHERE copy_id = 'b'").run();
  assert.deepStrictEqual(card(db), { quantity: 1, deleted: 0 }, 'a revived copy revives the printing');
});

test('moving a copy to another printing recounts BOTH printings', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity) VALUES ('1','Unknown','DE','Unknown',0), ('1','LOB-DE001','DE','Ultra Rare',0)");
  db.exec("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity) VALUES ('a','1','Unknown','DE','Unknown')");
  db.prepare("UPDATE card_copies SET set_code='LOB-DE001', rarity='Ultra Rare' WHERE copy_id='a'").run();
  assert.deepStrictEqual(db.prepare("SELECT quantity, deleted FROM cards WHERE set_code='Unknown'").get(), { quantity: 0, deleted: 1 });
  assert.deepStrictEqual(card(db), { quantity: 1, deleted: 0 });
});

test('backfill creates quantity copies once, with defaults, and is guarded', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec(`INSERT INTO cards (id, set_code, language, rarity, quantity, deleted) VALUES
           ('1','LOB-DE001','DE','Ultra Rare',3,0), ('2','SDK-DE001','DE','Common',1,1), ('3','X-1','DE','Common',0,0)`);
  const first = backfillCopies(db);
  assert.deepStrictEqual(first, { created: 3, skipped: false });
  const rows = db.prepare("SELECT card_id, edition, condition, deleted FROM card_copies ORDER BY card_id").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.card_id === '1' && r.edition === 'unknown' && r.condition === 'NM' && r.deleted === 0));
  assert.deepStrictEqual(card(db), { quantity: 3, deleted: 0 });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='copies_migrated'").get().value, '1');
  const second = backfillCopies(db);
  assert.deepStrictEqual(second, { created: 0, skipped: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 3);
});
```

- [ ] **Step 2: Run — expect module-not-found**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs`

- [ ] **Step 3: Implement `copies-schema.cjs`**

```js
const crypto = require('crypto');

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value')
    .run({ key, value: String(value) });
}
function addColumnIfMissing(db, table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

// Recount SQL for ONE printing key; used by all three triggers. `pfx` is NEW or OLD.
const PRINTING_WHERE = (pfx) =>
  `card_id = ${pfx}.card_id AND set_code = ${pfx}.set_code AND language = ${pfx}.language AND rarity = ${pfx}.rarity AND deleted = 0`;
const RECOUNT = (pfx) => `
  UPDATE cards SET
    quantity = (SELECT COUNT(*) FROM card_copies WHERE ${PRINTING_WHERE(pfx)}),
    deleted  = CASE WHEN (SELECT COUNT(*) FROM card_copies WHERE ${PRINTING_WHERE(pfx)}) = 0 THEN 1 ELSE 0 END
  WHERE id = ${pfx}.card_id AND set_code = ${pfx}.set_code AND language = ${pfx}.language AND rarity = ${pfx}.rarity;`;

function ensureCopiesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_copies (
      copy_id    TEXT PRIMARY KEY,
      card_id    TEXT NOT NULL,
      set_code   TEXT NOT NULL,
      language   TEXT NOT NULL DEFAULT 'DE',
      rarity     TEXT NOT NULL DEFAULT 'Unknown',
      edition    TEXT NOT NULL DEFAULT 'unknown' CHECK (edition IN ('first','unlimited','limited','unknown')),
      condition  TEXT NOT NULL DEFAULT 'NM' CHECK (condition IN ('MT','NM','EX','GD','LP','PL','PO')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted    INTEGER NOT NULL DEFAULT 0,
      container_id TEXT, page INTEGER, slot INTEGER, tags TEXT, note TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT,
      for_sale INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS card_copies_printing_idx ON card_copies (card_id, set_code, language, rarity);
    CREATE INDEX IF NOT EXISTS card_copies_updated_idx ON card_copies (updated_at);

    CREATE TABLE IF NOT EXISTS price_history (
      card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL, rarity TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'base',
      day TEXT NOT NULL,
      price REAL NOT NULL,
      source TEXT NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (card_id, set_code, language, rarity, variant, day)
    );
    CREATE INDEX IF NOT EXISTS price_history_recorded_idx ON price_history (recorded_at);

    CREATE TRIGGER IF NOT EXISTS trg_copies_ins AFTER INSERT ON card_copies FOR EACH ROW
    BEGIN ${RECOUNT('NEW')} END;
    CREATE TRIGGER IF NOT EXISTS trg_copies_upd AFTER UPDATE ON card_copies FOR EACH ROW
    BEGIN ${RECOUNT('NEW')} ${RECOUNT('OLD')} END;
    CREATE TRIGGER IF NOT EXISTS trg_copies_del AFTER DELETE ON card_copies FOR EACH ROW
    BEGIN ${RECOUNT('OLD')} END;

    CREATE TRIGGER IF NOT EXISTS trg_copies_updated AFTER UPDATE ON card_copies FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE card_copies SET updated_at = CURRENT_TIMESTAMP WHERE copy_id = NEW.copy_id; END;
  `);
  // Cross-spec columns pre-created now so A is the only PK/schema churn (overview doc).
  addColumnIfMissing(db, 'cards', 'price_first_ed', 'REAL');
  addColumnIfMissing(db, 'cards', 'cm_first_ed_updated_at', 'DATETIME');
  addColumnIfMissing(db, 'portfolio_history', 'sealed_value', 'REAL NOT NULL DEFAULT 0');
}

// One-time, desktop-only: `quantity` copies per live printing with the defaults. Guarded.
function backfillCopies(db) {
  if (getSetting(db, 'copies_migrated') === '1') return { created: 0, skipped: true };
  const rows = db.prepare('SELECT id, set_code, language, rarity, quantity FROM cards WHERE deleted = 0 AND quantity > 0').all();
  const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition, updated_at)
    VALUES (@copy_id, @card_id, @set_code, @language, @rarity, 'unknown', 'NM', CURRENT_TIMESTAMP)`);
  let created = 0;
  db.transaction(() => {
    for (const r of rows) {
      for (let i = 0; i < r.quantity; i++) {
        ins.run({ copy_id: crypto.randomUUID(), card_id: String(r.id), set_code: r.set_code, language: r.language || 'DE', rarity: r.rarity || 'Unknown' });
        created++;
      }
    }
    setSetting(db, 'copies_migrated', '1');
  })();
  return { created, skipped: false };
}

module.exports = { ensureCopiesSchema, backfillCopies };
```

- [ ] **Step 4: Run — expect 4 passing**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs`
Expected: `pass 4`. If the trigger test fails with "no such column NEW.card_id" inside a subquery, the SQLite version needs the recount split into two statements; keep the shape above (it is valid in SQLite ≥ 3.8 — better-sqlite3 12 ships 3.4x).

- [ ] **Step 5: Wire into `database.cjs`**

At the top of `desktop/electron/database.cjs` add:
```js
const { ensureCopiesSchema, backfillCopies } = require('./copies-schema.cjs');
```
In `runMigrations()`, directly after the `priceLockCols` `for` loop (line ~273, still inside the `try`), add:
```js
        // Spec A: physical copies + price history + cross-spec columns. Backfill is desktop-only and guarded.
        ensureCopiesSchema(db);
        const bf = backfillCopies(db);
        if (!bf.skipped) console.log(`Copies backfill: created ${bf.created} copies from quantities.`);
```
Keep the existing cleanup block (`UPDATE cards SET deleted = 1 WHERE quantity <= 0`) — it stays consistent with the trigger rule.

- [ ] **Step 6: Smoke the real app once**

Run (from `desktop/`): `npm run electron:dev` (installed app must be closed). In the terminal log expect `Copies backfill: created N copies from quantities.` once; restart → no log line. Close the app.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/copies-schema.cjs desktop/electron/copies-schema.test.cjs desktop/electron/database.cjs
git commit -m "feat(desktop): card_copies + price_history schema, recount triggers, guarded one-time backfill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Copy mutation helpers (`copies.cjs`)

**Files:**
- Create: `desktop/electron/copies.cjs`
- Create: `desktop/electron/copies.test.cjs`

**Interfaces:**
- Produces: `const { defaults, listCopies, groupCopies, addCopies, removeCopies, moveCopies, updateCopyGroup, softDeletePrinting } = require('./copies.cjs')`
  - `printing = { id, set_code, language, rarity }` (strings; `language` defaults `'DE'`, `rarity` defaults `'Unknown'`)
  - `defaults(db): { edition, condition }` from settings (`default_edition`/`default_condition`, fallback `unknown`/`NM`)
  - `listCopies(db, printing): Array<row>` live copies
  - `groupCopies(rows): Array<{edition, condition, count}>` (same ordering as renderer)
  - `addCopies(db, printing, { edition, condition, count = 1 }): string[]` new copy_ids
  - `removeCopies(db, printing, { edition, condition, count = 1 })`: soft-deletes `count` copies **of that group**; when `edition`/`condition` are omitted uses the **standard-first rule** (default group first, then others ordered by lowest factor last). Returns number removed.
  - `moveCopies(db, from, to)`: re-points all live copies of printing `from` to printing `to` (keeps edition/condition). Returns number moved.
  - `updateCopyGroup(db, printing, from: {edition, condition}, to: {edition, condition})`: returns number changed.
  - `softDeletePrinting(db, printing)`: soft-deletes all live copies (trigger tombstones the card row).

- [ ] **Step 1: Write the failing test**

`desktop/electron/copies.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const C = require('./copies.cjs');

const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
const U = { id: '1', set_code: 'Unknown', language: 'DE', rarity: 'Unknown' };
function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT, price REAL,
            language TEXT DEFAULT 'DE', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0,
            PRIMARY KEY (id, set_code, language, rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL);`);
  ensureCopiesSchema(d);
  d.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,10), ('1','Unknown','DE','Unknown',0,0)");
  return d;
}
const qty = (d, p) => d.prepare('SELECT quantity, deleted FROM cards WHERE id=? AND set_code=? AND language=? AND rarity=?').get(p.id, p.set_code, p.language, p.rarity);

test('defaults come from settings with fallbacks', () => {
  const d = db();
  assert.deepStrictEqual(C.defaults(d), { edition: 'unknown', condition: 'NM' });
  d.exec("INSERT INTO settings VALUES ('default_edition','first'), ('default_condition','EX')");
  assert.deepStrictEqual(C.defaults(d), { edition: 'first', condition: 'EX' });
});

test('addCopies creates rows and the trigger counts them', () => {
  const d = db();
  const ids = C.addCopies(d, P, { edition: 'first', condition: 'NM', count: 2 });
  assert.equal(ids.length, 2);
  assert.deepStrictEqual(qty(d, P), { quantity: 2, deleted: 0 });
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'first', condition: 'NM', count: 2 }]);
});

test('removeCopies removes from the named group, or standard-first without one', () => {
  const d = db();
  C.addCopies(d, P, { edition: 'unknown', condition: 'NM', count: 2 });   // standard
  C.addCopies(d, P, { edition: 'first', condition: 'GD', count: 1 });     // rare one
  assert.equal(C.removeCopies(d, P, { edition: 'first', condition: 'GD' }), 1);
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'unknown', condition: 'NM', count: 2 }]);
  C.addCopies(d, P, { edition: 'first', condition: 'GD', count: 1 });
  assert.equal(C.removeCopies(d, P, {}), 1, 'no group -> standard-first');
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [
    { edition: 'first', condition: 'GD', count: 1 }, { edition: 'unknown', condition: 'NM', count: 1 }]);
  assert.equal(C.removeCopies(d, P, { count: 5 }), 2, 'never removes more than exist');
  assert.deepStrictEqual(qty(d, P), { quantity: 0, deleted: 1 });
});

test('moveCopies re-points copies and both printings recount', () => {
  const d = db();
  C.addCopies(d, U, { edition: 'unknown', condition: 'PL', count: 2 });
  assert.equal(C.moveCopies(d, U, P), 2);
  assert.deepStrictEqual(qty(d, U), { quantity: 0, deleted: 1 });
  assert.deepStrictEqual(qty(d, P), { quantity: 2, deleted: 0 });
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'unknown', condition: 'PL', count: 2 }], 'condition preserved');
});

test('updateCopyGroup and softDeletePrinting', () => {
  const d = db();
  C.addCopies(d, P, { edition: 'unknown', condition: 'NM', count: 3 });
  assert.equal(C.updateCopyGroup(d, P, { edition: 'unknown', condition: 'NM' }, { edition: 'first', condition: 'EX' }), 3);
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'first', condition: 'EX', count: 3 }]);
  C.softDeletePrinting(d, P);
  assert.deepStrictEqual(qty(d, P), { quantity: 0, deleted: 1 });
  assert.equal(C.listCopies(d, P).length, 0);
});
```

- [ ] **Step 2: Run — expect module-not-found**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies.test.cjs`

- [ ] **Step 3: Implement `copies.cjs`**

```js
const crypto = require('crypto');
const { CONDITIONS, EDITIONS, conditionFactor } = require('./valuation.cjs');

const norm = (p) => ({ id: String(p.id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown' });
const KEY = 'card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity';

function defaults(db) {
  const get = (k) => { try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; } catch { return null; } };
  const edition = get('default_edition'), condition = get('default_condition');
  return {
    edition: EDITIONS.includes(edition) ? edition : 'unknown',
    condition: CONDITIONS.includes(condition) ? condition : 'NM',
  };
}

function listCopies(db, printing) {
  return db.prepare(`SELECT * FROM card_copies WHERE ${KEY} AND deleted = 0 ORDER BY created_at, copy_id`).all(norm(printing));
}

function groupCopies(rows) {
  const m = new Map();
  for (const c of rows || []) {
    const k = `${c.edition || 'unknown'}|${c.condition || 'NM'}`;
    m.set(k, (m.get(k) || 0) + (Number(c.count) || 1));
  }
  return Array.from(m.entries())
    .map(([k, count]) => { const [edition, condition] = k.split('|'); return { edition, condition, count }; })
    .sort((a, b) => (EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)) || (CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)));
}

function addCopies(db, printing, { edition, condition, count = 1 } = {}) {
  const p = norm(printing);
  const d = defaults(db);
  const ed = EDITIONS.includes(edition) ? edition : d.edition;
  const co = CONDITIONS.includes(condition) ? condition : d.condition;
  const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition)
    VALUES (@copy_id, @id, @set_code, @language, @rarity, @edition, @condition)`);
  const ids = [];
  db.transaction(() => {
    for (let i = 0; i < Math.max(1, Number(count) || 1); i++) {
      const copy_id = crypto.randomUUID();
      ins.run({ ...p, copy_id, edition: ed, condition: co });
      ids.push(copy_id);
    }
  })();
  return ids;
}

// Standard-first: the default group goes first, then the remaining copies ordered so that the
// most valuable (highest factor, non-default edition) are removed LAST.
function removeCopies(db, printing, { edition, condition, count = 1 } = {}) {
  const p = norm(printing);
  const n = Math.max(1, Number(count) || 1);
  let rows;
  if (edition || condition) {
    rows = db.prepare(`SELECT copy_id FROM card_copies WHERE ${KEY} AND deleted = 0
      AND (@edition IS NULL OR edition = @edition) AND (@condition IS NULL OR condition = @condition)
      ORDER BY created_at DESC, copy_id LIMIT @n`).all({ ...p, edition: edition || null, condition: condition || null, n });
  } else {
    const d = defaults(db);
    const all = db.prepare(`SELECT copy_id, edition, condition, created_at FROM card_copies WHERE ${KEY} AND deleted = 0`).all(p);
    all.sort((a, b) => {
      const sa = (a.edition === d.edition && a.condition === d.condition) ? 0 : 1;
      const sb = (b.edition === d.edition && b.condition === d.condition) ? 0 : 1;
      if (sa !== sb) return sa - sb;                                   // standard first
      const fa = conditionFactor(a.condition), fb = conditionFactor(b.condition);
      if (fa !== fb) return fa - fb;                                   // cheaper condition first
      const ea = a.edition === 'first' ? 1 : 0, eb = b.edition === 'first' ? 1 : 0;
      if (ea !== eb) return ea - eb;                                   // 1st edition last
      return String(b.created_at).localeCompare(String(a.created_at)); // newest first
    });
    rows = all.slice(0, n);
  }
  const upd = db.prepare('UPDATE card_copies SET deleted = 1 WHERE copy_id = ?');
  db.transaction(() => { for (const r of rows) upd.run(r.copy_id); })();
  return rows.length;
}

function moveCopies(db, from, to) {
  const f = norm(from), t = norm(to);
  const info = db.prepare(`UPDATE card_copies SET set_code = @t_set_code, language = @t_language, rarity = @t_rarity
    WHERE card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0`)
    .run({ ...f, t_set_code: t.set_code, t_language: t.language, t_rarity: t.rarity });
  return info.changes;
}

function updateCopyGroup(db, printing, from, to) {
  const p = norm(printing);
  if (!EDITIONS.includes(to.edition) || !CONDITIONS.includes(to.condition)) throw new Error('invalid edition/condition');
  const info = db.prepare(`UPDATE card_copies SET edition = @to_edition, condition = @to_condition
    WHERE ${KEY} AND deleted = 0 AND edition = @from_edition AND condition = @from_condition`)
    .run({ ...p, to_edition: to.edition, to_condition: to.condition, from_edition: from.edition, from_condition: from.condition });
  return info.changes;
}

function softDeletePrinting(db, printing) {
  const p = norm(printing);
  db.prepare(`UPDATE card_copies SET deleted = 1 WHERE ${KEY} AND deleted = 0`).run(p);
  // The trigger tombstones the card row; make it explicit for printings that had no copies.
  db.prepare('UPDATE cards SET deleted = 1, quantity = 0 WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0').run(p);
}

module.exports = { defaults, listCopies, groupCopies, addCopies, removeCopies, moveCopies, updateCopyGroup, softDeletePrinting };
```

- [ ] **Step 4: Run — expect 5 passing**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/copies.cjs desktop/electron/copies.test.cjs
git commit -m "feat(desktop): copies helpers — add/remove (standard-first), move, regroup, soft-delete printing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `price_history` recorder + wiring into every price writer

**Files:**
- Create: `desktop/electron/price-history.cjs`
- Create: `desktop/electron/price-history.test.cjs`
- Modify: `desktop/electron/main.cjs` (poller ~line 655-695, `update-all-cards` ~767-816, `set-card-price` ~521-528, `startCardmarketPoller` ~573, `notifyBulk` ~590, `get-portfolio` ~313)
- Modify: `desktop/electron/cardmarket-bulk.cjs:127-139`
- Modify: `desktop/electron/cardmarket-scraper.cjs:143-145`

**Interfaces:**
- Produces: `const { recordPrice, lastRecorded } = require('./price-history.cjs')`
  - `recordPrice(db, printing, price, source, variant = 'base'): boolean` — writes only if `price > 0` and differs from `lastRecorded`; upserts on `(printing, variant, day)`; returns whether a row was written. `source ∈ 'ygoprodeck' | 'cm_bulk' | 'cm_scrape' | 'manual'`. `printing` accepts `{ id | card_id, set_code, language, rarity }`.
  - `lastRecorded(db, printing, variant = 'base'): number | null`
- Consumes: `totalValue(db)`, `copyCount(db)` from Task 1 (replace every `SUM(price * quantity)` in main.cjs).

- [ ] **Step 1: Write the failing test**

`desktop/electron/price-history.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { recordPrice, lastRecorded } = require('./price-history.cjs');

const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d); return d;
}

test('records only changes, one row per day (last wins), ignores non-positive', () => {
  const d = db();
  assert.equal(lastRecorded(d, P), null);
  assert.equal(recordPrice(d, P, 0, 'ygoprodeck'), false);
  assert.equal(recordPrice(d, P, 1.5, 'ygoprodeck'), true);
  assert.equal(recordPrice(d, P, 1.5, 'cm_bulk'), false, 'same price -> no write');
  assert.equal(recordPrice(d, P, 2.0, 'cm_bulk'), true);
  const rows = d.prepare('SELECT price, source, variant FROM price_history').all();
  assert.deepStrictEqual(rows, [{ price: 2.0, source: 'cm_bulk', variant: 'base' }], 'same day -> upsert, not a second row');
  assert.equal(lastRecorded(d, P), 2.0);
  assert.equal(recordPrice(d, P, 3.0, 'cm_scrape', 'first'), true, 'variants are independent series');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM price_history').get().n, 2);
});
```

- [ ] **Step 2: Run — expect module-not-found**

Run (from `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/price-history.test.cjs`

- [ ] **Step 3: Implement**

`desktop/electron/price-history.cjs`:
```js
const norm = (p) => ({ card_id: String(p.id ?? p.card_id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown' });
const KEY = 'card_id = @card_id AND set_code = @set_code AND language = @language AND rarity = @rarity AND variant = @variant';

function lastRecorded(db, printing, variant = 'base') {
  const r = db.prepare(`SELECT price FROM price_history WHERE ${KEY} ORDER BY day DESC, recorded_at DESC LIMIT 1`).get({ ...norm(printing), variant });
  return r ? r.price : null;
}

// Only when the price really changed; at most one row per printing+variant+day (UTC), latest wins.
function recordPrice(db, printing, price, source, variant = 'base') {
  const p = Number(price);
  if (!(p > 0)) return false;
  const last = lastRecorded(db, printing, variant);
  if (last != null && Math.abs(last - p) < 0.005) return false;
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO price_history (card_id, set_code, language, rarity, variant, day, price, source, recorded_at)
    VALUES (@card_id, @set_code, @language, @rarity, @variant, @day, @price, @source, CURRENT_TIMESTAMP)
    ON CONFLICT(card_id, set_code, language, rarity, variant, day) DO UPDATE SET price = excluded.price, source = excluded.source, recorded_at = CURRENT_TIMESTAMP`)
    .run({ ...norm(printing), variant, day, price: p, source: String(source || 'unknown') });
  return true;
}

module.exports = { recordPrice, lastRecorded };
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Wire the desktop price writers**

In `desktop/electron/main.cjs`:

(a) Imports (top, after the `runBulkRefresh` require):
```js
const { recordPrice } = require('./price-history.cjs');
const { totalValue, copyCount } = require('./valuation.cjs');
```

(b) Price poller (`startPricePoller`): directly after `updateStmt.run({ price: newPrice, … })` add
```js
                        recordPrice(db, localCard, newPrice, 'ygoprodeck');
```
Replace the poller's `const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards WHERE deleted = 0').get();` with
```js
                const stats = { totalValue: totalValue(db) };
```

(c) `update-all-cards`: change the `rows` select to `SELECT id, set_code, language, rarity FROM cards` and replace the `updateStmt.run(...)` line inside the transaction with:
```js
                const before = db.prepare('SELECT price FROM cards WHERE id=? AND set_code=? AND language=? AND rarity=?').get(String(row.id), row.set_code, row.language, row.rarity);
                updateStmt.run({ ...d, price, id: String(row.id), set_code: row.set_code, language: row.language });
                if (before && Math.abs((before.price || 0) - price) > 0.01) recordPrice(db, row, price, 'ygoprodeck');
```
Replace its `stats` line with `const stats = { totalValue: totalValue(db) };`.

(d) `set-card-price`: after the UPDATE add
```js
    recordPrice(db, { id, set_code, language, rarity }, Number(price) || 0, 'manual');
```

(e) `startCardmarketPoller` and `notifyBulk`: replace `db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards WHERE deleted = 0').get()` with `{ totalValue: totalValue(db) }`.

(f) `get-portfolio` becomes:
```js
ipcMain.handle('get-portfolio', () => {
    try {
        const unique = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE quantity > 0 AND deleted = 0').get().n || 0;
        return { totalValue: totalValue(db), totalCards: copyCount(db), uniqueCards: unique };
    } catch (e) { return { totalValue: 0, totalCards: 0, uniqueCards: 0 }; }
});
```

In `desktop/electron/cardmarket-bulk.cjs` add `const { recordPrice } = require('./price-history.cjs');` at the top and change the Step B loop body to:
```js
      const info = upd.run(t, r.id, r.set_code, r.language, r.rarity, t);
      if (info.changes > 0) { priced++; recordPrice(db, r, t, 'cm_bulk'); } else unchanged++;
```

In `desktop/electron/cardmarket-scraper.cjs` add `const { recordPrice } = require('./price-history.cjs');` at the top and after the `.run(hit.trend, url, pid, String(cards[i].id), p.set_code, p.language, p.rarity);` line:
```js
            recordPrice(db, { id: cards[i].id, set_code: p.set_code, language: p.language, rarity: p.rarity }, hit.trend, 'cm_scrape');
```

- [ ] **Step 6: Run the whole desktop test set + lint**

Run (from `desktop/`): `for f in electron/*.test.cjs; do ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test "$f" || exit 1; done && node --test src/utils/valuation.test.mjs && npm run lint`
Expected: all pass; lint clean.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/price-history.cjs desktop/electron/price-history.test.cjs desktop/electron/main.cjs desktop/electron/cardmarket-bulk.cjs desktop/electron/cardmarket-scraper.cjs
git commit -m "feat(desktop): record price_history on every price write; portfolio totals via copy valuation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Main-process handlers on copies + new IPC + preload

**Files:**
- Create: `desktop/electron/collection-query.cjs`
- Create: `desktop/electron/handlers.test.cjs`
- Modify: `desktop/electron/main.cjs` — `add-card-to-db` (250-289), `get-collection` (291-293), `delete-card` (295-311), `update-card-meta` (501-519), `convert-unknowns-to-default` (707-745), `merge-unknown-cards` (747-763), `downgrade-to-lowest-rarity` (975-1024), `import-csv` (900-914)
- Modify: `desktop/electron/preload.cjs`

**Interfaces (renderer-facing via preload):**
- `addCardToDb(card)` — same name; new optional `card.copies: [{edition, condition, count}]`; without it, `card.quantity || 1` copies with the defaults. Returns `{ success, inserted?, updated?, copiesAdded }`.
- `getCollection()` rows gain `value` (number), `factor_sum`, `nonstandard` (copies off the defaults), `conditions` (comma string), `editions` (comma string).
- `getDefaults() → { edition, condition }`
- `listCopies(printing) → copy rows`
- `addCopy({ id, set_code, language, rarity, edition?, condition?, count? }) → { success, copyIds }`
- `removeCopy({ id, set_code, language, rarity, edition?, condition?, count? }) → { success, removed }` (no group → standard-first rule)
- `updateCopyGroup({ id, set_code, language, rarity, from: {edition, condition}, to: {edition, condition} }) → { success, changed }`
- `importCsv()` rows gain optional `edition`, `condition` from header columns `edition` / `condition` (or `zustand`).

- [ ] **Step 1: Write the failing test**

`desktop/electron/handlers.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { addCopies } = require('./copies.cjs');
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');

test('collectionSql yields value/factor_sum/nonstandard/conditions/editions', () => {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT, price REAL,
            language TEXT DEFAULT 'DE', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  d.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,10)");
  const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
  addCopies(d, P, { edition: 'unknown', condition: 'NM', count: 2 });
  addCopies(d, P, { edition: 'first', condition: 'GD', count: 1 });
  const rows = d.prepare(collectionSql()).all({ def_condition: 'NM', def_edition: 'unknown' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  assert.ok(Math.abs(rows[0].factor_sum - 2.7) < 1e-9);
  assert.equal(rows[0].value, 27);
  assert.equal(rows[0].nonstandard, 1);
  assert.deepStrictEqual(rows[0].conditions.split(',').sort(), ['GD', 'NM']);
  assert.deepStrictEqual(rows[0].editions.split(',').sort(), ['first', 'unknown']);
});

test('parseImportCsv: legacy column-2 passcodes and optional edition/condition headers', () => {
  assert.deepStrictEqual(parseImportCsv('name;passcode\nBlue;89631139\nBad;abc\n'), [{ passcode: '89631139' }]);
  assert.deepStrictEqual(parseImportCsv('Passcode,Edition,Condition\n46986414,first,gd\n12345678,weird,ZZ\n'),
    [{ passcode: '46986414', edition: 'first', condition: 'GD' }, { passcode: '12345678' }]);
  assert.deepStrictEqual(parseImportCsv(''), []);
});
```

- [ ] **Step 2: Run — expect module-not-found**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/handlers.test.cjs`

- [ ] **Step 3: Implement `collection-query.cjs`**

```js
const { factorCaseSql, EDITIONS, CONDITIONS } = require('./valuation.cjs');

// One row per live printing, plus copy-derived value columns. Params: @def_condition, @def_edition.
function collectionSql() {
  const f = factorCaseSql('condition');
  return `
    SELECT c.*,
      COALESCE(cp.factor_sum, 0)                                     AS factor_sum,
      ROUND(COALESCE(c.price, 0) * COALESCE(cp.factor_sum, 0), 2)    AS value,
      COALESCE(cp.nonstandard, 0)                                    AS nonstandard,
      COALESCE(cp.conditions, '')                                    AS conditions,
      COALESCE(cp.editions, '')                                      AS editions
    FROM cards c
    LEFT JOIN (
      SELECT card_id, set_code, language, rarity,
        SUM(${f}) AS factor_sum,
        SUM(CASE WHEN condition <> @def_condition OR edition <> @def_edition THEN 1 ELSE 0 END) AS nonstandard,
        GROUP_CONCAT(DISTINCT condition) AS conditions,
        GROUP_CONCAT(DISTINCT edition) AS editions
      FROM card_copies WHERE deleted = 0
      GROUP BY card_id, set_code, language, rarity
    ) cp ON cp.card_id = c.id AND cp.set_code = c.set_code AND cp.language = c.language AND cp.rarity = c.rarity
    WHERE c.quantity > 0 AND c.deleted = 0
    ORDER BY c.created_at DESC`;
}

// CSV: header row, ';' or ',' separated; passcode from a column named passcode/id/card_id, else column 2 (legacy).
function parseImportCsv(content) {
  const lines = String(content || '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const idx = (names) => header.findIndex(h => names.includes(h));
  let pcIdx = idx(['passcode', 'id', 'card_id']);
  if (pcIdx < 0) pcIdx = 1;
  const edIdx = idx(['edition']), coIdx = idx(['condition', 'zustand']);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep);
    const passcode = (parts[pcIdx] || '').trim();
    if (!/^\d+$/.test(passcode)) continue;
    const row = { passcode };
    const ed = edIdx >= 0 ? (parts[edIdx] || '').trim().toLowerCase() : '';
    const co = coIdx >= 0 ? (parts[coIdx] || '').trim().toUpperCase() : '';
    if (EDITIONS.includes(ed)) row.edition = ed;
    if (CONDITIONS.includes(co)) row.condition = co;
    out.push(row);
  }
  return out;
}

module.exports = { collectionSql, parseImportCsv };
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Rewrite `add-card-to-db`**

Add imports at the top of `main.cjs`:
```js
const copies = require('./copies.cjs');
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');
```
Replace the whole `add-card-to-db` handler with:
```js
ipcMain.handle('add-card-to-db', (event, card) => {
  try {
    const id = String(card.id);
    const setCode = card.set_code || 'Unknown';
    const language = card.language || 'DE';
    const rarity = card.rarity || 'Unknown';
    const printing = { id, set_code: setCode, language, rarity };
    // Copies to create: explicit groups from the staging chip, else quantity × defaults.
    const groups = (Array.isArray(card.copies) && card.copies.length) ? card.copies : [{ count: card.quantity || 1 }];

    const existing = db.prepare('SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?').get(id, setCode, language, rarity);
    let inserted = false;
    const copiesAdded = db.transaction(() => {
      if (existing) {
        db.prepare('UPDATE cards SET price = @price, deleted = 0 WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity')
          .run({ price: card.price || 0, id, set_code: setCode, language, rarity });
      } else {
        const imageUrl = card.card_images && card.card_images.length > 0 ? card.card_images[0].image_url : (card.image_url || '');
        let level = card.level;
        if (card.type && card.type.includes('Link') && card.linkval !== undefined) level = card.linkval;
        db.prepare(`INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language)
          VALUES (@id, @name, @type, @desc, @image_url, @atk, @def, @level, @race, @attribute, 0, @rarity, @set_code, @price, @language)`).run({
          id, name: card.name, type: card.type, desc: card.desc, image_url: imageUrl,
          atk: valOrNull(card.atk), def: valOrNull(card.def), level: valOrNull(level),
          race: card.race || null, attribute: card.attribute || null,
          rarity, set_code: setCode, price: card.price || 0, language
        });
        inserted = true;
      }
      let n = 0;
      for (const g of groups) n += copies.addCopies(db, printing, { edition: g.edition, condition: g.condition, count: g.count || 1 }).length;
      return n;
    })();
    return inserted ? { success: true, inserted: true, copiesAdded } : { success: true, updated: true, copiesAdded };
  } catch (error) {
    console.error('DB Insert Error:', error);
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 6: `get-collection`, copy IPC, `delete-card`, `update-card-meta`**

Replace `get-collection` with:
```js
ipcMain.handle('get-collection', () => {
    const def = copies.defaults(db);
    return db.prepare(collectionSql()).all({ def_condition: def.condition, def_edition: def.edition });
});
ipcMain.handle('get-defaults', () => copies.defaults(db));
ipcMain.handle('list-copies', (event, printing) => copies.listCopies(db, printing));
ipcMain.handle('add-copy', (event, { edition, condition, count, ...printing }) => {
    try { return { success: true, copyIds: copies.addCopies(db, printing, { edition, condition, count }) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('remove-copy', (event, { edition, condition, count, ...printing }) => {
    try { return { success: true, removed: copies.removeCopies(db, printing, { edition, condition, count }) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('update-copy-group', (event, { from, to, ...printing }) => {
    try { return { success: true, changed: copies.updateCopyGroup(db, printing, from, to) }; }
    catch (e) { return { success: false, error: e.message }; }
});
```

`delete-card`: replace the two `UPDATE cards SET deleted = 1 …` branches with:
```js
        if (rarity !== undefined && rarity !== null) {
            copies.softDeletePrinting(db, { id: String(id), set_code, language: language || 'DE', rarity });
        } else {
            const rows = db.prepare('SELECT rarity FROM cards WHERE id = ? AND set_code = ? AND language = ? AND deleted = 0').all(String(id), set_code, language || 'DE');
            for (const r of rows) copies.softDeletePrinting(db, { id: String(id), set_code, language: language || 'DE', rarity: r.rarity });
        }
```

`update-card-meta`: the `quantity` branch becomes a copies delta (kept for stale callers):
```js
        if (quantity !== undefined) {
            const printing = { id: String(id), set_code, language: language || 'DE', rarity: rarity || 'Unknown' };
            const current = copies.listCopies(db, printing).length;
            const target = Math.max(0, Number(quantity) || 0);
            if (target > current) copies.addCopies(db, printing, { count: target - current });
            else if (target < current) copies.removeCopies(db, printing, { count: current - target });
        }
```

- [ ] **Step 7: Unknown/downgrade handlers move copies**

`merge-unknown-cards`: select `id, quantity, language, rarity` for `unknowns`; the `forEach` body becomes:
```js
                const specific = db.prepare("SELECT id, set_code, rarity, language FROM cards WHERE id = ? AND set_code != 'Unknown' AND deleted = 0 ORDER BY quantity DESC LIMIT 1").get(u.id);
                if (specific) {
                    copies.moveCopies(db, { id: u.id, set_code: 'Unknown', language: u.language || 'DE', rarity: u.rarity || 'Unknown' }, specific);
                    mergedCount++;
                }
```

`convert-unknowns-to-default`: select `id, quantity, language, rarity` for `unknowns`; replace the `existing … else …` block with:
```js
                        const target = { id: unknown.id, set_code: newSetCode, language: 'DE', rarity: newRarity };
                        db.prepare(`INSERT OR IGNORE INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language, deleted)
  SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, 0, ?, ?, ?, 'DE', 0
  FROM cards WHERE id = ? AND set_code = 'Unknown'`).run(newRarity, newSetCode, newPrice, unknown.id);
                        db.prepare("UPDATE cards SET deleted = 0, price = ? WHERE id = ? AND set_code = ? AND language = 'DE' AND rarity = ?").run(newPrice, unknown.id, newSetCode, newRarity);
                        copies.moveCopies(db, { id: unknown.id, set_code: 'Unknown', language: unknown.language || 'DE', rarity: unknown.rarity || 'Unknown' }, target);
```

`downgrade-to-lowest-rarity`: replace the `existingTarget … else …` block with:
```js
                        const target = { id: card.id, set_code: newSetCode, language: card.language, rarity: newRarity };
                        db.prepare(`INSERT OR IGNORE INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language, deleted)
  SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, 0, ?, ?, ?, language, 0
  FROM cards WHERE id = ? AND set_code = ? AND rarity = ? AND language = ?`).run(newRarity, newSetCode, newPrice, card.id, card.set_code, card.rarity, card.language);
                        db.prepare("UPDATE cards SET deleted = 0 WHERE id = ? AND set_code = ? AND rarity = ? AND language = ?").run(card.id, newSetCode, newRarity, card.language);
                        copies.moveCopies(db, card, target);
```

`import-csv`: replace the manual loop with `const cards = parseImportCsv(content); return { canceled: false, cards };`.

- [ ] **Step 8: Preload**

In `desktop/electron/preload.cjs` after `addCardToDb`:
```js
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  listCopies: (printing) => ipcRenderer.invoke('list-copies', printing),
  addCopy: (data) => ipcRenderer.invoke('add-copy', data),
  removeCopy: (data) => ipcRenderer.invoke('remove-copy', data),
  updateCopyGroup: (data) => ipcRenderer.invoke('update-copy-group', data),
```

- [ ] **Step 9: Grep for forgotten quantity writers**

Run (from repo root): `grep -n "SET quantity\|quantity = @qty\|\.quantity + \|existing.quantity" desktop/electron/main.cjs`
Expected: no hits. Any hit must be converted to a copies call before continuing.

- [ ] **Step 10: Run tests + lint + manual smoke**

Run (from `desktop/`): `for f in electron/*.test.cjs; do ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test "$f" || exit 1; done && npm run lint`
Then `npm run electron:dev`: search a card into staging, Add → the card appears in the collection with the right quantity; Detail → Minus to 0 → the printing disappears; Collection › Unknown › Auto-Merge on a test Unknown row moves its copies (target quantity grows, Unknown row disappears).

- [ ] **Step 11: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/collection-query.cjs desktop/electron/handlers.test.cjs
git commit -m "feat(desktop): handlers write copies instead of quantity; copy IPC; collection value columns; CSV edition/condition

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Sync — copies stream, `quantity` out of push, price_history push, valuation snapshot

**Files:**
- Modify: `desktop/electron/sync.cjs` (whole file)
- Modify: `desktop/electron/test-sync.cjs`, `desktop/electron/test-sync-insert.cjs`
- Create: `desktop/electron/test-sync-copies.cjs`

**Interfaces:**
- New exports: `copyToRemote(row)`, `remoteToLocalCopy(r)`, `applyRemoteCopy(db, r)`.
- `MIRROR_COLS` loses `quantity`, gains `price_first_ed`. `remoteToLocalPatch(r)` returns `{ id, set_code, language, rarity, deleted }` (4-column key).
- Cycle order: `pull cards → pull copies → push cards → push copies → push price_history → snapshot`.
- Cloud schema assumed (Task 7): `card_copies` with the same columns (`deleted`, `needs_review`, `for_sale` boolean; `updated_at` server-stamped) and `price_history` with PK `(card_id, set_code, language, rarity, variant, day)`.

- [ ] **Step 1: Extend the mapping test (fails until implemented)**

Append to `desktop/electron/test-sync.cjs` before the final `console.log`:
```js
// Spec A: quantity is derived from copies on both sides -> never pushed; patch carries rarity + deleted only.
assert.ok(!('quantity' in rowToRemote(local)), 'quantity must not be pushed');
assert.deepStrictEqual(
  remoteToLocalPatch({ id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', quantity: 7, deleted: true }),
  { id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', deleted: 1 });
{
  const { copyToRemote, remoteToLocalCopy } = require('./sync.cjs');
  const c = copyToRemote({ copy_id: 'u1', card_id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', edition: 'first', condition: 'GD',
    deleted: 0, container_id: null, page: null, slot: null, tags: null, note: null, needs_review: 0, review_reason: null, for_sale: 0, created_at: 'x', updated_at: 'y' });
  assert.strictEqual(c.deleted, false); assert.strictEqual(c.needs_review, false); assert.strictEqual(c.for_sale, false);
  assert.ok(!('updated_at' in c) && !('created_at' in c), 'timestamps are not pushed');
  assert.strictEqual(c.edition, 'first');
  const l = remoteToLocalCopy({ copy_id: 'u1', card_id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', edition: 'first', condition: 'GD', deleted: true, needs_review: false, for_sale: true, updated_at: 'z' });
  assert.strictEqual(l.deleted, 1); assert.strictEqual(l.for_sale, 1); assert.strictEqual(l.needs_review, 0);
}
```
Update the existing F1 block in the same file: give its in-memory `cards` table a `rarity` in the PK (`PRIMARY KEY (id, set_code, language, rarity)`), insert `rarity = 'Common'`, pass `rarity: 'Common'` in every `applyRemoteRow` call, and change the second assertion block to:
```js
  applyRemoteRow(db, { id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', quantity: 5, deleted: true });
  row = db.prepare("SELECT quantity, deleted, updated_at FROM cards WHERE id='1' AND set_code='LOB-EN001'").get();
  assert.strictEqual(row.quantity, 3, 'quantity is NOT patched from remote any more');
  assert.strictEqual(row.deleted, 1, 'deleted applied');
  assert.strictEqual(row.updated_at, '2099-01-01 00:00:00', 'trigger fired only on real change');
```
Open `test-sync-insert.cjs`; if it asserts on quantity patching of an existing row, change it the same way (inserts of missing rows still carry `quantity`).

- [ ] **Step 2: Write the copies-stream test**

`desktop/electron/test-sync-copies.cjs`:
```js
const assert = require('assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { applyRemoteCopy } = require('./sync.cjs');

const db = new Database(':memory:');
db.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT, price REAL, language TEXT DEFAULT 'DE',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
ensureCopiesSchema(db);
db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity) VALUES ('1','LOB-DE001','DE','Common',0)");
const remote = { copy_id: 'u1', card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Common', edition: 'unknown', condition: 'NM', deleted: false,
  container_id: null, page: null, slot: null, tags: null, note: null, needs_review: false, review_reason: null, for_sale: false, updated_at: '2026-01-01T00:00:00Z' };

applyRemoteCopy(db, remote);
assert.strictEqual(db.prepare("SELECT quantity FROM cards WHERE id='1'").get().quantity, 1, 'phone-created copy recounts the printing');
db.prepare("UPDATE card_copies SET updated_at = '2026-01-01 00:00:00' WHERE copy_id = 'u1'").run();

applyRemoteCopy(db, remote);
assert.strictEqual(db.prepare("SELECT updated_at FROM card_copies WHERE copy_id='u1'").get().updated_at, '2026-01-01 00:00:00', 'unchanged copy is not re-dirtied');

applyRemoteCopy(db, { ...remote, condition: 'GD', deleted: true });
assert.deepStrictEqual(db.prepare("SELECT condition, deleted FROM card_copies WHERE copy_id='u1'").get(), { condition: 'GD', deleted: 1 });
assert.strictEqual(db.prepare("SELECT deleted FROM cards WHERE id='1'").get().deleted, 1, 'last copy gone -> printing tombstoned');
console.log('sync copies stream test: PASS');
```

- [ ] **Step 3: Run both — expect failures on the new assertions**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs; ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync-copies.cjs`

- [ ] **Step 4: Implement in `sync.cjs`**

Replace the top of the file (through `remoteToLocalFull`) with:
```js
const { createClient } = require('@supabase/supabase-js');
const { totalValue, copyCount } = require('./valuation.cjs');

// quantity is NOT mirrored any more: both sides derive it from card_copies via triggers.
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute',
  'rarity', 'price', 'deleted', 'cm_product_id', 'price_locked', 'price_first_ed'];

const COPY_COLS = ['copy_id', 'card_id', 'set_code', 'language', 'rarity', 'edition', 'condition', 'deleted',
  'container_id', 'page', 'slot', 'tags', 'note', 'needs_review', 'review_reason', 'for_sale'];
const COPY_BOOLS = new Set(['deleted', 'needs_review', 'for_sale']);

function rowToRemote(row) {
  const out = {};
  for (const c of MIRROR_COLS) {
    if (c === 'deleted') out.deleted = !!row.deleted;
    else if (c === 'price_locked') out.price_locked = Number(row.price_locked) || 0;
    else if (c === 'cm_product_id') out.cm_product_id = row.cm_product_id ?? null;
    else if (c === 'price_first_ed') out.price_first_ed = row.price_first_ed ?? null;
    else out[c] = row[c];
  }
  return out;
}

// Remote row -> the only field the phone may still change on a printing row.
function remoteToLocalPatch(r) {
  return { id: String(r.id), set_code: r.set_code, language: r.language || 'DE', rarity: r.rarity || 'Unknown', deleted: r.deleted ? 1 : 0 };
}

// Remote row -> full local INSERT payload for a phone-created printing the desktop doesn't have yet.
// quantity is carried once here; the copies stream + trigger correct it right after.
function remoteToLocalFull(r) {
  return {
    id: String(r.id), set_code: r.set_code || 'Unknown', language: r.language || 'DE',
    name: r.name ?? null, type: r.type ?? null, desc: r.desc ?? null, image_url: r.image_url ?? null,
    atk: r.atk ?? null, def: r.def ?? null, level: r.level ?? null, race: r.race ?? null,
    attribute: r.attribute ?? null, quantity: r.quantity ?? 1, rarity: r.rarity ?? 'Unknown',
    price: r.price ?? null, deleted: r.deleted ? 1 : 0,
    cm_product_id: r.cm_product_id ?? null, price_locked: Number(r.price_locked) || 0,
    price_first_ed: r.price_first_ed ?? null,
  };
}

function copyToRemote(row) {
  const out = {};
  for (const c of COPY_COLS) out[c] = COPY_BOOLS.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalCopy(r) {
  const out = {};
  for (const c of COPY_COLS) out[c] = COPY_BOOLS.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  out.copy_id = String(r.copy_id); out.card_id = String(r.card_id);
  out.language = out.language || 'DE'; out.rarity = out.rarity || 'Unknown';
  out.edition = out.edition || 'unknown'; out.condition = out.condition || 'NM';
  return out;
}
```
`applyRemoteRow`: 4-column existence check and `deleted`-only patch:
```js
function applyRemoteRow(db, r) {
  const p = remoteToLocalPatch(r);
  const exists = db.prepare('SELECT 1 FROM cards WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity LIMIT 1').get(p);
  if (!exists) {
    db.prepare(`INSERT OR IGNORE INTO cards
      (id, set_code, language, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, price, deleted, cm_product_id, price_locked, price_first_ed)
      VALUES (@id,@set_code,@language,@name,@type,@desc,@image_url,@atk,@def,@level,@race,@attribute,@quantity,@rarity,@price,@deleted,@cm_product_id,@price_locked,@price_first_ed)`)
      .run(remoteToLocalFull(r));
    return;
  }
  db.prepare(`UPDATE cards SET deleted = @deleted
    WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted IS NOT @deleted`).run(p);
}

// Upsert one pulled copy; only writes when something differs so the local updated_at trigger
// (and therefore the next push) fires only for real changes.
function applyRemoteCopy(db, r) {
  const l = remoteToLocalCopy(r);
  const cur = db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(l.copy_id);
  if (!cur) {
    db.prepare(`INSERT INTO card_copies (${COPY_COLS.join(',')}) VALUES (${COPY_COLS.map(c => '@' + c).join(',')})`).run(l);
    return;
  }
  const changed = COPY_COLS.some(c => c !== 'copy_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  const sets = COPY_COLS.filter(c => c !== 'copy_id').map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE card_copies SET ${sets} WHERE copy_id = @copy_id`).run(l);
}
```
Module-level, next to `recentlyPushed`: `const recentlyPushedCopies = new Map();`

Inside `startSync`, after `push`:
```js
  async function pullCopies(c) {
    const cursor = getSetting(db, 'sync_copies_last_pull') || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('card_copies').select('*')
        .gt('updated_at', cursor).order('updated_at', { ascending: true }).order('copy_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull copies failed: ' + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => {
        for (const r of data) {
          if (recentlyPushedCopies.get(r.copy_id) === r.updated_at) { recentlyPushedCopies.delete(r.copy_id); continue; }
          applyRemoteCopy(db, r); applied++;
        }
      })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_copies_last_pull', lastTs);
    return applied;
  }

  async function pushCopies(c) {
    const cursor = getSetting(db, 'sync_copies_last_push') || '1970-01-01T00:00:00Z';
    const changed = db.prepare('SELECT * FROM card_copies WHERE updated_at > ?').all(cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from('card_copies')
        .upsert(changed.slice(i, i + 500).map(copyToRemote), { onConflict: 'copy_id' }).select('copy_id,updated_at');
      if (error) throw new Error('Push copies failed: ' + error.message);
      for (const r of (data || [])) recentlyPushedCopies.set(r.copy_id, r.updated_at);
    }
    setSetting(db, 'sync_copies_last_push', changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }

  // Append-only: the desktop pushes price history, never pulls it (phone charts read the cloud table).
  async function pushPriceHistory(c) {
    const cursor = getSetting(db, 'sync_price_history_last_push') || '1970-01-01T00:00:00Z';
    const rows = db.prepare('SELECT card_id, set_code, language, rarity, variant, day, price, source, recorded_at FROM price_history WHERE recorded_at > ?').all(cursor);
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await c.from('price_history')
        .upsert(rows.slice(i, i + 500).map(({ recorded_at, ...r }) => r), { onConflict: 'card_id,set_code,language,rarity,variant,day' });
      if (error) throw new Error('Push price_history failed: ' + error.message);
    }
    setSetting(db, 'sync_price_history_last_push', rows.reduce((m, r) => (r.recorded_at > m ? r.recorded_at : m), cursor));
  }
```
`syncSnapshot`: replace the SQL with `{ total_value: totalValue(db), card_count: copyCount(db) }`.
`push(c)`: keep, but note the `.select('id,set_code,language,updated_at')` / `recentlyPushed` key stays 3-column (pre-existing; out of scope).
`cycle()`:
```js
      const pulled = await pull(c);
      const pulledCopies = await pullCopies(c);
      await push(c);
      await pushCopies(c);
      await pushPriceHistory(c);
      await syncSnapshot(c);
      if (pulled + pulledCopies > 0) { const w = getWindow(); if (w) w.webContents.send('collection-changed'); }
      emit('idle', pulled + pulledCopies > 0 ? `pulled ${pulled + pulledCopies}` : 'up to date');
```
Exports: `module.exports = { startSync, rowToRemote, remoteToLocalPatch, remoteToLocalFull, applyRemoteRow, copyToRemote, remoteToLocalCopy, applyRemoteCopy };`

- [ ] **Step 5: Run — expect PASS**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync-copies.cjs && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync-insert.cjs`
Expected: three PASS lines.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/test-sync.cjs desktop/electron/test-sync-copies.cjs desktop/electron/test-sync-insert.cjs
git commit -m "feat(sync): card_copies stream, quantity no longer pushed, price_history push, copy-based snapshot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Supabase — `card_copies`, `price_history`, recount trigger, RPC extension

**Files:**
- Create: `supabase/card_copies_schema.sql`
- Create: `supabase/price_history_schema.sql`
- Modify: `supabase/README_cardmarket_cloud.md` (one paragraph: the RPC now also records history)

**Interfaces:**
- Cloud tables consumed by Task 6 (`sync.cjs`) and Tasks 12–14 (Android REST): `public.card_copies` (columns exactly as SQLite, booleans for `deleted/needs_review/for_sale`), `public.price_history` (PK `card_id,set_code,language,rarity,variant,day`).
- Trigger invariant on the cloud: after any change to `card_copies`, `cards.quantity` = live copies and `cards.deleted = (quantity = 0)` for the affected printing(s); the update runs only when a value actually changes (so `set_updated_at` does not re-stamp untouched rows).
- No automated test: the user applies the SQL in the Supabase SQL editor; verification queries are given in Step 4.

- [ ] **Step 1: Write `supabase/card_copies_schema.sql`**

```sql
-- supabase/card_copies_schema.sql — Spec A. Apply ONCE in the Supabase SQL editor.
-- One row per physical copy. cards.quantity / cards.deleted are derived from live copies by trigger.
-- No backfill here: the desktop creates the copies and pushes them (avoids duplicates).

create table if not exists public.card_copies (
  copy_id       text primary key,
  card_id       text not null,
  set_code      text not null default 'Unknown',
  language      text not null default 'DE',
  rarity        text not null default 'Unknown',
  edition       text not null default 'unknown' check (edition in ('first','unlimited','limited','unknown')),
  condition     text not null default 'NM' check (condition in ('MT','NM','EX','GD','LP','PL','PO')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false,
  container_id  text,
  page          integer,
  slot          integer,
  tags          text,
  note          text,
  needs_review  boolean not null default false,
  review_reason text,
  for_sale      boolean not null default false
);

create index if not exists card_copies_printing_idx on public.card_copies (card_id, set_code, language, rarity);
create index if not exists card_copies_updated_idx on public.card_copies (updated_at);

-- Server-stamped updated_at (same helper as cards).
drop trigger if exists trg_card_copies_updated_at on public.card_copies;
create trigger trg_card_copies_updated_at
  before insert or update on public.card_copies
  for each row execute function public.set_updated_at();

-- Recount one printing; only writes when something changes.
create or replace function public.recount_printing(p_card_id text, p_set_code text, p_language text, p_rarity text)
returns void language plpgsql as $$
declare n integer;
begin
  select count(*) into n from public.card_copies c
   where c.card_id = p_card_id and c.set_code = p_set_code and c.language = p_language and c.rarity = p_rarity and c.deleted = false;
  update public.cards set quantity = n, deleted = (n = 0)
   where id = p_card_id and set_code = p_set_code and language = p_language and rarity = p_rarity
     and (quantity is distinct from n or deleted is distinct from (n = 0));
end $$;

create or replace function public.card_copies_recount()
returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.recount_printing(new.card_id, new.set_code, new.language, new.rarity);
  end if;
  if tg_op in ('UPDATE','DELETE') and (tg_op = 'DELETE'
      or old.card_id <> new.card_id or old.set_code <> new.set_code or old.language <> new.language or old.rarity <> new.rarity) then
    perform public.recount_printing(old.card_id, old.set_code, old.language, old.rarity);
  end if;
  return null;
end $$;

drop trigger if exists trg_card_copies_recount on public.card_copies;
create trigger trg_card_copies_recount
  after insert or update or delete on public.card_copies
  for each row execute function public.card_copies_recount();

-- Cross-spec columns pre-created (Spec G).
alter table public.cards add column if not exists price_first_ed double precision;
alter table public.cards add column if not exists cm_first_ed_updated_at timestamptz;
alter table public.portfolio_snapshots add column if not exists sealed_value numeric not null default 0;

-- Single-user app: any authenticated session may read/write (same policy as cards).
alter table public.card_copies enable row level security;
drop policy if exists card_copies_authenticated_all on public.card_copies;
create policy card_copies_authenticated_all on public.card_copies
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Write `supabase/price_history_schema.sql`**

```sql
-- supabase/price_history_schema.sql — Spec A. Apply ONCE after card_copies_schema.sql.
create table if not exists public.price_history (
  card_id     text not null,
  set_code    text not null,
  language    text not null,
  rarity      text not null,
  variant     text not null default 'base',      -- 'base' | 'first' (Spec G)
  day         date not null,
  price       double precision not null,
  source      text not null,                     -- ygoprodeck | cm_bulk | cm_scrape | manual | cloud
  recorded_at timestamptz not null default now(),
  primary key (card_id, set_code, language, rarity, variant, day)
);
create index if not exists price_history_printing_idx on public.price_history (card_id, set_code, language, rarity, day desc);

alter table public.price_history enable row level security;
drop policy if exists price_history_authenticated_all on public.price_history;
create policy price_history_authenticated_all on public.price_history
  for all to authenticated using (true) with check (true);

-- The daily Cardmarket refresh also records history for the rows it changes (source = 'cloud').
create or replace function public.apply_cardmarket_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with changed as (
    update public.cards c
       set price = v.trend,
           cm_updated_at = now()
      from jsonb_to_recordset(prices) as v(id_product integer, trend double precision)
     where c.cm_product_id = v.id_product
       and c.deleted = false
       and coalesce(c.price_locked, 0) <> 2
       and v.trend > 0
       and c.price is distinct from v.trend
     returning c.id, c.set_code, c.language, c.rarity, v.trend
  )
  insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
  select id, set_code, language, rarity, 'base', current_date, trend, 'cloud' from changed
  on conflict (card_id, set_code, language, rarity, variant, day)
  do update set price = excluded.price, source = excluded.source, recorded_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_prices(jsonb) from public;
grant execute on function public.apply_cardmarket_prices(jsonb) to service_role;
```
Note: `row_count` after the INSERT counts history rows, which equals the number of changed cards — the Edge Function's "updated N" log keeps its meaning.

- [ ] **Step 3: README note**

Append to `supabase/README_cardmarket_cloud.md`:
```
## Spec A (2026-09): price history
`apply_cardmarket_prices` now also upserts one `price_history` row (source `cloud`, variant `base`, today) per card whose price changed. Apply `card_copies_schema.sql` then `price_history_schema.sql` once; the desktop backfills copies and pushes them on its next sync.
```

- [ ] **Step 4: User applies + verifies (manual gate)**

Ask the user to run both files in the Supabase SQL editor (order: card_copies first). Verification queries:
```sql
select count(*) from public.card_copies;                    -- 0 right after applying
select tgname from pg_trigger where tgrelid = 'public.card_copies'::regclass;  -- both triggers listed
```
Then start the desktop once with sync enabled and re-run the first query: it must equal `select sum(quantity) from public.cards where deleted = false` (the desktop pushed the backfill). Spot-check: `select quantity from cards where id='<a passcode>'` matches the count of its copies.

- [ ] **Step 5: Commit**

```bash
git add supabase/card_copies_schema.sql supabase/price_history_schema.sql supabase/README_cardmarket_cloud.md
git commit -m "feat(cloud): card_copies + price_history tables, recount trigger, RPC records history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Renderer — Standards in Settings, `CopyChip`, Staging commits copies

**Files:**
- Create: `desktop/src/components/CopyChip.jsx`
- Modify: `desktop/src/components/Settings.jsx` (new "Standards" card after "Market Data")
- Modify: `desktop/src/components/StagingArea.jsx` (state per printing, chip next to the picker, `buildCardData`, CSV presets)

**Interfaces:**
- `<CopyChip edition condition onChange={({edition, condition}) => …} />` — renders `NM · Unbek.`; click toggles a small panel with two rows of buttons (conditions, editions).
- Staging card state gains `edition`, `condition` (primary) and each `extraPrintings[i]` gains the same; commit payload `copies: [{ edition, condition, count: quantity }]`.
- Consumes: `window.api.getDefaults()`, `window.api.saveSetting({key, value})`, `EDITION_LABELS`/`CONDITIONS`/`EDITIONS` from `utils/valuation.js`.

- [ ] **Step 1: `CopyChip.jsx`**

```jsx
import { useState } from 'react';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';

// Compact "NM · Unbek." chip; click opens two button rows (Zustand, Edition) for THIS row only.
export default function CopyChip({ edition = 'unknown', condition = 'NM', onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const std = edition === 'unknown' && condition === 'NM';
  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Zustand · Edition (nur diese Zeile)"
        className={`h-8 px-2 rounded-lg border text-[11px] font-mono whitespace-nowrap transition-colors ${
          std ? 'bg-black/40 border-gray-700 text-gray-400 hover:text-white' : 'bg-gold/10 border-gold/40 text-gold'
        }`}
      >
        {condition} · {EDITION_LABELS[edition] || edition}
      </button>
      {open && (
        <div className="absolute z-30 top-9 left-0 bg-[#1E1E1E] border border-gray-700 rounded-xl p-2 shadow-xl w-[300px]"
             onMouseLeave={() => setOpen(false)}>
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Zustand</div>
          <div className="flex gap-1 mb-2">
            {CONDITIONS.map(c => (
              <button key={c} type="button" onClick={() => onChange({ edition, condition: c })}
                className={`px-2 py-1 rounded text-[11px] font-mono ${c === condition ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 hover:bg-gray-700'}`}>{c}</button>
            ))}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Edition</div>
          <div className="flex gap-1">
            {EDITIONS.map(e => (
              <button key={e} type="button" onClick={() => onChange({ edition: e, condition })}
                className={`px-2 py-1 rounded text-[11px] ${e === edition ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 hover:bg-gray-700'}`}>{EDITION_LABELS[e]}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Settings — "Standards" card**

In `Settings.jsx` add state + loading:
```jsx
    const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
    // inside the existing useEffect, after getSettings().then(...):
            window.api.getDefaults?.().then(d => d && setDefaults(d));
```
and a handler:
```jsx
    const saveDefault = async (key, value) => {
        setDefaults(prev => ({ ...prev, [key]: value }));
        if (window.api) await window.api.saveSetting({ key: key === 'edition' ? 'default_edition' : 'default_condition', value });
    };
```
Insert this card between "Market Data" and "Data Management" (import `CONDITIONS, EDITIONS, EDITION_LABELS` from `../utils/valuation` and `Layers` from lucide):
```jsx
                <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-xl">
                    <div className="flex items-center mb-6 text-gold border-b border-gray-800 pb-4">
                        <Layers className="w-6 h-6 mr-2" />
                        <h3 className="text-xl font-bold text-white">Standards für neue Exemplare</h3>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">Jeder Scan legt Exemplare mit diesen Werten an. Abweichungen setzt du pro Zeile im Staging oder im Karten-Detail.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Zustand</label>
                            <div className="flex gap-1 flex-wrap">
                                {CONDITIONS.map(c => (
                                    <button key={c} onClick={() => saveDefault('condition', c)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-mono ${defaults.condition === c ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 border border-gray-700 hover:bg-gray-800'}`}>{c}</button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Edition</label>
                            <div className="flex gap-1 flex-wrap">
                                {EDITIONS.map(e => (
                                    <button key={e} onClick={() => saveDefault('edition', e)}
                                        className={`px-3 py-1.5 rounded-lg text-sm ${defaults.edition === e ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 border border-gray-700 hover:bg-gray-800'}`}>{EDITION_LABELS[e]}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
```

- [ ] **Step 3: StagingArea — defaults, chip, payload**

(a) Imports: `import CopyChip from './CopyChip';`

(b) Load defaults once (inside the component, before `fetchCard`):
```jsx
  const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
  useEffect(() => { window.api?.getDefaults?.().then(d => d && setDefaults(d)); }, []);
```

(c) In `fetchCard`, in the first `setScannedCards(prev => prev.map(c => { … return { ...c, status: 'loaded', … } }))` add to the returned object:
```jsx
                edition: c.edition || c.presetEdition || defaults.edition,
                condition: c.condition || c.presetCondition || defaults.condition,
```
and add `defaults` to the `useCallback` dependency array of `fetchCard`.

(d) `addPrinting`: the new extra printing object becomes `{ id: …, quantity: 1, selectedSet: null, edition: defaults.edition, condition: defaults.condition }`.

(e) `handleAdd` → `primary` gains `edition: card.edition, condition: card.condition`; in `buildCardData(p, isPrimary)` add before `return cardData;`:
```jsx
               cardData.copies = [{ edition: p.edition || defaults.edition, condition: p.condition || defaults.condition, count: p.quantity || 1 }];
```

(f) JSX — primary row: right after the `PrintingPicker` (inside the `flex-1 flex gap-2` div, before the `Erkannt`/`Prüfen?` badges) add:
```jsx
                                        <CopyChip edition={card.edition} condition={card.condition}
                                            onChange={(v) => handleUpdateCard(card.tempId, v)} />
```
Extra printings row: after its `PrintingPicker` add:
```jsx
                                            <CopyChip edition={p.edition} condition={p.condition}
                                                onChange={(v) => updatePrinting(card.tempId, p.id, v)} />
```

(g) CSV presets: in `handleImportCsv` the mapped staging entry gains `presetEdition: c.edition, presetCondition: c.condition`.

- [ ] **Step 4: Lint + manual verification**

Run: `npm run lint`. Then `npm run electron:dev`: scan/search a card → chip shows `NM · Unbek.`; click → pick `GD` and `1st Ed` → chip turns gold; Add → in Collection › Detail (Task 9 pending: use the DB) `SELECT edition, condition FROM card_copies ORDER BY created_at DESC LIMIT 1` in `userData/cards.db` shows `first, GD`. Change Settings › Standards to `EX` → next scan's chip starts as `EX · Unbek.`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/CopyChip.jsx desktop/src/components/Settings.jsx desktop/src/components/StagingArea.jsx
git commit -m "feat(desktop): staging copy chip (Zustand/Edition per row) + default standards in settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Renderer — Card detail shows copy groups

**Files:**
- Modify: `desktop/src/components/CardDetailModal.jsx` (variants block, lines 164-223 and handlers 42-119)

**Interfaces:**
- Consumes: `window.api.listCopies(printing)`, `addCopy`, `removeCopy`, `updateCopyGroup`, `deleteCard`, `groupCopies`/`valueOf`/`CONDITIONS`/`EDITIONS`/`EDITION_LABELS`.
- Renders per variant: one line per group `2× NM 1st Ed`, `+`/`−` per group, two `<select>`s to move the group, value per group (`fmtEUR(valueOf(price, [group]))`), an "Exemplar hinzufügen" button (defaults), the printing's manual price field and delete button unchanged.

- [ ] **Step 1: State + loading of copies per variant**

Add imports:
```jsx
import { groupCopies, valueOf, CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { fmtEUR } from '../utils/format';
```
Add state and a loader next to `localVariants`:
```jsx
  const [copiesByKey, setCopiesByKey] = useState({}); // "set|rarity|lang" -> [copy rows]
  const vKey = (v) => `${v.set_code}|${v.rarity}|${v.language || 'DE'}`;
  const printingOf = (v) => ({ id: String(card.id), set_code: v.set_code, language: v.language || 'DE', rarity: v.rarity });

  const reloadCopies = async (variants) => {
      if (!window.api?.listCopies) return;
      const entries = await Promise.all(variants.map(async v => [vKey(v), await window.api.listCopies(printingOf(v))]));
      setCopiesByKey(Object.fromEntries(entries));
  };
  useEffect(() => { reloadCopies(card.variants || []); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [card]);
```

- [ ] **Step 2: Replace `handleUpdateQuantity` with group handlers**

```jsx
  const changeGroup = async (variant, group, delta) => {
      const p = printingOf(variant);
      if (delta > 0) await window.api.addCopy({ ...p, edition: group.edition, condition: group.condition, count: 1 });
      else await window.api.removeCopy({ ...p, edition: group.edition, condition: group.condition, count: 1 });
      await refreshVariant(variant);
  };
  const addStandardCopy = async (variant) => { await window.api.addCopy(printingOf(variant)); await refreshVariant(variant); };
  const moveGroup = async (variant, group, to) => {
      await window.api.updateCopyGroup({ ...printingOf(variant), from: { edition: group.edition, condition: group.condition }, to });
      await refreshVariant(variant);
  };
  // Re-read one printing's copies; drop the variant locally when it has none left (the trigger tombstoned it).
  const refreshVariant = async (variant) => {
      const rows = await window.api.listCopies(printingOf(variant));
      setCopiesByKey(prev => ({ ...prev, [vKey(variant)]: rows }));
      setLocalVariants(prev => prev.map(v => vKey(v) === vKey(variant) ? { ...v, quantity: rows.length } : v).filter(v => v.quantity > 0));
  };
```
Delete `handleUpdateQuantity`. `handleAddVariant` stays (it calls `addCardToDb` with `quantity: 1`, which now creates one default copy); after `result.success` call `reloadCopies([...localVariants, newVariant])`.

- [ ] **Step 3: Replace the variant JSX**

Replace the `<div className="flex items-center gap-3">…</div>` block (the price input, "kein CM-Treffer", the +/− stepper, and the delete button) with:
```jsx
                            <div className="flex-1 ml-4">
                                {groupCopies(copiesByKey[vKey(variant)] || []).map(g => (
                                    <div key={`${g.edition}|${g.condition}`} className="flex items-center gap-2 py-1">
                                        <div className="flex items-center bg-[#1E1E1E] rounded border border-gray-600">
                                            <button onClick={() => changeGroup(variant, g, -1)} className="p-1 hover:bg-gray-700 rounded-l text-gray-400 hover:text-white"><Minus className="w-3 h-3" /></button>
                                            <span className="w-8 text-center font-mono text-sm font-bold">{g.count}×</span>
                                            <button onClick={() => changeGroup(variant, g, 1)} className="p-1 hover:bg-gray-700 rounded-r text-gray-400 hover:text-white"><Plus className="w-3 h-3" /></button>
                                        </div>
                                        <select value={g.condition} onChange={e => moveGroup(variant, g, { edition: g.edition, condition: e.target.value })}
                                            className="bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white font-mono">
                                            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <select value={g.edition} onChange={e => moveGroup(variant, g, { edition: e.target.value, condition: g.condition })}
                                            className="bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white">
                                            {EDITIONS.map(ed => <option key={ed} value={ed}>{EDITION_LABELS[ed]}</option>)}
                                        </select>
                                        <span className="ml-auto font-mono text-xs text-gold">{fmtEUR(valueOf(variant.price, [g]))}</span>
                                    </div>
                                ))}
                                <button onClick={() => addStandardCopy(variant)} className="mt-1 text-xs text-gray-400 hover:text-space-violet flex items-center gap-1">
                                    <Plus className="w-3 h-3" /> Exemplar hinzufügen
                                </button>
                            </div>
                            <div className="flex flex-col items-end gap-2 ml-3">
                                <input type="number" step="0.01" min="0" defaultValue={variant.price ?? 0}
                                  onBlur={async (e) => {
                                    const price = parseFloat(e.target.value);
                                    if (isNaN(price)) return;
                                    await window.api.setCardPrice({ id: card.id, set_code: variant.set_code, language: variant.language || 'DE', rarity: variant.rarity, price });
                                  }}
                                  className="w-16 bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white"
                                  title="Preis manuell setzen (überschreibt Auto-Preis)" />
                                {variant.cm_updated_at && !variant.cm_url && (
                                  <span className="text-[9px] text-yellow-500/80" title="Auf Cardmarket nicht eindeutig gefunden">kein CM-Treffer</span>
                                )}
                                <button onClick={() => { if (confirm(`${variant.set_code} (${variant.rarity}) mit allen Exemplaren löschen?`)) handleDeleteVariant(variant); }}
                                    className="p-1.5 bg-crit/10 hover:bg-crit/20 text-crit rounded transition-colors" title="Printing löschen">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
```
Change the outer variant row from `justify-between` to `items-start`, the header label to `Deine Exemplare`, and `Total Owned` to `Gesamt: {localVariants.reduce((s, v) => s + (v.quantity || 0), 0)}`. Replace `${(variant.price || 0).toFixed(2)}` under the set code with `{fmtEUR(variant.price || 0)}`.

- [ ] **Step 4: Lint + manual verification**

`npm run lint`, then in the app: open a card → groups listed with `×n`; `+` on a group adds one to that group; `−` removes from that group; change the condition select → group moves (two groups may merge); "Exemplar hinzufügen" adds a standard copy; `−` down to zero on the last group removes the printing from the list; delete printing still works.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/CardDetailModal.jsx
git commit -m "feat(desktop): card detail shows copy groups with per-group +/- and Zustand/Edition selects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Renderer — collection, tiles and all value sums use copy valuation

**Files:**
- Modify: `desktop/src/components/CollectionList.jsx` (grouping 149-169, filters 40-47/171-185/209-242, toolbar 371-384)
- Modify: `desktop/src/components/CardTile.jsx`
- Modify: `desktop/src/components/Portfolio.jsx:44-63`, `Statistics.jsx:59-93`, `Dashboard.jsx:25-28`

**Interfaces:**
- Every row from `getCollection()` carries `value`, `nonstandard`, `conditions`, `editions` (Task 5). Rule for the renderer: **row value = `row.value`**, never `price × quantity`. Group value = Σ row values.

- [ ] **Step 1: CollectionList grouping + filters**

In `groupedCards` (`useMemo`): replace `g.totalValue += (card.price || 0) * (card.quantity || 1);` with
```jsx
          g.totalValue += (card.value != null ? card.value : (card.price || 0) * (card.quantity || 1));
          g.nonstandard = (g.nonstandard || 0) + (card.nonstandard || 0);
          (card.conditions || '').split(',').filter(Boolean).forEach(x => g.conditions.add(x));
          (card.editions || '').split(',').filter(Boolean).forEach(x => g.editions.add(x));
```
and initialise `conditions: new Set(), editions: new Set(), nonstandard: 0` in the group object.

New filter state: `const [filterCondition, setFilterCondition] = useState('All'); const [filterEdition, setFilterEdition] = useState('All');`
In `filtered`: add
```jsx
        if (filterCondition !== 'All' && !c.conditions.has(filterCondition)) return false;
        if (filterEdition !== 'All' && !c.editions.has(filterEdition)) return false;
```
and the two states to the dependency array; `clearFilters` resets both. Toolbar: after the Rarity select add
```jsx
                <CustomSelect value={filterCondition} onChange={setFilterCondition} placeholder="Zustand" className="w-[110px]" options={[{ value: 'All', label: 'Zustand' }, ...CONDITIONS.map(c => ({ value: c, label: c }))]} />
                <CustomSelect value={filterEdition} onChange={setFilterEdition} placeholder="Edition" className="w-[120px]" options={[{ value: 'All', label: 'Edition' }, ...EDITIONS.map(e => ({ value: e, label: EDITION_LABELS[e] }))]} />
```
with `import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';`.

- [ ] **Step 2: CardTile — value + off-standard dot**

Replace `const total = …` with:
```jsx
  const total = card.totalValue != null ? card.totalValue
              : (card.value != null ? card.value : (card.price || 0) * qty);
```
Under the `×qty` badge add (top-left of the art):
```jsx
        {card.nonstandard > 0 && (
          <span className="absolute top-2 left-2 z-10 w-2 h-2 rounded-full bg-gold shadow-[0_0_6px_#F5C542]" title={`${card.nonstandard} Exemplar(e) mit abweichendem Zustand/Edition`} />
        )}
```
Replace `€{total.toFixed(2)}` with `{fmtEUR(total)}` (`import { fmtEUR } from '../utils/format';`).

- [ ] **Step 3: Portfolio, Statistics, Dashboard**

`Portfolio.jsx`: `equity: (c.price || 0) * (c.quantity || 1)` → `equity: c.value != null ? c.value : (c.price || 0) * (c.quantity || 1)`; the allocation `typeMap[type] += (c.price || 0) * (c.quantity || 1);` → `typeMap[type] += c.value != null ? c.value : (c.price || 0) * (c.quantity || 1);`.
`Statistics.jsx`: `totalValue += (c.price || 0) * q;` → `totalValue += c.value != null ? c.value : (c.price || 0) * q;` and `equity: (c.price || 0) * qty(c)` → `equity: c.value != null ? c.value : (c.price || 0) * qty(c)`.
`Dashboard.jsx`: unchanged for counts (quantity is still correct); nothing multiplies price there.

- [ ] **Step 4: Lint + manual verification**

`npm run lint`; in the app: a card with 1× NM and 1× GD at price 10 shows `17,00 €` on the tile and in the group value; Insights › Value total equals the Start total; Zustand filter `GD` shows only that card; the gold dot appears on it.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/CollectionList.jsx desktop/src/components/CardTile.jsx desktop/src/components/Portfolio.jsx desktop/src/components/Statistics.jsx
git commit -m "feat(desktop): collection/tiles/insights use copy valuation; Zustand + Edition filters; off-standard indicator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Android — `CopyRow`, `Valuation.kt`, JVM unit test

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/ValuationTest.kt`
- Modify: `android/app/build.gradle.kts` (test dependency `org.json:json`)

**Interfaces:**
- `data class CopyRow(copyId, cardId, setCode, language, rarity, edition, condition, deleted)`; `fun CopyRow.printingKey() = "$cardId|$setCode|$language|$rarity"`.
- `object Valuation { val CONDITIONS: List<String>; val EDITIONS: List<String>; val EDITION_LABELS: Map<String,String>; fun factor(condition: String?): Double; fun valueOf(price: Double?, copies: List<CopyRow>): Double; data class Group(val edition: String, val condition: String, val count: Int); fun group(copies: List<CopyRow>): List<Group> }`
- Same numbers and ordering as the JS twin (Task 1).

- [ ] **Step 1: Gradle — JVM unit tests can use org.json**

In `android/app/build.gradle.kts` dependencies add after `testImplementation("junit:junit:4.13.2")`:
```kotlin
    testImplementation("org.json:json:20240303")
```

- [ ] **Step 2: Write the failing test**

`android/app/src/test/java/com/example/yugiohscanner/ValuationTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ValuationTest {
    private fun copy(cond: String, ed: String = "unknown") =
        CopyRow("id-$cond-$ed-${System.nanoTime()}", "1", "LOB-DE001", "DE", "Ultra Rare", ed, cond, false)

    @Test
    fun factorsMatchTheSharedJsonFile() {
        // Gradle runs unit tests with the module dir (android/app) as working directory.
        val f = File("../../desktop/electron/condition-factors.json")
        assertTrue("shared factor file must exist at ${f.absolutePath}", f.exists())
        val json = JSONObject(f.readText())
        for (c in Valuation.CONDITIONS) assertEquals("factor $c", json.getDouble(c), Valuation.factor(c), 1e-9)
        assertEquals(json.length(), Valuation.CONDITIONS.size)
    }

    @Test
    fun valueOfSumsPriceTimesFactor() {
        assertEquals(17.0, Valuation.valueOf(10.0, listOf(copy("NM"), copy("GD"))), 1e-9)
        assertEquals(0.0, Valuation.valueOf(null, listOf(copy("NM"))), 1e-9)
        assertEquals(1.0, Valuation.factor(""), 1e-9)
        assertEquals(1.0, Valuation.factor("XX"), 1e-9)
    }

    @Test
    fun groupOrdersByEditionThenCondition() {
        val g = Valuation.group(listOf(copy("NM"), copy("GD", "first"), copy("NM")))
        assertEquals(listOf(Valuation.Group("first", "GD", 1), Valuation.Group("unknown", "NM", 2)), g)
    }
}
```

- [ ] **Step 3: Run — expect compile failure (unresolved CopyRow/Valuation)**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.example.yugiohscanner.ValuationTest"`

- [ ] **Step 4: Implement**

`cloud/CopyRow.kt`:
```kotlin
package com.example.yugiohscanner.cloud

// One physical copy, mirrored from the Supabase `card_copies` table (Spec A).
data class CopyRow(
    val copyId: String,
    val cardId: String,
    val setCode: String,
    val language: String,
    val rarity: String,
    val edition: String,     // first | unlimited | limited | unknown
    val condition: String,   // MT NM EX GD LP PL PO
    val deleted: Boolean,
) {
    fun printingKey() = "$cardId|$setCode|$language|$rarity"
}

fun CardRow.printingKey() = "$id|$setCode|$language|${rarity ?: "Unknown"}"
```

`cloud/Valuation.kt`:
```kotlin
package com.example.yugiohscanner.cloud

// Fixed condition factors — MUST equal desktop/electron/condition-factors.json (ValuationTest checks).
object Valuation {
    val CONDITIONS = listOf("MT", "NM", "EX", "GD", "LP", "PL", "PO")
    val EDITIONS = listOf("first", "unlimited", "limited", "unknown")
    val EDITION_LABELS = mapOf("first" to "1st Ed", "unlimited" to "Unlimited", "limited" to "Limited", "unknown" to "Unbek.")
    private val FACTORS = mapOf("MT" to 1.0, "NM" to 1.0, "EX" to 0.85, "GD" to 0.7, "LP" to 0.5, "PL" to 0.35, "PO" to 0.2)

    fun factor(condition: String?): Double = FACTORS[condition?.uppercase() ?: ""] ?: 1.0

    fun valueOf(price: Double?, copies: List<CopyRow>): Double {
        val p = price ?: 0.0
        if (p <= 0.0 || copies.isEmpty()) return 0.0
        val f = copies.filter { !it.deleted }.sumOf { factor(it.condition) }
        return Math.round(p * f * 100.0) / 100.0
    }

    data class Group(val edition: String, val condition: String, val count: Int)

    fun group(copies: List<CopyRow>): List<Group> =
        copies.filter { !it.deleted }
            .groupBy { it.edition to it.condition }
            .map { (k, v) -> Group(k.first, k.second, v.size) }
            .sortedWith(compareBy({ EDITIONS.indexOf(it.edition) }, { CONDITIONS.indexOf(it.condition) }))
}
```

- [ ] **Step 5: Run — expect 3 passing**

Run: `./gradlew :app:testDebugUnitTest --tests "com.example.yugiohscanner.ValuationTest"` → BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add android/app/build.gradle.kts android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt android/app/src/test/java/com/example/yugiohscanner/ValuationTest.kt
git commit -m "feat(android): CopyRow + Valuation (shared condition factors, JVM test against the JSON file)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Android — `CollectionRepository` on copies

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt`

**Interfaces:**
- `suspend fun loadCopies(): List<CopyRow>` — all live copies (paged like `loadCards`).
- `suspend fun addCopies(printing: CardRow, edition: String, condition: String, count: Int = 1)` — POST N rows to `card_copies`; throws `NotMigratedException` if the printing has `quantity > 0` but zero live copies (desktop backfill not synced yet).
- `suspend fun removeCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): Int` — PATCH `deleted=true` on up to `count` copy_ids of that group (client picks newest first).
- `suspend fun updateCopyGroup(printing: CardRow, fromEdition, fromCondition, toEdition, toCondition): Int`
- `suspend fun addPrinting(base, setCode, rarity, price, language, edition, condition, count)` — inserts the card row (quantity 0) then copies.
- `suspend fun addScanned(base, setCode, rarity, language, edition, condition, count): String` — existing row → `addCopies` (un-deletes via trigger); missing → `addPrinting`.
- `setQuantity` is deleted. `softDelete(row)` now soft-deletes the copies of the printing first, then the card row.
- `class NotMigratedException(msg) : RuntimeException(msg)`.

- [ ] **Step 1: Add the copies API**

Add at file top (after imports): `class NotMigratedException(message: String) : RuntimeException(message)`
and `import java.util.UUID`.

Inside `object CollectionRepository` add:
```kotlin
    private fun auth(b: Request.Builder) = b
        .addHeader("apikey", SupabaseCloud.key())
        .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    suspend fun loadCopies(): List<CopyRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<CopyRow>()
        var offset = 0
        while (true) {
            val url = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
                .addQueryParameter("select", "copy_id,card_id,set_code,language,rarity,edition,condition,deleted")
                .addQueryParameter("deleted", "eq.false")
                .addQueryParameter("order", "copy_id.asc")
                .addQueryParameter("limit", PAGE.toString())
                .addQueryParameter("offset", offset.toString())
                .build()
            val page = executeWithReauth { auth(Request.Builder().url(url)).get().build() }.use { resp ->
                val text = resp.body?.string() ?: "[]"
                if (!resp.isSuccessful) throw RuntimeException("Exemplare laden fehlgeschlagen (${resp.code}): $text")
                parseCopies(JSONArray(text))
            }
            out.addAll(page)
            if (page.size < PAGE) break
            offset += PAGE
        }
        out
    }

    private suspend fun copiesOf(p: CardRow, edition: String? = null, condition: String? = null): List<CopyRow> = withContext(Dispatchers.IO) {
        val b = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            .addQueryParameter("select", "copy_id,card_id,set_code,language,rarity,edition,condition,deleted")
            .addQueryParameter("card_id", "eq.${p.id}")
            .addQueryParameter("set_code", "eq.${p.setCode}")
            .addQueryParameter("language", "eq.${p.language}")
            .addQueryParameter("rarity", "eq.${p.rarity ?: "Unknown"}")
            .addQueryParameter("deleted", "eq.false")
            .addQueryParameter("order", "created_at.desc")
        if (edition != null) b.addQueryParameter("edition", "eq.$edition")
        if (condition != null) b.addQueryParameter("condition", "eq.$condition")
        executeWithReauth { auth(Request.Builder().url(b.build())).get().build() }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("Exemplare laden fehlgeschlagen (${resp.code}): $text")
            parseCopies(JSONArray(text))
        }
    }

    // A printing that still has quantity > 0 but no copies was not backfilled yet (desktop-only step).
    // Adding copies now would double-count once the desktop pushes its backfill -> refuse.
    private suspend fun ensureMigrated(p: CardRow) {
        val row = getRow(p.id, p.setCode, p.language, p.rarity) ?: return
        if (row.quantity > 0 && copiesOf(p).isEmpty())
            throw NotMigratedException("Sammlung noch nicht migriert – bitte die Desktop-App einmal starten (Sync).")
    }

    suspend fun addCopies(printing: CardRow, edition: String, condition: String, count: Int = 1) = withContext(Dispatchers.IO) {
        ensureMigrated(printing)
        val arr = JSONArray()
        repeat(maxOf(1, count)) {
            arr.put(JSONObject()
                .put("copy_id", UUID.randomUUID().toString())
                .put("card_id", printing.id).put("set_code", printing.setCode)
                .put("language", printing.language).put("rarity", printing.rarity ?: "Unknown")
                .put("edition", edition).put("condition", condition).put("deleted", false))
        }
        executeWithReauth {
            auth(Request.Builder().url("${SupabaseCloud.base()}/rest/v1/card_copies"))
                .addHeader("Content-Type", "application/json").addHeader("Prefer", "return=minimal")
                .post(arr.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Exemplar anlegen fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
    }

    suspend fun removeCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): Int = withContext(Dispatchers.IO) {
        val victims = copiesOf(printing, edition, condition).take(maxOf(1, count))
        for (c in victims) patchCopy(c.copyId, JSONObject().put("deleted", true))
        victims.size
    }

    suspend fun updateCopyGroup(printing: CardRow, fromEdition: String, fromCondition: String, toEdition: String, toCondition: String): Int = withContext(Dispatchers.IO) {
        val rows = copiesOf(printing, fromEdition, fromCondition)
        for (c in rows) patchCopy(c.copyId, JSONObject().put("edition", toEdition).put("condition", toCondition))
        rows.size
    }

    private suspend fun patchCopy(copyId: String, body: JSONObject) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            .addQueryParameter("copy_id", "eq.$copyId").build()
        executeWithReauth {
            auth(Request.Builder().url(url)).addHeader("Content-Type", "application/json")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Exemplar ändern fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
    }

    private fun parseCopies(arr: JSONArray): List<CopyRow> = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        CopyRow(
            copyId = o.getString("copy_id"), cardId = o.getString("card_id"),
            setCode = o.optString("set_code", "Unknown"), language = o.optString("language", "DE"),
            rarity = o.optString("rarity", "Unknown"), edition = o.optString("edition", "unknown"),
            condition = o.optString("condition", "NM"), deleted = o.optBoolean("deleted", false),
        )
    }
```

- [ ] **Step 2: Rewrite the printing writers**

Replace `setQuantity`, `softDelete`, `addPrinting`, `addScanned` with:
```kotlin
    suspend fun softDelete(row: CardRow) = withContext(Dispatchers.IO) {
        for (c in copiesOf(row)) patchCopy(c.copyId, JSONObject().put("deleted", true))
        patch(row, JSONObject().put("deleted", true).put("quantity", 0))
    }

    // Creates the printing row (quantity 0; the cloud trigger counts the copies) + its copies.
    suspend fun addPrinting(base: CardRow, setCode: String, rarity: String, price: Double, language: String = "DE",
                            edition: String, condition: String, count: Int = 1) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("id", base.id).put("set_code", setCode).put("language", language)
            .put("name", base.name).put("type", base.type).put("desc", base.desc)
            .put("image_url", base.imageUrl).put("atk", base.atk ?: JSONObject.NULL)
            .put("def", base.def ?: JSONObject.NULL).put("level", base.level ?: JSONObject.NULL)
            .put("race", base.race).put("attribute", base.attribute)
            .put("quantity", 0).put("rarity", rarity).put("price", price).put("deleted", false)
            .toString()
        executeWithReauth {
            auth(Request.Builder().url("${SupabaseCloud.base()}/rest/v1/cards"))
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("Hinzufügen fehlgeschlagen (${resp.code}): ${resp.body?.string()}")
        }
        val printing = CardRow(base.id, setCode, language, base.name, base.imageUrl, rarity, 0, price)
        addCopies(printing, edition, condition, count)
    }

    // Autonomous scan flow: add `count` copies under the (validated) printing; the printing row is
    // created when missing. Un-deleting a tombstoned printing happens through the cloud trigger.
    suspend fun addScanned(base: CardRow, setCode: String, rarity: String, language: String,
                           edition: String, condition: String, count: Int = 1): String = withContext(Dispatchers.IO) {
        val existing = getRow(base.id, setCode, language, rarity)
        val label = base.name ?: base.id
        if (existing != null) {
            addCopies(existing, edition, condition, count)
            "$label → +$count× ($setCode)"
        } else {
            addPrinting(base, setCode, rarity, 0.0, language, edition, condition, count)
            "$label hinzugefügt ($setCode)"
        }
    }
```
`merge-duplicates` on the cards POST makes a re-add of a tombstoned printing an upsert (it resets `deleted=false`, `quantity=0`, and the copies recount).

- [ ] **Step 3: Static check + fix call sites**

Run: `./gradlew :app:compileDebugKotlin`. Expected errors at `AddPrintingSection.kt:56`, `CardDetailScreen.kt:118/126`, `ScanStagingScreen.kt:105/115` (signature changes) — they are fixed in Tasks 13/14. To keep this task green, apply the minimal call-site edits now:
- `AddPrintingSection.kt:56`: `CollectionRepository.addPrinting(base, s.setCode, s.rarity, s.price, s.language, edition = Prefs.defaultEdition(context), condition = Prefs.defaultCondition(context))` — requires Task 13's `Prefs`; for now pass literals `"unknown", "NM"` and leave a `// STOPGAP(Task 13)` comment that Task 13 removes.
- `CardDetailScreen.kt` lines 117-129: temporarily replace the two `setQuantity` calls with `addCopies(v, "unknown", "NM")` / `removeCopies(v, "unknown", "NM")` (Task 14 rewrites this block).
- `ScanStagingScreen.kt` 105-118: add `edition = "unknown", condition = "NM"` to both `addScanned` calls (Task 13 replaces with the chip values).
Re-run the compile → BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt android/app/src/main/java/com/example/yugiohscanner/ui/AddPrintingSection.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/ScanStagingScreen.kt
git commit -m "feat(android): CollectionRepository writes card_copies (add/remove/regroup), not-migrated guard, setQuantity removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Android — prefs, Settings chips, staging `CopyChip`, commit with copies

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/Prefs.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/CopyChip.kt`
- Modify: `ui/SettingsScreen.kt` (new section "Standards" after "Preisquelle")
- Modify: `ui/ScanStagingScreen.kt` (entry state, chip in `StagingRow`, commit)
- Modify: `ui/AddPrintingSection.kt` (use `Prefs`)

**Interfaces:**
- `object Prefs { fun defaultEdition(ctx: Context): String; fun defaultCondition(ctx: Context): String; fun setDefaultEdition(ctx, v); fun setDefaultCondition(ctx, v) }` backed by `scanner_prefs` keys `default_edition` / `default_condition`.
- `@Composable fun CopyChip(edition: String, condition: String, onChange: (String, String) -> Unit)` — same behaviour as the desktop chip (dropdown with two rows).
- `ScanStagingEntry` and `ExtraPrinting` gain `var edition`, `var condition` (initialised from `Prefs` by the creator).

- [ ] **Step 1: `Prefs.kt`**

```kotlin
package com.example.yugiohscanner

import android.content.Context
import com.example.yugiohscanner.cloud.Valuation

object Prefs {
    private fun p(ctx: Context) = ctx.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
    fun defaultEdition(ctx: Context): String =
        p(ctx).getString("default_edition", null)?.takeIf { it in Valuation.EDITIONS } ?: "unknown"
    fun defaultCondition(ctx: Context): String =
        p(ctx).getString("default_condition", null)?.takeIf { it in Valuation.CONDITIONS } ?: "NM"
    fun setDefaultEdition(ctx: Context, v: String) = p(ctx).edit().putString("default_edition", v).apply()
    fun setDefaultCondition(ctx: Context, v: String) = p(ctx).edit().putString("default_condition", v).apply()
}
```

- [ ] **Step 2: `ui/CopyChip.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted

// "NM · Unbek." chip; tap opens the two rows (Zustand, Edition). Gold when off the standard.
@Composable
fun CopyChip(edition: String, condition: String, onChange: (edition: String, condition: String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val std = edition == "unknown" && condition == "NM"
    val tint = if (std) Muted else Gold
    Box {
        Text(
            "$condition · ${Valuation.EDITION_LABELS[edition] ?: edition}",
            style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = tint,
            modifier = Modifier
                .border(1.dp, tint.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                .background(tint.copy(alpha = if (std) 0.08f else 0.15f), RoundedCornerShape(8.dp))
                .clickable { open = true }
                .padding(horizontal = 8.dp, vertical = 5.dp),
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text("Zustand", style = MaterialTheme.typography.labelSmall, color = Muted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            Row(Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Valuation.CONDITIONS.forEach { c ->
                    FilterChip(selected = c == condition, onClick = { onChange(edition, c) }, label = { Text(c, fontFamily = MonoFontFamily) })
                }
            }
            Text("Edition", style = MaterialTheme.typography.labelSmall, color = Muted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Valuation.EDITIONS.forEach { e ->
                    FilterChip(selected = e == edition, onClick = { onChange(e, condition); open = false }, label = { Text(Valuation.EDITION_LABELS[e] ?: e) })
                }
            }
        }
    }
}
```
(`Gold` exists in `ui/theme/Color.kt` — it is used by `PortfolioScreen`.)

- [ ] **Step 3: SettingsScreen — "Standards"**

After the "Preisquelle" section add:
```kotlin
        // ---- Standards für neue Exemplare ------------------------------------
        val ctx = androidx.compose.ui.platform.LocalContext.current
        var defEdition by remember { mutableStateOf(com.example.yugiohscanner.Prefs.defaultEdition(ctx)) }
        var defCondition by remember { mutableStateOf(com.example.yugiohscanner.Prefs.defaultCondition(ctx)) }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Standards für neue Exemplare")
            Text("Jeder Scan legt Exemplare mit diesen Werten an. Abweichungen setzt du pro Zeile.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
            Text("Zustand", style = MaterialTheme.typography.labelSmall, color = Muted)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                com.example.yugiohscanner.cloud.Valuation.CONDITIONS.forEach { c ->
                    FilterChip(selected = defCondition == c, onClick = { defCondition = c; com.example.yugiohscanner.Prefs.setDefaultCondition(ctx, c) }, label = { Text(c) })
                }
            }
            Text("Edition", style = MaterialTheme.typography.labelSmall, color = Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                com.example.yugiohscanner.cloud.Valuation.EDITIONS.forEach { e ->
                    FilterChip(selected = defEdition == e, onClick = { defEdition = e; com.example.yugiohscanner.Prefs.setDefaultEdition(ctx, e) },
                        label = { Text(com.example.yugiohscanner.cloud.Valuation.EDITION_LABELS[e] ?: e) })
                }
            }
        }
```
Add `import androidx.compose.foundation.horizontalScroll` (and `rememberScrollState` is already imported).

- [ ] **Step 4: ScanStagingScreen — state, chip, commit**

`ScanStagingEntry`: add `var edition by mutableStateOf("unknown")` and `var condition by mutableStateOf("NM")`; same two fields on `ExtraPrinting`. Where entries are created (`MainActivity.kt:476` `ScanStagingEntry(System.nanoTime(), pc)`), set them right after construction:
```kotlin
                val entry = ScanStagingEntry(System.nanoTime(), pc).apply {
                    edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
                    condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
                }
```
and in `StagingRow`'s `TextButton(onClick = { entry.extraPrintings.add(ExtraPrinting()) })` initialise the new `ExtraPrinting` with the entry's current values: `ExtraPrinting().apply { edition = entry.edition; condition = entry.condition }`.

In `StagingRow`, primary row: after `SetPicker(…)` and before `QtyStepper` insert
```kotlin
                Spacer(Modifier.width(6.dp))
                CopyChip(entry.edition, entry.condition) { e, c -> entry.edition = e; entry.condition = c }
```
and the same for each extra printing with `ep.edition/ep.condition`.

Commit block: replace the two `addScanned` calls' `edition = "unknown", condition = "NM"` (Task 12 stop-gap) with `edition = e.edition, condition = e.condition` and `edition = ep.edition, condition = ep.condition`; catch `NotMigratedException` explicitly so the message reaches the user unchanged (the generic `catch (ex: Exception)` already shows `ex.message`; nothing else needed).

`AddPrintingSection.kt`: replace the stop-gap literals with `edition = Prefs.defaultEdition(context), condition = Prefs.defaultCondition(context)` where `val context = LocalContext.current` at the top of the composable; remove the STOPGAP comment.

- [ ] **Step 5: Compile + on-device check**

Run: `./gradlew :app:installDebug` (device connected) then `adb shell am start -W -n com.example.yugiohscanner/.MainActivity`. Scan a card → Prüfen: chip shows `NM · Unbek.`; tap → choose `EX` → chip turns gold; Übernehmen → in Supabase: `select edition, condition from card_copies order by created_at desc limit 1` → `unknown, EX`. Settings → Standards → `1st Ed` → next scan's chip starts `NM · 1st Ed`.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/Prefs.kt android/app/src/main/java/com/example/yugiohscanner/ui/CopyChip.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/ScanStagingScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AddPrintingSection.kt android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt
git commit -m "feat(android): staging copy chip + default standards in settings; scans commit copies with edition/condition

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Android — detail groups, valuation everywhere, on-device verification

**Files:**
- Modify: `ui/CardDetailScreen.kt` (signature + "Deine Exemplare" block)
- Modify: `ui/CollectionScreen.kt` (load copies, values, pass to detail)
- Modify: `ui/Dashboard.kt` (`computeDashboard(cards, copies)`)
- Modify: `ui/PortfolioScreen.kt`, `ui/UebersichtScreen.kt` (load copies, pass through)

**Interfaces:**
- `computeDashboard(cards: List<CardRow>, copies: List<CopyRow>): Dashboard` — every value uses `Valuation.valueOf(price, copiesOfThatPrinting)`; counts use `quantity` (unchanged).
- `CardDetailScreen(cardId, initial, initialCopies: List<CopyRow>, onClose, onChanged)`.
- Value helper for both screens: `fun printingValue(c: CardRow, byKey: Map<String, List<CopyRow>>) = Valuation.valueOf(c.price, byKey[c.printingKey()] ?: emptyList())` (put it in `Dashboard.kt`, top-level, `internal`).

- [ ] **Step 1: `Dashboard.kt` — valuation**

Change `groupCards(...)` to take `byKey: Map<String, List<CopyRow>>` and sum `printingValue(c, byKey)` instead of `(c.price ?: 0.0) * c.quantity`. `computeDashboard(cards, copies)`:
```kotlin
internal fun printingValue(c: CardRow, byKey: Map<String, List<CopyRow>>): Double =
    Valuation.valueOf(c.price, byKey[c.printingKey()] ?: emptyList())

fun computeDashboard(cards: List<CardRow>, copies: List<CopyRow>): Dashboard {
    val byKey = copies.groupBy { it.printingKey() }
    val totalValue = cards.sumOf { printingValue(it, byKey) }
    val totalCards = cards.sumOf { it.quantity }
    val top = cards.sortedByDescending { printingValue(it, byKey) }.take(10)
    val byRarity = groupCards(cards, byKey) { it.rarity ?: "Unbekannt" }.sortedBy { rarityRank(if (it.label == "Unbekannt") null else it.label) }
    val typeOrder = listOf("Monster", "Zauber", "Falle", "Sonstige")
    val typeMap = groupCards(cards, byKey) { typeGroup(it.type) }.associateBy { it.label }
    val byType = typeOrder.mapNotNull { typeMap[it] }
    val bySet = groupCards(cards, byKey) { it.setCode }.sortedByDescending { it.count }.take(10)
    val byAttribute = groupCards(cards, byKey, include = { !it.attribute.isNullOrBlank() }) { it.attribute }.sortedByDescending { it.count }
    return Dashboard(totalValue, totalCards, cards.size, top, byRarity, byType, bySet, byAttribute)
}
```
(imports: `com.example.yugiohscanner.cloud.CopyRow`, `Valuation`, `printingKey`.)

- [ ] **Step 2: Callers load copies**

`PortfolioScreen.kt`: add `var copies by remember { mutableStateOf<List<CopyRow>>(emptyList()) }`; in `LaunchedEffect` after `cards = c`: `copies = CollectionRepository.loadCopies()`; `computeDashboard(c, copies)` / `computeDashboard(cards, copies)`; the "Teuerste Karten" row value: `ValueText(printingValue(c, copies.groupBy { it.printingKey() }), …)` (compute `byKey` once above the loop).
`UebersichtScreen.kt:127`: same pattern — load copies next to cards and call `computeDashboard(cards, copies)`.
`CollectionScreen.kt`: add `var copies by remember { mutableStateOf<List<CopyRow>>(emptyList()) }`; `reload()` becomes `cards = CollectionRepository.loadCards(); copies = CollectionRepository.loadCopies(); loading = false`; `groupCards(cards)` → `groupCards(cards, copies.groupBy { it.printingKey() })` with `totalValue = rows.sumOf { printingValue(it, byKey) }`; pass `initialCopies = copies` to `CardDetailScreen`. In `CardGroupItem` the per-variant unit price stays `v.price`.

- [ ] **Step 3: CardDetailScreen — groups**

Signature: `fun CardDetailScreen(cardId: String, initial: List<CardRow>, initialCopies: List<CopyRow>, onClose: () -> Unit, onChanged: () -> Unit)`. State: `var copies by remember { mutableStateOf(initialCopies.filter { it.cardId == cardId }) }`; `refresh()` reloads both (`copies = CollectionRepository.loadCopies().filter { it.cardId == cardId }`). Replace the `printings.forEach { v -> … }` block with:
```kotlin
        val ctx = androidx.compose.ui.platform.LocalContext.current
        val byKey = copies.groupBy { it.printingKey() }
        printings.forEach { v ->
            val mine = byKey[v.printingKey()] ?: emptyList()
            val migrated = mine.isNotEmpty() || v.quantity == 0
            SpaceCard(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        RarityChip(v.rarity)
                        Text(v.setCode, style = MaterialTheme.typography.bodyMedium, fontFamily = MonoFontFamily, color = Muted, modifier = Modifier.weight(1f))
                        ValueText(Valuation.valueOf(v.price, mine), style = MaterialTheme.typography.bodyMedium)
                        IconButton(onClick = { scope.launch { try { CollectionRepository.softDelete(v); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                            Icon(Icons.Default.Delete, "Löschen", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                    if (!migrated) {
                        Text("${v.quantity}× NM · Unbek. (nicht migriert – Desktop einmal starten)", style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                    Valuation.group(mine).forEach { g ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(enabled = migrated, onClick = { scope.launch { try { CollectionRepository.removeCopies(v, g.edition, g.condition); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                                Icon(Icons.Default.Remove, "−", tint = MaterialTheme.colorScheme.primary)
                            }
                            Text("${g.count}×", fontFamily = MonoFontFamily, color = MaterialTheme.colorScheme.onSurface)
                            IconButton(enabled = migrated, onClick = { scope.launch { try { CollectionRepository.addCopies(v, g.edition, g.condition); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                                Icon(Icons.Default.Add, "+", tint = MaterialTheme.colorScheme.primary)
                            }
                            Spacer(Modifier.width(6.dp))
                            CopyChip(g.edition, g.condition) { e, c ->
                                scope.launch { try { CollectionRepository.updateCopyGroup(v, g.edition, g.condition, e, c); error = null; refresh() } catch (ex: Exception) { error = ex.message } }
                            }
                            Spacer(Modifier.weight(1f))
                            ValueText(Valuation.valueOf(v.price, mine.filter { it.edition == g.edition && it.condition == g.condition }), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    TextButton(enabled = migrated, onClick = {
                        scope.launch { try { CollectionRepository.addCopies(v, Prefs.defaultEdition(ctx), Prefs.defaultCondition(ctx)); error = null; refresh() } catch (e: Exception) { error = e.message } }
                    }) { Text("Exemplar hinzufügen", color = MaterialTheme.colorScheme.primary) }
                }
            }
        }
```
Rename the section header to `SectionHeader("Deine Exemplare")`. Imports: `com.example.yugiohscanner.Prefs`, `cloud.CopyRow`, `cloud.Valuation`, `cloud.printingKey`. Remove the Task 12 stop-gap lines.

- [ ] **Step 4: Compile, unit tests, install**

Run: `./gradlew :app:testDebugUnitTest :app:installDebug` → BUILD SUCCESSFUL.

- [ ] **Step 5: On-device verification (spec §11) — record the results in the commit message**

With the desktop running (sync on, backfill done, cloud SQL applied):
1. Handy: Karte scannen → Prüfen → Chip `GD` → Übernehmen. Desktop (≤ 20 s): the printing shows a `GD` group; tile value uses 0.7.
2. Desktop: Detail → `+` on the `NM` group. Handy: reopen detail → group `2×`.
3. Handy: `−` until the printing has 0 copies → it vanishes; desktop: printing gone after sync.
4. Handy: total on Start/Wert equals the desktop Insights total (same €, rounding ±0,01).
5. Handy on a printing with quantity > 0 and no copies (simulate by deleting its copies in the SQL editor): detail shows "(nicht migriert…)", +/− disabled, scanning that card again shows the NotMigrated message.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/Dashboard.kt android/app/src/main/java/com/example/yugiohscanner/ui/PortfolioScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/UebersichtScreen.kt
git commit -m "feat(android): card detail copy groups, copy-based valuation on Sammlung/Wert/Übersicht, not-migrated guard in UI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Spec coverage check (self-review)

| Spec section | Task |
|---|---|
| 5.1 `card_copies` (SQLite + Supabase) | 2, 7 |
| 5.2 recount triggers (both sides), OLD+NEW on move | 2, 7 |
| 5.3 fixed factors, `valueOf` JS + Kotlin, shared JSON + Kotlin test | 1, 11 |
| 5.4 `price_history` + write rule; all four desktop writers + cloud RPC | 4, 7 |
| 5.5 settings `default_condition`/`default_edition`/`copies_migrated`; Android prefs | 2, 3 (`defaults`), 8, 13 |
| 6.1 `quantity` out of push, `deleted`-only patch, cycle order | 6 |
| 6.2 copies stream with cursor/echo-skip/soft-delete | 6 |
| 7.1 desktop-only guarded backfill | 2 |
| 7.2 cloud SQL without backfill | 7 |
| 7.3 Android refuses unmigrated printings, UI shows "(nicht migriert)" | 12, 14 |
| 8.1 standards | 8, 13 |
| 8.2 staging chip + payload `copies` | 8 (desktop), 13 (Android) |
| 8.3 detail groups, +/−, regroup, add standard copy, minus removes from the group | 9, 14 |
| 8.4 list filters Zustand/Edition, off-standard indicator, row value, standard-first minus | 5 (`nonstandard`, `conditions`, `editions`), 10, 3 (`removeCopies` rule) |
| 8.5 Unknown/downgrade handlers move copies | 5 |
| 8.6 CSV import optional columns (export → Spec F) | 5, 8 |
| 9 valuation at every sum (portfolio, snapshot, insights, dashboard, phone) | 4, 6, 10, 14 |
| Overview: cross-spec columns pre-created | 2, 7 |

Known deviations from the spec, deliberate: factor JSON lives in `desktop/electron/` (packaging), not `desktop/shared/`; CSV **export** with copy columns is left to Spec F because no export handler exists today; the pre-existing 3-column `trg_cards_updated` trigger and the 3-column `recentlyPushed` key in `push()` are untouched (out of scope, harmless).
