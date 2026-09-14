const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { referenceRows, cardHistory } = require('./price-reference.cjs');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  const ins = d.prepare(`INSERT INTO price_history (card_id,set_code,language,rarity,variant,day,price,source) VALUES (?,?,?,?,?,?,?,?)`);
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'base', '2026-09-01', 10, 'cm_bulk');
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'base', '2026-09-10', 11, 'cm_bulk');
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'base', '2026-09-15', 12, 'cm_bulk');
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'first', '2026-09-12', 99, 'cm_scrape');
  ins.run('2', 'Q-DE002', 'DE', 'Common', 'base', '2026-09-18', 3, 'cloud');
  ins.run('2', 'Q-DE002', 'DE', 'Common', 'base', '2026-09-16', 2, 'cloud');
  ins.run('3', 'R-DE003', 'DE', 'Common', 'first', '2026-09-01', 5, 'cm_scrape');
  return d;
}

test('referenceRows: letzte Zeile bis Stichtag, sonst frueheste; Variante first zaehlt nie', () => {
  const rows = referenceRows(db(), '2026-09-13').sort((a, b) => a.card_id.localeCompare(b.card_id));
  assert.deepStrictEqual(rows, [
    { card_id: '1', set_code: 'P-DE001', language: 'DE', rarity: 'Rare', day: '2026-09-10', price: 11, source: 'cm_bulk' },
    { card_id: '2', set_code: 'Q-DE002', language: 'DE', rarity: 'Common', day: '2026-09-16', price: 2, source: 'cloud' },
  ]);
});

test('referenceRows: Zeile genau am Stichtag zaehlt', () => {
  const rows = referenceRows(db(), '2026-09-10').filter((r) => r.card_id === '1');
  assert.equal(rows[0].day, '2026-09-10');
});

test('cardHistory: nur base, aufsteigend', () => {
  const rows = cardHistory(db(), { id: '1', set_code: 'P-DE001', language: 'DE', rarity: 'Rare' });
  assert.deepStrictEqual(rows.map((r) => r.day), ['2026-09-01', '2026-09-10', '2026-09-15']);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['day', 'price', 'source']);
});
