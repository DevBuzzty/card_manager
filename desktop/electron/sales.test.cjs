const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const S = require('./sales.cjs');

function freshDb() {
  const db = new Database(':memory:');
  // Wie copies-for-sale.test.cjs: ensureCopiesSchema braucht cards (mit price) und portfolio_history.
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  ensureSalesSchema(db);
  return db;
}
function addCard(db, id, price, n, extra = {}) {
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, price) VALUES (?, 'LOB-DE001', 'DE', 'Common', ?, ?)`).run(id, `Karte ${id}`, price);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const copyId = `${id}-${i}`;
    db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, condition, for_sale, container_id, page, slot)
      VALUES (?, ?, 'LOB-DE001', 'DE', 'Common', 'NM', ?, ?, ?, ?)`)
      .run(copyId, id, extra.forSale ? 1 : 0, extra.container ?? null, extra.page ?? null, extra.slot ?? null);
    ids.push(copyId);
  }
  return ids;
}
const copy = (db, id) => db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(id);
const base = { channel_id: 'cardmarket', sold_on: '2026-09-21', gross: 10, fees: 0.5, shipping: 1.6, note: null };

test('Kanaele: fuenf feste mit Cardmarket 5 %', () => {
  const db = freshDb();
  const ch = S.listChannels(db);
  assert.deepEqual(ch.map((c) => [c.channel_id, c.fee_percent]), [['cardmarket', 5], ['ebay', 0], ['kleinanzeigen', 0], ['tausch', 0], ['privat', 0]]);
});

test('Buchen: Exemplare verkauft, Anteile exakt, Marktwert eingefroren, Momentaufnahme', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1, { forSale: true });
  const [b] = addCard(db, '2', 1, 1);
  const saleId = S.bookSale(db, { ...base, copyIds: [a, b] });
  // Netto 790 auf 300/100: 592,5 -> 593 und 197,5 -> 198 (Summe 791), der Rest-Cent -1 geht an die groessere Position.
  assert.equal(copy(db, a).deleted, 1);
  assert.equal(copy(db, a).sold_in, saleId);
  assert.equal(copy(db, a).for_sale, 0);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY copy_id').all(saleId);
  assert.deepEqual(items.map((i) => [i.copy_id, i.value_at_sale, i.share, i.was_for_sale, i.name]),
    [[a, 3, 5.92, 1, 'Karte 1'], [b, 1, 1.98, 0, 'Karte 2']]);
  assert.equal(db.prepare("SELECT deleted FROM cards WHERE id = '1'").get().deleted, 1, 'Trigger blendet den leeren Druck aus');
  db.prepare("UPDATE cards SET price = 99 WHERE id = '1'").run();
  S.updateSale(db, { sale_id: saleId, ...base, gross: 12, returnCopyIds: [] });
  assert.equal(db.prepare('SELECT value_at_sale FROM sale_items WHERE copy_id = ?').get(a).value_at_sale, 3, 'eingefroren');
});

test('Buchen: bereits verkauft oder leer wird abgelehnt, nichts halb gebucht', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  S.bookSale(db, { ...base, copyIds: [a] });
  const [b] = addCard(db, '2', 1, 1);
  assert.throws(() => S.bookSale(db, { ...base, copyIds: [b, a] }), /bereits verkauft/);
  assert.equal(copy(db, b).deleted, 0, 'b bleibt lebend');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1);
  assert.throws(() => S.bookSale(db, { ...base, copyIds: [] }), /Mindestens eine Karte/);
  assert.throws(() => S.bookSale(db, { ...base, gross: -1, copyIds: [b] }), /Preis/);
});

test('Teil-Rueckgabe: Exemplar kommt zurueck, Rest neu verteilt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1, { forSale: true });
  const [b] = addCard(db, '2', 1, 1);
  const saleId = S.bookSale(db, { ...base, copyIds: [a, b] });
  S.updateSale(db, { sale_id: saleId, ...base, returnCopyIds: [a] });
  assert.equal(copy(db, a).deleted, 0);
  assert.equal(copy(db, a).sold_in, null);
  assert.equal(copy(db, a).for_sale, 1, 'was_for_sale wiederhergestellt');
  assert.equal(db.prepare('SELECT share FROM sale_items WHERE copy_id = ?').get(b).share, 7.9);
  assert.throws(() => S.updateSale(db, { sale_id: saleId, ...base, returnCopyIds: [b] }), /sonst stornieren/);
  // Rollback: der gescheiterte Versuch, auch b zurueckzugeben, darf nichts veraendert haben.
  assert.equal(copy(db, b).deleted, 1, 'b bleibt verkauft (Rollback)');
  assert.equal(copy(db, b).sold_in, saleId, 'b bleibt beim Verkauf (Rollback)');
  assert.equal(db.prepare('SELECT deleted FROM sale_items WHERE sale_id = ? AND copy_id = ?').get(saleId, b).deleted, 0, 'Position b bleibt aktiv (Rollback)');
});

test('Storno: alle zurueck, Status storniert, nicht mehr aenderbar', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const saleId = S.bookSale(db, { ...base, copyIds: [a, b] });
  S.cancelSale(db, saleId);
  assert.equal(copy(db, a).deleted, 0);
  assert.equal(copy(db, b).deleted, 0);
  assert.equal(db.prepare('SELECT status FROM sales WHERE sale_id = ?').get(saleId).status, 'storniert');
  assert.equal(db.prepare("SELECT deleted FROM cards WHERE id = '1'").get().deleted, 0, 'Trigger belebt den Druck');
  assert.throws(() => S.updateSale(db, { sale_id: saleId, ...base, returnCopyIds: [] }), /storniert/);
});

test('Fach-Konflikt: Rueckkehr ohne Fach, needs_review', () => {
  const db = freshDb();
  db.prepare("INSERT INTO containers (container_id, name, kind, pockets_per_page) VALUES ('B', 'Ordner', 'binder', 9)").run();
  const [a] = addCard(db, '1', 3, 1, { container: 'B', page: 1, slot: 4 });
  const saleId = S.bookSale(db, { ...base, copyIds: [a] });
  addCard(db, '2', 1, 1, { container: 'B', page: 1, slot: 4 });
  S.cancelSale(db, saleId);
  const r = copy(db, a);
  assert.deepEqual([r.deleted, r.container_id, r.page, r.slot, r.needs_review, r.review_reason], [0, 'B', null, null, 1, 'Fach inzwischen belegt']);
});

test('Kein Fach-Konflikt ohne Behaelter: zwei nicht einsortierte Exemplare teilen sich kein Fach', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1, { page: 1, slot: 4 });
  const saleId = S.bookSale(db, { ...base, copyIds: [a] });
  addCard(db, '2', 1, 1, { page: 1, slot: 4 });
  S.cancelSale(db, saleId);
  const r = copy(db, a);
  assert.deepEqual([r.deleted, r.container_id, r.page, r.slot, r.needs_review, r.review_reason], [0, null, 1, 4, 0, null]);
});

test('Doppelverkauf: Storno des einen laesst das Exemplar im anderen verkauft', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const s1 = S.bookSale(db, { ...base, copyIds: [a] });
  // Zweiter Verkauf desselben Exemplars, wie er nach einem Abgleich von einem anderen Geraet ankommt:
  db.prepare(`INSERT INTO sales (sale_id, sold_on, channel_id, channel_name, gross, updated_at) VALUES ('s2', '2026-09-21', 'ebay', 'eBay', 5, '2000-01-01 00:00:00')`).run();
  db.prepare(`INSERT INTO sale_items (sale_id, copy_id, value_at_sale, share, card_id, set_code, language, rarity, edition, condition)
    VALUES ('s2', ?, 3, 5, '1', 'LOB-DE001', 'DE', 'Common', 'unknown', 'NM')`).run(a);
  const ov = S.salesOverview(db, { period: 'gesamt', today: '2026-09-21' });
  assert.deepEqual(ov.sales.filter((s) => s.doubleSold).map((s) => s.sale_id).sort(), [s1, 's2'].sort());
  const cardsOf = (o, id) => o.sales.find((s) => s.sale_id === id).cards;
  assert.equal(cardsOf(ov, s1), 1, 'Position zaehlt beim Verkauf, auf den sold_in zeigt');
  assert.equal(cardsOf(ov, 's2'), 0, 'im anderen Verkauf zaehlt sie nicht');
  S.cancelSale(db, s1);
  const ov2 = S.salesOverview(db, { period: 'gesamt', today: '2026-09-21' });
  assert.equal(cardsOf(ov2, s1), 1, 'storniert: alle lebenden Positionen');
  assert.equal(cardsOf(ov2, 's2'), 1, 'sold_in zeigt jetzt auf s2');
  assert.equal(copy(db, a).deleted, 1, 'bleibt verkauft');
  assert.equal(copy(db, a).sold_in, 's2', 'sold_in wandert zum anderen Verkauf');
});

test('Uebersicht und Kartenansicht', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const s1 = S.bookSale(db, { ...base, copyIds: [a] });
  S.bookSale(db, { ...base, channel_id: 'ebay', sold_on: '2026-08-01', gross: 4, fees: null, shipping: null, copyIds: [b] });
  const ov = S.salesOverview(db, { period: 'monat', today: '2026-09-21' });
  assert.deepEqual(ov.totals, { netCents: 790, marketCents: 300, feesCents: 50, sales: 1, cards: 1 });
  assert.equal(ov.byMonth.length, 12);
  assert.equal(S.salesOverview(db, { period: 'gesamt', today: '2026-09-21' }).sales[0].sale_id, s1, 'neueste zuerst');
  assert.equal(S.cardSales(db, '1').length, 2);
  assert.equal(S.saleDetail(db, s1).items.length, 1);
});

test('Uebersicht nach Storno: Zeile zeigt weiterhin den Nettobetrag der Positionen', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const saleId = S.bookSale(db, { ...base, copyIds: [a] });
  S.cancelSale(db, saleId);
  const row = S.salesOverview(db, { period: 'gesamt', today: '2026-09-21' }).sales.find((s) => s.sale_id === saleId);
  assert.equal(row.netCents, 790);
  assert.equal(row.marketCents, 300);
});

test('Buchen: unendliche Gebühren/Versand werden abgelehnt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  assert.throws(() => S.bookSale(db, { ...base, fees: Infinity, copyIds: [a] }), /Gebühren/);
  assert.throws(() => S.bookSale(db, { ...base, shipping: Infinity, copyIds: [a] }), /Versand/);
});

test('Buchen auf ausgeblendetem Kanal scheitert', () => {
  const db = freshDb();
  const id = S.saveChannel(db, { name: 'Flohmarkt', fee_percent: 0 });
  S.hideChannel(db, id);
  const [a] = addCard(db, '1', 3, 1);
  assert.throws(() => S.bookSale(db, { ...base, channel_id: id, copyIds: [a] }), /Kanal nicht gefunden/);
});

test('Bearbeiten: Kanalname bleibt die Momentaufnahme vom Buchen, auch nach Umbenennen', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const saleId = S.bookSale(db, { ...base, copyIds: [a] });
  S.saveChannel(db, { channel_id: 'cardmarket', name: 'CM Neu', fee_percent: 5 });
  S.updateSale(db, { sale_id: saleId, ...base, note: 'Notiz', returnCopyIds: [] });
  assert.equal(db.prepare('SELECT channel_name FROM sales WHERE sale_id = ?').get(saleId).channel_name, 'Cardmarket');
});

test('Kanaele: eigener Kanal anlegen, ausblenden; feste nicht ausblendbar', () => {
  const db = freshDb();
  const id = S.saveChannel(db, { name: 'Flohmarkt', fee_percent: 0 });
  assert.ok(S.listChannels(db).some((c) => c.channel_id === id));
  S.hideChannel(db, id);
  assert.ok(!S.listChannels(db).some((c) => c.channel_id === id));
  assert.throws(() => S.hideChannel(db, 'cardmarket'), /Feste Kanäle/);
  S.saveChannel(db, { channel_id: 'cardmarket', name: 'Cardmarket', fee_percent: 6.5 });
  assert.equal(S.listChannels(db)[0].fee_percent, 6.5);
  assert.throws(() => S.saveChannel(db, { name: ' ', fee_percent: 0 }), /Namen/);
  assert.throws(() => S.saveChannel(db, { name: 'X', fee_percent: 101 }), /Gebühr/);
});
