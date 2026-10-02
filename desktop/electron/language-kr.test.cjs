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
             price_locked INTEGER DEFAULT 0, cm_lang_factor REAL, kr_updated_at DATETIME, deleted INTEGER DEFAULT 0,
             PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE price_history (card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL,
             rarity TEXT NOT NULL, variant TEXT NOT NULL DEFAULT 'base', day TEXT NOT NULL, price REAL NOT NULL,
             source TEXT NOT NULL, recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             PRIMARY KEY (card_id, set_code, language, rarity, variant, day));`);
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
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price, price_locked, cm_lang_factor, deleted) VALUES ('1','CORI-KR001','KR','Common',5,0,0.5,0)").run();
  kr.rescaleKrRow(db, { id: '1', set_code: 'CORI-KR001', language: 'KR', rarity: 'Common' }, 0.6);
  const r = db.prepare("SELECT price, cm_lang_factor FROM cards WHERE id='1'").get();
  assert.deepStrictEqual(r, { price: 6, cm_lang_factor: 0.6 });
});

test('setKrFactor: 50 -> 60 -> 50 % landet wieder beim Ausgangspreis, gesperrte Preise bleiben', () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price, price_locked, cm_lang_factor, deleted) VALUES ('1','CORI-KR001','KR','Common',5,1,0.5,0)").run();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price, price_locked, cm_lang_factor, deleted) VALUES ('2','CORI-KR002','KR','Common',9.99,2,null,0)").run();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price, price_locked, cm_lang_factor, deleted) VALUES ('3','CORI-DE001','DE','Common',4,1,null,0)").run();
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

test('setKrFactor schreibt den umgerechneten Preis in den Preisverlauf', () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price, price_locked, cm_lang_factor, deleted) VALUES ('1','CORI-KR001','KR','Common',5,1,0.5,0)").run();
  kr.setKrFactor(db, 0.6);
  const h = db.prepare('SELECT card_id, set_code, language, rarity, variant, price, source FROM price_history').all();
  assert.deepStrictEqual(h, [
    { card_id: '1', set_code: 'CORI-KR001', language: 'KR', rarity: 'Common', variant: 'base', price: 6, source: 'kr_factor' },
  ]);
});

test('setKrFactor mit ungueltigem Wert speichert den Standard', () => {
  const db = makeDb();
  assert.strictEqual(kr.setKrFactor(db, 'abc').factor, 0.5);
});

test('setsBelongTo: kr nimmt nur KR-Codes, de nur deutsche, jp keine fremden TCG-Regionen', () => {
  const { setsBelongTo } = require('./api-handler.cjs');
  const kr = setsBelongTo('kr');
  assert.deepStrictEqual(['SYE-KR001', 'LOB-K005', 'DOOD-EN001', 'LOB-DE005'].filter(kr), ['SYE-KR001', 'LOB-K005']);
  assert.deepStrictEqual(['LOB-DE005', 'TP1-G015', 'SYE-KR001'].filter(setsBelongTo('de')), ['LOB-DE005', 'TP1-G015']);
  assert.deepStrictEqual(['B3-17', 'SYE-KR001'].filter(setsBelongTo('jp')), ['B3-17']);
});

test('setKrFactor rechnet Drucke mit k-tcg-Preis nicht um', () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price, cm_lang_factor, kr_updated_at) VALUES ('9','CORI-KR027','KR','Ultra Rare',5,0.5,'2026-10-02 08:00:00')").run();
  kr.setKrFactor(db, 0.8);
  assert.strictEqual(db.prepare("SELECT price FROM cards WHERE id='9'").get().price, 5);
});
