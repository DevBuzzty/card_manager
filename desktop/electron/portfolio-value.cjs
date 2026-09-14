// Spec G1 §4.4 — eine Zeile in portfolio_history nach JEDEM Preisschreiber (YGOPRODeck-Poller,
// "Alle aktualisieren", Cardmarket-Bulk, Scraper, manueller Preis), sobald sich der Gesamtwert
// gegenueber der letzten Zeile um mehr als 0,50 EUR bewegt hat.
const { totalValue } = require('./valuation.cjs');

const THRESHOLD_EUR = 0.5;

function recordPortfolioValue(db) {
  const total = totalValue(db);
  const last = db.prepare('SELECT total_value FROM portfolio_history ORDER BY id DESC LIMIT 1').get();
  if (last && Math.abs((last.total_value || 0) - total) <= THRESHOLD_EUR) return false;
  db.prepare('INSERT INTO portfolio_history (total_value) VALUES (?)').run(total);
  return true;
}

module.exports = { recordPortfolioValue };
