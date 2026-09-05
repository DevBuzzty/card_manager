const norm = (p) => ({ card_id: String(p.id ?? p.card_id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown' });
const KEY = 'card_id = @card_id AND set_code = @set_code AND language = @language AND rarity = @rarity AND variant = @variant';

function lastRecorded(db, printing, variant = 'base') {
  const r = db.prepare(`SELECT price FROM price_history WHERE ${KEY} ORDER BY day DESC, recorded_at DESC LIMIT 1`).get({ ...norm(printing), variant });
  return r ? r.price : null;
}

// Only when the price really changed; at most one row per printing+variant+day (UTC), latest wins.
function recordPrice(db, printing, price, source, variant = 'base') {
  const p = Number(price);
  if (!(p > 0)) return false;
  const last = lastRecorded(db, printing, variant);
  if (last != null && Math.abs(last - p) < 0.005) return false;
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO price_history (card_id, set_code, language, rarity, variant, day, price, source, recorded_at)
    VALUES (@card_id, @set_code, @language, @rarity, @variant, @day, @price, @source, CURRENT_TIMESTAMP)
    ON CONFLICT(card_id, set_code, language, rarity, variant, day) DO UPDATE SET price = excluded.price, source = excluded.source, recorded_at = CURRENT_TIMESTAMP`)
    .run({ ...norm(printing), variant, day, price: p, source: String(source || 'unknown') });
  return true;
}

module.exports = { recordPrice, lastRecorded };
