// Spec E3 §6 — Starthand-Wahrscheinlichkeiten (exakt, hypergeometrisch) und Testhand. Nur Desktop, kein Zwilling.

export const NO_MAIN = 'Keine Main-Deck-Karten';
export const NO_STARTERS = 'Markiere Starthand-Ziele mit dem Stern';
export const HAND_SIZES = [5, 6];

// P(genau 0), P(genau 1), P(mindestens 2), P(mindestens 1) fuer N Karten, K Starter, n gezogene Karten -- ueber Produkte
// von Bruechen (keine grossen Binomialkoeffizienten). n wird auf N begrenzt; K >= N -> P(0) = 0; N = 0 -> null.
export function handOdds(N, K, n) {
  if (!(N > 0)) return null;
  const k = Math.min(Math.max(0, K), N);
  const draw = Math.min(Math.max(0, n), N);
  // P(0) = prod_{i<draw} (N-K-i)/(N-i)
  let p0 = 1;
  for (let i = 0; i < draw; i++) p0 *= Math.max(0, N - k - i) / (N - i);
  // P(1) = draw * K/N * prod_{i<draw-1} (N-K-i)/(N-1-i)
  let p1 = 0;
  if (draw >= 1 && k >= 1) {
    p1 = (draw * k) / N;
    for (let i = 0; i < draw - 1; i++) p1 *= Math.max(0, N - k - i) / (N - 1 - i);
  }
  const p2plus = Math.max(0, 1 - p0 - p1);
  return { p0, p1, p2plus, atLeastOne: 1 - p0 };
}

// "74,2 %" -- eine Nachkommastelle, deutsches Komma.
export function percentText(p) {
  const tenths = Math.round(p * 1000);
  return `${Math.floor(tenths / 10)},${tenths % 10} %`;
}

// mainCards: [{ quantity|count, role }] des Main Decks. Ergebnis { message } oder { lines: [{ size, atLeastOne, distribution }] }.
export function oddsTexts(mainCards) {
  const countOf = (c) => Math.max(0, Number(c.quantity ?? c.count) || 0);
  const N = (mainCards || []).reduce((a, c) => a + countOf(c), 0);
  const K = (mainCards || []).filter((c) => c.role === 'starter').reduce((a, c) => a + countOf(c), 0);
  if (N === 0) return { message: NO_MAIN };
  if (K === 0) return { message: NO_STARTERS };
  return {
    lines: HAND_SIZES.map((size) => {
      const o = handOdds(N, K, size);
      return {
        size,
        atLeastOne: `${size} Karten: mindestens 1 Starter ${percentText(o.atLeastOne)}`,
        distribution: `0: ${percentText(o.p0)} · 1: ${percentText(o.p1)} · 2+: ${percentText(o.p2plus)}`,
      };
    }),
  };
}

// Testhand: `size` zufaellige Karten aus dem Main Deck, Kopien einzeln (hoechstens so viele, wie da sind).
// rng liefert Zahlen in [0, 1) und ist austauschbar (Tests). Teil-Fisher-Yates, Reihenfolge = Ziehreihenfolge.
export function drawHand(mainCards, size, rng = Math.random) {
  const pile = [];
  for (const c of mainCards || []) {
    const n = Math.max(0, Number(c.quantity ?? c.count) || 0);
    for (let i = 0; i < n; i++) pile.push(c);
  }
  const take = Math.min(size, pile.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pile.length - i));
    [pile[i], pile[j]] = [pile[j], pile[i]];
  }
  return pile.slice(0, take);
}
