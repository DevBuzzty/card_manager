import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPasscode, normPasscode, passcodeMatches } from './passcode.js';

test('normPasscode entfernt fuehrende Nullen und alles ausser Ziffern', () => {
  assert.equal(normPasscode('02463794'), '2463794');
  assert.equal(normPasscode(2463794), '2463794');
  assert.equal(normPasscode(' 024-637 94 '), '2463794');
  assert.equal(normPasscode(''), '');
  assert.equal(normPasscode('000'), '0');
});

test('formatPasscode zeigt acht Stellen', () => {
  assert.equal(formatPasscode('2463794'), '02463794');
  assert.equal(formatPasscode('02463794'), '02463794');
  assert.equal(formatPasscode(46986414), '46986414');
  assert.equal(formatPasscode(''), '');
});

test('passcodeMatches findet die Karte in beiden Schreibweisen', () => {
  assert.ok(passcodeMatches('02463794', '2463794'));   // Nutzer tippt, was auf der Karte steht
  assert.ok(passcodeMatches('2463794', '2463794'));
  assert.ok(passcodeMatches('463794', '2463794'));     // Teilsuche
  assert.ok(passcodeMatches('0246', '2463794'));       // Teilsuche mit fuehrender Null
  assert.ok(!passcodeMatches('999', '2463794'));
  assert.ok(!passcodeMatches('', '2463794'));
});
