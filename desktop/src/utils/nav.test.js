import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTES } from './routes.js';
import { NAV_GROUPS, SAMMLUNG_SEGMENTS, VERKAUFEN_SEGMENTS } from './i18n-de.js';

// ZWILLING: android NavTabellenTest.kt liest dieselbe Tabelle.
const N = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/nav.json', import.meta.url), 'utf8'));

test('Die Seitenleiste zeigt die Gruppen der Tabelle in ihrer Reihenfolge', () => {
  assert.deepEqual(NAV_GROUPS.map(g => g.group), N.groups.map(g => g.group));
  assert.deepEqual(NAV_GROUPS.map(g => g.items.map(i => i.key)), N.groups.map(g => g.items));
});

test('Jeder Eintrag traegt den Text der Tabelle und eine bekannte Route', () => {
  for (const g of NAV_GROUPS) for (const i of g.items) {
    assert.equal(i.label, N.labels[i.key], i.key);
    assert.ok(typeof i.to === 'string' && i.to.startsWith('/'), `${i.key}: ${i.to}`);
  }
});

test('Die Unterteilungen stimmen mit der Tabelle ueberein', () => {
  assert.deepEqual(SAMMLUNG_SEGMENTS.map(s => [s.id, s.label]), N.segments.sammlung);
  assert.deepEqual(VERKAUFEN_SEGMENTS.map(s => [s.id, s.label]), N.segments.verkaufen);
});

test('Decks und Verkaufen haben eigene Routen', () => {
  assert.equal(ROUTES.decks, '/decks');
  assert.equal(ROUTES.verkaufen, '/verkaufen/kandidaten');
  assert.equal(ROUTES.zumVerkauf, '/verkaufen/zum-verkauf');
  assert.equal(ROUTES.angebote, '/verkaufen/angebote');
  assert.equal(ROUTES.verkaeufe, '/verkaufen/verkaeufe');
});
