import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handOdds, percentText, oddsTexts, drawHand, NO_MAIN, NO_STARTERS } from './deckOdds.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} != ${b}`);

// Exakte Werte mit BigInt-Binomialkoeffizienten, unabhaengig von der Produktformel.
function binom(n, k) {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
}
const ratio = (a, b) => Number((a * 10n ** 15n) / b) / 1e15;

test('40 Karten, 9 Starter, 5 Karten: 74,2 % (C(31,5)/C(40,5) = 169911/658008)', () => {
  const o = handOdds(40, 9, 5);
  close(o.p0, 169911 / 658008, 'P(0)');
  close(o.p1, 283185 / 658008, 'P(1)');
  close(o.p2plus, 204912 / 658008, 'P(2+)');
  close(o.atLeastOne, 488097 / 658008, 'P(>=1)');
  assert.equal(percentText(o.atLeastOne), '74,2 %');
});

test('Produktformel stimmt mit den Binomialkoeffizienten überein (N 1–20, alle K, n 1–7)', () => {
  for (let N = 1; N <= 20; N++) {
    for (let K = 0; K <= N; K++) {
      for (let n = 1; n <= 7; n++) {
        const d = Math.min(n, N);
        const all = binom(N, d);
        const o = handOdds(N, K, n);
        const tag = `N=${N} K=${K} n=${n}`;
        assert.ok(Math.abs(o.p0 - ratio(binom(N - K, d), all)) < 1e-9, `${tag} P(0)`);
        assert.ok(Math.abs(o.p1 - ratio(binom(K, 1) * binom(N - K, d - 1), all)) < 1e-9, `${tag} P(1)`);
      }
    }
  }
});

test('Kanten: K = 0, K = N, n > N, N = 0', () => {
  assert.deepEqual(handOdds(40, 0, 5), { p0: 1, p1: 0, p2plus: 0, atLeastOne: 0 });
  const all = handOdds(40, 40, 5);
  assert.equal(all.p0, 0);
  assert.equal(all.atLeastOne, 1);
  assert.equal(handOdds(1, 1, 5).p1, 1, 'n auf N begrenzt');
  const small = handOdds(3, 1, 5);
  assert.equal(small.p0, 0);
  close(small.p1, 1, 'alle 3 Karten gezogen: genau 1 Starter');
  assert.equal(handOdds(0, 0, 5), null);
});

test('Prozenttext: eine Nachkommastelle mit Komma', () => {
  assert.equal(percentText(0.25822), '25,8 %');
  assert.equal(percentText(0.43037), '43,0 %');
  assert.equal(percentText(1), '100,0 %');
  assert.equal(percentText(0), '0,0 %');
  assert.equal(percentText(0.00049), '0,0 %');
  assert.equal(percentText(0.0005), '0,1 %');
});

test('Texte für 5 und 6 Karten; ohne Main Deck bzw. ohne Starter der Hinweis', () => {
  const main = [
    { card_id: '1', quantity: 3, role: 'starter' }, { card_id: '2', quantity: 3, role: 'starter' },
    { card_id: '3', quantity: 3, role: 'starter' }, { card_id: '4', quantity: 31, role: null },
  ];
  assert.deepEqual(oddsTexts(main), {
    lines: [
      { size: 5, atLeastOne: '5 Karten: mindestens 1 Starter 74,2 %', distribution: '0: 25,8 % · 1: 43,0 % · 2+: 31,1 %' },
      { size: 6, atLeastOne: '6 Karten: mindestens 1 Starter 80,8 %', distribution: '0: 19,2 % · 1: 39,8 % · 2+: 41,0 %' },
    ],
  });
  assert.deepEqual(oddsTexts([]), { message: NO_MAIN });
  assert.deepEqual(oddsTexts([{ card_id: '4', quantity: 40, role: null }]), { message: NO_STARTERS });
  assert.deepEqual(oddsTexts([{ card_id: '1', count: 2, role: 'starter' }, { card_id: '4', count: 38 }]).lines[0].size, 5, 'count statt quantity');
});

test('Testhand: austauschbare Zufallsquelle, Kopien einzeln, höchstens so viele wie da', () => {
  const a = { card_id: 'a', quantity: 2 };
  const b = { card_id: 'b', quantity: 1, role: 'starter' };
  const c = { card_id: 'c', quantity: 4 };
  const ids = (hand) => hand.map((x) => x.card_id);
  assert.deepEqual(ids(drawHand([a, b, c], 5, () => 0)), ['a', 'a', 'b', 'c', 'c']);
  assert.deepEqual(ids(drawHand([a, b, c], 2, () => 0.999999)), ['c', 'a']);
  const seq = [0.5, 0.1, 0.9];
  let k = 0;
  assert.deepEqual(ids(drawHand([a, b, c], 3, () => seq[k++])), ['c', 'a', 'c']);
  assert.equal(drawHand([a, b, c], 6, Math.random).length, 6);
  assert.equal(drawHand([b], 5, () => 0).length, 1);
  assert.deepEqual(drawHand([], 5, () => 0), []);
  assert.equal(drawHand([a, b, c], 7, () => 0).filter((x) => x.role === 'starter').length, 1, 'Starter-Markierung bleibt am Objekt');
});
