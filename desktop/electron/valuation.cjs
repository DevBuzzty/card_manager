const FACTORS = require('./condition-factors.json');

const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];

function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

// Spec G4 §6 — Bewertungsregel: Exemplarwert = Zustandsfaktor x unitPrice(card, copy).
// ZWILLING in vier Fassungen: unitPrice/valueOf hier, unitPriceCaseSql (SQL, unten), desktop/src/utils/valuation.js
// (unitPrice/valueOf) und android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt (unitPrice/valueOf).
// Gemeinsame Fixture: docs/fixtures/valuation/first-ed.json. Wer eine Fassung aendert, aendert alle.
function unitPrice(card, copy) {
  if (copy && copy.edition === 'first' && card && card.price_first_ed != null) return Number(card.price_first_ed);
  return Number(card && card.price) || 0;
}

// copies: [{ edition, condition, count? }] — count defaults to 1.
function valueOf(card, copies) {
  if (!copies || copies.length === 0) return 0;
  let v = 0;
  for (const c of copies) v += unitPrice(card, c) * conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(v * 100) / 100;
}

// SQL CASE expression turning a condition column into its factor (for SUM(unitPrice * factor)).
function factorCaseSql(col) {
  const whens = CONDITIONS.map(c => `WHEN '${c}' THEN ${FACTORS[c]}`).join(' ');
  return `CASE ${col} ${whens} ELSE 1.0 END`;
}

// SQL-Fassung von unitPrice (Zwilling, siehe oben).
function unitPriceCaseSql(cardAlias, copyAlias) {
  return `CASE WHEN ${copyAlias}.edition = 'first' AND ${cardAlias}.price_first_ed IS NOT NULL THEN ${cardAlias}.price_first_ed ELSE COALESCE(${cardAlias}.price, 0) END`;
}

// Live copies of live printings, joined on the 4-column printing key.
const LIVE_JOIN = `FROM card_copies cp JOIN cards c
  ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
  WHERE cp.deleted = 0 AND c.deleted = 0`;

function totalValue(db) {
  const r = db.prepare(`SELECT COALESCE(SUM(${unitPriceCaseSql('c', 'cp')} * ${factorCaseSql('cp.condition')}), 0) AS total ${LIVE_JOIN}`).get();
  return Math.round((r.total || 0) * 100) / 100;
}

function copyCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n ${LIVE_JOIN}`).get().n || 0;
}

module.exports = { FACTORS, CONDITIONS, EDITIONS, conditionFactor, unitPrice, valueOf, factorCaseSql, unitPriceCaseSql, totalValue, copyCount };
