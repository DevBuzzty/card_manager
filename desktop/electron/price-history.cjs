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

// Spec G1 §4.2 — einmalige Startzeile: ohne sie haette die erste Preisaenderung eines Printings kein
// "Damals", weil recordPrice nur den NEUEN Preis schreibt. Quelle aus price_locked (1 CM, 2 manuell,
// sonst YGOPRODeck). Die Cloud-Absicherung supabase/price_history_seed.sql folgt derselben Regel.
function seedPriceHistory(db, today = new Date().toISOString().slice(0, 10)) {
  const flag = db.prepare(`SELECT value FROM settings WHERE key = 'price_history_seeded'`).get();
  if (flag && flag.value === '1') return { inserted: 0, skipped: true };
  let inserted = 0;
  db.transaction(() => {
    inserted = db.prepare(`
      INSERT OR IGNORE INTO price_history (card_id, set_code, language, rarity, variant, day, price, source, recorded_at)
      SELECT c.id, c.set_code, c.language, c.rarity, 'base', @today, c.price,
             CASE COALESCE(c.price_locked, 0) WHEN 1 THEN 'cm_bulk' WHEN 2 THEN 'manual' ELSE 'ygoprodeck' END,
             CURRENT_TIMESTAMP
        FROM cards c
       WHERE c.deleted = 0 AND c.price > 0
         AND EXISTS (SELECT 1 FROM card_copies cp WHERE cp.card_id = c.id AND cp.set_code = c.set_code
                       AND cp.language = c.language AND cp.rarity = c.rarity AND cp.deleted = 0)
         AND NOT EXISTS (SELECT 1 FROM price_history h WHERE h.card_id = c.id AND h.set_code = c.set_code
                       AND h.language = c.language AND h.rarity = c.rarity AND h.variant = 'base')`)
      .run({ today }).changes;
    db.prepare(`INSERT INTO settings (key, value) VALUES ('price_history_seeded', '1')
                ON CONFLICT(key) DO UPDATE SET value = '1'`).run();
  })();
  return { inserted, skipped: false };
}

module.exports = { recordPrice, lastRecorded, norm, seedPriceHistory };
