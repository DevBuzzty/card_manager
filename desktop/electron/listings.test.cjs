const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const copies = require('./copies.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const L = require('./listings.cjs');
const S = require('./sales.cjs');

function freshDb({ listings = true } = {}) {
  const db = new Database(':memory:');
  // Wie sales.test.cjs; dazu cm_url (database.cjs legt die Spalte an, ensureCopiesSchema nicht).
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0, cm_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  ensureSalesSchema(db);
  if (listings) ensureListingsSchema(db);
  return db;
}
// n Exemplare eines Drucks; Passcode `id`, Preis in Euro; extra.condition/edition fuer eigene Gruppen.
function addCard(db, id, price, n, extra = {}) {
  db.prepare(`INSERT OR IGNORE INTO cards (id, set_code, language, rarity, name, image_url, price, cm_url)
    VALUES (?, 'LOB-DE005', 'DE', 'Ultra Rare', ?, ?, ?, ?)`).run(id, `Card ${id}`, `https://img/${id}.jpg`, price, extra.cmUrl ?? null);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const copyId = `${id}-${extra.tag ?? ''}${i}`;
    db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition)
      VALUES (?, ?, 'LOB-DE005', 'DE', 'Ultra Rare', ?, ?)`).run(copyId, id, extra.edition ?? 'first', extra.condition ?? 'NM');
    ids.push(copyId);
  }
  return ids;
}
const NAMES = (id) => (id === '1' ? { de: 'Dunkler Magier', en: 'Dark Magician' } : null);
const base = (over) => ({ channel_id: 'ebay', listed_on: '2026-09-21', price: 12, title: 'T', description: 'D', external_url: null, note: null, ...over });
const sale = { channel_id: 'ebay', sold_on: '2026-09-21', gross: 10, fees: null, shipping: null, note: null };
const listing = (db, id) => db.prepare('SELECT * FROM listings WHERE listing_id = ?').get(id);
const liveItems = (db, id) => db.prepare('SELECT copy_id FROM listing_items WHERE listing_id = ? AND deleted = 0 ORDER BY copy_id').all(id).map((r) => r.copy_id);

test('Anlegen: Momentaufnahme mit deutschem Namen, for_sale = 1, Kanalname eingefroren', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [b, a] })] }, NAMES);
  const l = listing(db, id);
  assert.deepEqual([l.channel_id, l.channel_name, l.price, l.status, l.title], ['ebay', 'eBay', 12, 'aktiv', 'T']);
  const items = db.prepare('SELECT * FROM listing_items WHERE listing_id = ? ORDER BY copy_id').all(id);
  assert.deepEqual(items.map((i) => [i.copy_id, i.name, i.image_url, i.edition]), [[a, 'Dunkler Magier', 'https://img/1.jpg', 'first'], [b, 'Dunkler Magier', 'https://img/1.jpg', 'first']]);
  assert.deepEqual(db.prepare('SELECT for_sale FROM card_copies ORDER BY copy_id').all().map((r) => r.for_sale), [1, 1]);
});

test('Prüfungen §5.7: nichts halb angelegt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [b] = addCard(db, '2', 1, 1);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [] })] }), /Mindestens eine Karte/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], price: 0 })] }), /über 0 €/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], price: 0.004 })] }), /über 0 €/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], listed_on: '21.09.2026' })] }), /Datum/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], external_url: 'ftp://x' })] }), /Link/);
  const own = S.saveChannel(db, { name: 'Flohmarkt', fee_percent: 0 });
  S.hideChannel(db, own);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], channel_id: own })] }), /Kanal/);
  S.bookSale(db, { ...sale, copyIds: [b] });
  // Zwei Angebote in einem Aufruf, das zweite scheitert: auch das erste entsteht nicht.
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a] }), base({ copyIds: [b] })] }), /bereits verkauft/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 0);
  assert.equal(db.prepare('SELECT for_sale FROM card_copies WHERE copy_id = ?').get(a).for_sale, 0);
});

test('Cardmarket: genau eine Gruppe, Aufteilung als mehrere Angebote in einem Aufruf, ohne Titel/Text', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [e] = addCard(db, '1', 3, 1, { condition: 'EX', tag: 'x' });
  assert.throws(() => L.createListings(db, { listings: [base({ channel_id: 'cardmarket', copyIds: [a, e] })] }), /nur gleiche Karten/);
  const ids = L.createListings(db, { listings: [base({ channel_id: 'cardmarket', copyIds: [a] }), base({ channel_id: 'cardmarket', copyIds: [e], price: 2.5 })] });
  assert.equal(ids.length, 2);
  assert.deepEqual([listing(db, ids[0]).title, listing(db, ids[0]).description, listing(db, ids[1]).price], [null, null, 2.5]);
});

test('Vorschau: Namen, cm_url, Marktwert, "auch auf", fehlende Exemplare', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2, { cmUrl: 'https://www.cardmarket.com/x' });
  L.createListings(db, { listings: [base({ copyIds: [a] })] });
  S.bookSale(db, { ...sale, copyIds: [b] });
  const pv = L.previewListing(db, [b, a], NAMES);
  assert.deepEqual(pv.missing, [b]);
  assert.deepEqual(pv.items.map((i) => [i.copy_id, i.name, i.name_en, i.cm_url, i.valueCents, i.alsoOn]),
    [[a, 'Dunkler Magier', 'Dark Magician', 'https://www.cardmarket.com/x', 300, ['eBay']]]);
  assert.deepEqual(pv.rule, { discount: 5, minCents: 10 });
});

test('Verkauft ganz: Status verkauft, sale_id gesetzt, Positionen bleiben', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a, b] })] });
  const r = S.bookSaleDetailed(db, { ...sale, gross: 12, copyIds: [a, b], listing_id: id });
  assert.deepEqual([listing(db, id).status, listing(db, id).sale_id], ['verkauft', r.saleId]);
  assert.deepEqual(liveItems(db, id), [a, b]);
  assert.deepEqual([r.reminders, r.askAdjust, r.listingSkipped], [[], false, false]);
});

test('Teilverkauf Cardmarket: Stückpreis x Rest; anderer Kanal: Preis bleibt, Hinweis', () => {
  const db = freshDb();
  const cm3 = addCard(db, '1', 3, 3);
  const [cm] = L.createListings(db, { listings: [base({ channel_id: 'cardmarket', copyIds: cm3, price: 10 })] });
  const r1 = S.bookSaleDetailed(db, { ...sale, gross: 3.33, copyIds: [cm3[0]], listing_id: cm });
  assert.deepEqual([listing(db, cm).status, listing(db, cm).price, listing(db, cm).sale_id, r1.askAdjust], ['aktiv', 6.66, null, false]);
  assert.deepEqual(liveItems(db, cm), [cm3[1], cm3[2]]);
  const eb = addCard(db, '2', 1, 2);
  const [e] = L.createListings(db, { listings: [base({ copyIds: eb })] });
  const r2 = S.bookSaleDetailed(db, { ...sale, copyIds: [eb[1]], listing_id: e });
  assert.deepEqual([listing(db, e).status, listing(db, e).price, r2.askAdjust], ['aktiv', 12, true]);
  assert.deepEqual(liveItems(db, e), [eb[0]]);
});

test('Aufräumen in derselben Transaktion -- auch bei Buchung ohne Angebot', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [e] = L.createListings(db, { listings: [base({ copyIds: [a, b], external_url: 'https://www.ebay.de/itm/1' })] });
  const [k] = L.createListings(db, { listings: [base({ channel_id: 'kleinanzeigen', copyIds: [a], title: 'Magier' })] });
  const r = S.bookSaleDetailed(db, { ...sale, copyIds: [a] });
  assert.deepEqual(liveItems(db, e), [b]);
  assert.deepEqual([listing(db, e).status, listing(db, k).status], ['aktiv', 'beendet']);
  assert.deepEqual(r.reminders.map((x) => [x.channel_name, x.title, x.external_url]).sort(),
    [['Kleinanzeigen', 'Magier', null], ['eBay', 'T', 'https://www.ebay.de/itm/1']]);
  // Scheitert die Buchung, bleibt auch das Aufraeumen aus (eine Transaktion).
  const [c] = addCard(db, '2', 1, 1);
  L.createListings(db, { listings: [base({ copyIds: [c] })] });
  assert.throws(() => S.bookSaleDetailed(db, { ...sale, copyIds: [c, a] }), /bereits verkauft/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM listing_items WHERE copy_id = ? AND deleted = 0").get(c).n, 1);
});

test('Angebot inzwischen beendet: Verkauf gilt, nur aufgeräumt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a] })] });
  L.endListing(db, id);
  const r = S.bookSaleDetailed(db, { ...sale, copyIds: [a], listing_id: id });
  assert.equal(r.listingSkipped, true);
  assert.equal(listing(db, id).status, 'beendet');
  assert.equal(db.prepare('SELECT deleted FROM card_copies WHERE copy_id = ?').get(a).deleted, 1);
});

test('Beenden: Positionen und for_sale bleiben, danach nicht mehr bearbeitbar', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a] })] });
  L.endListing(db, id);
  assert.equal(listing(db, id).status, 'beendet');
  assert.deepEqual(liveItems(db, id), [a]);
  assert.equal(db.prepare('SELECT for_sale FROM card_copies WHERE copy_id = ?').get(a).for_sale, 1);
  assert.throws(() => L.updateListing(db, { listing_id: id, price: 5 }), /Nur aktive/);
});

test('Bearbeiten: Preis/Link, Position herausnehmen, letzte Position -> beendet', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a, b] })] });
  assert.deepEqual(L.updateListing(db, { listing_id: id, price: '9.5', title: 'Neu', description: '', external_url: 'https://x', note: ' ', removeCopyIds: [a] }), { ended: false });
  const l = listing(db, id);
  assert.deepEqual([l.price, l.title, l.description, l.external_url, l.note], [9.5, 'Neu', null, 'https://x', null]);
  assert.throws(() => L.updateListing(db, { listing_id: id, price: 0 }), /über 0 €/);
  assert.deepEqual(L.removeListingItems(db, id, [b]), { ended: true });
  assert.equal(listing(db, id).status, 'beendet');
});

test('Karte fehlt, Storno-Marke, Erneut anbieten, Übersicht', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [k] = L.createListings(db, { listings: [base({ channel_id: 'kleinanzeigen', copyIds: [a], title: 'K' })] });
  const [e] = L.createListings(db, { listings: [base({ copyIds: [b], price: 2 })] });
  copies.deleteCopy(db, { copy_id: a }); // anderes Geraet hat geloescht
  const r = S.bookSaleDetailed(db, { ...sale, copyIds: [b], listing_id: e });
  S.cancelSale(db, r.saleId);
  const ov = L.listingsOverview(db, { today: '2026-09-23' });
  const row = (id) => ov.listings.find((x) => x.listing_id === id);
  assert.equal(row(k).marks.missing, true);
  assert.equal(row(e).marks.saleCancelled, true);
  assert.deepEqual([row(e).status, row(k).days, row(k).rowTitle, row(k).cards], ['verkauft', 2, 'K', 1]);
  assert.deepEqual(L.relistPrefill(db, e), { channel_id: 'ebay', title: 'T', description: 'D', priceCents: 200, copyIds: [b] });
  assert.deepEqual(L.relistPrefill(db, k).copyIds, []);
  assert.deepEqual(L.listingOffers(db), { [a]: [{ listing_id: k, channel_id: 'kleinanzeigen', channel_name: 'Kleinanzeigen', priceCents: 1200 }] });
  const d = L.listingDetail(db, k, { today: '2026-09-23' });
  assert.deepEqual(d.items.map((i) => [i.copy_id, i.copyLive, i.marketCents]), [[a, false, null]]);
  assert.deepEqual(L.removeListingItems(db, k, [a]), { ended: true });
});

test('Ohne Angebots-Tabellen bucht bookSale wie bisher', () => {
  const db = freshDb({ listings: false });
  const [a] = addCard(db, '1', 3, 1);
  assert.equal(typeof S.bookSale(db, { ...sale, copyIds: [a] }), 'string');
  assert.deepEqual(L.listingOffers(db), {});
});
