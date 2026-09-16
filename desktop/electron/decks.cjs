// Spec E1 §3/§6/§7 — Hauptprozess-Helfer der Decks: Deckbox zuordnen, Fehlende auf die Wunschliste, Exemplare in die
// Deckbox. `client` ist der Supabase-Client aus dealsClient(); die Tests reichen eine Attrappe herein.
const { ValidationError, setCopyLocation } = require('./copies.cjs');

const DECKBOX_TAKEN = 'Diese Deckbox gehört schon zu einem anderen Deck';

// Postgres unique_violation (Index decks_container_unique) -> deutsche Meldung; sonst die Rohmeldung wie bei den
// uebrigen Cloud-Kanaelen der Decks.
function deckContainerErrorMessage(error) {
  if (error && error.code === '23505') return DECKBOX_TAKEN;
  return (error && error.message) || 'Speichern fehlgeschlagen.';
}

async function setDeckContainer(client, { deckId, containerId } = {}) {
  const { error } = await client.from('decks').update({ container_id: containerId || null }).eq('id', deckId);
  if (error) return { success: false, error: deckContainerErrorMessage(error) };
  return { success: true };
}

// items: [{ card_id, name, image_url, max_price }]. Eintrag fuer Eintrag; ein Eintrag mit Preis bekommt wie
// add-to-wishlist einen Deal-Watch (dessen Fehler bricht den Eintrag nicht ab). Die Cloud-Suche wird hoechstens
// EINMAL am Ende angestossen, und nur, wenn mindestens ein Deal-Watch entstanden ist (Spec E1 §6).
async function addMissingToWishlist(client, items, triggerScrape) {
  const list = Array.isArray(items) ? items : [];
  let added = 0;
  let watches = 0;
  const failed = [];
  for (const it of list) {
    const cardId = String(it.card_id);
    const name = it.name || cardId;
    const maxPrice = typeof it.max_price === 'number' ? it.max_price : null;
    let error;
    try {
      ({ error } = await client.from('wishlist').insert({ card_id: cardId, name, image_url: it.image_url || null, max_price: maxPrice }));
    } catch (e) { error = e; }
    if (error) { failed.push(cardId); continue; }
    added += 1;
    if (maxPrice == null) continue;
    try {
      const { error: watchError } = await client.from('deal_watches').insert({ query: name, max_price: maxPrice });
      if (!watchError) watches += 1;
    } catch { /* wie add-to-wishlist: nie fatal */ }
  }
  if (watches > 0) triggerScrape(client);
  return { total: list.length, added, watches, failed };
}

// Exemplar fuer Exemplar ueber setCopyLocation (leert page/slot, weil eine Deckbox keine Seiten hat). Ein Fehlschlag
// betrifft nur seine Zeile; `messageOf` ist containerCopyErrorMessage aus main.cjs.
function moveCopiesToContainer(db, { copyIds, containerId } = {}, messageOf) {
  const box = containerId
    ? db.prepare('SELECT kind FROM containers WHERE container_id = ? AND deleted = 0').get(containerId)
    : null;
  if (!box || box.kind !== 'deckbox') throw new ValidationError('Die Deckbox wurde nicht gefunden.');
  return (Array.isArray(copyIds) ? copyIds : []).map((copy_id) => {
    try {
      setCopyLocation(db, { copy_id, container_id: containerId, page: null, slot: null });
      return { copy_id, success: true };
    } catch (e) {
      return { copy_id, success: false, error: messageOf(e) };
    }
  });
}

module.exports = { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer };
