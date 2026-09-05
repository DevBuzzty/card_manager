const FACTORS = require('./condition-factors.json');

const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];

function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

// copies: [{ condition, count? }] — count defaults to 1.
function valueOf(price, copies) {
  const p = Number(price) || 0;
  if (!p || !copies || copies.length === 0) return 0;
  let f = 0;
  for (const c of copies) f += conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(p * f * 100) / 100;
}

// SQL CASE expression turning a condition column into its factor (for SUM(price * factor)).
function factorCaseSql(col) {
  const whens = CONDITIONS.map(c => `WHEN '${c}' THEN ${FACTORS[c]}`).join(' ');
  return `CASE ${col} ${whens} ELSE 1.0 END`;
}

// Live copies of live printings, joined on the 4-column printing key.
const LIVE_JOIN = `FROM card_copies cp JOIN cards c
  ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
  WHERE cp.deleted = 0 AND c.deleted = 0`;

function totalValue(db) {
  const r = db.prepare(`SELECT COALESCE(SUM(COALESCE(c.price, 0) * ${factorCaseSql('cp.condition')}), 0) AS total ${LIVE_JOIN}`).get();
  return Math.round((r.total || 0) * 100) / 100;
}

function copyCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n ${LIVE_JOIN}`).get().n || 0;
}

module.exports = { FACTORS, CONDITIONS, EDITIONS, conditionFactor, valueOf, factorCaseSql, totalValue, copyCount };
