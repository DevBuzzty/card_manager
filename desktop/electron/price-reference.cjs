// Spec G1 §4.3 — Referenzpreise und Kartenverlauf aus der lokalen price_history (nur Variante base).
// Die Cloud-RPC supabase/price_reference_rpc.sql liefert DIESELBE Auswahl; wer eine aendert, aendert beide.
const { norm } = require('./price-history.cjs');

function referenceRows(db, cutoff) {
  return db.prepare(`
    SELECT card_id, set_code, language, rarity, day, price, source FROM (
      SELECT card_id, set_code, language, rarity, day, price, source,
             ROW_NUMBER() OVER (
               PARTITION BY card_id, set_code, language, rarity
               ORDER BY (day <= @cutoff) DESC,
                        CASE WHEN day <= @cutoff THEN day END DESC,
                        day ASC
             ) AS rn
        FROM price_history
       WHERE variant = 'base'
    ) WHERE rn = 1`).all({ cutoff });
}

function cardHistory(db, printing) {
  const rows = db.prepare(`
    SELECT day, price, source FROM price_history
     WHERE card_id = @card_id AND set_code = @set_code AND language = @language AND rarity = @rarity AND variant = 'base'
     ORDER BY day DESC LIMIT 1000`).all(norm(printing));
  return rows.reverse();
}

module.exports = { referenceRows, cardHistory };
