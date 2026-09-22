// desktop/electron/listings.cjs — Spec H3a §5–§8: Angebote anlegen, bearbeiten, Positionen herausnehmen, beenden,
// erneut anbieten, lesen, nach einem Verkauf aufraeumen. Regeln ausschliesslich aus listing-text.cjs (Zwilling).
// Jede Schreibaktion ist EINE Transaktion; applySaleToListings laeuft INNERHALB der bookSale-Transaktion (sales.cjs).
const crypto = require('crypto');
const M = require('./sales-math.cjs');
const T = require('./listing-text.cjs');
const copies = require('./copies.cjs');

class ListingError extends Error {}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const URL_OK = /^https?:\/\//i;
const blank = (v) => v == null || String(v).trim() === '';
const textOrNull = (v) => (blank(v) ? null : String(v).trim());

// H2-Test-Datenbanken (sales.test.cjs) und Datenbanken vor H3a haben keine Angebots-Tabellen: nichts aufzuraeumen.
function hasListings(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'listings'").get();
}

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
// Spec H2 §9: Preisvorschlag-Regel aus den Einstellungen (gleiche Normalisierung wie collection-export.cjs).
function suggestionRule(db) {
  return { discount: M.normalizeDiscount(getSetting(db, 'sale_discount_percent')), minCents: M.normalizeMinPrice(getSetting(db, 'sale_min_price')) };
}

// Lebende, unverkaufte Exemplare mit Kartendaten, ausgeschriebene Spalten wie sales.cjs#liveCopies, dazu cm_url.
const LIVE_COPY_SQL = `
  SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
         c.name AS card_name, c.image_url, c.price, c.price_first_ed, c.cm_url
    FROM card_copies cp
    LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
   WHERE cp.copy_id = ? AND cp.deleted = 0 AND cp.sold_in IS NULL`;

// Anzeigename = deutscher Katalogname, sonst cards.name (der englisch ist, main.cjs#withGermanNames). Englischer Name
// fuer die Cardmarket-Suche = Katalog name_en, sonst cards.name. namesOf(passcode) -> { de, en } | null.
function withNames(r, namesOf) {
  const n = namesOf(String(r.card_id)) || {};
  return { ...r, card_id: String(r.card_id), name: n.de || r.card_name || null, name_en: n.en || r.card_name || null };
}

function activeChannelsOf(db, copyId) {
  return db.prepare(`SELECT DISTINCT l.channel_name FROM listing_items li JOIN listings l ON l.listing_id = li.listing_id
     WHERE li.copy_id = ? AND li.deleted = 0 AND l.status = 'aktiv' AND l.deleted = 0 ORDER BY l.channel_name`).all(copyId)
    .map((r) => r.channel_name);
}

// Spec §5.2/§5.7 -- Vorschau fuer den Dialog: lebende, unverkaufte Exemplare (nach copy_id) mit Namen, Bild, cm_url,
// Marktwert (Cent) und "auch auf" (Kanaele aktiver Angebote); missing = die uebrigen copy_ids; rule = Vorschlagsregel.
function previewListing(db, copyIds, namesOf = () => null) {
  const q = db.prepare(LIVE_COPY_SQL);
  const items = [];
  const missing = [];
  for (const id of [...new Set(Array.isArray(copyIds) ? copyIds : [])].sort()) {
    const r = q.get(id);
    if (!r) { missing.push(id); continue; }
    const x = withNames(r, namesOf);
    items.push({ copy_id: x.copy_id, card_id: x.card_id, set_code: x.set_code, language: x.language, rarity: x.rarity,
      edition: x.edition, condition: x.condition, name: x.name, name_en: x.name_en, image_url: x.image_url ?? null,
      cm_url: x.cm_url ?? null, valueCents: M.marketValueCents(x, x), alsoOn: activeChannelsOf(db, id) });
  }
  return { items, missing, rule: suggestionRule(db) };
}

function checkFields(l) {
  if (!DATE.test(String(l.listed_on || ''))) throw new ListingError('Ungültiges Datum.');
  const cents = blank(l.price) ? null : M.toCents(l.price);
  if (cents == null || cents <= 0) throw new ListingError('Der Angebotspreis muss über 0 € liegen.');
  if (!blank(l.external_url) && !URL_OK.test(String(l.external_url).trim())) {
    throw new ListingError('Der Link muss mit http:// oder https:// beginnen.');
  }
  return cents;
}

function createOne(db, l, namesOf) {
  const copyIds = [...new Set(Array.isArray(l.copyIds) ? l.copyIds : [])].sort();
  if (copyIds.length === 0) throw new ListingError('Mindestens eine Karte auswählen.');
  const cents = checkFields(l);
  const ch = db.prepare('SELECT channel_id, name FROM sale_channels WHERE channel_id = ? AND deleted = 0').get(l.channel_id);
  if (!ch) throw new ListingError('Kanal nicht gefunden.');
  const q = db.prepare(LIVE_COPY_SQL);
  const rows = copyIds.map((id) => q.get(id));
  if (rows.some((r) => !r)) throw new ListingError('Karte bereits verkauft oder gelöscht.');
  const items = rows.map((r) => withNames(r, namesOf));
  const cm = ch.channel_id === 'cardmarket';
  if (cm && T.groupItems(items).length !== 1) {
    throw new ListingError('Ein Cardmarket-Angebot enthält nur gleiche Karten (Druck, Sprache, Zustand, Auflage).');
  }
  const listingId = crypto.randomUUID();
  db.prepare(`INSERT INTO listings (listing_id, channel_id, channel_name, title, description, price, listed_on, external_url, note)
    VALUES (@listing_id, @channel_id, @channel_name, @title, @description, @price, @listed_on, @external_url, @note)`).run({
    listing_id: listingId, channel_id: ch.channel_id, channel_name: ch.name,
    title: cm ? null : textOrNull(l.title), description: cm ? null : textOrNull(l.description),
    price: cents / 100, listed_on: l.listed_on, external_url: textOrNull(l.external_url), note: textOrNull(l.note),
  });
  const ins = db.prepare(`INSERT INTO listing_items (listing_id, copy_id, card_id, set_code, language, rarity, edition, condition, name, image_url)
    VALUES (@listing_id, @copy_id, @card_id, @set_code, @language, @rarity, @edition, @condition, @name, @image_url)`);
  for (const it of items) {
    ins.run({ listing_id: listingId, copy_id: it.copy_id, card_id: it.card_id, set_code: it.set_code, language: it.language,
      rarity: it.rarity, edition: it.edition, condition: it.condition, name: it.name, image_url: it.image_url ?? null });
  }
  copies.setForSale(db, { copyIds, value: true }); // Spec §5.2: Anlegen setzt for_sale = 1 (H1), idempotent
  return listingId;
}

// Spec §5.2/§5.4 -- ein oder mehrere Angebote (Cardmarket-Aufteilung) in EINER Transaktion: scheitert eines, entsteht keines.
function createListings(db, input = {}, namesOf = () => null) {
  const list = Array.isArray(input.listings) ? input.listings : [];
  if (list.length === 0) throw new ListingError('Mindestens eine Karte auswählen.');
  const ids = [];
  db.transaction(() => { for (const l of list) ids.push(createOne(db, l || {}, namesOf)); })();
  return ids;
}

function getListing(db, listingId) {
  const l = db.prepare('SELECT * FROM listings WHERE listing_id = ? AND deleted = 0').get(listingId);
  if (!l) throw new ListingError('Angebot nicht gefunden.');
  return l;
}
function activeListing(db, listingId) {
  const l = getListing(db, listingId);
  if (l.status !== 'aktiv') throw new ListingError('Nur aktive Angebote lassen sich ändern.');
  return l;
}

// Positionen herausnehmen; bleibt keine lebende Position, endet das Angebot (Spec §8). -> true, wenn es endete.
function removeItemsIn(db, listingId, copyIds) {
  const upd = db.prepare('UPDATE listing_items SET deleted = 1 WHERE listing_id = ? AND copy_id = ? AND deleted = 0');
  for (const id of new Set(Array.isArray(copyIds) ? copyIds : [])) upd.run(listingId, id);
  const left = db.prepare('SELECT COUNT(*) AS n FROM listing_items WHERE listing_id = ? AND deleted = 0').get(listingId).n;
  if (left > 0) return false;
  db.prepare("UPDATE listings SET status = 'beendet' WHERE listing_id = ? AND status = 'aktiv'").run(listingId);
  return true;
}

// Spec §6 Bearbeiten: Preis, Titel, Text, Link, Notiz; Positionen herausnehmen; keine Karten hinzufuegen.
function updateListing(db, input = {}) {
  let ended = false;
  db.transaction(() => {
    const l = activeListing(db, input.listing_id);
    const cents = checkFields({ ...input, listed_on: l.listed_on });
    const cm = l.channel_id === 'cardmarket';
    db.prepare(`UPDATE listings SET price = @price, title = @title, description = @description, external_url = @external_url,
      note = @note WHERE listing_id = @listing_id`).run({
      listing_id: l.listing_id, price: cents / 100, title: cm ? null : textOrNull(input.title),
      description: cm ? null : textOrNull(input.description), external_url: textOrNull(input.external_url), note: textOrNull(input.note),
    });
    ended = removeItemsIn(db, l.listing_id, input.removeCopyIds);
  })();
  return { ended };
}

// Spec §8 "Karte fehlt": Antippen nimmt die Position heraus, leeres Angebot -> beendet.
function removeListingItems(db, listingId, copyIds) {
  let ended = false;
  db.transaction(() => { activeListing(db, listingId); ended = removeItemsIn(db, listingId, copyIds); })();
  return { ended };
}

// Spec §7.3: status = beendet; Positionen und for_sale bleiben. Schon beendet/verkauft: nichts zu tun.
function endListing(db, listingId) {
  db.transaction(() => {
    getListing(db, listingId);
    db.prepare("UPDATE listings SET status = 'beendet' WHERE listing_id = ? AND status = 'aktiv'").run(listingId);
  })();
}

// Spec §7.4: Vorbelegung fuer ein neues Angebot -- Kanal, Titel, Beschreibung, Preis und die noch lebenden,
// unverkauften Exemplare der lebenden Positionen des alten.
function relistPrefill(db, listingId) {
  const l = getListing(db, listingId);
  const copyIds = db.prepare(`SELECT li.copy_id FROM listing_items li JOIN card_copies cp ON cp.copy_id = li.copy_id
     WHERE li.listing_id = ? AND li.deleted = 0 AND cp.deleted = 0 AND cp.sold_in IS NULL ORDER BY li.copy_id`).all(listingId)
    .map((r) => r.copy_id);
  return { channel_id: l.channel_id, title: l.title, description: l.description, priceCents: M.toCents(l.price), copyIds };
}

// Spec §7.1/§7.2 -- INNERHALB der bookSale-Transaktion: das Angebot, aus dem verkauft wurde (listingId), wird verkauft
// oder teilweise verkauft; danach werden die verkauften Exemplare aus allen ANDEREN aktiven Angeboten genommen.
// Ist das Angebot nicht mehr aktiv (anderes Geraet), bleibt der Verkauf gueltig und es wird nur aufgeraeumt
// (listingSkipped) -- wie am Handy, wo book_sale vor dem Angebot geschrieben wird.
function applySaleToListings(db, saleId, soldCopyIds, listingId = null) {
  const out = { reminders: [], askAdjust: false, listingSkipped: false };
  if (!hasListings(db)) return out;
  if (listingId) {
    const l = db.prepare('SELECT * FROM listings WHERE listing_id = ? AND deleted = 0').get(listingId);
    if (!l || l.status !== 'aktiv') {
      out.listingSkipped = true;
    } else {
      // Abschluss-Fix I2: nur Positionen, deren Exemplar vor diesem Verkauf lebte -- tote Positionen sind kein Rest.
      const live = db.prepare(`SELECT li.copy_id FROM listing_items li JOIN card_copies cp ON cp.copy_id = li.copy_id
         WHERE li.listing_id = ? AND li.deleted = 0
           AND ((cp.deleted = 0 AND cp.sold_in IS NULL) OR li.copy_id IN (SELECT value FROM json_each(?)))
         ORDER BY li.copy_id`).all(listingId, JSON.stringify(soldCopyIds)).map((r) => r.copy_id);
      const r = T.afterListingSale(l, live, soldCopyIds);
      if (r.status === 'verkauft') {
        db.prepare("UPDATE listings SET status = 'verkauft', sale_id = ? WHERE listing_id = ?").run(saleId, listingId);
      } else {
        const del = db.prepare('UPDATE listing_items SET deleted = 1 WHERE listing_id = ? AND copy_id = ?');
        for (const id of r.removeCopyIds) del.run(listingId, id);
        if (r.priceCents !== M.toCents(l.price)) db.prepare('UPDATE listings SET price = ? WHERE listing_id = ?').run(r.priceCents / 100, listingId);
      }
      out.askAdjust = r.askAdjust;
    }
  }
  const listings = db.prepare('SELECT * FROM listings WHERE deleted = 0').all();
  const items = db.prepare('SELECT * FROM listing_items WHERE deleted = 0').all();
  const c = T.cleanupAfterSale(listings, items, soldCopyIds, out.listingSkipped ? null : listingId);
  const del = db.prepare('UPDATE listing_items SET deleted = 1 WHERE listing_id = ? AND copy_id = ?');
  for (const it of c.removeItems) del.run(it.listing_id, it.copy_id);
  const end = db.prepare("UPDATE listings SET status = 'beendet' WHERE listing_id = ? AND status = 'aktiv'");
  for (const id of c.endListings) end.run(id);
  out.reminders = c.remind;
  return out;
}

// Spec §6 -- Uebersicht: alle nicht geloeschten Angebote in Anzeige-Reihenfolge mit Zeilentitel, Kartenzahl, heutigem
// Marktwert (lebende Positionen mit lebendem Exemplar, aktueller Zustand/Auflage des Exemplars), Tagen und Marken;
// items (lebende Positionen) fuer den Kopf, byCopy fuer die Kanal-Kuerzel.
function listingsOverview(db, { today } = {}) {
  const listings = T.sortListings(db.prepare('SELECT * FROM listings WHERE deleted = 0').all());
  const items = db.prepare('SELECT * FROM listing_items WHERE deleted = 0 ORDER BY listing_id, copy_id').all();
  const copyRows = new Map(db.prepare(`
    SELECT cp.copy_id, cp.edition, cp.condition, c.price, c.price_first_ed FROM card_copies cp
      LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.deleted = 0 AND cp.sold_in IS NULL
       AND cp.copy_id IN (SELECT copy_id FROM listing_items WHERE deleted = 0)`).all().map((r) => [r.copy_id, r]));
  const saleStatus = new Map(db.prepare('SELECT sale_id, status FROM sales WHERE deleted = 0').all().map((s) => [s.sale_id, s.status]));
  const rule = suggestionRule(db);
  const valueOf = (id) => { const r = copyRows.get(id); return r ? M.marketValueCents(r, r) : null; };
  const suggestionOf = (id) => { const v = valueOf(id); return v == null ? null : M.suggestionCents(v, rule.discount, rule.minCents); };
  const marks = T.listingMarks(listings, items, (id) => copyRows.has(id), (sid) => saleStatus.get(sid) ?? null, suggestionOf);
  const rows = listings.map((l) => {
    const live = items.filter((it) => it.listing_id === l.listing_id);
    return { ...l, cards: live.length, rowTitle: T.rowTitle(l, live), marketCents: live.reduce((a, it) => a + (valueOf(it.copy_id) ?? 0), 0),
      days: today ? T.daysSince(l.listed_on, today) : 0, marks: marks[l.listing_id] };
  });
  return { listings: rows, items: items.map(({ listing_id, copy_id }) => ({ listing_id, copy_id })), byCopy: T.activeByCopy(listings, items) };
}

// Detail: Zeile wie in der Uebersicht plus lebende Positionen mit Bild, Druck, heutigem Marktwert und copyLive.
function listingDetail(db, listingId, { today } = {}) {
  getListing(db, listingId);
  const listing = listingsOverview(db, { today }).listings.find((l) => l.listing_id === listingId);
  const items = db.prepare(`
    SELECT li.*, (cp.copy_id IS NOT NULL) AS copy_live, cp.edition AS copy_edition, cp.condition AS copy_condition,
           c.price, c.price_first_ed
      FROM listing_items li
      LEFT JOIN card_copies cp ON cp.copy_id = li.copy_id AND cp.deleted = 0 AND cp.sold_in IS NULL
      LEFT JOIN cards c ON c.id = li.card_id AND c.set_code = li.set_code AND c.language = li.language AND c.rarity = li.rarity
     WHERE li.listing_id = ? AND li.deleted = 0 ORDER BY li.copy_id`).all(listingId).map((it) => {
    const { copy_live, copy_edition, copy_condition, price, price_first_ed, ...rest } = it;
    const copyLive = !!copy_live;
    return { ...rest, copyLive,
      marketCents: copyLive ? M.marketValueCents({ price, price_first_ed }, { edition: copy_edition, condition: copy_condition }) : null };
  });
  return { listing, items };
}

// Kanal-Kuerzel/"angeboten auf" je Exemplar (Verkaufsliste, Kartenansicht).
function listingOffers(db) {
  if (!hasListings(db)) return {};
  return T.activeByCopy(db.prepare('SELECT * FROM listings WHERE deleted = 0').all(),
    db.prepare('SELECT * FROM listing_items WHERE deleted = 0').all());
}

module.exports = {
  ListingError, hasListings, previewListing, createListings, updateListing, removeListingItems, endListing, relistPrefill,
  applySaleToListings, listingsOverview, listingDetail, listingOffers,
};
