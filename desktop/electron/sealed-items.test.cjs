const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const S = require('./sealed-items.cjs');

// Produkte wie aus sealed-products.cjs (echte IDs und Trends aus dem Cardmarket-Cache).
const DISPLAY = { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 };
const BOOSTER = { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: 34.22 };
const NO_TREND = { cm_product_id: 254468, name: 'Legend of Blue Eyes White Dragon Booster Box', kind: 'display', trend: null };

function freshDb() {
  const db = new Database(':memory:');
  S.ensureSealedSchema(db);
  return db;
}
const row = (db, id) => db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ?').get(id);
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM sealed_items').get().n;

test('ensureSealedSchema ist idempotent und legt genau die Spalten an', () => {
  const db = freshDb();
  S.ensureSealedSchema(db);
  assert.deepEqual(db.prepare('PRAGMA table_info(sealed_items)').all().map((c) => c.name), S.SEALED_COLS);
});

test('checks: Art nur die sechs Werte, Menge mindestens 1', () => {
  const db = freshDb();
  const ins = db.prepare('INSERT INTO sealed_items (sealed_id, cm_product_id, name, kind, quantity) VALUES (?, 1, ?, ?, ?)');
  assert.throws(() => ins.run('k1', 'Falsch', 'karton', 1));
  assert.throws(() => ins.run('k2', 'Null', 'display', 0));
  for (const kind of ['display', 'booster', 'tin', 'deck', 'special', 'other']) {
    assert.doesNotThrow(() => ins.run(`ok-${kind}`, kind, kind, 1));
  }
});

test('addSealed legt mit Startpreis an; ohne Trend ohne Preis und ohne Zeitstempel', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 2);
  assert.equal(a.merged, false);
  const r = row(db, a.sealed_id);
  assert.match(r.sealed_id, /^[0-9a-f-]{36}$/);
  assert.equal(r.cm_product_id, 254469);
  assert.equal(r.name, 'Metal Raiders Booster Box');
  assert.equal(r.kind, 'display');
  assert.equal(r.quantity, 2);
  assert.equal(r.price, 499.29);
  assert.ok(r.price_updated_at);
  assert.equal(r.deleted, 0);
  const b = row(db, S.addSealed(db, NO_TREND, 1).sealed_id);
  assert.equal(b.price, null);
  assert.equal(b.price_updated_at, null);
});

test('addSealed desselben lebenden Produkts erhöht die Menge statt einer neuen Zeile', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 2);
  const b = S.addSealed(db, DISPLAY, 3);
  assert.deepEqual(b, { sealed_id: a.sealed_id, merged: true });
  assert.equal(count(db), 1);
  assert.equal(row(db, a.sealed_id).quantity, 5);
});

test('nach Soft-Delete legt addSealed eine neue Zeile an', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 1);
  S.deleteSealed(db, a.sealed_id);
  const b = S.addSealed(db, DISPLAY, 1);
  assert.notEqual(b.sealed_id, a.sealed_id);
  assert.equal(count(db), 2);
});

test('ungültige Menge, fehlendes Produkt und unbekannte Zeile werfen SealedError', () => {
  const db = freshDb();
  assert.throws(() => S.addSealed(db, DISPLAY, 0), S.SealedError);
  assert.throws(() => S.addSealed(db, DISPLAY, 1.5), S.SealedError);
  assert.throws(() => S.addSealed(db, undefined, 1), S.SealedError);
  const a = S.addSealed(db, DISPLAY, 1);
  assert.throws(() => S.setSealedQuantity(db, { sealed_id: a.sealed_id, quantity: 0 }), S.SealedError);
  assert.throws(() => S.setSealedQuantity(db, { sealed_id: 'gibtsnicht', quantity: 2 }), S.SealedError);
  assert.throws(() => S.deleteSealed(db, 'gibtsnicht'), S.SealedError);
  assert.equal(count(db), 1);
  assert.equal(row(db, a.sealed_id).quantity, 1);
});

test('setSealedQuantity setzt die Menge und stempelt updated_at neu', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 1);
  db.prepare("UPDATE sealed_items SET updated_at = '2000-01-01 00:00:00' WHERE sealed_id = ?").run(a.sealed_id);
  S.setSealedQuantity(db, { sealed_id: a.sealed_id, quantity: 4 });
  const r = row(db, a.sealed_id);
  assert.equal(r.quantity, 4);
  assert.notEqual(r.updated_at, '2000-01-01 00:00:00', 'der Push saehe die Aenderung sonst nie');
});

test('openSealed zählt bis 1 herunter und löscht dann nur weich', () => {
  const db = freshDb();
  const a = S.addSealed(db, BOOSTER, 2);
  assert.deepEqual(S.openSealed(db, a.sealed_id), { quantity: 1, deleted: false });
  assert.deepEqual(S.openSealed(db, a.sealed_id), { quantity: 1, deleted: true });
  const r = row(db, a.sealed_id);
  assert.ok(r, 'die Zeile bleibt als Soft-Delete stehen');
  assert.equal(r.deleted, 1);
  assert.equal(r.quantity, 1);
  assert.throws(() => S.openSealed(db, a.sealed_id), S.SealedError);
});

test('deleteSealed löscht weich', () => {
  const db = freshDb();
  const a = S.addSealed(db, BOOSTER, 3);
  S.deleteSealed(db, a.sealed_id);
  assert.equal(row(db, a.sealed_id).deleted, 1);
  assert.equal(count(db), 1);
});

test('listSealed: lebende Zeilen sortiert, mit Zeilensumme, Veraltung, Art und Sealed-Wert', () => {
  const db = freshDb();
  const display = S.addSealed(db, DISPLAY, 1).sealed_id;
  const booster = S.addSealed(db, BOOSTER, 20).sealed_id;
  const noTrend = S.addSealed(db, NO_TREND, 1).sealed_id;
  const gone = S.addSealed(db, { cm_product_id: 999001, name: 'Weg', kind: 'other', trend: 5 }, 1).sealed_id;
  S.deleteSealed(db, gone);
  db.prepare("UPDATE sealed_items SET price_updated_at = '2026-08-01 09:30:00' WHERE sealed_id = ?").run(display);
  const { items, sealedValue } = S.listSealed(db, Date.parse('2026-09-15T12:00:00Z'));
  assert.deepEqual(items.map((i) => i.sealed_id), [booster, display, noTrend]);
  assert.ok(Math.abs(items[0].lineValue - 684.4) < 1e-9);
  assert.equal(items[2].lineValue, null);
  assert.deepEqual(items.map((i) => i.stale), [false, true, false]);
  assert.deepEqual(items.map((i) => i.kindLabel), ['Booster', 'Display', 'Display']);
  assert.ok(Math.abs(sealedValue - (684.4 + 499.29)) < 1e-9);
});

test('applySealedPrices schreibt nur geänderte Trends lebender Zeilen und stempelt price_updated_at', () => {
  const db = freshDb();
  const same = S.addSealed(db, DISPLAY, 1).sealed_id;
  const changed = S.addSealed(db, BOOSTER, 1).sealed_id;
  const empty = S.addSealed(db, NO_TREND, 1).sealed_id;
  const gone = S.addSealed(db, { cm_product_id: 230007, name: 'Dark Revelation 2 Booster', kind: 'booster', trend: 40 }, 1).sealed_id;
  S.deleteSealed(db, gone);
  db.prepare("UPDATE sealed_items SET price_updated_at = '2000-01-01 00:00:00'").run();
  const n = S.applySealedPrices(db, [
    { idProduct: 254469, trend: 499.29 },
    { idProduct: 230006, trend: 36.5 },
    { idProduct: 254468, trend: 0.02 },
    { idProduct: 230007, trend: 46.11 },
  ]);
  assert.equal(n, 2);
  assert.equal(row(db, same).price_updated_at, '2000-01-01 00:00:00');
  assert.equal(row(db, changed).price, 36.5);
  assert.notEqual(row(db, changed).price_updated_at, '2000-01-01 00:00:00');
  assert.equal(row(db, empty).price, 0.02);
  assert.equal(row(db, gone).price, 40, 'geloeschte Zeilen bekommen keinen Preis');
});
