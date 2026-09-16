import { conditionFactor, unitPrice } from './valuation.js';
import { deckCoverage, validDeckboxIds } from './deckCoverage.js';

// Spec E1 §7 — Vorschlag "Box befüllen" und die Texte des Dialogs.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/FillBoxProposal.kt. Beide laufen gegen
// docs/fixtures/decks/fill-box.json. Wer eine Seite aendert, aendert beide.

// Gruppen: 1 unsortiert (auch: Behaelter unbekannt), 2 Box oder keinem Deck zugeordnete Deckbox, 3 Ordner.
function groupOf(copy, containersById) {
  const c = copy.container_id ? containersById.get(copy.container_id) : null;
  if (!c) return 1;
  return c.kind === 'binder' ? 3 : 2;
}

// input wie deckCoverage, copies zusaetzlich mit edition, condition, price, price_first_ed.
// Ergebnis null ohne gueltige Deckbox; sonst { rows: [{ copy_id, card_id, group }], short, surplus }.
export function fillBoxProposal(input) {
  const cov = deckCoverage({ ...input, prices: {} });
  if (!cov.boxId) return null;
  const valid = validDeckboxIds(input.containers);
  const reservedBoxes = new Set(
    (input.decks || []).filter((d) => d.id !== input.deckId && d.container_id && valid.has(d.container_id)).map((d) => d.container_id),
  );
  const containersById = new Map((input.containers || []).filter((c) => !c.deleted).map((c) => [c.container_id, c]));
  const live = (input.copies || []).filter((cp) => !cp.deleted && !cp.printing_deleted);

  const rows = [];
  for (const card of cov.cards) {
    const take = Math.max(0, Math.min(card.needed - card.inBox, card.available - card.inBox));
    if (take === 0) continue;
    const candidates = live
      .filter((cp) => String(cp.card_id) === card.card_id && cp.container_id !== cov.boxId && !reservedBoxes.has(cp.container_id))
      .map((cp) => ({ cp, group: groupOf(cp, containersById), value: unitPrice(cp, cp) * conditionFactor(cp.condition) }))
      .sort((a, b) => a.group - b.group || a.value - b.value || (a.cp.copy_id < b.cp.copy_id ? -1 : a.cp.copy_id > b.cp.copy_id ? 1 : 0));
    for (const c of candidates.slice(0, take)) rows.push({ copy_id: c.cp.copy_id, card_id: card.card_id, group: c.group });
  }

  const needed = new Map(cov.cards.map((c) => [c.card_id, c.needed]));
  const inBox = new Map();
  for (const cp of live) if (cp.container_id === cov.boxId) inBox.set(String(cp.card_id), (inBox.get(String(cp.card_id)) || 0) + 1);
  let surplus = 0;
  for (const [id, n] of inBox) surplus += Math.max(0, n - (needed.get(id) || 0));

  return { rows, short: cov.totals.missing, surplus };
}

export function locationText(copy, container) {
  if (!copy || !copy.container_id || !container) return 'unsortiert';
  if (container.kind === 'binder' && copy.page != null && copy.slot != null) return `${container.name} · S. ${copy.page} · Fach ${copy.slot}`;
  return container.name;
}

export function shortText(n) {
  if (!n) return null;
  return n === 1 ? '1 fehlt noch – nicht in der Sammlung' : `${n} fehlen noch – nicht in der Sammlung`;
}

export const surplusText = (n) => (n ? `${n} überzählig in der Box` : null);
