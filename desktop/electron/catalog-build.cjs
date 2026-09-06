// desktop/electron/catalog-build.cjs
// Reine Katalogbau-Funktionen: Merge der YGOPRODeck-Dumps (EN + DE), Anhang der vom Desktop
// bestätigten Set-Codes, gzip-Packen. Kein Netz, keine DB, kein Supabase — alles Testbare hier.
const zlib = require('node:zlib');

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
    });
  }
  return out;
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

function packCatalog(cards, version) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  return { buffer, json, bytes: buffer.length };
}

module.exports = { mergeCards, attachVerified, packCatalog };
