// Spec G1 §4.4 — eine Zeile in portfolio_history nach JEDEM Preisschreiber (YGOPRODeck-Poller,
// "Alle aktualisieren", Cardmarket-Bulk, Scraper, manueller Preis), sobald sich der Gesamtwert
// gegenueber der letzten Zeile um mehr als 0,50 EUR bewegt hat.
// Spec G3 §4.2/§6: Gesamtwert = Karten + Sealed. portfolioTotals ist die einzige Stelle dafuer am Desktop
// (get-portfolio, recordPortfolioValue, syncSnapshot); gespeichert wird auf Cent gerundet wie totalValue.
const { totalValue } = require('./valuation.cjs');
const { sealedValue } = require('./sealed-value.cjs');

const THRESHOLD_EUR = 0.5;
const cents = (x) => Math.round(x * 100) / 100;

function portfolioTotals(db) {
  const cards = totalValue(db);
  const rows = db.prepare('SELECT quantity, price, deleted FROM sealed_items WHERE deleted = 0').all();
  const sealed = cents(sealedValue(rows));
  return { cards, sealed, total: cents(cards + sealed), sealedCount: rows.length };
}

function recordPortfolioValue(db) {
  const { total, sealed } = portfolioTotals(db);
  const last = db.prepare('SELECT total_value FROM portfolio_history ORDER BY id DESC LIMIT 1').get();
  if (last && Math.abs((last.total_value || 0) - total) <= THRESHOLD_EUR) return false;
  db.prepare('INSERT INTO portfolio_history (total_value, sealed_value) VALUES (?, ?)').run(total, sealed);
  return true;
}

module.exports = { portfolioTotals, recordPortfolioValue };
