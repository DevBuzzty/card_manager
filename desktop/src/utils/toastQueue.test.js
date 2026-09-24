import test from 'node:test';
import assert from 'node:assert/strict';
import { showToast, pauseToast, resumeToast, isExpired, TOAST_MS } from './toastQueue.js';

test('Standard: sechs Sekunden', () => {
  const t = showToast(null, { text: 'a' }, 1000);
  assert.equal(TOAST_MS, 6000);
  assert.equal(isExpired(t, 1000 + 5999), false);
  assert.equal(isExpired(t, 1000 + 6000), true);
});

test('eine neue Leiste ersetzt die alte (neue id, eigener Ablauf)', () => {
  const a = showToast(null, { text: 'a' }, 0);
  const b = showToast(a, { text: 'b', ms: 1000 }, 5000);
  assert.equal(b.id, a.id + 1);
  assert.equal(b.text, 'b');
  assert.equal(isExpired(b, 5999), false);
  assert.equal(isExpired(b, 6000), true);
});

test('Pause haelt die Restzeit an, Fortsetzen verlaengert entsprechend', () => {
  const t = showToast(null, { text: 'a' }, 0);
  const p = pauseToast(t, 4000);
  assert.equal(p.remaining, 2000);
  assert.equal(isExpired(p, 999999), false);
  const r = resumeToast(p, 10000);
  assert.equal(isExpired(r, 11999), false);
  assert.equal(isExpired(r, 12000), true);
});

test('ohne Leiste passiert nichts', () => {
  assert.equal(pauseToast(null, 1), null);
  assert.equal(resumeToast(null, 1), null);
  assert.equal(isExpired(null, 1), false);
});
