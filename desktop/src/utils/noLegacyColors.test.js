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
// Fixrunde 2, Punkt 3: die Praefix-Listen fuer weiss/schwarz und die Tailwind-Buntfarben deckten nur
// text/bg/border/ring(/from/to/via/fill/stroke) ab -- divide-white, placeholder-gray-500, shadow-red-500,
// outline-blue-500, decoration-pink-400, accent-emerald-500 rutschten durch. Dazu: farbige Schatten
// direkt ueber eine Rolle (shadow-accent/... usw. -- optisch derselbe Leuchtschatten wie ein rohes
// shadow-[0_0_10px_rgba(...)], nur ueber die Rolle statt Hex) und feste Hex-Werte in style={{}}.
// frame-* (Kartenrahmenfarbe) bekommt bewusst KEIN Verbot: als Dekor einer Kachel oder als echte
// Kartenfarbe laesst es sich per Text allein nicht zuverlaessig unterscheiden -- das prueft die Abnahme.
const VERBOTEN = [
  /\bspace-(black|charcoal|white|violet)/, /\bobsidian\b/, /\btext-ink\b/, /\bink-muted\b/,
  /\brarity-(common|rare|super|ultra|secret)\b/, /#9D00FF/i, /bg-gradient-/,
  /linear-gradient\(/, /radial-gradient\(/,
  /rgba\(157, *0, *255/,
  /\b(text|bg|border|ring|divide|placeholder|shadow)-(white|black)\b/,
  /-\[#/,
  /\b(text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder|shadow|outline|decoration|accent)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  /\bshadow-(accent|good|warn|bad|text|muted|line|bg|surface|surface-2)\b/,
  /\b(text|bg|border|ring)-crit\b/,
  /\bgold\b/,
  /violet-soft/,
  /ink-faint/,
  // Feste Hex-Farbwerte direkt in style={{}} -- Ausnahmen unten (RarityGuide-Kartenfarben) werden vor
  // dieser Pruefung aus dem Text herausgeschnitten, nicht dateiweit ausgenommen.
  /(backgroundColor|color|borderColor|fill|stroke)\s*:\s*['"]#/,
];

// .foil-sheen (index.css) ist der Folien-Glanz-Effekt auf Kartenbildern -- ein Karteninhalt, kein
// UI-Leuchteffekt (Spec I §6.2, Ausnahme fuer RARITY_TIERS/Kartenbilder). Ausgenommen wird nur eine
// Regel, deren Selektor mit ".foil-sheen" BEGINNT (".foil-sheen", ".foil-sheen.secret", ".foil-sheen::after"
// -- Fixrunde 2, Punkt 3), nicht ein Selektor, der nur darauf ENDET (z.B. ".card .foil-sheen").
function ohneFoilSheen(text) {
  return text.replace(/(^|\n)\.foil-sheen(?:[.:][\w-]+)*\s*\{[^}]*\}/g, '\n');
}

// RarityGuide.jsx: die Seltenheits-Farbmuster in der Konstante `rarities` sind Karteninhalt (wie echte
// Rarities aussehen), keine Oberflaechenfarbe -- konstantengenau ausgenommen, nicht die ganze Datei
// (Fixrunde 2, Punkt 3). Alles andere in der Datei (Dialog-Chrome) bleibt geprueft.
function ohneRarityFarben(text) {
  return text.replace(/const rarities = \[[\s\S]*?\n\s*\];/, 'const rarities = [];');
}

test('Kein Renderer-Code nutzt mehr die alte Palette oder Leuchteffekte', () => {
  const treffer = [];
  for (const f of dateien) {
    let t = readFileSync(f, 'utf8');
    if (f.endsWith('index.css')) t = ohneFoilSheen(t);
    if (f.endsWith('RarityGuide.jsx')) t = ohneRarityFarben(t);
    for (const r of VERBOTEN) if (r.test(t)) treffer.push(`${f.split('src')[1]}: ${r}`);
  }
  assert.deepEqual(treffer, []);
});

// Abschlussreview A3/A4: Farbtext auf eigener Toenung (bg-bad/15 text-bad usw.) faellt je nach Modus
// unter 4,5:1. Getoente Marken tragen den Text in text-text; die Rolle steckt nur in Toenung und Rand.
// Geprueft wird je Zeichenketten-Literal (className, clsx-Zweig, Vorlage), unabhaengig von der
// Reihenfolge der Klassen. hover:-Toenungen zaehlen nicht (nur waehrend des Zeigens sichtbar).
test('Getoente Marken: kein Rollentext auf der eigenen Toenung, kein hover:bg-accent/90', () => {
  const treffer = [];
  for (const f of dateien) {
    if (!f.endsWith('.jsx') && !f.endsWith('.js')) continue;
    const t = readFileSync(f, 'utf8');
    if (/hover:bg-accent\/90\b/.test(t)) treffer.push(`${f.split('src')[1]}: hover:bg-accent/90`);
    for (const lit of t.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || []) {
      for (const rolle of ['good', 'warn', 'bad', 'accent']) {
        const toenung = new RegExp(`(^|[\\s'"\`])bg-${rolle}/\\d+\\b`).test(lit);
        const text = new RegExp(`(^|[\\s'"\`])text-${rolle}(?![\\w/-])`).test(lit);
        if (toenung && text) treffer.push(`${f.split('src')[1]}: ${lit.slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(treffer, []);
});
