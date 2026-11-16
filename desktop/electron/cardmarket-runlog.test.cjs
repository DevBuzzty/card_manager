const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendLog, pauseUntilIso, pauseActive, PAUSE_HOURS } = require('./cardmarket-runlog.cjs');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-runlog-')), 'x.log');
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);

test('appendLog hängt an statt zu leeren', () => {
  const f = tmpFile();
  appendLog(f, { a: 1 });
  appendLog(f, { a: 2 });
  const l = lines(f);
  assert.strictEqual(l.length, 2);
  const e = JSON.parse(l[1]);
  assert.strictEqual(e.a, 2);
  assert.ok(e.at);
});

test('appendLog rotiert über maxBytes', () => {
  const f = tmpFile();
  appendLog(f, { a: 1 }, { maxBytes: 10 });
  appendLog(f, { a: 2 }, { maxBytes: 10 });
  assert.ok(fs.existsSync(f + '.1'));
  assert.strictEqual(lines(f).length, 1);
  assert.strictEqual(JSON.parse(lines(f)[0]).a, 2);
});

test('appendLog schluckt Fehler', () => {
  assert.doesNotThrow(() => appendLog(path.join(os.tmpdir(), 'gibt-es-nicht', 'x', 'y.log'), { a: 1 }));
});

test('pauseActive', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.strictEqual(pauseActive(null, now), false);
  assert.strictEqual(pauseActive('kaputt', now), false);
  assert.strictEqual(pauseActive('2026-11-16T13:00:00.000Z', now), true);
  assert.strictEqual(pauseActive('2026-11-16T11:00:00.000Z', now), false);
});

test('pauseUntilIso', () => {
  assert.strictEqual(PAUSE_HOURS, 6);
  assert.strictEqual(pauseUntilIso(Date.parse('2026-11-16T12:00:00Z')), '2026-11-16T18:00:00.000Z');
});
