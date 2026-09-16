const { factorCaseSql, unitPriceCaseSql, EDITIONS, CONDITIONS } = require('./valuation.cjs');

// One row per live printing, plus copy-derived value columns. Params: @def_condition, @def_edition.
// Spec G4 §6: value = Summe unitPrice x Zustandsfaktor je lebendem Exemplar (1st-Ed-Preis fuer edition = 'first');
// factor_sum bleibt die reine Faktorsumme.
function collectionSql() {
  const f = factorCaseSql('cp.condition');
  const unit = unitPriceCaseSql('pc', 'cp');
  return `
    SELECT c.*,
      COALESCE(v.factor_sum, 0)            AS factor_sum,
      ROUND(COALESCE(v.value_sum, 0), 2)   AS value,
      COALESCE(v.nonstandard, 0)           AS nonstandard,
      COALESCE(v.conditions, '')           AS conditions,
      COALESCE(v.editions, '')             AS editions
    FROM cards c
    LEFT JOIN (
      SELECT cp.card_id, cp.set_code, cp.language, cp.rarity,
        SUM(${f}) AS factor_sum,
        SUM(${unit} * ${f}) AS value_sum,
        SUM(CASE WHEN cp.condition <> @def_condition OR cp.edition <> @def_edition THEN 1 ELSE 0 END) AS nonstandard,
        GROUP_CONCAT(DISTINCT cp.condition) AS conditions,
        GROUP_CONCAT(DISTINCT cp.edition) AS editions
      FROM card_copies cp
      JOIN cards pc ON pc.id = cp.card_id AND pc.set_code = cp.set_code AND pc.language = cp.language AND pc.rarity = cp.rarity
      WHERE cp.deleted = 0
      GROUP BY cp.card_id, cp.set_code, cp.language, cp.rarity
    ) v ON v.card_id = c.id AND v.set_code = c.set_code AND v.language = c.language AND v.rarity = c.rarity
    WHERE c.quantity > 0 AND c.deleted = 0
    ORDER BY c.created_at DESC`;
}

// CSV: header row, ';' or ',' separated; passcode from a column named passcode/id/card_id, else column 2 (legacy).
function parseImportCsv(content) {
  const lines = String(content || '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const idx = (names) => header.findIndex(h => names.includes(h));
  let pcIdx = idx(['passcode', 'id', 'card_id']);
  if (pcIdx < 0) pcIdx = 1;
  const edIdx = idx(['edition']), coIdx = idx(['condition', 'zustand']);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep);
    const passcode = (parts[pcIdx] || '').trim();
    if (!/^\d+$/.test(passcode)) continue;
    const row = { passcode };
    const ed = edIdx >= 0 ? (parts[edIdx] || '').trim().toLowerCase() : '';
    const co = coIdx >= 0 ? (parts[coIdx] || '').trim().toUpperCase() : '';
    if (EDITIONS.includes(ed)) row.edition = ed;
    if (CONDITIONS.includes(co)) row.condition = co;
    out.push(row);
  }
  return out;
}

module.exports = { collectionSql, parseImportCsv };
