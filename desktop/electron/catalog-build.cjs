// desktop/electron/catalog-build.cjs
// Reine Katalogbau-Funktionen: Merge der YGOPRODeck-Dumps (EN + DE), Anhang der vom Desktop
// bestätigten Set-Codes, gzip-Packen. Kein Netz, keine DB, kein Supabase — alles Testbare hier.
const zlib = require('node:zlib');
const { trendById } = require('./sealed-prices.cjs');
const { UNBEKANNT, kenntRarity, repariereQuellcode } = require('./rarity-sources.cjs');

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
      // Weder Rarity erfinden noch kaputte Codes uebernehmen -- beides stammt aus derselben
      // Messung (20.09.2026) wie rarity-sources.cjs: YGOPRODeck liefert fuer frische Sets
      // "LAVD-ENO11" (Buchstabe O statt Null) und `set_rarity: "3"`. Diese Zeile ist die
      // Hauptquelle der `printings` im Offline-Katalog, den BEIDE Geraete lesen -- ein Fehler hier
      // wandert in jede Erkennung und bleibt eine Woche stehen, bis der Katalog neu gebaut wird.
      printings: (c.card_sets || [])
        .filter(s => s && s.set_code)
        .map(s => ({
          code: repariereQuellcode(s.set_code),
          rarity: kenntRarity(s.set_rarity) ? s.set_rarity : UNBEKANNT,
        })),
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

// Deutscher Code: Infix -DE oder -G<Ziffer> (je nach Aera). Dieselbe Regel wie readVerified (catalog-builder.cjs) und
// api-handler.cjs -- KR-, EN- oder JP-Codes landen nie in printings_verified.
const isGermanCode = (code) => /-DE/i.test(code) || /-G\d/i.test(code);

// Nachtrag Katalogbau 2026-11-03 — verifizierte DE-Drucke aus dem zuletzt veroeffentlichten Katalog erhalten.
// Der eigene api_cache kennt nur die Karten, die DIESER Rechner je bei Yugipedia nachgeschlagen hat; ein Bau von einem
// anderen Rechner (oder nach einem DB-Wechsel) wuerde sonst alle uebrigen echten DE-Codes still vom Handy loeschen.
// Regeln:
//  - Kennt der lokale Cache eine Karte (frische Yugipedia-Daten), gilt fuer sie NUR der lokale Stand -- so kann ein
//    korrigierter Cache alte Fehler und von Yugipedia entfernte Drucke wirklich loswerden. Aus dem Vorgaenger
//    uebernommen werden nur Karten ohne lokalen Fund.
//  - Rarity-Angaben werden bereinigt (saubereRarity: Reste von HTML-Kommentaren/Templates aus dem Wiki-Text, in v11
//    belegt: "Common<!--", "Rare-->", "Ultra Rare-->"). Bleibt keine echte Rarity (kenntRarity), wird sie ehrlich
//    'Unknown' -- der verifizierte DEUTSCHE Code bleibt erhalten (wie readVerified).
//  - Je Karte faellt ein code|Unknown weg, sobald derselbe Code eine bekannte Rarity hat (v11: 76948970 ALIN-DE091).
// Vorgaenger-Eintraege muessen dieselbe Form haben, die attachVerified erzeugt (code: deutscher Code, rarity: nicht leer,
// lang: 'DE' bzw. fehlend); `cm` wird verworfen, attachCm setzt es neu. Reihenfolge: lokale Karten/Eintraege in ihrer
// Reihenfolge zuerst, danach die uebernommenen in der Reihenfolge des Vorgaengers -- fuer saubere Eintraege ist der
// Roundtrip Vorgaenger -> attachVerified -> attachCm also verlustfrei.
// `local`: Map passcode -> Array<{code,rarity,lang}> (readVerified) oder Map passcode -> Map<"code|rarity", Eintrag>.
// `previous`: Katalog-Objekt ({ cards }) oder dessen cards-Array; alles andere = kein Vorgaenger.
// `knownIds`: optional Set der Passcodes (String) im neuen Bau -- Karten, die es nicht mehr gibt, fallen weg.
function saubereRarity(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');   // vollstaendige Kommentare
  s = s.replace(/<!--|-->/g, ' ');          // abgeschnittene Kommentar-Reste
  s = s.split(/\{\{|\}\}|\||</)[0];         // Template-/Tabellen-/Tag-Reste abschneiden
  s = s.replace(/\s+/g, ' ').trim();
  return kenntRarity(s) ? s : UNBEKANNT;
}

// Je Code: Platzhalter 'Unknown' nur, wenn es fuer diesen Code keine bekannte Rarity gibt. Reihenfolge bleibt.
function ohneUnbekannteDubletten(entries) {
  const bekannt = new Set();
  for (const e of entries) if (e.rarity !== UNBEKANNT) bekannt.add(e.code);
  return entries.filter(e => e.rarity !== UNBEKANNT || !bekannt.has(e.code));
}

function mergeVerified(local, previous, { knownIds = null } = {}) {
  const keep = (passcode) => !knownIds || knownIds.has(passcode);
  const out = new Map();
  for (const [passcode, v] of local instanceof Map ? local : []) {
    const id = String(passcode);
    if (!keep(id)) continue;
    const list = Array.isArray(v) ? v : (v instanceof Map ? Array.from(v.values()) : []);
    const entries = new Map();
    for (const e of list) {
      if (!e || !e.code) continue;
      const rarity = e.rarity ? saubereRarity(e.rarity) : 'Common';
      const key = `${e.code}|${rarity}`;
      if (!entries.has(key)) entries.set(key, { ...e, rarity });
    }
    if (entries.size > 0) out.set(id, ohneUnbekannteDubletten(Array.from(entries.values())));
  }

  let carriedCards = 0;
  let carriedPrintings = 0;
  const prevCards = Array.isArray(previous) ? previous : (previous && Array.isArray(previous.cards) ? previous.cards : []);
  for (const c of prevCards) {
    if (!c || c.id == null || !Array.isArray(c.printings_verified)) continue;
    const id = String(c.id);
    if (!keep(id) || out.has(id)) continue;     // lokaler Fund ersetzt den Vorgaenger fuer diese Karte ganz
    const entries = new Map();
    for (const p of c.printings_verified) {
      if (!p || typeof p.code !== 'string' || !p.code || !isGermanCode(p.code)) continue;
      if (typeof p.rarity !== 'string' || !p.rarity) continue;
      const lang = p.lang == null ? 'DE' : p.lang;
      if (lang !== 'DE') continue;
      const rarity = saubereRarity(p.rarity);
      const key = `${p.code}|${rarity}`;
      if (!entries.has(key)) entries.set(key, { code: p.code, rarity, lang });
    }
    const list = ohneUnbekannteDubletten(Array.from(entries.values()));
    if (list.length > 0) { out.set(id, list); carriedCards++; carriedPrintings += list.length; }
  }

  return { verified: out, carriedCards, carriedPrintings };
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
// Spec 2026-10-04 §3.2 — `cm` je Druck fuer die Euro-Preise auf dem Handy: Zahl (eindeutig),
// Array (mehrdeutig, Handy zeigt Spanne) oder fehlt. Cardmarket-Produkte sind sprachneutral, also
// bekommen DE- und EN-Druck desselben Sets/derselben Seltenheit dieselbe Nummer.
function attachCm(cards, lookup) {
  const prefixOf = (code) => String(code || '').split('-')[0].toUpperCase();
  for (const c of cards) {
    const rarities = (prefix) => (c.printings || []).filter(p => prefixOf(p.code) === prefix).map(p => p.rarity);
    for (const p of [...(c.printings || []), ...(c.printings_verified || [])]) {
      const cm = lookup(c.name_en, p.code, p.rarity, rarities(prefixOf(p.code)));
      if (cm != null) p.cm = cm;
    }
  }
  return cards;
}

function packCatalog(cards, version, sealedProducts = [], aliases = {}) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards, sealed_products: sealedProducts, aliases });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  return { buffer, json, bytes: buffer.length };
}

module.exports = { cmPriceOf, banOf, mergeCards, buildAliases, attachVerified, mergeVerified, saubereRarity, isGermanCode, attachCm, sealedKindOf, buildSealedProducts, packCatalog };
