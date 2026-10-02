// desktop/electron/kr-prices.test.cjs — KR-Preise aus k-tcg. Run with ELECTRON_RUN_AS_NODE=1 (better-sqlite3 ABI).
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { refreshKrPrices, parseKtcgName, matchProduct, eurFromUsd, parseEcbUsd } = require('./kr-prices.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');

// Namen wie am 02.10.2026 in der Store-API von k-tcg.com.
const prod = (name, cents) => ({ name, prices: { price: String(cents), currency_code: 'USD', currency_minor_unit: 2 } });
const MAGICIAN = [
  prod('Yugioh Card &#8220;Magician of Dark Chaos &#8211; Black Chaos&#8221; (extended art) CORI-KR027 Korean Ver Prismatic Secret Rare', 46462),
  prod('Yugioh Card &#8220;Magician of Dark Chaos &#8211; Black Chaos&#8221; CORI-KR027 Korean Ver Secret Rare', 923),
  prod('Yugioh Card &#8220;Magician of Dark Chaos &#8211; Black Chaos&#8221; CORI-KR027 Korean Ver Ultra Rare', 577),
];

test('parseKtcgName liest Code, Seltenheit und Variante', () => {
  assert.deepEqual(parseKtcgName(MAGICIAN[2].name), { code: 'CORI-KR027', rarity: 'Ultra Rare', variant: false });
  assert.equal(parseKtcgName(MAGICIAN[0].name).variant, true);
  assert.equal(parseKtcgName('Yugioh Card "Kuriboh (Alt)" MVP1-KRQ54 Korean Ver Common').variant, false); // Klammer im Namen zaehlt nicht
  assert.equal(parseKtcgName('Yugioh Booster Box CORI Korean'), null);
});

test('matchProduct verlangt dieselbe Seltenheit (nicht nur das Wort "Rare") und keine Variante', () => {
  assert.equal(matchProduct(MAGICIAN, { set_code: 'CORI-KR027', rarity: 'Ultra Rare' }), MAGICIAN[2]);
  assert.equal(matchProduct(MAGICIAN, { set_code: 'CORI-KR027', rarity: 'Secret Rare' }), MAGICIAN[1]);
  assert.equal(matchProduct(MAGICIAN, { set_code: 'CORI-KR027', rarity: 'Prismatic Secret Rare' }), null); // nur extended art da
  assert.equal(matchProduct(MAGICIAN, { set_code: 'CORI-KR027', rarity: 'Rare' }), null);
  assert.equal(matchProduct(MAGICIAN, { set_code: 'CORI-KR028', rarity: 'Ultra Rare' }), null);
});

test('eurFromUsd rechnet um, Mindestpreis wird zum Rechenwert 0,10 €', () => {
  assert.equal(eurFromUsd(5.77, 1.1538), 5);
  assert.equal(eurFromUsd(1, 1.1538), 0.1);
  assert.equal(eurFromUsd(1.15, 1.15), 1);
});

test('parseEcbUsd liest den USD-Kurs aus dem EZB-XML', () => {
  assert.equal(parseEcbUsd("<Cube time='2026-10-01'><Cube currency='USD' rate='1.0846'/><Cube currency='JPY' rate='160.1'/>"), 1.0846);
  assert.equal(parseEcbUsd('<html>kaputt</html>'), null);
});

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE cards (id TEXT, name TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT,
      quantity INTEGER DEFAULT 1, price REAL, price_locked INTEGER DEFAULT 0, cm_product_id INTEGER,
      cm_product_derived INTEGER DEFAULT 0, kr_ktcg_usd REAL, kr_updated_at DATETIME, deleted INTEGER DEFAULT 0,
      PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL);
  `);
  ensureCopiesSchema(db); // recordPrice braucht price_history
  const ins = db.prepare("INSERT INTO cards (id, name, set_code, language, rarity, price, price_locked, cm_product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  ins.run('44001993', 'Magician of Dark Chaos - Black Chaos', 'CORI-KR027', 'KR', 'Ultra Rare', 26, 1, 894838);
  ins.run('71222649', 'Twilight Specter Rayrage', 'CORI-KR025', 'KR', 'Common', 0.04, 1, 894753);
  ins.run('11111111', 'Ohne Treffer', 'CORI-KR099', 'KR', 'Rare', 3, 0, null);
  ins.run('22222222', 'Handpreis', 'CORI-KR001', 'KR', 'Rare', 7, 2, null);
  ins.run('44001993', 'Magician of Dark Chaos - Black Chaos', 'CORI-DE027', 'DE', 'Ultra Rare', 52, 1, 894838);
  return db;
}

const fakeNet = (calls) => async (url) => {
  calls.push(url);
  if (url.includes('ecb.europa.eu')) return "<Cube currency='USD' rate='1.1538'/>";
  if (url.includes('CORI-KR027')) return JSON.stringify(MAGICIAN);
  if (url.includes('CORI-KR025')) return JSON.stringify([prod('Yugioh Card "Twilight Specter Rayrage" CORI-KR025 Korean Ver Common', 100)]);
  return '[]';
};

test('refreshKrPrices setzt k-tcg-Preise, loest KR von Cardmarket und laesst Handpreise und DE in Ruhe', async () => {
  const db = makeDb();
  const calls = [];
  const res = await refreshKrPrices(db, { deps: { getText: fakeNet(calls), sleep: async () => {} } });
  assert.deepEqual(res, { checked: 3, priced: 2, noMatch: 1, errors: 0 });
  const row = (sc) => db.prepare('SELECT price, price_locked, cm_product_id, kr_ktcg_usd, kr_updated_at FROM cards WHERE set_code = ?').get(sc);
  const mag = row('CORI-KR027');
  assert.equal(mag.price, 5);
  assert.equal(mag.kr_ktcg_usd, 5.77);
  assert.equal(mag.cm_product_id, null);
  assert.equal(mag.price_locked, 1);
  assert.ok(mag.kr_updated_at);
  assert.equal(row('CORI-KR025').price, 0.1);         // Mindestpreis
  assert.equal(row('CORI-KR025').kr_ktcg_usd, 1);
  assert.equal(row('CORI-KR099').price, 0);            // kein Treffer -> kein Preis
  assert.equal(row('CORI-KR099').kr_ktcg_usd, null);
  assert.equal(row('CORI-KR001').price, 7);            // Handpreis unberuehrt
  assert.equal(row('CORI-DE027').price, 52);           // DE unberuehrt
  assert.equal(row('CORI-DE027').cm_product_id, 894838);
  assert.equal(calls.filter(u => u.includes('k-tcg')).length, 3); // eine Suche je Set-Code

  // Zweiter Lauf innerhalb von 24 h fragt nichts ab.
  const again = await refreshKrPrices(db, { deps: { getText: fakeNet([]), sleep: async () => {} } });
  assert.equal(again.checked, 0);
});

test('refreshKrPrices ohne jeden Wechselkurs schreibt nichts', async () => {
  const db = makeDb();
  const res = await refreshKrPrices(db, { deps: { getText: async () => { throw new Error('offline'); }, sleep: async () => {} } });
  assert.equal(res.error, 'no-fx');
  assert.equal(db.prepare("SELECT price FROM cards WHERE set_code = 'CORI-KR027'").get().price, 26);
});

test('refreshKrPrices: k-tcg nicht erreichbar -> Druck bleibt faellig, Preis unveraendert', async () => {
  const db = makeDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('fx_usd_per_eur', '1.1538')").run();
  const res = await refreshKrPrices(db, { deps: { getText: async () => { throw new Error('offline'); }, sleep: async () => {} } });
  assert.equal(res.errors, 3);
  const mag = db.prepare("SELECT price, kr_updated_at FROM cards WHERE set_code = 'CORI-KR027'").get();
  assert.deepEqual(mag, { price: 26, kr_updated_at: null });
});
