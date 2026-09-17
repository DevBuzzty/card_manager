// Spec F1 §4 -- Exporte: Umfang aus der Datenbank laden und die Datei bauen. Das Speichern (Dialog, Schreiben) macht
// main.cjs; die Formatierer stehen in carddex-format.cjs und export-formats.cjs.
const { carddexGroups, writeCarddex } = require('./carddex-format.cjs');
const { dragonShieldCsv, ygoprodeckCsv, cardmarketWantslist, saleListText } = require('./export-formats.cjs');

// Dateiname und Endung je Format; die Beschriftungen fuer den Dialog stehen in src/utils/exportScope.js.
const EXPORT_FORMATS = {
  carddex: { file: 'carddex', ext: 'csv' },
  dragonshield: { file: 'dragonshield', ext: 'csv' },
  ygoprodeck: { file: 'ygoprodeck', ext: 'csv' },
  wantslist: { file: 'wantslist', ext: 'txt' },
  salelist: { file: 'verkaufsliste', ext: 'txt' },
};

// Lebende Exemplare lebender Printings mit Preisfeldern und lebendem Behaelter.
// scope: { kind: 'all' } | { kind: 'container', containerId } | { kind: 'copies', copyIds: string[] }
function loadExportCopies(db, scope = { kind: 'all' }) {
  const rows = db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.page, cp.slot, cp.tags, cp.note,
           c.name, c.price, c.price_first_ed,
           ct.container_id, ct.name AS container_name, ct.kind AS container_kind, ct.pockets_per_page
      FROM card_copies cp
      JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
      LEFT JOIN containers ct ON ct.container_id = cp.container_id AND ct.deleted = 0
     WHERE cp.deleted = 0 AND c.deleted = 0
     ORDER BY cp.created_at, cp.copy_id`).all();
  if (scope.kind === 'container') return rows.filter((r) => r.container_id === scope.containerId);
  if (scope.kind === 'copies') {
    const ids = new Set(Array.isArray(scope.copyIds) ? scope.copyIds.map(String) : []);
    return rows.filter((r) => ids.has(r.copy_id));
  }
  return rows;
}

const dateStamp = (now) => now.toISOString().slice(0, 10);

// -> { content, count, omitted, unit: 'copy'|'wish', defaultName, ext }; count = exportierte Exemplare bzw. Wuensche.
// deps = { nameEn(passcode) -> string|null, wishlist: Array|undefined, now: Date }
function buildExport(db, { format, scope } = {}, deps = {}) {
  const f = EXPORT_FORMATS[format];
  if (!f) throw new Error('Unbekanntes Exportformat');
  const now = deps.now || new Date();
  const defaultName = `${f.file}-${dateStamp(now)}.${f.ext}`;
  if (format === 'wantslist') {
    const wishlist = deps.wishlist || [];
    return { content: cardmarketWantslist(wishlist, deps.nameEn), count: wishlist.length, omitted: 0, unit: 'wish', defaultName, ext: f.ext };
  }
  const list = loadExportCopies(db, scope);
  const done = (content, omitted = 0) => ({ content, count: list.length - omitted, omitted, unit: 'copy', defaultName, ext: f.ext });
  if (format === 'carddex') return done(writeCarddex(carddexGroups(list)));
  if (format === 'dragonshield') return done(dragonShieldCsv(list, deps.nameEn));
  if (format === 'ygoprodeck') return done(ygoprodeckCsv(list, deps.nameEn));
  const sale = saleListText(list);
  return done(sale.text, sale.omitted);
}

function exportResultText({ count, omitted, unit }) {
  const noun = unit === 'wish' ? (count === 1 ? 'Wunsch' : 'Wünsche') : (count === 1 ? 'Exemplar' : 'Exemplare');
  const base = `${count} ${noun} exportiert`;
  return omitted > 0 ? `${base} · ${omitted} ${omitted === 1 ? 'Exemplar' : 'Exemplare'} ohne Set-Code weggelassen` : base;
}

module.exports = { EXPORT_FORMATS, loadExportCopies, buildExport, exportResultText };
