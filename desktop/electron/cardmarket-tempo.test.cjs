const test = require('node:test');
const assert = require('node:assert/strict');
// cardmarket-scraper.cjs zieht electron nach -- fuer den reinen Rechenteil genuegt ein Stub.
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { BrowserWindow: function () {}, session: { fromPartition: () => ({}) } };
  return orig.call(this, req, ...rest);
};
const { pauseNachPruefungen } = require('./cardmarket-scraper.cjs');
Module._load = orig;

test('ohne Pruefung bleibt das bisherige Tempo (2-4 s)', () => {
  assert.deepEqual(pauseNachPruefungen(0), { lo: 2000, hi: 4000 });
});

test('jede Pruefung verdoppelt die Pause', () => {
  assert.deepEqual(pauseNachPruefungen(1), { lo: 4000, hi: 8000 });
  assert.deepEqual(pauseNachPruefungen(2), { lo: 8000, hi: 16000 });
});

test('die Pause bleibt bei hoechstens 16 s', () => {
  assert.deepEqual(pauseNachPruefungen(3), { lo: 16000, hi: 16000 });
  assert.deepEqual(pauseNachPruefungen(10), { lo: 16000, hi: 16000 });
});
