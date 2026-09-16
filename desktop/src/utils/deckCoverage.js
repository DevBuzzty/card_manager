import { fmtNum } from './format.js';

// Spec E1 §4/§5/§8 — Abgleich eines Decks mit der Sammlung und die Texte dazu.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckCoverage.kt. Beide laufen gegen
// docs/fixtures/decks/coverage.json. Wer eine Seite aendert, aendert beide.

export const LOADING = '…';

const round2 = (v) => Math.round(v * 100) / 100;

// Gueltige Deckbox = lebender Behaelter mit kind 'deckbox'. Eine geloeschte oder umgestellte Box gilt als "keine Box".
export function validDeckboxIds(containers) {
  const out = new Set();
  for (const c of containers || []) if (c && !c.deleted && c.kind === 'deckbox') out.add(c.container_id);
  return out;
}

// Spec E1 §3: waehlbar sind gueltige Deckboxen, die keinem ANDEREN Deck gehoeren (die eigene also mit),
// in der Reihenfolge der Behaelterliste.
export function deckBoxChoices(deckId, decks, containers) {
  const taken = new Set((decks || []).filter((d) => d.id !== deckId && d.container_id).map((d) => d.container_id));
  return (containers || []).filter((c) => !c.deleted && c.kind === 'deckbox' && !taken.has(c.container_id));
}

export function deckBoxId(deck, containers) {
  const id = deck && deck.container_id;
  return id && validDeckboxIds(containers).has(id) ? id : null;
}

// input: { deckId, deckCards: [{card_id, count, section}], copies: [{copy_id, card_id, container_id, deleted?, printing_deleted?}],
//          decks: [{id, name, container_id}], containers: [{container_id, name, kind, deleted?}], prices: {passcode: number|null} }
export function deckCoverage({ deckId, deckCards, copies, decks, containers, prices }) {
  const valid = validDeckboxIds(containers);
  const boxOf = (d) => (d.container_id && valid.has(d.container_id) ? d.container_id : null);
  const own = (decks || []).find((d) => d.id === deckId);
  const boxId = own ? boxOf(own) : null;
  const otherBox = new Map(); // container_id -> Deck
  for (const d of decks || []) {
    const b = boxOf(d);
    if (d.id !== deckId && b) otherBox.set(b, d);
  }

  const byCard = new Map();
  for (const dc of deckCards || []) {
    const id = String(dc.card_id);
    const e = byCard.get(id) || { card_id: id, needed: 0, inBox: 0, live: 0, reserved: new Map() };
    e.needed += Number(dc.count) || 0;
    byCard.set(id, e);
  }
  for (const cp of copies || []) {
    if (cp.deleted || cp.printing_deleted) continue;
    const e = byCard.get(String(cp.card_id));
    if (!e) continue;
    e.live += 1;
    if (boxId && cp.container_id === boxId) e.inBox += 1;
    else if (cp.container_id && otherBox.has(cp.container_id)) {
      const d = otherBox.get(cp.container_id);
      const r = e.reserved.get(d.id) || { deck_id: d.id, name: d.name, count: 0 };
      r.count += 1;
      e.reserved.set(d.id, r);
    }
  }

  const deckOrder = new Map((decks || []).map((d, i) => [d.id, i]));
  const cards = [];
  const totals = { needed: 0, owned: 0, boxed: 0, missing: 0, missingCards: 0, cost: 0, unpriced: 0 };
  for (const e of byCard.values()) {
    // Reihenfolge der Deckliste, damit beide Geraete die Markierungen gleich ordnen.
    const reservedElsewhere = Array.from(e.reserved.values()).sort((a, b) => deckOrder.get(a.deck_id) - deckOrder.get(b.deck_id));
    const reservedCount = reservedElsewhere.reduce((s, r) => s + r.count, 0);
    const available = e.live - reservedCount;
    const missing = Math.max(0, e.needed - available);
    const p = prices ? prices[e.card_id] : null;
    const price = typeof p === 'number' && p > 0 ? p : null;
    const missingCost = price == null ? null : round2(missing * price);
    cards.push({ card_id: e.card_id, needed: e.needed, inBox: e.inBox, available, missing, price, missingCost, reservedElsewhere });
    totals.needed += e.needed;
    totals.owned += Math.min(e.needed, available);
    totals.boxed += Math.min(e.needed, e.inBox);
    totals.missing += missing;
    if (missing > 0) {
      totals.missingCards += 1;
      if (price == null) totals.unpriced += 1;
      else totals.cost += missingCost;
    }
  }
  totals.cost = round2(totals.cost);
  return { boxId, cards, totals };
}

export const eur = (v) => `${fmtNum(v)} €`;

export function costText(totals) {
  if (!totals || totals.missing === 0) return null;
  if (totals.unpriced === totals.missingCards) return 'Preis unbekannt';
  if (totals.unpriced > 0) return `ca. ${eur(totals.cost)} + ${totals.unpriced} ohne Preis`;
  return `ca. ${eur(totals.cost)}`;
}

export function headerText(cov) {
  const t = cov.totals;
  const cost = costText(t);
  return `vorhanden ${t.owned}/${t.needed} · in der Box ${t.boxed}/${t.needed} · fehlen ${t.missing}${cost ? ` · ${cost}` : ''}`;
}

export function listText(cov) {
  const t = cov.totals;
  const cost = costText(t);
  return `${t.owned}/${t.needed} vorhanden${cost ? ` · ${cost}` : ''}`;
}

export function boxLabel(deck, containers) {
  const id = deckBoxId(deck, containers);
  const c = id && (containers || []).find((x) => x.container_id === id);
  return c ? c.name : 'keine Box';
}

export const rowText = (card) => `Box ${card.inBox} · verfügbar ${card.available} · gebraucht ${card.needed}`;

export const reservedTexts = (card) => card.reservedElsewhere.map((r) => `${r.count} in Deck ${r.name}`);
