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
    else if (/\.(jsx?|css)$/.test(e) && !e.endsWith('.test.js')) dateien.push(p);
  }
})(WURZEL);

// Spec I §6.2 -- nach dem Umbau darf keine feste Farbe und kein Leuchteffekt mehr im Renderer stehen.
const VERBOTEN = [/\bspace-(black|charcoal|white|violet)/, /\bobsidian\b/, /\btext-ink\b/, /\bink-muted\b/,
  /\bcrit\b/, /\brarity-(common|rare|super|ultra|secret)\b/, /#9D00FF/i, /bg-gradient-/];

// 'crit' ist hier keine Tailwind-Farbe, sondern der Wert der Badge-Art aus deckLegality.js#badgeKind --
// ein Zwilling mit android/.../DeckLegality.kt gegen docs/fixtures/decks/legality.json (siehe dort).
// Das Umbenennen dieses Werts ist eine plattformuebergreifende Aenderung und liegt ausserhalb von Task 7
// (PC-Farbrollen); die zugehoerige CSS-Klasse ist bereits auf die Rolle 'bad' umgestellt.
const AUSNAHMEN = {
  'crit': [/utils[\\/]deckLegality\.js$/, /components[\\/]DeckLegalityBadge\.jsx$/],
};

test('Kein Renderer-Code nutzt mehr die alte Palette oder Leuchteffekte', () => {
  const treffer = [];
  for (const f of dateien) {
    const t = readFileSync(f, 'utf8');
    for (const r of VERBOTEN) {
      if (!r.test(t)) continue;
      const key = r.source.replace(/\\b/g, '');
      const ausgenommen = AUSNAHMEN[key]?.some((p) => p.test(f));
      if (!ausgenommen) treffer.push(`${f.split('src')[1]}: ${r}`);
    }
  }
  assert.deepEqual(treffer, []);
});
