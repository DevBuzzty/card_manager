import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moversMessage } from './moversText.js';

test('no_reference mit Tag', () => {
  assert.equal(moversMessage({ status: 'no_reference', firstDay: '2026-09-23', winners: [], losers: [] }, 7),
    'Noch nicht genug Verlauf — Bewegungen erscheinen ab 23.09.');
});
test('no_reference ohne Tag', () => {
  assert.equal(moversMessage({ status: 'no_reference', firstDay: null, winners: [], losers: [] }, 30), 'Noch nicht genug Verlauf');
});
test('ok ohne Bewegung', () => {
  assert.equal(moversMessage({ status: 'ok', firstDay: null, winners: [], losers: [] }, 30), 'Keine Bewegungen in 30 Tagen');
});
test('ok mit Bewegung -> Listen zeigen', () => {
  assert.equal(moversMessage({ status: 'ok', firstDay: null, winners: [{}], losers: [] }, 7), null);
});
