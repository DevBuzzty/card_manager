import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES, resolveMode, contrastRatio, applyTheme, startTheme } from './theme.js';

// ZWILLING: android DesignTokensTest.kt liest dieselbe Datei.
const TOK = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/tokens.json', import.meta.url), 'utf8'));

test('ROLES nennt genau die Rollen der Token-Datei', () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(TOK.roles).sort());
});

test('resolveMode: hell ist die Vorgabe, System folgt dem Geraet', () => {
  assert.equal(resolveMode('light', true), 'light');
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('system', true), 'dark');
  assert.equal(resolveMode('system', false), 'light');
  assert.equal(resolveMode(undefined, true), 'light', 'ohne Einstellung immer hell');
  assert.equal(resolveMode('quatsch', true), 'light');
});

test('Kontrast: jedes geforderte Paar erreicht seinen Mindestwert in beiden Modi', () => {
  for (const c of TOK.contrast) {
    for (const mode of ['light', 'dark']) {
      const r = contrastRatio(TOK.roles[c.fg][mode], TOK.roles[c.bg][mode]);
      assert.ok(r >= c.min, `${c.fg} auf ${c.bg} (${mode}): ${r.toFixed(2)} < ${c.min}`);
    }
  }
});

const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('index.css traegt jede Rolle in beiden Modi mit dem Token-Wert', () => {
  const block = (sel) => {
    const i = CSS.indexOf(sel);
    assert.ok(i >= 0, `${sel} fehlt in index.css`);
    return CSS.slice(i, CSS.indexOf('}', i));
  };
  const hell = block(':root');
  const dunkel = block('[data-theme="dark"]');
  for (const [name, werte] of Object.entries(TOK.roles)) {
    assert.match(hell, new RegExp(`--${name}:\\s*${werte.light}\\s*;`, 'i'), `hell: ${name}`);
    assert.match(dunkel, new RegExp(`--${name}:\\s*${werte.dark}\\s*;`, 'i'), `dunkel: ${name}`);
  }
});

// Abschlussreview A5/A6: Formularfelder und Bildlaufleisten folgen dem Modus (color-scheme), Zahlen
// haben gleiche Ziffernbreite (Spec I §6.3).
test('index.css setzt color-scheme je Modus und tabular-nums auf body', () => {
  const block = (sel) => CSS.slice(CSS.indexOf(sel), CSS.indexOf('}', CSS.indexOf(sel)));
  assert.match(block(':root'), /color-scheme:\s*light\s*;/);
  assert.match(block('[data-theme="dark"]'), /color-scheme:\s*dark\s*;/);
  assert.match(CSS, /body\s*\{[^}]*font-variant-numeric:\s*tabular-nums\s*;/);
});

test('applyTheme setzt data-theme am Dokument', () => {
  const doc = { documentElement: { dataset: {} } };
  assert.equal(applyTheme(doc, 'system', true), 'dark');
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(applyTheme(doc, 'light', true), 'light');
  assert.equal(doc.documentElement.dataset.theme, 'light');
});

// Fake matchMedia, die addEventListener/removeEventListener wie im Browser als Zuhoerer-Menge fuehrt.
function fakeDocMitMatchMedia() {
  const listeners = new Set();
  const mq = {
    matches: true,
    addEventListener: (ev, fn) => { if (ev === 'change') listeners.add(fn); },
    removeEventListener: (ev, fn) => { if (ev === 'change') listeners.delete(fn); },
  };
  const doc = { documentElement: { dataset: {} }, defaultView: { matchMedia: () => mq } };
  return { doc, listeners };
}

test('startTheme gibt eine Abmeldefunktion zurueck, die den Zuhoerer wirklich entfernt', () => {
  const { doc, listeners } = fakeDocMitMatchMedia();
  const stop = startTheme(doc, 'system');
  assert.equal(listeners.size, 1, 'ein Zuhoerer nach dem Start');
  stop();
  assert.equal(listeners.size, 0, 'kein Zuhoerer mehr nach der Abmeldung');
});

test('startTheme meldet den vorigen Zuhoerer selbst ab (Abschlussreview B4)', () => {
  const { doc, listeners } = fakeDocMitMatchMedia();
  startTheme(doc, 'system');
  startTheme(doc, 'system');
  assert.equal(listeners.size, 1, 'zweimal system -> genau ein Zuhoerer');
  startTheme(doc, 'light');
  assert.equal(listeners.size, 0, 'danach hell -> kein Zuhoerer mehr');
  assert.equal(doc.documentElement.dataset.theme, 'light');
});

test('Abmelden vor einem erneuten Start haeuft keine Zuhoerer an (Settings.jsx-Muster)', () => {
  const { doc, listeners } = fakeDocMitMatchMedia();
  let stop = startTheme(doc, 'system');
  stop(); // ausdrueckliches Abmelden bleibt erlaubt (Rueckgabe von startTheme)
  stop = startTheme(doc, 'system');
  assert.equal(listeners.size, 1, 'genau ein aktiver Zuhoerer, kein Leck');
});

// Spec I §6.3 (I2 Task 10) -- Schrift und Ecken: tailwind.config.js bildet die Stufen auf die Token-Datei ab.
// ZWILLING: android DesignTokensTest.kt prueft Type.kt/Theme.kt gegen denselben Block.
test('Tailwind: Schriftgroessen und Ecken wie in tokens.json', async () => {
  const tw = (await import('../../tailwind.config.js')).default.theme.extend;
  const px = (n) => `${n}px`;
  const size = (k) => tw.fontSize[k][0];
  assert.equal(size('xl'), px(TOK.typo.sizes.titel));
  assert.equal(size('2xl'), px(TOK.typo.sizes.titel));
  assert.equal(size('lg'), px(TOK.typo.sizes.abschnitt));
  assert.equal(size('sm'), px(TOK.typo.sizes.zeile));
  assert.equal(size('base'), px(TOK.typo.sizes.zeile));
  assert.equal(size('xs'), px(TOK.typo.sizes.neben));
  assert.equal(size('klein'), px(TOK.typo.sizes.nebenKlein));
  const erlaubt = new Set(Object.values(TOK.typo.sizes).map(px));
  for (const [k, [v]] of Object.entries(tw.fontSize)) assert.ok(erlaubt.has(v), `text-${k} = ${v} ist keine der vier Groessen`);
  for (const k of ['DEFAULT', 'sm', 'md', 'lg', 'feld']) assert.equal(tw.borderRadius[k], px(TOK.radius.feld), `rounded-${k}`);
  for (const k of ['xl', '2xl', '3xl', 'flaeche']) assert.equal(tw.borderRadius[k], px(TOK.radius.flaeche), `rounded-${k}`);
  const fam = new Set(Object.values(tw.fontFamily).map((f) => f.join(',')));
  assert.equal(fam.size, 1, 'eine Schriftfamilie fuer alles');
  assert.equal(tw.fontFamily.sans[0], 'system-ui');
});

