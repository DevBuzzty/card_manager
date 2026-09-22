// desktop/electron/listing-text.cjs
// Spec H3a §5.3–§7.2 -- Texte und Regeln fuer Angebote. MASSGEBLICH am PC (listings.cjs).
// ZWILLINGE: desktop/src/utils/listingText.js (wortgleich, ESM) und
// android/app/src/main/java/com/example/yugiohscanner/ml/ListingText.kt. Gemeinsame Fixture: docs/fixtures/listings/listings.json.
// Wer eine Fassung aendert, aendert alle drei. Laengen in UTF-16-Codeeinheiten (JS .length = Kotlin .length); alle
// Texte bleiben in der BMP. Vergleiche per Codeeinheiten (kein localeCompare/Collator -- Geraetegleichheit).
const { toCents, euroCentsText } = require('./sales-math.cjs');

const TITLE_MAX = 65;
const LANGUAGE_NAMES = { DE: 'Deutsch', EN: 'Englisch', FR: 'Französisch', IT: 'Italienisch', SP: 'Spanisch', PT: 'Portugiesisch', JP: 'Japanisch' };
const TITLE_EDITION = { first: '1. Auflage', limited: 'Limitiert' };
// Wie export-formats.cjs#SALE_EDITION (F1-Verkaufsliste).
const LINE_EDITION = { first: '1. Auflage', unlimited: 'Unlimitiert', limited: 'Limitiert' };
const EDITION_ORDER = ['first', 'unlimited', 'limited', 'unknown'];
const CONDITION_ORDER = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const FIXED_SHORT = { cardmarket: 'CM', ebay: 'EB', kleinanzeigen: 'KA', tausch: 'TA', privat: 'PR' };
const LINKS = { kleinanzeigen: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben.html', ebay: 'https://www.ebay.de/sl/sell' };
const CM_SEARCH = 'https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString=';
const DISCLAIMER = 'Privatverkauf, keine Garantie oder Rücknahme.';

const known = (v) => v != null && v !== '' && v !== 'Unknown';
const nameOf = (g) => (g.name != null && g.name !== '' ? g.name : String(g.card_id));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const foldName = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const isActive = (l) => l.status === 'aktiv' && !l.deleted;

function groupItems(items) {
  const m = new Map();
  for (const it of items || []) {
    const k = [String(it.card_id), it.set_code, it.language, it.rarity, it.edition, it.condition].join('|');
    const g = m.get(k);
    if (g) { g.count += 1; g.copy_ids.push(it.copy_id); continue; }
    m.set(k, { card_id: String(it.card_id), name: it.name ?? null, name_en: it.name_en ?? null, set_code: it.set_code,
      language: it.language, rarity: it.rarity, edition: it.edition, condition: it.condition, image_url: it.image_url ?? null,
      count: 1, copy_ids: [it.copy_id] });
  }
  const out = [...m.values()];
  for (const g of out) g.copy_ids.sort(cmp);
  return out.sort((a, b) => cmp(foldName(nameOf(a)), foldName(nameOf(b))) || cmp(a.set_code, b.set_code)
    || cmp(a.rarity, b.rarity) || cmp(a.language, b.language)
    || EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition)
    || CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition) || cmp(a.card_id, b.card_id));
}

function truncateTitle(text, ellipsis) {
  if (text.length <= TITLE_MAX) return text;
  const room = ellipsis ? TITLE_MAX - 1 : TITLE_MAX;
  const cut = text.lastIndexOf(' ', room);
  const head = (cut > 0 ? text.slice(0, cut) : text.slice(0, room)).replace(/[ ,–]+$/, '');
  return ellipsis ? `${head}…` : head;
}

function titleParts(g) {
  return ['Yu-Gi-Oh!', nameOf(g), known(g.set_code) ? g.set_code : null, known(g.rarity) ? g.rarity : null,
    TITLE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null, LANGUAGE_NAMES[g.language] ?? null]
    .filter((p) => p != null).join(' ');
}

function listingTitle(items) {
  const groups = groupItems(items);
  if (groups.length === 0) return '';
  if (groups.length === 1) {
    const g = groups[0];
    return truncateTitle(g.count > 1 ? `${g.count}× ${titleParts(g)}` : titleParts(g), false);
  }
  const n = groups.reduce((a, g) => a + g.count, 0);
  const names = [];
  for (const g of groups) if (!names.includes(nameOf(g))) names.push(nameOf(g));
  return truncateTitle(`Yu-Gi-Oh! Konvolut ${n} Karten – ${names.join(', ')}`, true);
}

function listingDescription(items, priceCents) {
  const lines = groupItems(items).map((g) => [`${g.count}× ${nameOf(g)}`, known(g.set_code) ? g.set_code : null,
    known(g.rarity) ? g.rarity : null, LINE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null]
    .filter((p) => p != null).join(' – '));
  return [...lines, '', `Preis: ${priceCents == null ? '–' : euroCentsText(priceCents)}`, '', DISCLAIMER].join('\n');
}

function cardmarketProduct(g) {
  return [nameOf(g), known(g.set_code) ? g.set_code : null].filter((p) => p != null).join(' ');
}
function pieceCents(totalCents, quantity) {
  return Math.round(totalCents / quantity);
}
function cardmarketEntry(g, priceCents) {
  return { product: cardmarketProduct(g), quantity: g.count, language: LANGUAGE_NAMES[g.language] ?? g.language,
    condition: g.condition, firstEdition: g.edition === 'first', pieceCents: priceCents == null ? null : pieceCents(priceCents, g.count) };
}

function afterListingSale(listing, liveCopyIds, soldCopyIds) {
  const live = [...new Set(liveCopyIds)];
  const sold = new Set(soldCopyIds);
  const hit = live.filter((id) => sold.has(id)).sort(cmp);
  const price = toCents(listing.price);
  if (hit.length === 0) return { status: listing.status, removeCopyIds: [], priceCents: price, askAdjust: false };
  if (hit.length === live.length) return { status: 'verkauft', removeCopyIds: [], priceCents: price, askAdjust: false };
  if (listing.channel_id === 'cardmarket') {
    // Nie 0 € (Spec §5.5): ein Stueckpreis, der auf 0 Cent faellt, ergaebe ein ungueltiges Angebot.
    const rest = Math.max(1, pieceCents(price, live.length) * (live.length - hit.length));
    return { status: 'aktiv', removeCopyIds: hit, priceCents: rest, askAdjust: false };
  }
  return { status: 'aktiv', removeCopyIds: hit, priceCents: price, askAdjust: true };
}

function listingLink(channelId, { cmUrl = null, nameEn = null, setCode = null } = {}) {
  if (channelId === 'cardmarket') {
    if (cmUrl != null && cmUrl !== '') return cmUrl;
    const q = [nameEn != null && nameEn !== '' ? nameEn : null, known(setCode) ? setCode : null].filter((p) => p != null).join(' ');
    return CM_SEARCH + encodeURIComponent(q);
  }
  return LINKS[channelId] ?? null;
}

function channelShort(channelId, name) {
  if (FIXED_SHORT[channelId]) return FIXED_SHORT[channelId];
  return String(name ?? '').trim().slice(0, 2).toUpperCase() || '??';
}

function rowTitle(listing, liveItems) {
  if (listing.channel_id === 'cardmarket') {
    const groups = groupItems(liveItems);
    if (groups.length === 0) return '(ohne Karten)';
    return `${groups.reduce((a, g) => a + g.count, 0)}× ${cardmarketProduct(groups[0])}`;
  }
  return listing.title != null && listing.title.trim() !== '' ? listing.title : '(ohne Titel)';
}

function sortListings(listings) {
  return [...listings].sort((a, b) => cmp(b.listed_on, a.listed_on) || cmp(b.created_at ?? '', a.created_at ?? '')
    || cmp(a.listing_id, b.listing_id));
}

function listingMarks(listings, items, copyLive, saleStatusOf, suggestionOf) {
  const active = new Map(listings.filter(isActive).map((l) => [l.listing_id, l]));
  const liveItems = (items || []).filter((it) => !it.deleted);
  const byCopy = new Map();
  for (const it of liveItems) {
    if (!active.has(it.listing_id)) continue;
    if (!byCopy.has(it.copy_id)) byCopy.set(it.copy_id, []);
    byCopy.get(it.copy_id).push(it.listing_id);
  }
  const out = {};
  for (const l of listings) {
    const act = isActive(l);
    const also = new Set();
    let missing = false;
    let sugg = 0;
    if (act) {
      for (const it of liveItems) {
        if (it.listing_id !== l.listing_id) continue;
        for (const other of byCopy.get(it.copy_id) || []) if (other !== l.listing_id) also.add(active.get(other).channel_name);
        if (copyLive(it.copy_id)) sugg += suggestionOf(it.copy_id) ?? 0;
        else missing = true;
      }
    }
    out[l.listing_id] = {
      alsoOn: [...also].sort(cmp),
      missing,
      underSuggestion: act && sugg > 0 && sugg * 100 >= toCents(l.price) * 120,
      saleCancelled: l.status === 'verkauft' && l.sale_id != null && saleStatusOf(l.sale_id) === 'storniert',
    };
  }
  return out;
}

function activeByCopy(listings, items) {
  const active = new Map(listings.filter(isActive).map((l) => [l.listing_id, l]));
  const out = {};
  for (const it of items || []) {
    if (it.deleted || !active.has(it.listing_id)) continue;
    const l = active.get(it.listing_id);
    (out[it.copy_id] = out[it.copy_id] || []).push({ listing_id: l.listing_id, channel_id: l.channel_id, channel_name: l.channel_name,
      priceCents: toCents(l.price) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => cmp(a.channel_name, b.channel_name) || cmp(a.listing_id, b.listing_id));
  return out;
}
function offeredText(offers) {
  if (!offers || offers.length === 0) return null;
  return `angeboten auf ${offers.map((o) => `${o.channel_name} für ${euroCentsText(o.priceCents)}`).join(', ')}`;
}
function copyBadges(offers) {
  return [...new Set((offers || []).map((o) => channelShort(o.channel_id, o.channel_name)))].sort(cmp);
}

function cleanupAfterSale(listings, items, soldCopyIds, exceptListingId = null) {
  const sold = new Set(soldCopyIds);
  const removeItems = [];
  const endListings = [];
  const remind = [];
  const active = listings.filter((l) => isActive(l) && l.listing_id !== exceptListingId).sort((a, b) => cmp(a.listing_id, b.listing_id));
  for (const l of active) {
    const live = (items || []).filter((it) => it.listing_id === l.listing_id && !it.deleted);
    const hit = live.map((it) => it.copy_id).filter((id) => sold.has(id)).sort(cmp);
    if (hit.length === 0) continue;
    for (const id of hit) removeItems.push({ listing_id: l.listing_id, copy_id: id });
    if (hit.length === live.length) endListings.push(l.listing_id);
    remind.push({ listing_id: l.listing_id, channel_name: l.channel_name, title: rowTitle(l, live), external_url: l.external_url ?? null });
  }
  return { removeItems, endListings, remind };
}

function listingsSummary(listings, items) {
  const act = listings.filter(isActive);
  const ids = new Set(act.map((l) => l.listing_id));
  return {
    listings: act.length,
    cards: (items || []).filter((it) => !it.deleted && ids.has(it.listing_id)).length,
    priceCents: act.reduce((a, l) => a + toCents(l.price), 0),
  };
}
function summaryText(s) {
  return `${s.listings} ${s.listings === 1 ? 'Angebot' : 'Angebote'} · ${s.cards} ${s.cards === 1 ? 'Karte' : 'Karten'} · ${euroCentsText(s.priceCents)}`;
}
function startText(n) {
  return `Angebote: ${n} aktiv`;
}

function daysSince(listedOn, today) {
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.max(0, Math.round((utc(today) - utc(listedOn)) / 86400000));
}
function sinceText(days) {
  if (days <= 0) return 'seit heute';
  return days === 1 ? 'seit 1 Tag' : `seit ${days} Tagen`;
}

function suggestionSum(list) {
  let s = null;
  for (const v of list || []) if (v != null) s = (s ?? 0) + v;
  return s;
}

function imageUrls(items) {
  return [...new Set(groupItems(items).map((g) => g.image_url).filter((u) => u != null && u !== ''))];
}
function imagesText(saved, total) {
  if (total === 0) return 'Keine Bilder vorhanden.';
  if (saved === total) return `${total} ${total === 1 ? 'Bild' : 'Bilder'} gespeichert`;
  return `${saved} von ${total} Bildern gespeichert`;
}

module.exports = {
  TITLE_MAX, LANGUAGE_NAMES, groupItems, truncateTitle, listingTitle, listingDescription, cardmarketProduct, pieceCents,
  cardmarketEntry, afterListingSale, listingLink, channelShort, rowTitle, sortListings, listingMarks, activeByCopy,
  offeredText, copyBadges, cleanupAfterSale, listingsSummary, summaryText, startText, daysSince, sinceText,
  suggestionSum, imageUrls, imagesText,
};
