import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateHint, cmRunMessage } from './cmEstimate.js';
import { fmtEUR } from './format.js';

const NBSP = String.fromCharCode(160);
const norm = (s) => s.split(NBSP).join(' ');
const hhmm = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

test('estimateHint: null ohne Schaetzung', () => {
  assert.equal(estimateHint({ cm_estimate: 0, price: 2, cm_estimate_max: 40 }), null);
  assert.equal(estimateHint({ price: 2 }), null);
  assert.equal(estimateHint(null), null);
});

test('estimateHint: Spanne mit Euro-Werten', () => {
  const h = estimateHint({ cm_estimate: 1, price: 2, cm_estimate_max: 40 });
  assert.equal(h.label, 'Schätzung');
  assert.ok(norm(h.title).includes('2,00 €'));
  assert.ok(norm(h.title).includes('40,00 €'));
  assert.ok(h.title.includes(fmtEUR(2)));
  assert.ok(h.title.endsWith('genaue Version unbekannt'));
});

test('cmRunMessage: Pause laeuft', () => {
  const until = '2026-11-16T18:00:00.000Z';
  const m = cmRunMessage({ paused: true, until });
  assert.ok(m.includes('Pause bis'));
  assert.ok(m.includes(hhmm(until)));
});

test('cmRunMessage: Ergebnis ohne Pause', () => {
  const m = cmRunMessage({ updated: 2, noMatch: 0, errors: 0, firstEd: { updated: 1 }, pruefungenGesehen: 0, until: null });
  assert.ok(m.includes('2'));
  assert.ok(m.includes('0 Prüfungen'));
  assert.ok(!m.includes('Pause bis'));
});

test('cmRunMessage: Ergebnis mit neuer Pause', () => {
  const until = '2026-11-16T18:00:00.000Z';
  const m = cmRunMessage({ updated: 2, firstEd: { updated: 1, pruefungenGesehen: 2 }, pruefungenGesehen: 1, until });
  assert.ok(m.includes('3 Prüfungen'));
  assert.ok(m.includes('Pause bis'));
  assert.ok(m.includes(hhmm(until)));
});
