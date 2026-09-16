// desktop/electron/catalog-build.cjs
// Reine Katalogbau-Funktionen: Merge der YGOPRODeck-Dumps (EN + DE), Anhang der vom Desktop
// bestätigten Set-Codes, gzip-Packen. Kein Netz, keine DB, kein Supabase — alles Testbare hier.
const zlib = require('node:zlib');
const { trendById } = require('./sealed-prices.cjs');

// Spec E1 §5 — Cardmarket-Preis je Passcode aus card_prices[0].cardmarket_price. YGOPRODeck liefert ihn als
// Zeichenkette ("4.50"); > 0 wird Zahl, alles andere (fehlt, "0.00", unlesbar) null. Ab Katalog Version 6.
function cmPriceOf(c) {
  const raw = Array.isArray(c.card_prices) && c.card_prices[0] ? c.card_prices[0].cardmarket_price : null;
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Spec E3 §3 — Banlist-Stufe aus banlist_info.ban_tcg/ban_ocg. YGOPRODeck schreibt "Forbidden" (im Dump vom
// 2026-09-16 gemessen: 117x TCG, 91x OCG; nie "Banned"); "Banned" steht in der Spec und wird ebenso verstanden.
// Fehlt banlist_info oder der Schluessel, oder ist der Wert unbekannt -> null = uneingeschraenkt.
const BAN_LEVELS = { Forbidden: 'forbidden', Banned: 'forbidden', Limited: 'limited', 'Semi-Limited': 'semi' };
function banOf(c, key) {
  const raw = c && c.banlist_info ? c.banlist_info[key] : null;
  return raw != null && Object.hasOwn(BAN_LEVELS, raw) ? BAN_LEVELS[raw] : null;
}

// Die Kartenliste des englischen Dumps ist das Gerüst (vollständige Printings, Stats, Bilder);
// aus dem deutschen Dump kommen nur Name und Text, mit Rückfall auf Englisch.
function mergeCards(enCards, deCards) {
  const de = new Map();
  for (const c of deCards || []) if (c && c.id != null) de.set(String(c.id), c);

  const out = [];
  for (const c of enCards || []) {
    if (!c || c.id == null) continue;
    const img = Array.isArray(c.card_images) ? c.card_images[0] : null;
    if (!img || !img.image_url) continue;              // ohne Bild ist die Karte im Scan wertlos
    const d = de.get(String(c.id));
    out.push({
      id: Number(c.id),
      name_de: (d && d.name) || c.name || '',
      name_en: c.name || '',
      type: c.type || '',
      desc_de: (d && d.desc) || c.desc || '',
      atk: c.atk ?? null,
      def: c.def ?? null,
      // Link-Monster: die Link-Zahl steht in `linkval`. Die Fallunterscheidung geht über den TYP,
      // nicht über null — YGOPRODeck liefert für 108 der 473 Link-Monster `level: 0` neben einem
      // echten `linkval`, und ein `??` würde die 0 stehen lassen. Gleiche Semantik wie
      // CardSearchRepository.parseData auf dem Handy.
      level: /Link/.test(c.type || '') ? (c.linkval ?? null) : (c.level ?? null),
      race: c.race || null,
      attribute: c.attribute || null,
      image: img.image_url,
      image_small: img.image_url_small || img.image_url,
      printings: (c.card_sets || [])
        .filter(s => s && s.set_code)
        .map(s => ({ code: s.set_code, rarity: s.set_rarity || 'Common' })),
      printings_verified: [],
      cm_price: cmPriceOf(c),
      ban_tcg: banOf(c, 'ban_tcg'),
      ban_ocg: banOf(c, 'ban_ocg'),
    });
  }
  return out;
}

// Spec E3 §3 — Artwork-Zuordnung { "<Artwork-Passcode>": "<Haupt-Passcode>" } aus card_images[].id. Nur fuer Karten,
// die im Katalog stehen (`cards` = Ergebnis von mergeCards); die Haupt-ID selbst und IDs, die selbst Haupt-ID einer
// Katalogkarte sind, werden nie aufgenommen (im Dump vom 2026-09-16: 164 Artworks, keine Kollision).
function buildAliases(enCards, cards) {
  const mains = new Set((cards || []).map((c) => String(c.id)));
  const aliases = {};
  for (const c of enCards || []) {
    if (!c || c.id == null || !mains.has(String(c.id))) continue;
    for (const img of Array.isArray(c.card_images) ? c.card_images : []) {
      if (!img || img.id == null) continue;
      const alt = String(Number(img.id));
      if (alt === String(c.id) || mains.has(alt) || Object.hasOwn(aliases, alt)) continue;
      aliases[alt] = String(c.id);
    }
  }
  return aliases;
}

// `verifiedByPasscode` kommt aus dem api_cache des Desktops und enthält AUSSCHLIESSLICH Codes,
// die über Yugipedia/Fandom/Konami tatsächlich belegt sind. Hier wird nichts abgeleitet:
// aus LOB-EN005 wird niemals LOB-DE005 (DE- und G-Infix unterscheiden sich je nach Ära).
function attachVerified(cards, verifiedByPasscode) {
  for (const c of cards) {
    const v = verifiedByPasscode instanceof Map
      ? verifiedByPasscode.get(String(c.id))
      : (verifiedByPasscode || {})[String(c.id)];
    c.printings_verified = Array.isArray(v)
      ? v.filter(x => x && x.code).map(x => ({ code: x.code, rarity: x.rarity || 'Common', lang: x.lang || 'DE' }))
      : [];
  }
  return cards;
}

// Spec G3 §3 — Art eines Sealed-Produkts aus der Cardmarket-Kategorie. EINZIGE Stelle dieser Zuordnung;
// die Werte sind die sechs erlaubten sealed_items.kind (sealed-value.cjs#SEALED_KINDS).
const SEALED_KIND_BY_CATEGORY = {
  'Yugioh Display': 'display',
  'Yugioh Booster': 'booster',
  'Yugioh Collector Tins': 'tin',
  'Yugioh Structure Deck': 'deck',
  'Yugioh Starter Deck': 'deck',
  'Yugioh Special Edition': 'special',
};
function sealedKindOf(categoryName) {
  return categoryName != null && Object.hasOwn(SEALED_KIND_BY_CATEGORY, categoryName)
    ? SEALED_KIND_BY_CATEGORY[categoryName]
    : 'other';
}

// Produktliste fuer Suche und Katalog: jedes Nicht-Einzelkarten-Produkt einmal, mit Art und dem Trend
// zum Bauzeitpunkt (null bei fehlendem oder 0 — gleiche Auswahl wie die Preisregel, sealed-prices.cjs).
function buildSealedProducts(nonsingles, priceGuides) {
  const trends = trendById(priceGuides);
  const seen = new Set();
  const out = [];
  for (const p of nonsingles || []) {
    const id = Number(p && p.idProduct);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !p.name) continue;
    seen.add(id);
    out.push({ cm_product_id: id, name: String(p.name), kind: sealedKindOf(p.categoryName), trend: trends.get(id) ?? null });
  }
  return out;
}

// Spec E3 §3: `aliases` steht immer im Katalog (auch leer) -- sein Fehlen kennzeichnet einen Katalog von vor E3
// ("Katalog fehlt – Banlist unbekannt").
function packCatalog(cards, version, sealedProducts = [], aliases = {}) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards, sealed_products: sealedProducts, aliases });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  return { buffer, json, bytes: buffer.length };
}

module.exports = { cmPriceOf, banOf, mergeCards, buildAliases, attachVerified, sealedKindOf, buildSealedProducts, packCatalog };
