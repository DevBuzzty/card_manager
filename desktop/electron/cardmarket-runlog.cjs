// Lauf-Protokoll des Cardmarket-Scrapers (anhaengen, rotieren) und Pause-Helfer nach gescheiterter Pruefung.
const fs = require('node:fs');

const PAUSE_HOURS = 6;

// Haengt eine JSON-Zeile an. Ist die Datei schon groesser als maxBytes, wird sie vorher nach file + '.1'
// verschoben (ein altes .1 wird ueberschrieben). Diagnose ist best-effort: Fehler werden geschluckt.
function appendLog(file, entry, { maxBytes = 1_000_000 } = {}) {
  try {
    try {
      if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.1');
    } catch { /* Datei existiert noch nicht */ }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* Diagnose ist best-effort */ }
}

const pauseUntilIso = (nowMs, hours = PAUSE_HOURS) => new Date(nowMs + hours * 3600 * 1000).toISOString();

function pauseActive(untilIso, nowMs) {
  const t = Date.parse(untilIso);
  return Number.isFinite(t) && t > nowMs;
}

module.exports = { appendLog, pauseUntilIso, pauseActive, PAUSE_HOURS };
