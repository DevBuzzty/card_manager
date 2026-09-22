const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('./listing-text.cjs');

// ZWILLING: desktop/src/utils/listingText.test.js und android ListingTextTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/fixtures/listings/listings.json'), 'utf8'));
const pick = (ids) => ids.map((id) => FIX.items[id]);
const B = FIX.board;
const boardItems = B.items.map((it) => ({ ...B.base, ...it }));
const live = new Set(B.copyLive);
const liveOf = (id) => boardItems.filter((it) => it.listing_id === id && !it.deleted);

test('Titel', () => {
  for (const c of FIX.titles) {
    const t = T.listingTitle(pick(c.items));
    assert.equal(t, c.title, c.name);
    assert.equal(t.length, c.length, `${c.name}: Länge`);
    assert.ok(t.length <= T.TITLE_MAX, `${c.name}: höchstens 65`);
  }
});
test('Beschreibung', () => {
  for (const c of FIX.descriptions) assert.equal(T.listingDescription(pick(c.items), c.priceCents), c.text, c.name);
});
test('Cardmarket-Aufteilung', () => {
  for (const c of FIX.cardmarketGroups) {
    const got = T.groupItems(pick(c.items)).map((g) => ({ product: T.cardmarketProduct(g), condition: g.condition, count: g.count, copy_ids: g.copy_ids }));
    assert.deepEqual(got, c.groups, c.name);
  }
});
test('Cardmarket-Eintragwerte', () => {
  for (const c of FIX.cardmarketEntries) {
    const groups = T.groupItems(pick(c.items));
    assert.equal(groups.length, 1);
    assert.deepEqual(T.cardmarketEntry(groups[0], c.priceCents), c.entry);
  }
});
test('Stückpreis', () => {
  for (const c of FIX.pieceCents) assert.equal(T.pieceCents(c.total, c.quantity), c.cents, JSON.stringify(c));
});
test('Verkauf aus einem Angebot (ganz/teilweise)', () => {
  for (const c of FIX.afterSale) assert.deepEqual(T.afterListingSale(c.listing, c.live, c.sold), c.result, c.name);
});
test('Links je Kanal', () => {
  for (const c of FIX.links) assert.equal(T.listingLink(c.channel_id, { cmUrl: c.cmUrl, nameEn: c.nameEn, setCode: c.setCode }), c.url, c.channel_id);
});
test('Kanal-Kürzel und Marken der Verkaufsliste', () => {
  for (const c of FIX.shorts) assert.equal(T.channelShort(c.channel_id, c.name), c.short, c.channel_id);
  for (const c of FIX.badges) assert.deepEqual(T.copyBadges(c.offers), c.badges);
});
test('Bilder', () => {
  for (const c of FIX.imageUrls) assert.deepEqual(T.imageUrls(pick(c.items)), c.urls);
  for (const c of FIX.imagesText) assert.equal(T.imagesText(c.saved, c.total), c.text);
});
test('seit N Tagen', () => {
  for (const c of FIX.since) {
    assert.equal(T.daysSince(c.listed_on, c.today), c.days, JSON.stringify(c));
    assert.equal(T.sinceText(c.days), c.text);
  }
});
test('Vorschlags-Summe', () => {
  for (const c of FIX.suggestionSum) assert.equal(T.suggestionSum(c.values), c.sum, JSON.stringify(c.values));
});
test('Texte: Kopf und Start', () => {
  for (const c of FIX.summaryTexts) assert.equal(T.summaryText(c), c.text);
  for (const c of FIX.startTexts) assert.equal(T.startText(c.n), c.text);
});
test('Zeilentitel', () => {
  for (const c of FIX.rowTitleCases) assert.equal(T.rowTitle(c.listing, pick(c.items)), c.title);
  for (const [id, title] of Object.entries(B.rowTitles)) assert.equal(T.rowTitle(B.listings.find((l) => l.listing_id === id), liveOf(id)), title, id);
});
test('Marken: auch auf, Karte fehlt, Preis unter Vorschlag (120 %), Verkauf storniert', () => {
  const m = T.listingMarks(B.listings, boardItems, (id) => live.has(id), (s) => B.saleStatus[s] ?? null, (id) => B.suggestions[id] ?? null);
  assert.deepEqual(m, B.marks);
});
test('Sortierung und Kopf', () => {
  assert.deepEqual(T.sortListings(B.listings).map((l) => l.listing_id), B.order);
  const s = T.listingsSummary(B.listings, boardItems);
  assert.deepEqual(s, B.summary);
  assert.equal(T.summaryText(s), B.summaryText);
});
test('Angebote je Exemplar', () => {
  const by = T.activeByCopy(B.listings, boardItems);
  assert.deepEqual(by, B.byCopy);
  for (const [id, text] of Object.entries(B.offeredText)) assert.equal(T.offeredText(by[id] || []), text, id);
});
test('Aufräumen nach dem Verkauf', () => {
  for (const c of B.cleanup) assert.deepEqual(T.cleanupAfterSale(B.listings, boardItems, c.sold, c.except), c.result, c.name);
});
