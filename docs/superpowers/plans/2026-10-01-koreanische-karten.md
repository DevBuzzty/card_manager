# Koreanische Karten (KR) – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Koreanische Karten als eigene Sprache `KR` erfassen – KR-Set-Codes in jeder Set-Auswahl, koreanischer Name in der Anzeige, Scanner mit Auto-Erkennung und fester Sprache, Preis = Trend × KR-Faktor.

**Architecture:** KR wird nach dem vorhandenen JP-Muster eingebaut (Wikis + Konami, parallel). Zwei neue Spalten an `cards` (`name_ko`, `cm_lang_factor`) laufen durch SQLite, Supabase und Sync. Jede Preisquelle multipliziert beim Schreiben mit `cm_lang_factor`, die Bewertung bleibt unverändert. Zwillingslogik (JS ↔ Kotlin) wird über die Fixture `docs/fixtures/language/kr.json` geprüft.

**Tech Stack:** Electron (CommonJS main, `.cjs`) + React/Vite renderer + better-sqlite3; Kotlin/Compose Android (OkHttp, org.json, JUnit4); Supabase Postgres (plpgsql).

**Spec:** `docs/superpowers/specs/2026-10-01-koreanische-karten-design.md`

## Global Constraints

- Sprachwert in der DB: genau `'KR'` (Großbuchstaben), wie `'DE'`/`'EN'`/`'JP'`.
- KR-Code = Region `KR` oder altes einzelnes `K` vor der Nummer; Regex `/-KR?[A-Z]?\d/i` (JS) bzw. `Regex("""-KR?[A-Z]?\d""", IGNORE_CASE)` (Kotlin).
- Standard-KR-Faktor `0.5`; gültige Werte `0 < f ≤ 1`; Einstellung `settings.kr_price_factor`.
- Rundung: `Math.round(price * f * 100 + 1e-7) / 100` (JS) ≙ `Math.round(price * f * 100 + 1e-7) / 100.0` (Kotlin) ≙ `round(numeric, 2)` (Postgres).
- `price_locked = 2` (manueller Preis) wird nie angefasst.
- `cards.quantity`/`cards.deleted` nie direkt schreiben (Projektregel).
- Main-Process-Dateien bleiben CommonJS (`.cjs`), Renderer ESM.
- Neue IPC-Kanäle in **beiden** `main.cjs` und `preload.cjs`.
- UI-Texte Deutsch. Renderer: keine rohen Hex-Farben außer in `Flag.jsx` (dort schon üblich), keine `text-[Npx]`.
- Lint: `npm run lint` darf nicht mehr als die 5 bekannten Fehler zeigen.
- Kein eigener Worktree (Junction-Falle, siehe Memory): Arbeit auf Branch `feat/koreanische-karten` im Haupt-Checkout.
- Edge Functions werden von Agents **nicht** deployt; SQL wird vom Nutzer im Supabase-SQL-Editor ausgeführt.
- `android/local.properties` nie lesen/ändern.

## Review Focus

1. **Phone legt KR-Zeile an, PC zieht sie:** Preis muss auf den PC-Faktor umgerechnet werden, nicht doppelt multipliziert (Test in Task 2).
2. **Faktor zweimal hintereinander ändern (50 → 60 → 50 %):** Preis muss wieder exakt beim Ausgangswert landen, gesperrte Preise unberührt (Test in Task 4).
3. **Feste Sprache KR, aber Prefix+Nummer nicht lesbar:** muss `NO_MATCH` bleiben, nichts zusammensetzen (Test in Task 9).
4. **Fremde Codes im `kr_sets`-Block** (z. B. `DOOD-EN001`) dürfen nicht als KR auftauchen; `KRT-EN001` (Präfix beginnt mit K) ist kein KR-Code (Fixture-Fälle in Task 1).
5. **Alter Handy-Schnappschuss (VERSION 1) nach Update:** darf nicht abstürzen, sondern einmal vollständig laden (bestehender Versionstest + Feldzähler in Task 7).

---

### Task 0: Branch anlegen

- [ ] **Step 1:** Im Haupt-Checkout `C:\Users\Buzzty\Downloads\yugi`:

```bash
rtk git checkout -b feat/koreanische-karten
```

---

### Task 1: Gemeinsame Fixture + KR-Helfer (PC)

**Files:**
- Create: `docs/fixtures/language/kr.json`
- Create: `desktop/electron/language-kr.cjs`
- Test: `desktop/electron/language-kr.test.cjs`

**Interfaces:**
- Produces (CommonJS, `require('./language-kr.cjs')`):
  - `KR_DEFAULT_FACTOR: number` (= 0.5)
  - `isKoreanCode(code: string): boolean`
  - `applyLangFactor(price: number|null, factor: number|null): number|null`
  - `normalizeKrFactor(value: any): number` (ungültig → 0.5)
  - `extractKoName(wikitext: string): string|null`
  - `konamiTitleName(html: string): string|null`
  - `getKrFactor(db): number`, `krPriceFields(db, language, rawPrice) → { price, cm_lang_factor }`
  - `rescaleKrRow(db, key: {id,set_code,language,rarity}, newFactor): void`
  - `setKrFactor(db, value): { factor: number, changed: number }`

- [ ] **Step 1: Fixture anlegen** `docs/fixtures/language/kr.json`:

```json
{
  "default_factor": 0.5,
  "region_language": [
    ["KR", "KR"], ["K", "KR"], ["kr", "KR"],
    ["DE", "DE"], ["G", "DE"],
    ["EN", "EN"], ["E", "EN"], ["FR", "EN"], ["SP", "EN"], ["AE", "EN"],
    ["JP", "JP"], ["JA", "JP"]
  ],
  "korean_code": [
    ["CORI-KR001", true], ["LOB-K005", true], ["SYE-KR001", true], ["QCAC-KR018", true],
    ["MVP1-KRQ54", true], ["cori-kr001", true],
    ["DOOD-EN001", false], ["LOB-DE005", false], ["TP1-G015", false], ["KRT-EN001", false],
    ["B3-17", false], ["Unknown", false], ["", false]
  ],
  "apply_factor": [
    [10.0, 0.5, 5.0], [0.15, 0.5, 0.08], [3.33, null, 3.33], [12.5, 0.6, 7.5],
    [null, 0.5, null], [0.0, 0.5, 0.0], [7.49, 1.0, 7.49]
  ],
  "normalize_factor": [
    ["0.5", 0.5], ["0.6", 0.6], [null, 0.5], ["abc", 0.5], ["0", 0.5], ["-1", 0.5], ["1.5", 0.5], ["1", 1.0]
  ],
  "ko_name": [
    ["{{CardTable2\n| en_name = Dark Magician\n| ko_name               = 블랙 매지션\n| ko_rr_name = Beullaek\n}}", "블랙 매지션"],
    ["| ko_name = <ruby>마법</ruby>사\n", "마법사"],
    ["| ko_name = \n| ja_name = x", null],
    ["| en_name = Foo\n", null]
  ],
  "konami_title": [
    ["<html><head><title>블랙 매지션 | 카드 상세 | Yu-Gi-Oh! Neuron</title>", "블랙 매지션"],
    ["<title>Yu-Gi-Oh! Neuron</title>", null],
    ["", null]
  ]
}
```

- [ ] **Step 2: Failing Test schreiben** `desktop/electron/language-kr.test.cjs`:

```js
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/language-kr.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const kr = require('./language-kr.cjs');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'language', 'kr.json'), 'utf8'));

test('Standardfaktor stimmt mit der Fixture ueberein', () => {
  assert.strictEqual(kr.KR_DEFAULT_FACTOR, FIX.default_factor);
});

test('isKoreanCode laut Fixture', () => {
  for (const [code, want] of FIX.korean_code) assert.strictEqual(kr.isKoreanCode(code), want, code);
});

test('applyLangFactor laut Fixture', () => {
  for (const [price, f, want] of FIX.apply_factor) assert.strictEqual(kr.applyLangFactor(price, f), want, `${price}x${f}`);
});

test('normalizeKrFactor laut Fixture', () => {
  for (const [v, want] of FIX.normalize_factor) assert.strictEqual(kr.normalizeKrFactor(v), want, String(v));
});

test('extractKoName laut Fixture', () => {
  for (const [w, want] of FIX.ko_name) assert.strictEqual(kr.extractKoName(w), want);
});

test('konamiTitleName laut Fixture', () => {
  for (const [h, want] of FIX.konami_title) assert.strictEqual(kr.konamiTitleName(h), want);
});

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL,
             price_locked INTEGER DEFAULT 0, cm_lang_factor REAL, deleted INTEGER DEFAULT 0,
             PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  return db;
}

test('getKrFactor: ohne Einstellung 0.5, sonst der gespeicherte Wert', () => {
  const db = makeDb();
  assert.strictEqual(kr.getKrFactor(db), 0.5);
  db.prepare("INSERT INTO settings (key, value) VALUES ('kr_price_factor', '0.7')").run();
  assert.strictEqual(kr.getKrFactor(db), 0.7);
});

test('krPriceFields: KR wird multipliziert, andere Sprachen nicht', () => {
  const db = makeDb();
  assert.deepStrictEqual(kr.krPriceFields(db, 'KR', 10), { price: 5, cm_lang_factor: 0.5 });
  assert.deepStrictEqual(kr.krPriceFields(db, 'DE', 10), { price: 10, cm_lang_factor: null });
});

test('rescaleKrRow rechnet vom alten auf den neuen Faktor um', () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards VALUES ('1','CORI-KR001','KR','Common',5,0,0.5,0)").run();
  kr.rescaleKrRow(db, { id: '1', set_code: 'CORI-KR001', language: 'KR', rarity: 'Common' }, 0.6);
  const r = db.prepare("SELECT price, cm_lang_factor FROM cards WHERE id='1'").get();
  assert.deepStrictEqual(r, { price: 6, cm_lang_factor: 0.6 });
});

test('setKrFactor: 50 -> 60 -> 50 % landet wieder beim Ausgangspreis, gesperrte Preise bleiben', () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards VALUES ('1','CORI-KR001','KR','Common',5,1,0.5,0)").run();
  db.prepare("INSERT INTO cards VALUES ('2','CORI-KR002','KR','Common',9.99,2,null,0)").run();
  db.prepare("INSERT INTO cards VALUES ('3','CORI-DE001','DE','Common',4,1,null,0)").run();
  assert.deepStrictEqual(kr.setKrFactor(db, 0.6), { factor: 0.6, changed: 1 });
  assert.deepStrictEqual(kr.setKrFactor(db, 0.5), { factor: 0.5, changed: 1 });
  const rows = db.prepare('SELECT id, price, cm_lang_factor FROM cards ORDER BY id').all();
  assert.deepStrictEqual(rows, [
    { id: '1', price: 5, cm_lang_factor: 0.5 },
    { id: '2', price: 9.99, cm_lang_factor: null },
    { id: '3', price: 4, cm_lang_factor: null },
  ]);
  assert.strictEqual(db.prepare("SELECT value FROM settings WHERE key='kr_price_factor'").get().value, '0.5');
});

test('setKrFactor mit ungueltigem Wert speichert den Standard', () => {
  const db = makeDb();
  assert.strictEqual(kr.setKrFactor(db, 'abc').factor, 0.5);
});
```

- [ ] **Step 3: Test laufen lassen, muss fehlschlagen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/language-kr.test.cjs`
Expected: FAIL – `Cannot find module './language-kr.cjs'`.

- [ ] **Step 4: Implementierung** `desktop/electron/language-kr.cjs`:

```js
// Koreanische Karten (Spec 2026-10-01). ZWILLING: android/.../cloud/LanguageKr.kt.
// Gemeinsame Fixture: docs/fixtures/language/kr.json. Wer eine Fassung aendert, aendert beide.
const KR_DEFAULT_FACTOR = 0.5;

// KR-Region ("CORI-KR001", "MVP1-KRQ54") oder das alte einzelne K ("LOB-K005") direkt vor der Nummer.
const KOREAN_CODE_RE = /-KR?[A-Z]?\d/i;
function isKoreanCode(code) {
  return KOREAN_CODE_RE.test(String(code || ''));
}

// Preis x Sprachfaktor, auf Cent gerundet (+1e-7 wie FIRST_ED_SQL, damit 0.075 auf 0.08 rundet).
function applyLangFactor(price, factor) {
  if (price == null) return null;
  if (factor == null) return price;
  return Math.round(price * factor * 100 + 1e-7) / 100;
}

function normalizeKrFactor(value) {
  const f = Number(value);
  return (value != null && Number.isFinite(f) && f > 0 && f <= 1) ? f : KR_DEFAULT_FACTOR;
}

// "| ko_name = 블랙 매지션" aus Yugipedia-Wikitext; HTML-Tags (z. B. <ruby>) werden entfernt.
function extractKoName(wikitext) {
  const m = String(wikitext || '').match(/^\|\s*ko_name\s*=[ \t]*(.*)$/m);
  if (!m) return null;
  const name = m[1].replace(/<[^>]+>/g, '').trim();
  return name || null;
}

// Konami-Detailseite mit request_locale=ko: "<title>블랙 매지션 | 카드 상세 | ...".
function konamiTitleName(html) {
  const m = String(html || '').match(/<title>\s*([^|<]+?)\s*\|/);
  return m ? m[1] : null;
}

function getKrFactor(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'kr_price_factor'").get();
  return normalizeKrFactor(r ? r.value : null);
}

// Preisfelder fuer eine neu geschriebene Zeile: KR bekommt Faktor + multiplizierten Preis.
function krPriceFields(db, language, rawPrice) {
  if (language !== 'KR') return { price: rawPrice, cm_lang_factor: null };
  const f = getKrFactor(db);
  return { price: applyLangFactor(rawPrice, f), cm_lang_factor: f };
}

const KEY_WHERE = 'id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity';

// Rechnet den Preis einer Zeile vom gespeicherten auf newFactor um (fehlender Faktor = 1).
function rescaleKrRow(db, key, newFactor) {
  const row = db.prepare(`SELECT price, cm_lang_factor FROM cards WHERE ${KEY_WHERE}`).get(key);
  if (!row) return;
  const old = row.cm_lang_factor ?? 1;
  const price = row.price == null ? null : applyLangFactor(row.price / old, newFactor);
  db.prepare(`UPDATE cards SET price = @price, cm_lang_factor = @f WHERE ${KEY_WHERE}`)
    .run({ ...key, price, f: newFactor });
}

// Neuer KR-Faktor: speichern und alle lebenden, nicht manuell gesperrten KR-Zeilen umrechnen.
function setKrFactor(db, value) {
  const factor = normalizeKrFactor(value);
  let changed = 0;
  db.transaction(() => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('kr_price_factor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(factor));
    const rows = db.prepare(
      "SELECT id, set_code, language, rarity FROM cards WHERE language = 'KR' AND deleted = 0 AND COALESCE(price_locked, 0) != 2 AND cm_lang_factor IS NOT ?"
    ).all(factor);
    for (const r of rows) { rescaleKrRow(db, r, factor); changed++; }
  })();
  return { factor, changed };
}

module.exports = {
  KR_DEFAULT_FACTOR, isKoreanCode, applyLangFactor, normalizeKrFactor, extractKoName, konamiTitleName,
  getKrFactor, krPriceFields, rescaleKrRow, setKrFactor,
};
```

- [ ] **Step 5: Test laufen lassen, muss grün sein**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/language-kr.test.cjs`
Expected: alle Tests PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add docs/fixtures/language/kr.json desktop/electron/language-kr.cjs desktop/electron/language-kr.test.cjs
rtk git commit -m "feat(kr): gemeinsame KR-Fixture und Helfer am PC"
```

---

### Task 2: PC-Schema + Sync für `name_ko` / `cm_lang_factor`

**Files:**
- Modify: `desktop/electron/copies-schema.cjs:104` (nach `cm_first_ed_factor`)
- Modify: `desktop/electron/sync.cjs:19-21, 53-64, 73-84, 102-114`
- Modify: `desktop/electron/test-sync.cjs:50`, `desktop/electron/test-sync-insert.cjs:10` (Test-Schemata um die zwei Spalten ergänzen)
- Test: `desktop/electron/sync-kr.test.cjs`

**Interfaces:**
- Consumes: `getKrFactor`, `rescaleKrRow` aus Task 1.
- Produces: Spalten `cards.name_ko TEXT`, `cards.cm_lang_factor REAL`; `rowToRemote`/`remoteToLocalFull` tragen beide Felder; `applyRemoteRow` rechnet neu eingefügte KR-Zeilen auf den PC-Faktor um.

- [ ] **Step 1: Failing Test** `desktop/electron/sync-kr.test.cjs`:

```js
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sync-kr.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { rowToRemote, remoteToLocalFull, applyRemoteRow } = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', name TEXT, type TEXT, desc TEXT,
      image_url TEXT, atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT, quantity INTEGER DEFAULT 0,
      rarity TEXT, price REAL, deleted INTEGER DEFAULT 0, cm_product_id INTEGER, price_locked INTEGER DEFAULT 0,
      last_updated DATETIME, updated_at DATETIME, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  ensureCopiesSchema(db);
  return db;
}

test('Schema bekommt name_ko und cm_lang_factor', () => {
  const db = makeDb();
  const cols = db.prepare('PRAGMA table_info(cards)').all().map(c => c.name);
  assert.ok(cols.includes('name_ko'));
  assert.ok(cols.includes('cm_lang_factor'));
});

test('Push-Payload und Insert-Payload tragen beide Felder (fehlend = null)', () => {
  const r = rowToRemote({ id: '1', set_code: 'CORI-KR001', language: 'KR', name_ko: '블랙 매지션', cm_lang_factor: 0.5 });
  assert.strictEqual(r.name_ko, '블랙 매지션');
  assert.strictEqual(r.cm_lang_factor, 0.5);
  const e = rowToRemote({ id: '1', set_code: 'X', language: 'DE' });
  assert.strictEqual(e.name_ko, null);
  assert.strictEqual(e.cm_lang_factor, null);
  const l = remoteToLocalFull({ id: '1', set_code: 'CORI-KR001', language: 'KR', name_ko: 'x', cm_lang_factor: 0.5 });
  assert.strictEqual(l.name_ko, 'x');
  assert.strictEqual(l.cm_lang_factor, 0.5);
});

test('Vom Handy angelegte KR-Zeile wird beim Einfuegen auf den PC-Faktor umgerechnet', () => {
  const db = makeDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('kr_price_factor', '0.6')").run();
  applyRemoteRow(db, { id: '9', set_code: 'CORI-KR001', language: 'KR', rarity: 'Common', deleted: false, price: 5, cm_lang_factor: 0.5, name_ko: '블랙' });
  const r = db.prepare("SELECT price, cm_lang_factor, name_ko FROM cards WHERE id='9'").get();
  assert.deepStrictEqual(r, { price: 6, cm_lang_factor: 0.6, name_ko: '블랙' });
});

test('Vom Handy angelegte DE-Zeile bleibt unveraendert', () => {
  const db = makeDb();
  applyRemoteRow(db, { id: '8', set_code: 'CORI-DE001', language: 'DE', rarity: 'Common', deleted: false, price: 5 });
  const r = db.prepare("SELECT price, cm_lang_factor FROM cards WHERE id='8'").get();
  assert.deepStrictEqual(r, { price: 5, cm_lang_factor: null });
});
```

- [ ] **Step 2: Laufen lassen → FAIL** (`name_ko` fehlt im Schema).

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sync-kr.test.cjs`

- [ ] **Step 3: Schema** – in `copies-schema.cjs` direkt nach Zeile 104 (`addColumnIfMissing(db, 'cards', 'cm_first_ed_factor', 'REAL');`) und vor dem `db.exec` der Trigger einfügen:

```js
  // Koreanische Karten (Spec 2026-10-01): koreanischer Name und Sprach-Preisfaktor (nur KR-Zeilen).
  addColumnIfMissing(db, 'cards', 'name_ko', 'TEXT');
  addColumnIfMissing(db, 'cards', 'cm_lang_factor', 'REAL');
```

- [ ] **Step 4: Sync** – in `sync.cjs`:

`MIRROR_COLS` (Zeile 19–21) ergänzen:

```js
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute',
  'rarity', 'price', 'deleted', 'cm_product_id', 'price_locked', 'price_first_ed', 'cm_first_ed_factor',
  'name_ko', 'cm_lang_factor'];
```

In `rowToRemote` nach der `cm_first_ed_factor`-Zeile:

```js
    else if (c === 'name_ko') out.name_ko = row.name_ko ?? null;
    else if (c === 'cm_lang_factor') out.cm_lang_factor = row.cm_lang_factor ?? null;
```

In `remoteToLocalFull` nach `cm_first_ed_factor: …`:

```js
    name_ko: r.name_ko ?? null,
    cm_lang_factor: r.cm_lang_factor ?? null,
```

Oben bei den Requires ergänzen:

```js
const { getKrFactor, rescaleKrRow } = require('./language-kr.cjs');
```

`applyRemoteRow` Insert-Zweig ersetzen:

```js
  if (!exists) {
    db.prepare(`INSERT OR IGNORE INTO cards
      (id, set_code, language, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, price, deleted, cm_product_id, price_locked, price_first_ed, cm_first_ed_factor, name_ko, cm_lang_factor)
      VALUES (@id,@set_code,@language,@name,@type,@desc,@image_url,@atk,@def,@level,@race,@attribute,@quantity,@rarity,@price,@deleted,@cm_product_id,@price_locked,@price_first_ed,@cm_first_ed_factor,@name_ko,@cm_lang_factor)`)
      .run(remoteToLocalFull(r));
    // Das Handy kennt nur den Standardfaktor; der PC rechnet auf seinen eingestellten Wert um.
    // Die Umrechnung stempelt updated_at, der naechste Push bringt Preis + Faktor zurueck in die Cloud.
    if (p.language === 'KR') rescaleKrRow(db, p, getKrFactor(db));
    return;
  }
```

- [ ] **Step 5: Bestehende Test-Schemata nachziehen** – in `test-sync.cjs:50` und `test-sync-insert.cjs:10` die `CREATE TABLE cards` um `name_ko TEXT, cm_lang_factor REAL,` ergänzen (direkt hinter `cm_first_ed_factor REAL,`).

- [ ] **Step 6: Tests grün**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sync-kr.test.cjs electron/copies-schema.test.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync-insert.cjs
```
Expected: PASS / keine Assertion-Fehler.

- [ ] **Step 7: Commit**

```bash
rtk git add desktop/electron/copies-schema.cjs desktop/electron/sync.cjs desktop/electron/sync-kr.test.cjs desktop/electron/test-sync.cjs desktop/electron/test-sync-insert.cjs
rtk git commit -m "feat(kr): name_ko und cm_lang_factor im PC-Schema und Sync"
```

---

### Task 3: Supabase-Migration

**Files:**
- Create: `supabase/cards_korean.sql`

**Interfaces:**
- Produces: Cloud-Spalten `name_ko text`, `cm_lang_factor double precision`; `apply_cardmarket_prices` multipliziert mit `coalesce(cm_lang_factor, 1)`.

- [ ] **Step 1: SQL schreiben** `supabase/cards_korean.sql`:

```sql
-- Koreanische Karten (Spec docs/superpowers/specs/2026-10-01-koreanische-karten-design.md).
-- VOR dem neuen Desktop-Installer und der neuen APK ausfuehren: beide senden name_ko/cm_lang_factor,
-- ohne die Spalten scheitert jeder Push. Idempotent.
alter table public.cards add column if not exists name_ko text;
alter table public.cards add column if not exists cm_lang_factor double precision;

-- Tagesaktualisierung: Trend x Sprachfaktor (KR), auf Cent gerundet. Ohne Faktor = Trend wie bisher.
create or replace function public.apply_cardmarket_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with v as (
    select x.id_product, x.trend
      from jsonb_to_recordset(prices) as x(id_product integer, trend double precision)
     where x.trend > 0
  ), changed as (
    update public.cards c
       set price = round(v.trend::numeric * coalesce(c.cm_lang_factor, 1)::numeric, 2)::double precision,
           cm_updated_at = now()
      from v
     where c.cm_product_id = v.id_product
       and c.deleted = false
       and coalesce(c.price_locked, 0) <> 2
       and c.price is distinct from round(v.trend::numeric * coalesce(c.cm_lang_factor, 1)::numeric, 2)::double precision
     returning c.id, c.set_code, c.language, c.rarity, c.price
  )
  insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
  select id, set_code, language, rarity, 'base', current_date, price, 'cloud' from changed
  on conflict (card_id, set_code, language, rarity, variant, day)
  do update set price = excluded.price, source = excluded.source, recorded_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_prices(jsonb) from public, anon, authenticated;
grant execute on function public.apply_cardmarket_prices(jsonb) to service_role;

-- Pruefen (erwartet 0.08, 7.5, 3.33):
-- select round(0.15::numeric * 0.5::numeric, 2), round(12.5::numeric * 0.6::numeric, 2), round(3.33::numeric * 1::numeric, 2);
-- select has_function_privilege('anon', 'public.apply_cardmarket_prices(jsonb)', 'execute'); -- erwartet: false
```

- [ ] **Step 2: Gegenlesen** gegen `supabase/price_history_schema.sql:22-53` (gleiche Signatur, gleiche History-Spalten). Kein Agent führt das SQL aus – das macht der Nutzer in Task 12.

- [ ] **Step 3: Commit**

```bash
rtk git add supabase/cards_korean.sql
rtk git commit -m "feat(kr): Supabase-Spalten und Preisfaktor in apply_cardmarket_prices"
```

---

### Task 4: PC – KR-Set-Codes, koreanischer Name, Preisquellen, Einstellung

**Files:**
- Modify: `desktop/electron/api-handler.cjs:188-285`
- Modify: `desktop/electron/main.cjs:7, 469-510, 1415-1475, 1549-1590` + neuer Handler
- Modify: `desktop/electron/preload.cjs:171`
- Modify: `desktop/electron/cardmarket-bulk.cjs:121-143`
- Modify: `desktop/electron/cardmarket-scraper.cjs:131, 160-162`
- Test: `desktop/electron/cardmarket-bulk.test.cjs` (neuer Test), `desktop/electron/language-kr.test.cjs` (Filter-Test über `setsBelongTo`)

**Interfaces:**
- Consumes: Task 1 (`isKoreanCode`, `applyLangFactor`, `krPriceFields`, `setKrFactor`, `extractKoName`, `konamiTitleName`), Task 2 (Spalten).
- Produces: `api-handler.cjs` exportiert zusätzlich `fetchKoreanSets(passcode) → [{set_code,set_rarity}]`, `fetchKoreanName(passcode) → string|null`, `setsBelongTo(wikiLang) → (code)=>boolean`. IPC `fetch-korean-sets` → `window.api.fetchKoreanSets(passcode)`; IPC `set-kr-price-factor` → `window.api.setKrPriceFactor(value) → {factor, changed}`.

- [ ] **Step 1: Failing Tests**

An `desktop/electron/language-kr.test.cjs` anhängen:

```js
test('setsBelongTo: kr nimmt nur KR-Codes, de nur deutsche, jp keine fremden TCG-Regionen', () => {
  const { setsBelongTo } = require('./api-handler.cjs');
  const kr = setsBelongTo('kr');
  assert.deepStrictEqual(['SYE-KR001', 'LOB-K005', 'DOOD-EN001', 'LOB-DE005'].filter(kr), ['SYE-KR001', 'LOB-K005']);
  assert.deepStrictEqual(['LOB-DE005', 'TP1-G015', 'SYE-KR001'].filter(setsBelongTo('de')), ['LOB-DE005', 'TP1-G015']);
  assert.deepStrictEqual(['B3-17', 'SYE-KR001'].filter(setsBelongTo('jp')), ['B3-17']);
});
```

An `desktop/electron/cardmarket-bulk.test.cjs` anhängen:

```js
test('applyPrices: KR-Zeile bekommt Trend x cm_lang_factor', async () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards (id, name, set_code, language, rarity, price, cm_product_id, cm_lang_factor) VALUES ('00102380','Lava Golem','RA01-KR001','KR','Secret Rare',0,741145,0.5)").run();
  await runBulkRefresh(db, { files });
  const kr = db.prepare("SELECT price FROM cards WHERE set_code='RA01-KR001'").get();
  const de = db.prepare("SELECT price FROM cards WHERE set_code='RA01-DE001'").get();
  assert.strictEqual(kr.price, 6.25);
  assert.strictEqual(de.price, 12.5);
});
```

(`makeDb` ruft `ensureCopiesSchema`, das seit Task 2 `cm_lang_factor` anlegt – kein eigenes `ALTER TABLE` nötig.)

- [ ] **Step 2: Laufen lassen → FAIL**

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/language-kr.test.cjs electron/cardmarket-bulk.test.cjs
```

- [ ] **Step 3: `api-handler.cjs`**

Oben ergänzen: `const { isKoreanCode, extractKoName, konamiTitleName } = require('./language-kr.cjs');`

`fetchKonamiForCard` (Zeile 202–211) aufteilen, damit der Name-Abruf die cid wiederverwenden kann:

```js
// Konami-cid der Karte: Suchtreffer, deren EN-Drucke sich mit YGOPRODeck ueberschneiden.
async function konamiCidFor(englishName, ygoprodeckCodes) {
    const cids = await konamiCids(englishName);
    if (cids.length === 0) return null;
    const enLists = await Promise.all(
        cids.map(cid => fetchKonamiSets(cid, 'en').then(s => ({ cid, codes: s.map(x => x.set_code) })))
    );
    const match = enLists.find(e => e.codes.some(c => ygoprodeckCodes.includes(c)));
    return match ? match.cid : null;
}

async function fetchKonamiForCard(englishName, ygoprodeckCodes, konamiLocale) {
    const cid = await konamiCidFor(englishName, ygoprodeckCodes);
    return cid ? await fetchKonamiSets(cid, konamiLocale) : [];
}
```

Den Yugipedia-Titel aus `fetchSetsUnion` (Zeile 232–245) in eine Funktion ziehen und dort aufrufen:

```js
// Yugipedias eigener Seitentitel per Passcode-Weiterleitung (alternative Schreibweisen), sonst der englische Name.
async function yugipediaTitle(passcode, englishName) {
    const redirectData = await cachedFetch(
        `https://yugipedia.com/api.php?action=query&titles=${passcode}&redirects&format=json`,
        'yugipedia_redirect', 168);
    let yugiTitle = null;
    if (redirectData && redirectData.query && redirectData.query.pages) {
        const pages = redirectData.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pageId !== '-1') yugiTitle = pages[pageId].title;
    }
    return yugiTitle || englishName;
}
```

und in `fetchSetsUnion` den zweiten `Promise.all`-Eintrag ersetzen durch:

```js
        (async () => {
            const yugiTitle = await yugipediaTitle(passcode, englishName);
            return yugiTitle ? parseWikiSets('https://yugipedia.com/api.php', yugiTitle, wikiLang, 'wiki_parse') : [];
        })(),
```

Filter verallgemeinern (ersetzt die `belongs`-Zeile 255):

```js
// Welche Codes gehoeren zur angefragten Sprache (wirft von Wikis falsch einsortierte fremde Codes raus).
function setsBelongTo(wikiLang) {
    if (wikiLang === 'de') return (c) => isGermanCode(c);
    if (wikiLang === 'kr') return (c) => isKoreanCode(c);
    return (c) => !isForeignForJapanese(c);
}
```

```js
    const belongs = setsBelongTo(wikiLang);
```

Neue Funktionen nach `fetchJapaneseSets`:

```js
async function fetchKoreanSets(passcode) {
    try { return await fetchSetsUnion(passcode, 'kr', 'ko'); }
    catch (e) { console.error("Korean set lookup error:", e); return []; }
}

// Koreanischer Kartenname: Yugipedia ko_name, sonst der Titel der koreanischen Konami-Seite. null, wenn keiner.
async function fetchKoreanName(passcode) {
    try {
        const card = await fetchCardData(passcode);
        const c0 = card && card.data && card.data[0];
        const englishName = c0 && c0.name;
        const title = await yugipediaTitle(passcode, englishName);
        if (title) {
            const parseUrl = `https://yugipedia.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
            const data = await cachedFetch(parseUrl, 'wiki_parse', 24);
            const name = data && data.parse && data.parse.wikitext ? extractKoName(data.parse.wikitext['*']) : null;
            if (name) return name;
        }
        const codes = ((c0 && c0.card_sets) || []).map(s => s.set_code);
        if (!englishName || codes.length === 0) return null;
        const cid = await konamiCidFor(englishName, codes);
        if (!cid) return null;
        const html = await cachedFetchText(`${KONAMI_BASE}?ope=2&cid=${cid}&request_locale=ko`, 'konami_detail', 168);
        return konamiTitleName(html);
    } catch (e) { console.error("Korean name lookup error:", e); return null; }
}
```

Export (Zeile 285):

```js
module.exports = { fetchJson, cachedFetch, fetchYugipediaSets, fetchJapaneseSets, fetchKoreanSets, fetchKoreanName, fetchCardData, setsBelongTo };
```

- [ ] **Step 4: Preisquellen**

`cardmarket-bulk.cjs` `applyPrices`: SELECT um `cm_lang_factor` erweitern und den Trend multiplizieren:

```js
  const rows = db.prepare(
    "SELECT id, set_code, language, rarity, cm_product_id, cm_lang_factor FROM cards WHERE deleted = 0 AND cm_product_id IS NOT NULL AND COALESCE(price_locked, 0) != 2"
  ).all();
```

```js
      const trend = trendById.get(Number(r.cm_product_id));
      if (trend == null) { skipped++; continue; }
      const t = applyLangFactor(trend, r.cm_lang_factor); // KR: Trend x Sprachfaktor
      const info = upd.run(t, r.id, r.set_code, r.language, r.rarity, t);
```

plus `const { applyLangFactor } = require('./language-kr.cjs');` oben.

`cardmarket-scraper.cjs`: Zeile 131 SELECT um `cm_lang_factor` ergänzen; Zeile 160–162:

```js
            const price = applyLangFactor(hit.trend, p.cm_lang_factor);
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_product_id = COALESCE(?, cm_product_id), cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(price, url, pid, String(cards[i].id), p.set_code, p.language, p.rarity);
            recordPrice(db, { id: cards[i].id, set_code: p.set_code, language: p.language, rarity: p.rarity }, price, 'cm_scrape');
```

plus Require oben.

`main.cjs`:
- Require (Zeile 7): `fetchKoreanSets, fetchKoreanName` ergänzen; neu `const { applyLangFactor, krPriceFields, setKrFactor } = require('./language-kr.cjs');`.
- `startPricePoller` (Zeile 1421): SELECT um `cm_lang_factor` ergänzen; vor dem Vergleich in Zeile 1466 einfügen:
  ```js
                    newPrice = applyLangFactor(newPrice, localCard.cm_lang_factor);
  ```
- `update-all-cards` (Zeile 1551): SELECT `id, set_code, language, rarity, cm_lang_factor`; Zeile 1583:
  ```js
                const price = applyLangFactor(priceForCard(apiData, row.set_code, apiField), row.cm_lang_factor);
  ```
- `add-card-to-db` (Zeile 477–510): vor der Transaktion `const pf = krPriceFields(db, language, card.price || 0);`. UPDATE-Zweig: `SET price = @price, cm_lang_factor = @cm_lang_factor, deleted = 0` mit `{ price: pf.price, cm_lang_factor: pf.cm_lang_factor, … }`. INSERT-Zweig: Spalte `cm_lang_factor` + Wert `@cm_lang_factor` ergänzen, `price: pf.price`. Nach der Transaktion (vor dem `return`):
  ```js
    if (language === 'KR') fillKoreanName(id);
  ```
- Neue Helfer + Handler direkt nach `fetch-japanese-sets` (Zeile 473–475):

```js
ipcMain.handle('fetch-korean-sets', async (event, passcode) => {
    return await fetchKoreanSets(passcode);
});

// Koreanischer Name fuer alle KR-Zeilen eines Passcodes, die noch keinen haben. Laeuft im Hintergrund;
// ein Fehlschlag laesst name_ko einfach leer.
function fillKoreanName(id) {
    const missing = db.prepare("SELECT 1 FROM cards WHERE id = ? AND language = 'KR' AND name_ko IS NULL LIMIT 1").get(id);
    if (!missing) return;
    fetchKoreanName(id).then(name => {
        if (name) db.prepare("UPDATE cards SET name_ko = ? WHERE id = ? AND language = 'KR' AND name_ko IS NULL").run(name, id);
    }).catch(e => console.error('[kr] name:', e.message));
}

ipcMain.handle('set-kr-price-factor', (event, value) => setKrFactor(db, value));
```

`preload.cjs` nach Zeile 171:

```js
  fetchKoreanSets: (passcode) => ipcRenderer.invoke('fetch-korean-sets', passcode),
  setKrPriceFactor: (value) => ipcRenderer.invoke('set-kr-price-factor', value),
```

- [ ] **Step 5: Tests grün**

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs
```
Expected: alle PASS (inkl. neuer Tests).

- [ ] **Step 6: Commit**

```bash
rtk git add desktop/electron/api-handler.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/cardmarket-bulk.cjs desktop/electron/cardmarket-scraper.cjs desktop/electron/language-kr.test.cjs desktop/electron/cardmarket-bulk.test.cjs
rtk git commit -m "feat(kr): KR-Set-Codes, koreanischer Name und KR-Faktor in allen PC-Preisquellen"
```

---

### Task 5: PC-Oberfläche

**Files:**
- Modify: `desktop/src/components/Flag.jsx`
- Modify: `desktop/src/components/CollectionFilters.jsx:33`
- Modify: `desktop/src/components/StagingArea.jsx:19-38, 180-187`
- Modify: `desktop/src/components/CardDetailPanel.jsx:140-161, 268, 303`
- Modify: `desktop/src/components/Settings.jsx` (neues Feld nach dem Block „Duplikate: behalten je Karte“, Zeile ~589–595)
- Modify: `desktop/electron/listing-text.cjs:10`, `desktop/src/utils/listingText.js:5`, `supabase/functions/_shared/listing-text.ts:22`
- Modify: `desktop/electron/export-formats.cjs:10`, `supabase/functions/_shared/ebay-map.ts:24`

**Interfaces:**
- Consumes: `window.api.fetchKoreanSets`, `window.api.setKrPriceFactor` (Task 4); Zeilenfelder `name_ko`, `cm_lang_factor` (Task 2, kommen über `SELECT c.*` mit).

- [ ] **Step 1: Flagge** – in `Flag.jsx` vor `case 'EN':`:

```jsx
        case 'KR':
            return (
                <svg {...common} viewBox="0 0 36 24">
                    <rect width="36" height="24" fill="#fff" />
                    <circle cx="18" cy="12" r="6" fill="#CD2E3A" />
                    <path d="M12,12 a6,6 0 0,0 12,0 a3,3 0 0,0 -6,0 a3,3 0 0,1 -6,0" fill="#0047A0" />
                    <g stroke="#000" strokeWidth="1.2">
                        <path d="M5,5 l3,-2.5 M6,6.5 l3,-2.5 M7,8 l3,-2.5" />
                        <path d="M26,3 l3,2.5 M27,4.5 l3,2.5 M25,6.5 l3,2.5" />
                        <path d="M5,19 l3,2.5 M6,17.5 l3,2.5 M7,16 l3,2.5" />
                        <path d="M26,21 l3,-2.5 M27,19.5 l3,-2.5 M25,17.5 l3,-2.5" />
                    </g>
                </svg>
            );
```

- [ ] **Step 2: Filter** – `CollectionFilters.jsx:33` Option `{ value: "KR", label: "KR" }` zwischen EN und JP einfügen.

- [ ] **Step 3: Staging** – `mergePrintings(cardSets, germanSets, japaneseSets, koreanSets)`:

```js
    const kr = (koreanSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price || 0, language: 'KR', isYugipedia: true }));
```

Reihenfolge `[...de, ...en, ...kr, ...jp]`; Kommentar oben auf „German + English + Korean + Japanese“ anpassen. Im Nachladen (Zeile 181–187):

```js
        Promise.all([
            window.api.fetchYugipediaSets(passcode).then(s => s || []).catch(() => []),
            window.api.fetchJapaneseSets(passcode).then(s => s || []).catch(() => []),
            window.api.fetchKoreanSets(passcode).then(s => s || []).catch(() => []),
        ]).then(([germanSets, japaneseSets, koreanSets]) => {
            …
                const allPrintings = mergePrintings(c.data.card_sets, germanSets, japaneseSets, koreanSets);
```

Alle weiteren Aufrufer von `mergePrintings` per `rtk grep -n "mergePrintings" desktop/src` prüfen und `koreanSets` (bzw. `[]`) durchreichen.

- [ ] **Step 4: Kartendetail** – `CardDetailPanel.jsx` Zeile 142–151: dritten Abruf `window.api.fetchKoreanSets(card.id)` ergänzen und `...krSets.map(s => ({ ...s, language: 'KR' }))` vor JP einfügen. Unter der Überschrift (Zeile 268):

```jsx
          <h2 className="text-2xl font-bold text-text mb-2">{card.name}</h2>
          {(card.variants || []).find(v => v.language === 'KR' && v.name_ko)?.name_ko && (
              <p className="text-sm text-muted mb-2">{card.variants.find(v => v.language === 'KR' && v.name_ko).name_ko}</p>
          )}
```

Preiszeile (Zeile 303) um den Hinweis ergänzen:

```jsx
                              <span className="text-xs text-text">{firstEdLine(variant) ?? fmtEUR(variant.price || 0)}</span>
                              {variant.language === 'KR' && variant.cm_lang_factor != null && (
                                  <span className="text-xs text-muted">KR-Faktor {Math.round(variant.cm_lang_factor * 100)} %</span>
                              )}
```

- [ ] **Step 5: Einstellung** – `Settings.jsx`: State `const [krFactorInput, setKrFactorInput] = useState('50');`, im `getSettings`-Effekt `setKrFactorInput(String(Math.round(normalizeKr(settings?.kr_price_factor) * 100)));` mit lokalem Helfer

```js
const normalizeKr = (v) => { const f = Number(v); return v != null && Number.isFinite(f) && f > 0 && f <= 1 ? f : 0.5; };
```

Speichern:

```js
    const saveKrFactor = async () => {
        const f = normalizeKr(Number(String(krFactorInput).replace(',', '.')) / 100);
        setKrFactorInput(String(Math.round(f * 100)));
        if (window.api?.setKrPriceFactor) await window.api.setKrPriceFactor(f);
    };
```

Feld direkt nach dem Block „Duplikate: behalten je Karte“:

```jsx
                        <div className="mt-6 pt-6 border-t border-line">
                            <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">Preisfaktor koreanische Karten (%)</label>
                            <input type="number" min="1" max="100" step="1" value={krFactorInput}
                                onChange={e => setKrFactorInput(e.target.value)} onBlur={saveKrFactor}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="w-24 bg-surface-2 border border-line text-text rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent" />
                            <p className="text-xs text-muted mt-2">KR-Karten bekommen den Cardmarket-Trend des Sets mal diesen Faktor. Ganze Zahl 1–100, Standard 50. Ändern rechnet alle KR-Preise sofort um; manuell gesetzte Preise bleiben.</p>
                        </div>
```

- [ ] **Step 6: Sprachnamen** – in allen drei Listing-Text-Fassungen `KR: 'Koreanisch'` (TS: `KR: "Koreanisch"`) hinter `JP` ergänzen; `export-formats.cjs:10` `KR: 'Korean'`; `ebay-map.ts:24` `KR: "Korean"`.

- [ ] **Step 7: Tests + Lint + Build**

```bash
node --test src/utils/*.test.js src/utils/*.test.mjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs
npm run lint
npm run build
```
Expected: Tests PASS, Lint ≤ 5 bekannte Fehler, Build ok. Falls `noLegacyColors.test.js` an `Flag.jsx` scheitert: prüfen, wie die bestehenden Flaggen-Hexwerte erlaubt sind, und KR identisch behandeln (nicht den Test lockern).

- [ ] **Step 8: Sichtprüfung** – `npm run electron:dev`, eine Karte mit KR-Drucken (z. B. Passcode `46986414`, Dark Magician) im Staging öffnen: KR-Gruppe mit 🇰🇷 erscheint; Einstellungen zeigt das neue Feld.

- [ ] **Step 9: Commit**

```bash
rtk git add desktop/src desktop/electron/listing-text.cjs desktop/electron/export-formats.cjs supabase/functions/_shared/listing-text.ts supabase/functions/_shared/ebay-map.ts
rtk git commit -m "feat(kr): KR in Flagge, Filter, Set-Auswahl, Kartendetail, Einstellungen und Sprachnamen"
```

---

### Task 6: Android – Zwilling `LanguageKr`, Region, Flagge, Sprachname

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/LanguageKr.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ml/RegionToken.kt:42-45, 63-67`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/LangFlag.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ml/ListingText.kt:21-22`
- Test: `android/app/src/test/java/com/example/yugiohscanner/LanguageKrTest.kt`

**Interfaces:**
- Produces: `object LanguageKr { const val DEFAULT_FACTOR = 0.5; fun isKoreanCode(code: String): Boolean; fun applyFactor(price: Double?, factor: Double?): Double?; fun extractKoName(wikitext: String): String?; fun konamiTitleName(html: String): String? }`; `RegionToken.language("KR"|"K") == "KR"`.

- [ ] **Step 1: Failing Test** `LanguageKrTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.LanguageKr
import com.example.yugiohscanner.ml.RegionToken
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Zwilling von desktop/electron/language-kr.test.cjs -- beide lesen docs/fixtures/language/kr.json. */
class LanguageKrTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/language/kr.json"))

    @Test fun `Standardfaktor laut Fixture`() {
        assertEquals(fix.getDouble("default_factor"), LanguageKr.DEFAULT_FACTOR, 0.0)
    }

    @Test fun `Region auf Sprache laut Fixture`() {
        val a = fix.getJSONArray("region_language")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(p.getString(0), p.getString(1), RegionToken.language(p.getString(0)))
        }
    }

    @Test fun `isKoreanCode laut Fixture`() {
        val a = fix.getJSONArray("korean_code")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(p.getString(0), p.getBoolean(1), LanguageKr.isKoreanCode(p.getString(0)))
        }
    }

    @Test fun `applyFactor laut Fixture`() {
        val a = fix.getJSONArray("apply_factor")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            val price = if (p.isNull(0)) null else p.getDouble(0)
            val f = if (p.isNull(1)) null else p.getDouble(1)
            val want = if (p.isNull(2)) null else p.getDouble(2)
            assertEquals("$price x $f", want, LanguageKr.applyFactor(price, f))
        }
    }

    @Test fun `extractKoName laut Fixture`() {
        val a = fix.getJSONArray("ko_name")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(if (p.isNull(1)) null else p.getString(1), LanguageKr.extractKoName(p.getString(0)))
        }
    }

    @Test fun `konamiTitleName laut Fixture`() {
        val a = fix.getJSONArray("konami_title")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(if (p.isNull(1)) null else p.getString(1), LanguageKr.konamiTitleName(p.getString(0)))
        }
    }
}
```

- [ ] **Step 2: Laufen lassen → FAIL** (in `android/`, `JAVA_HOME` = Android Studios `jbr`):

```bash
./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.LanguageKrTest"
```

- [ ] **Step 3: Implementierung** `cloud/LanguageKr.kt`:

```kotlin
package com.example.yugiohscanner.cloud

/**
 * Koreanische Karten (Spec 2026-10-01). ZWILLING: desktop/electron/language-kr.cjs.
 * Gemeinsame Fixture: docs/fixtures/language/kr.json. Wer eine Fassung aendert, aendert beide.
 */
object LanguageKr {
    const val DEFAULT_FACTOR = 0.5

    // KR-Region ("CORI-KR001", "MVP1-KRQ54") oder das alte einzelne K ("LOB-K005") direkt vor der Nummer.
    private val KOREAN_CODE = Regex("""-KR?[A-Z]?\d""", RegexOption.IGNORE_CASE)
    fun isKoreanCode(code: String): Boolean = KOREAN_CODE.containsMatchIn(code)

    /** Preis x Sprachfaktor, auf Cent gerundet (+1e-7 wie am PC, damit 0.075 auf 0.08 rundet). */
    fun applyFactor(price: Double?, factor: Double?): Double? {
        if (price == null) return null
        if (factor == null) return price
        return Math.round(price * factor * 100 + 1e-7) / 100.0
    }

    private val KO_NAME = Regex("""^\|\s*ko_name\s*=[ \t]*(.*)$""", RegexOption.MULTILINE)
    private val TAG = Regex("<[^>]+>")
    fun extractKoName(wikitext: String): String? =
        KO_NAME.find(wikitext)?.groupValues?.get(1)?.replace(TAG, "")?.trim()?.ifEmpty { null }

    private val TITLE = Regex("""<title>\s*([^|<]+?)\s*\|""")
    fun konamiTitleName(html: String): String? = TITLE.find(html)?.groupValues?.get(1)
}
```

Hinweis zur Android-Regex-Falle (Memory): kein `(?U)` verwenden – die obigen Muster enthalten keins.

`RegionToken.kt`: in `KNOWN` `"K"` ergänzen (Kommentar: „K = altes koreanisches Einbuchstaben-Infix, z. B. LOB-K005 (Yugipedia kr_sets)“). `language()`:

```kotlin
    fun language(region: String): String = when (region.uppercase(Locale.ROOT)) {
        "DE", "G" -> "DE"
        "JP", "JA" -> "JP"
        "KR", "K" -> "KR"
        else -> "EN"
    }
```

Den Kommentarblock darüber (Zeile 47–62) um einen Satz ergänzen: „Seit 2026-10-01 hat KR eine eigene Sprache (Spec koreanische Karten).“ und `KR` aus der „everything else“-Aufzählung entfernen.

`LangFlag.kt`: `"KR" -> "🇰🇷"` vor `"EN"`. `ListingText.kt`: `"KR" to "Koreanisch"` hinter `"JP" to "Japanisch"`.

- [ ] **Step 4: Tests grün** – erst die neue Klasse, dann alles:

```bash
./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.LanguageKrTest"
./gradlew testDebugUnitTest
```
Expected: PASS. Schlägt ein bestehender Test fehl, der `KR → EN` erwartete, ist das gewollte Verhaltensänderung: Test auf `KR` umstellen und im Commit erwähnen.

- [ ] **Step 5: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner/cloud/LanguageKr.kt android/app/src/main/java/com/example/yugiohscanner/ml/RegionToken.kt android/app/src/main/java/com/example/yugiohscanner/ui/LangFlag.kt android/app/src/main/java/com/example/yugiohscanner/ml/ListingText.kt android/app/src/test/java/com/example/yugiohscanner/LanguageKrTest.kt
rtk git commit -m "feat(kr): Kotlin-Zwilling LanguageKr, Region KR/K wird KR, Flagge und Sprachname"
```

---

### Task 7: Android – `CardRow`-Felder, Parsen, Schnappschuss, Anlegen

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt:247-267, 338-368`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/StoreSnapshot.kt:71, 86, 114`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/StoreSnapshotCodecTest.kt:67` (20 → 22)
- Test: `android/app/src/test/java/com/example/yugiohscanner/CardRowParseTest.kt` (neuer Fall)

**Interfaces:**
- Consumes: `LanguageKr.DEFAULT_FACTOR`, `LanguageKr.applyFactor` (Task 6).
- Produces: `CardRow.nameKo: String? = null`, `CardRow.cmLangFactor: Double? = null`; `addPrinting(..., nameKo: String? = null)` (Task 8 füllt `nameKo`).

- [ ] **Step 1: Failing Test** – an `CardRowParseTest.kt` anhängen:

```kotlin
    @Test fun `liest name_ko und cm_lang_factor, fehlend ergibt null`() {
        val rows = CollectionRepository.parse(org.json.JSONArray("""[
            {"id":"1","set_code":"CORI-KR001","language":"KR","rarity":"Common","quantity":1,"price":5.0,"name_ko":"블랙 매지션","cm_lang_factor":0.5},
            {"id":"2","set_code":"X-1","price":1.0}
        ]"""))
        org.junit.Assert.assertEquals("블랙 매지션", rows[0].nameKo)
        org.junit.Assert.assertEquals(0.5, rows[0].cmLangFactor!!, 0.0)
        org.junit.Assert.assertNull(rows[1].nameKo)
        org.junit.Assert.assertNull(rows[1].cmLangFactor)
    }
```

(Imports/Stil an die vorhandenen Tests in der Datei anpassen.)

- [ ] **Step 2: Laufen → FAIL** (`nameKo` unbekannt).

- [ ] **Step 3: Implementierung**

`CardRow.kt` am Ende:

```kotlin
    // Koreanische Karten (Spec 2026-10-01): koreanischer Name und Sprach-Preisfaktor, nur bei KR-Zeilen gesetzt.
    val nameKo: String? = null,
    val cmLangFactor: Double? = null,
```

`CollectionRepository.parse`: nach `cmFirstEdFactor = …`:

```kotlin
                    nameKo = o.strOrNull("name_ko"),
                    cmLangFactor = if (o.isNull("cm_lang_factor")) null else o.optDouble("cm_lang_factor"),
```

`StoreSnapshot.kt`: `VERSION = 2`; encode Zeile 86 anhängen `; o.str(c.nameKo); o.dbl(c.cmLangFactor)`; decode Zeile 114 anhängen `nameKo = i.str(), cmLangFactor = i.dbl(),`. `StoreSnapshotCodecTest.kt:67` Erwartung `20` → `22`.

- [ ] **Step 4: Anlegen am Handy** – `addPrinting` (Zeile 247–267):

```kotlin
    suspend fun addPrinting(base: CardRow, setCode: String, rarity: String, price: Double, language: String = "DE",
                            edition: String, condition: String, count: Int = 1, nameKo: String? = null): List<String> = withContext(Dispatchers.IO) {
        // KR (Spec 2026-10-01): Standardfaktor; der PC rechnet beim naechsten Sync auf seinen Faktor um.
        val factor = if (language == "KR") LanguageKr.DEFAULT_FACTOR else null
        val body = JSONObject()
            .put("id", base.id).put("set_code", setCode).put("language", language)
            .put("name", base.name).put("type", base.type).put("desc", base.desc)
            .put("image_url", base.imageUrl).put("atk", base.atk ?: JSONObject.NULL)
            .put("def", base.def ?: JSONObject.NULL).put("level", base.level ?: JSONObject.NULL)
            .put("race", base.race).put("attribute", base.attribute)
            .put("rarity", rarity).put("price", LanguageKr.applyFactor(price, factor)).put("deleted", false)
            .put("name_ko", nameKo ?: JSONObject.NULL).put("cm_lang_factor", factor ?: JSONObject.NULL)
            .toString()
```

(Rest der Funktion unverändert; die lokale `CardRow` am Ende um `nameKo = nameKo, cmLangFactor = factor` ergänzen.)

- [ ] **Step 5: Tests grün**

```bash
./gradlew testDebugUnitTest
```

- [ ] **Step 6: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner/cloud android/app/src/test/java/com/example/yugiohscanner/CardRowParseTest.kt android/app/src/test/java/com/example/yugiohscanner/StoreSnapshotCodecTest.kt
rtk git commit -m "feat(kr): Handy liest/speichert name_ko und cm_lang_factor, KR-Zeilen mit Standardfaktor"
```

---

### Task 8: Android – KR-Drucke und koreanischer Name aus dem Netz

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/PrintingRepository.kt:47-104, 125-144`
- Test: `android/app/src/test/java/com/example/yugiohscanner/LanguageKrTest.kt` (Filter-Fall über die gemeinsame Funktion)

**Interfaces:**
- Consumes: `LanguageKr.isKoreanCode`, `LanguageKr.extractKoName`, `LanguageKr.konamiTitleName`.
- Produces: `PrintingRepository.fetchAllSets(passcode)` enthält KR-Drucke (`language = "KR"`); `suspend fun koreanName(passcode: String): String?`; `internal fun belongsTo(tag: String): (String) -> Boolean`.

- [ ] **Step 1: Failing Test** – an `LanguageKrTest.kt` anhängen:

```kotlin
    @Test fun `belongsTo KR nimmt nur KR-Codes`() {
        val kr = com.example.yugiohscanner.cloud.PrintingRepository.belongsTo("KR")
        assertEquals(listOf("SYE-KR001", "LOB-K005"), listOf("SYE-KR001", "LOB-K005", "DOOD-EN001", "LOB-DE005").filter(kr))
        val de = com.example.yugiohscanner.cloud.PrintingRepository.belongsTo("DE")
        assertEquals(listOf("LOB-DE005", "TP1-G015"), listOf("LOB-DE005", "TP1-G015", "SYE-KR001").filter(de))
        val jp = com.example.yugiohscanner.cloud.PrintingRepository.belongsTo("JP")
        assertEquals(listOf("B3-17"), listOf("B3-17", "SYE-KR001").filter(jp))
    }
```

- [ ] **Step 2: Laufen → FAIL** (`belongsTo` fehlt).

- [ ] **Step 3: Implementierung** in `PrintingRepository.kt`:

Neue Konstanten neben `SETS_CACHE`:

```kotlin
    // v3 (2026-10-01): Unions enthalten jetzt auch KR-Drucke; v2-Eintraege haben keine und werden nicht mehr gelesen.
    private const val SETS_CACHE = "sets-v3"
    private const val KR_CACHE = "sets-kr-v1"
    private const val NAME_KO_CACHE = "name-ko-v1"
    private val hintergrund = kotlinx.coroutines.CoroutineScope(Dispatchers.IO + kotlinx.coroutines.SupervisorJob())
```

(Den alten `SETS_CACHE = "sets-v2"` ersetzen, den langen Kommentar darüber stehen lassen und den neuen Satz anhängen.)

Filter + Locale (ersetzt die `belongs`-Lambda in `localizedUnion`):

```kotlin
    internal fun belongsTo(tag: String): (String) -> Boolean = when (tag) {
        "DE" -> { c -> germanCode.containsMatchIn(c) }
        "KR" -> { c -> LanguageKr.isKoreanCode(c) }
        else -> { c -> !foreignForJp.containsMatchIn(c) }
    }

    private fun konamiLocale(tag: String) = when (tag) { "JP" -> "ja"; "KR" -> "ko"; else -> "de" }
```

In `localizedUnion`: `konamiDetail(cid, konamiLocale(tag), tag)` und `val belongs = belongsTo(tag)`.

Katalog-Pfad in `fetchAllSets` (Zeile 69–78) – KR anhängen, ohne zu warten:

```kotlin
        if (catalogSets.any { it.verified }) {
            // KR steht nicht im Katalog: nur aus dem Plattenspeicher, sonst im Hintergrund nachladen
            // (die naechste Abfrage dieser Karte hat sie dann).
            val kr = ScanCache.read(KR_CACHE, passcode)?.let { runCatching { deserializeSets(it) }.getOrNull() }
                ?: emptyList<SetOption>().also { hintergrund.launch { runCatching { fetchKoreanSets(passcode) } } }
            return@coroutineScope RarityQuellen.ohneErfundeneRarity(
                catalogSets.map { SetOption(it.code, it.rarity, 0.0, it.lang ?: "EN", verified = it.verified) } + kr
            )
        }
```

(`import kotlinx.coroutines.launch` ergänzen.)

Netz-Pfad (Zeile 95–100):

```kotlin
        val deD = async(Dispatchers.IO) { localizedUnion(title, cid, "de", "DE") }
        val jpD = async(Dispatchers.IO) { localizedUnion(title, cid, "jp", "JP") }
        val krD = async(Dispatchers.IO) { localizedUnion(title, cid, "kr", "KR") }
        val kr = krD.await()
        if (kr.isNotEmpty()) ScanCache.write(KR_CACHE, passcode, serializeSets(kr))

        val seen = HashSet<String>()
        val result = RarityQuellen.ohneErfundeneRarity(deD.await() + en + kr + jpD.await())
            .filter { seen.add("${it.setCode}|${it.rarity}") }
```

Neue Funktionen:

```kotlin
    /** Nur die KR-Drucke (Hintergrund-Nachladen fuer den Katalog-Pfad). Schreibt KR_CACHE. */
    suspend fun fetchKoreanSets(passcode: String): List<SetOption> = coroutineScope {
        val enD = async(Dispatchers.IO) { runCatching { fetchSets(passcode) }.getOrDefault(emptyList()) }
        val title = resolveYugipediaTitle(passcode)
        val enCodes = enD.await().map { it.setCode }
        val cid = if (title != null && enCodes.isNotEmpty()) konamiValidCid(title, enCodes) else null
        val kr = localizedUnion(title, cid, "kr", "KR")
        if (kr.isNotEmpty()) ScanCache.write(KR_CACHE, passcode, serializeSets(kr))
        kr
    }

    /** Koreanischer Name: Yugipedia ko_name, sonst Titel der koreanischen Konami-Seite. null, wenn keiner. */
    suspend fun koreanName(passcode: String): String? = withContext(Dispatchers.IO) {
        ScanCache.read(NAME_KO_CACHE, passcode)?.let { return@withContext it }
        val title = resolveYugipediaTitle(passcode) ?: return@withContext null
        val fromWiki = runCatching {
            val req = Request.Builder()
                .url("https://yugipedia.com/api.php?action=parse&page=${URLEncoder.encode(title, "UTF-8")}&prop=wikitext&format=json")
                .header("User-Agent", UA).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) null
                else JSONObject(resp.body?.string() ?: "").optJSONObject("parse")?.optJSONObject("wikitext")
                    ?.optString("*", "")?.let { LanguageKr.extractKoName(it) }
            }
        }.getOrNull()
        val name = fromWiki ?: run {
            val enCodes = runCatching { fetchSets(passcode) }.getOrDefault(emptyList()).map { it.setCode }
            val cid = if (enCodes.isNotEmpty()) konamiValidCid(title, enCodes) else null
            cid?.let { konamiGet("$KONAMI?ope=2&cid=$it&request_locale=ko") }?.let { LanguageKr.konamiTitleName(it) }
        }
        if (name != null) ScanCache.write(NAME_KO_CACHE, passcode, name)
        name
    }
```

(Vorher mit `rtk grep -n "fun resolveYugipediaTitle\|fun write\|fun read" android/app/src/main/java/com/example/yugiohscanner/cloud` die genauen Signaturen von `resolveYugipediaTitle` und `ScanCache.read/write` prüfen und bei Abweichung anpassen.)

Kopfkommentar der Datei (Zeile 27–32, 47) um „KR“ ergänzen: „DE, JP und KR: Fandom + Yugipedia + Konami“.

Namen beim Anlegen mitgeben – in `CollectionRepository.addScanned` (Zeile 273–281) den `addPrinting`-Aufruf ersetzen:

```kotlin
            // KR: koreanischen Namen mitschicken (Netz; ein Fehlschlag laesst ihn leer).
            val nameKo = if (language == "KR") runCatching { PrintingRepository.koreanName(base.id) }.getOrNull() else null
            addPrinting(base, setCode, rarity, 0.0, language, edition, condition, count, nameKo)
```

Weitere `addPrinting`-Aufrufer mit `rtk grep -n "addPrinting(" android/app/src/main` suchen; wo `language` dort `"KR"` sein kann (z. B. `AddPrintingSection.kt`), ebenso `nameKo` holen und übergeben.

- [ ] **Step 4: Tests grün**

```bash
./gradlew testDebugUnitTest
```

- [ ] **Step 5: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner android/app/src/test/java/com/example/yugiohscanner/LanguageKrTest.kt
rtk git commit -m "feat(kr): Handy laedt KR-Drucke und koreanischen Namen (Wikis + Konami)"
```

---

### Task 9: Android – feste Scan-Sprache in `SetCodeMatch`

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/ScanSprache.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SetCodeMatch.kt:181-251`
- Test: `android/app/src/test/java/com/example/yugiohscanner/SetCodeMatchFesteSpracheTest.kt`

**Interfaces:**
- Produces:
  - `object ScanSprache { val OPTIONEN: List<String?> = listOf(null, "DE", "EN", "KR", "JP"); var fest: String? ; fun region(sprache: String): String }` – `fest == null` heißt Auto; lebt nur im Prozess (App-Neustart → Auto).
  - `SetCodeMatch.best(evidence, known, framesEvidence = evidence, festeSprache: String? = null): MatchResult`

- [ ] **Step 1: Failing Test** `SetCodeMatchFesteSpracheTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class SetCodeMatchFesteSpracheTest {
    private val en = SetOption("CORI-EN001", "Super Rare", 0.0, "EN")
    private val de = SetOption("CORI-DE001", "Super Rare", 0.0, "DE", verified = true)
    private val kr = SetOption("CORI-KR001", "Super Rare", 0.0, "KR")

    @Test fun `fest KR waehlt den vorhandenen KR-Druck, auch wenn EN gelesen wurde`() {
        val r = SetCodeMatch.best(listOf("CORI-EN001"), listOf(de, en, kr), festeSprache = "KR")
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
        assertEquals(SetCodeMatch.MatchReason.MATCHED, r.reason)
    }

    @Test fun `fest KR ohne KR-Druck setzt den Code zusammen, unverifiziert`() {
        val r = SetCodeMatch.best(listOf("CORI-DE001"), listOf(de, en), festeSprache = "KR")
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
        assertEquals("Super Rare", r.selected?.rarity)
        assertFalse(r.selected!!.verified)
    }

    @Test fun `fest DE schlaegt eine gelesene EN-Region`() {
        val r = SetCodeMatch.best(listOf("CORI-EN001", "CORI-EN001"), listOf(de, en), festeSprache = "DE")
        assertEquals("CORI-DE001", r.selected?.setCode)
    }

    @Test fun `fest KR schlaegt den deutschen Sprachhinweis aus dem Kartentext`() {
        val text = "Wenn diese Karte auf den Friedhof gelegt wird, kannst du eine Karte deiner Hand"
        val r = SetCodeMatch.best(listOf("CORI-DE001", text), listOf(de, en, kr), listOf("CORI-DE001", text), festeSprache = "KR")
        assertEquals("CORI-KR001", r.selected?.setCode)
    }

    @Test fun `fest KR ohne lesbares Kuerzel bleibt NO_MATCH`() {
        val r = SetCodeMatch.best(listOf("xx zz"), listOf(de, en, kr), festeSprache = "KR")
        assertNull(r.selected)
        assertEquals(SetCodeMatch.MatchReason.NO_MATCH, r.reason)
    }

    @Test fun `Auto mit gelesener KR-Region waehlt KR`() {
        val r = SetCodeMatch.best(listOf("CORI-KR001", "CORI-KR001"), listOf(de, en, kr))
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
    }

    @Test fun `Auto mit KR-Region ohne KR-Druck setzt KR zusammen`() {
        val r = SetCodeMatch.best(listOf("CORI-KR001", "CORI-KR001"), listOf(de, en))
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
    }

    @Test fun `ScanSprache startet auf Auto und kennt die Regionen`() {
        assertNull(com.example.yugiohscanner.ml.ScanSprache.fest)
        assertEquals("KR", com.example.yugiohscanner.ml.ScanSprache.region("KR"))
        assertEquals("DE", com.example.yugiohscanner.ml.ScanSprache.region("DE"))
    }
}
```

- [ ] **Step 2: Laufen → FAIL** (Parameter `festeSprache` / `ScanSprache` fehlen).

```bash
./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.SetCodeMatchFesteSpracheTest"
```

- [ ] **Step 3: Implementierung**

`ml/ScanSprache.kt`:

```kotlin
package com.example.yugiohscanner.ml

/**
 * Sprach-Schalter des Scanners (Spec koreanische Karten §3.2). `null` = Automatisch.
 * Bewusst nur im Speicher: nach einem App-Neustart gilt wieder Auto, damit ein koreanischer Stapel
 * nicht am naechsten Tag deutsche Karten als KR bucht.
 */
object ScanSprache {
    val OPTIONEN: List<String?> = listOf(null, "DE", "EN", "KR", "JP")

    @Volatile var fest: String? = null

    /** Standard-Region einer Sprache fuer einen zusammengesetzten Code (CORI-EN001 -> CORI-KR001). */
    fun region(sprache: String): String = sprache
}
```

`SetCodeMatch.best`: Signatur und Block direkt **vor** `// Sprache aus dem gelesenen Kartentext` (Zeile 241) einfügen:

```kotlin
    fun best(
        evidence: List<String>,
        known: List<SetOption>,
        framesEvidence: List<String> = evidence,
        festeSprache: String? = null,
    ): MatchResult {
```

```kotlin
        // Feste Scan-Sprache (Spec koreanische Karten §3.2): Kuerzel+Nummer sind erkannt, die Sprache
        // gibt der Nutzer vor -- vor Kartentext-Hinweis und gelesener Region. Gibt es keinen Druck in
        // dieser Sprache, wird der Code zusammengesetzt (unverifiziert), wie im Fall 1 unten.
        if (festeSprache != null) {
            val passend = byVerifiedFirst(bestGroup.filter { it.option.language.equals(festeSprache, ignoreCase = true) })
            val gewaehlt = passend.firstOrNull() ?: SetOption(
                setCode = "$groupPrefix-${com.example.yugiohscanner.ml.ScanSprache.region(festeSprache)}$groupNumber",
                rarity = bestGroup.first().option.rarity,
                price = 0.0,
                language = festeSprache,
                verified = false,
            )
            val rest = byVerifiedFirst(bestGroup).filter { it !in passend }
            return MatchResult(gewaehlt, (listOf(gewaehlt) + rest).distinctBy { it.setCode + "|" + it.rarity }, MatchReason.MATCHED, codeExactMatch, codeFrameCount)
        }
```

(`byVerifiedFirst` ist in Zeile 239 definiert – den neuen Block **nach** dieser Zeile einfügen.)

- [ ] **Step 4: Tests grün**

```bash
./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.SetCodeMatchFesteSpracheTest"
./gradlew testDebugUnitTest
```

- [ ] **Step 5: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner/ml/ScanSprache.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SetCodeMatch.kt android/app/src/test/java/com/example/yugiohscanner/SetCodeMatchFesteSpracheTest.kt
rtk git commit -m "feat(kr): feste Scan-Sprache im Set-Code-Abgleich"
```

---

### Task 10: Android – Sprach-Chip im Scanner + Aufrufer

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanResolver.kt:92`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanCapture.kt:183, 364`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt:442-444, 847` (Kopfzeile)

**Interfaces:**
- Consumes: `ScanSprache.fest`, `ScanSprache.OPTIONEN`, `SetCodeMatch.best(..., festeSprache)` (Task 9); `langFlag` (Task 6).

- [ ] **Step 1: Alle vier Aufrufer** übergeben die feste Sprache:

```kotlin
SetCodeMatch.best(evidence, knownSets, framesEvidence, com.example.yugiohscanner.ml.ScanSprache.fest)   // ScanResolver.kt:92
SetCodeMatch.best(evidence, entry.knownSets, framesEvidence, com.example.yugiohscanner.ml.ScanSprache.fest)   // ScanCapture.kt:183
SetCodeMatch.best(evidence, alt.knownSets, framesEvidence, com.example.yugiohscanner.ml.ScanSprache.fest)   // ScanCapture.kt:364
SetCodeMatch.best(setEvidence.setCodeCandidates(d.passcode) + frames, entry.knownSets, frames, com.example.yugiohscanner.ml.ScanSprache.fest)   // ScanScreen.kt:442
```

Danach `rtk grep -n "SetCodeMatch.best(" android/app/src/main` – es dürfen keine Aufrufer ohne vierten Parameter übrig sein.

- [ ] **Step 2: Chip in der Kopfzeile** – in `ScanScreen.kt` direkt nach `Spacer(Modifier.weight(1f))` (Zeile 847), vor dem Scan-Modus-Knopf:

```kotlin
            // Sprach-Schalter (Spec koreanische Karten §3.2): Auto -> DE -> EN -> KR -> JP -> Auto.
            // Nur im Speicher (ScanSprache), nach App-Neustart wieder Auto. Feste Sprache = gelb hervorgehoben.
            var scanSprache by remember { mutableStateOf(com.example.yugiohscanner.ml.ScanSprache.fest) }
            TextButton(
                onClick = {
                    val o = com.example.yugiohscanner.ml.ScanSprache.OPTIONEN
                    val next = o[(o.indexOf(scanSprache) + 1) % o.size]
                    com.example.yugiohscanner.ml.ScanSprache.fest = next
                    scanSprache = next
                },
                modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)),
            ) {
                Text(
                    scanSprache?.let { "${langFlag(it)} $it" } ?: "Sprache: Auto",
                    color = if (scanSprache != null) Color.Yellow else Color.White,
                )
            }
```

Fehlende Imports (`TextButton`, `remember`, `mutableStateOf`, `getValue`/`setValue`) ergänzen, falls der Compiler sie meldet.

- [ ] **Step 3: Bauen + Tests**

```bash
./gradlew testDebugUnitTest
./gradlew assembleRelease
```
Expected: grün, APK unter `android/app/build/outputs/apk/release/`.

- [ ] **Step 4: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner/ui
rtk git commit -m "feat(kr): Sprach-Chip im Scanner, alle Abgleiche nutzen die feste Sprache"
```

---

### Task 11: Android – koreanischer Name und KR-Hinweis in der Kartenansicht

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt:156-158, 221-224`

**Interfaces:**
- Consumes: `CardRow.nameKo`, `CardRow.cmLangFactor` (Task 7).

- [ ] **Step 1: Name** – nach der Kopf-`Row` (Zeile 173, vor dem Kartenbild):

```kotlin
            printings.firstOrNull { it.language == "KR" && it.nameKo != null }?.nameKo?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = Muted, modifier = Modifier.padding(start = 48.dp))
            }
```

- [ ] **Step 2: Hinweis** – nach dem `Valuation.firstEdLine(v)`-Block (Zeile 224):

```kotlin
                        // Spec koreanische Karten §4: Preis ist Trend x KR-Faktor -- Gegenstueck zu CardDetailPanel.jsx.
                        if (v.language == "KR" && v.cmLangFactor != null) {
                            Text("KR-Faktor ${Math.round(v.cmLangFactor * 100)} %", style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
```

- [ ] **Step 3: Bauen**

```bash
./gradlew testDebugUnitTest
./gradlew assembleRelease
```

- [ ] **Step 4: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt
rtk git commit -m "feat(kr): koreanischer Name und KR-Faktor-Hinweis in der Kartenansicht am Handy"
```

---

### Task 12: Einführung & Abnahme (mit dem Nutzer)

**Files:**
- Create: `docs/superpowers/ledgers/2026-10-01-koreanische-karten/abnahme.md`

- [ ] **Step 1: Volle Suiten** (PC in `desktop/`, Handy in `android/`):

```bash
node --test src/utils/*.test.js src/utils/*.test.mjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs
npm run lint
./gradlew testDebugUnitTest
```

- [ ] **Step 2: Nutzer führt `supabase/cards_korean.sql`** im Supabase-SQL-Editor aus (vor Installer/APK) und die Prüfabfragen am Dateiende. Danach Edge Functions mit geänderten `_shared`-Dateien (`listing-text.ts`, `ebay-map.ts`) neu deployen – das macht der Nutzer, kein Agent.

- [ ] **Step 3: PC-Installer bauen** – `npm run dist` im Haupt-Checkout (nie aus einem Junction-Worktree), Nutzer installiert.

- [ ] **Step 4: APK installieren** – `./gradlew assembleRelease`, per `adb install -r` aufs Handy; App einmal starten und `adb logcat -b crash -d` prüfen (Lehre aus der Regex-Falle).

- [ ] **Step 5: Abnahme mit der echten koreanischen Karte** (Spec §7), Ergebnis je Punkt in `abnahme.md`:
  1. Modus **Auto** scannen → Zeile `language = KR`, `-KR`-Code.
  2. Modus **KR** → KR.
  3. App neu starten → Chip „Sprache: Auto“; deutsche Karte wird DE.
  4. PC: 🇰🇷, koreanischer Name, Preis = Trend × 50 % mit Hinweis; Filter KR zeigt die Karte.
  5. Faktor am PC auf 60 % → Preis rechnet um, erscheint nach Sync am Handy.

- [ ] **Step 6: Commit** des Ledgers; Merge nach `main` erst nach bestandener Abnahme und Freigabe durch den Nutzer.
