// Spec E1 §6 — "Fehlende auf die Wunschliste": Auswahl, Hoechstpreis und Texte.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckWishlist.kt. Beide laufen gegen
// docs/fixtures/decks/wishlist.json. Wer eine Seite aendert, aendert beide.

// max_price = 1,2 x Katalogpreis, auf Cent gerundet; ohne Preis null (dann kein Deal-Watch).
export function wishlistMaxPrice(cmPrice) {
  if (typeof cmPrice !== 'number' || !(cmPrice > 0)) return null;
  return Math.round(cmPrice * 1.2 * 100) / 100;
}

// coverage: Ergebnis von deckCoverage; wishlistCardIds: Passcodes, die schon auf der Wunschliste stehen.
export function missingForWishlist(coverage, wishlistCardIds) {
  const listed = new Set((wishlistCardIds || []).map(String));
  const candidates = [];
  let alreadyListed = 0;
  let withoutPrice = 0;
  for (const c of coverage.cards) {
    if (c.missing <= 0) continue;
    if (listed.has(c.card_id)) { alreadyListed += 1; continue; }
    const maxPrice = wishlistMaxPrice(c.price);
    if (maxPrice == null) withoutPrice += 1;
    candidates.push({ card_id: c.card_id, max_price: maxPrice });
  }
  return { candidates, alreadyListed, withoutPrice };
}

const karten = (n) => (n === 1 ? 'Karte' : 'Karten');

export function wishlistConfirmText({ candidates, alreadyListed, withoutPrice }) {
  const n = candidates.length;
  if (n === 0) return 'Alle fehlenden Karten stehen schon auf der Wunschliste.';
  const parts = [];
  if (alreadyListed > 0) parts.push(`${alreadyListed} ${alreadyListed === 1 ? 'steht' : 'stehen'} schon drauf`);
  if (withoutPrice > 0) {
    parts.push(withoutPrice === 1
      ? '1 hat keinen Preis und bekommt keine Deal-Suche'
      : `${withoutPrice} haben keinen Preis und bekommen keine Deal-Suche`);
  }
  return `${n} fehlende ${karten(n)} auf die Wunschliste setzen?${parts.length ? ` ${parts.join(', ')}.` : ''}`;
}

// result: { total, added, watches } — watches = Anzahl angelegter Deal-Watches.
export function wishlistResultText({ total, added, watches }) {
  const failed = total - added;
  if (failed > 0) return `${added} von ${total} hinzugefügt, ${failed} fehlgeschlagen`;
  return `${added} ${karten(added)} auf der Wunschliste${watches > 0 ? ', Deal-Suche läuft.' : '.'}`;
}
