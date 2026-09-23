import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WURZEL = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dateien = [];
(function sammeln(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sammeln(p);
    // App.css wird nirgends importiert (Fixrunde 1, Punkt 5) -- ausgenommen, damit der Waechter nur
    // tatsaechlich gerenderten Code prueft.
    else if (/\.(jsx?|css)$/.test(e) && !e.endsWith('.test.js') && e !== 'App.css') dateien.push(p);
  }
})(WURZEL);

// Spec I §6.2 -- nach dem Umbau darf keine feste Farbe und kein Leuchteffekt mehr im Renderer stehen.
// Fixrunde 1, Punkt 5: erweitert um Verlaeufe, text/bg-white|black, beliebige Hex-Klassen ([#...]),
// Tailwinds eingebaute Buntfarben, und ein enges crit-Muster (das den Datenwert 'crit' in
// deckLegality.js nicht mehr trifft -- die dateiweite Ausnahme dafuer entfaellt).
const VERBOTEN = [
  /\bspace-(black|charcoal|white|violet)/, /\bobsidian\b/, /\btext-ink\b/, /\bink-muted\b/,
  /\brarity-(common|rare|super|ultra|secret)\b/, /#9D00FF/i, /bg-gradient-/,
  /linear-gradient\(/, /radial-gradient\(/,
  /rgba\(157, *0, *255/,
  /\b(text|bg)-(white|black)\b/,
  /-\[#/,
  /\b(text|bg|border|ring|from|to|via|fill|stroke)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  /\b(text|bg|border|ring)-crit\b/,
  /\bgold\b/,
  /violet-soft/,
  /ink-faint/,
];

// .foil-sheen (index.css) ist der Folien-Glanz-Effekt auf Kartenbildern -- ein Karteninhalt, kein
// UI-Leuchteffekt (Spec I §6.2, Ausnahme fuer RARITY_TIERS/Kartenbilder). Nur diese eine Regel wird
// vor der Verlaufs-Pruefung herausgeschnitten, nicht die ganze Datei.
function ohneFoilSheen(text) {
  return text.replace(/\.foil-sheen(\.secret)?\s*\{[^}]*\}/g, '');
}

test('Kein Renderer-Code nutzt mehr die alte Palette oder Leuchteffekte', () => {
  const treffer = [];
  for (const f of dateien) {
    const roh = readFileSync(f, 'utf8');
    const t = f.endsWith('index.css') ? ohneFoilSheen(roh) : roh;
    for (const r of VERBOTEN) if (r.test(t)) treffer.push(`${f.split('src')[1]}: ${r}`);
  }
  assert.deepEqual(treffer, []);
});
