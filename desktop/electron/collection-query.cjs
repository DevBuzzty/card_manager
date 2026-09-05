const { factorCaseSql, EDITIONS, CONDITIONS } = require('./valuation.cjs');

// One row per live printing, plus copy-derived value columns. Params: @def_condition, @def_edition.
function collectionSql() {
  const f = factorCaseSql('condition');
  return `
    SELECT c.*,
      COALESCE(cp.factor_sum, 0)                                     AS factor_sum,
      ROUND(COALESCE(c.price, 0) * COALESCE(cp.factor_sum, 0), 2)    AS value,
      COALESCE(cp.nonstandard, 0)                                    AS nonstandard,
      COALESCE(cp.conditions, '')                                    AS conditions,
      COALESCE(cp.editions, '')                                      AS editions
    FROM cards c
    LEFT JOIN (
      SELECT card_id, set_code, language, rarity,
        SUM(${f}) AS factor_sum,
        SUM(CASE WHEN condition <> @def_condition OR edition <> @def_edition THEN 1 ELSE 0 END) AS nonstandard,
        GROUP_CONCAT(DISTINCT condition) AS conditions,
        GROUP_CONCAT(DISTINCT edition) AS editions
      FROM card_copies WHERE deleted = 0
      GROUP BY card_id, set_code, language, rarity
    ) cp ON cp.card_id = c.id AND cp.set_code = c.set_code AND cp.language = c.language AND cp.rarity = c.rarity
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
