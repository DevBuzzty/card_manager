import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBusyGate, createLatestOnly } from './busyGate.js';

test('Doppelklick: der zweite Start waehrend eines Laufs wird verworfen', async () => {
  const gate = createBusyGate();
  let calls = 0;
  let release;
  const first = gate.run(() => { calls += 1; return new Promise((r) => { release = r; }); });
  assert.equal(gate.running, true);
  assert.equal(await gate.run(() => { calls += 1; }), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(gate.running, false);
  assert.equal(await gate.run(() => { calls += 1; }), true);
  assert.equal(calls, 2);
});

test('eine werfende Aktion gibt das Gatter wieder frei', async () => {
  const gate = createBusyGate();
  await assert.rejects(gate.run(async () => { throw new Error('kaputt'); }), /kaputt/);
  assert.equal(gate.running, false);
  assert.equal(await gate.run(() => {}), true);
});

test('latestOnly: eine spaeter gestartete, aber frueher ankommende Antwort gewinnt gegen die aeltere', async () => {
  const latest = createLatestOnly();
  const applied = [];
  let resolveFirst;
  let resolveSecond;
  const firstToken = latest.start();
  const first = new Promise((r) => { resolveFirst = r; });
  const secondToken = latest.start();
  const second = new Promise((r) => { resolveSecond = r; });
  first.then(() => { if (latest.isCurrent(firstToken)) applied.push('first'); });
  second.then(() => { if (latest.isCurrent(secondToken)) applied.push('second'); });
  resolveSecond();
  await second;
  resolveFirst();
  await first;
  assert.deepEqual(applied, ['second']);
});
