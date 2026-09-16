// Spec E1 §3/§6/§7 — Hauptprozess-Helfer der Decks: Deckbox zuordnen, Fehlende auf die Wunschliste, Exemplare in die
// Deckbox. `client` ist der Supabase-Client aus dealsClient(); die Tests reichen eine Attrappe herein.
// ZWILLING (F3, Deal-Watch nur mit echtem Namen): android/app/src/main/java/com/example/yugiohscanner/ml/DeckWishlist.kt
// (addAll) bzw. WishlistRepository.addToWishlist. Beide legen den Wunschlisten-Eintrag mit dem Passcode als
// Namens-Rueckfall an, aber nie einen Deal-Watch dafuer.
const fs = require('fs');
const path = require('path');
const { ValidationError, setCopyLocation } = require('./copies.cjs');

const DECKBOX_TAKEN = 'Diese Deckbox gehört schon zu einem anderen Deck';

// F3: ein Deal-Watch mit dem Passcode als Suchbegriff faende nichts -- also nur mit einem echten Namen (nicht leer,
// nicht der Passcode-Rueckfall selbst).
function hasDealWatchName(name, cardId) {
  return typeof name === 'string' && name.trim() !== '' && name !== cardId;
}

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
    if (maxPrice == null || !hasDealWatchName(name, cardId)) continue;
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

// Spec E2 §5 -- YDK-Datei fuer den Import: nur lesen, das Parsen macht der Renderer mit dem gemeinsamen Parser
// (deckFormats.js). Antwortform { canceled: false, name, text }; name = Dateiname ohne .ydk.
function readYdkFile(filePath) {
  return { canceled: false, name: path.basename(filePath, path.extname(filePath)), text: fs.readFileSync(filePath, 'utf8') };
}

// Spec E2 §5 -- Import legt immer ein NEUES Deck an: erst das Deck (mit Notizen), dann alle Deckkarten in einem Insert.
// Scheitert das Einfuegen der Karten, wird das leere Deck wieder geloescht. `imageOf(passcode)` liefert das Katalogbild.
// Rueckgabe { success: true, deck } oder { success: false, error } (Rohmeldung; "Import fehlgeschlagen: …" setzt der
// Renderer ueber deckImport.js#failedText).
// ZWILLING (Rueckbau): android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt#createWithRollback.
async function createImportedDeck(client, { name, notes, cards } = {}, imageOf = () => null) {
  // notes nur mitsenden, wenn es welche gibt: ein Import ohne Nicht-Uebernommenes klappt so auch vor decks_notes.sql.
  const deckRow = notes ? { name, notes } : { name };
  let deck;
  try {
    const { data, error } = await client.from('decks').insert(deckRow).select('*').single();
    if (error) return { success: false, error: error.message || 'Deck anlegen fehlgeschlagen.' };
    deck = data;
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
  const rows = (Array.isArray(cards) ? cards : []).map((c) => ({
    deck_id: deck.id, card_id: String(c.card_id), name: c.name || null,
    image_url: imageOf(String(c.card_id)) || null, count: c.count, section: c.section,
  }));
  if (rows.length === 0) return { success: true, deck };
  let error;
  try { ({ error } = await client.from('deck_cards').insert(rows)); } catch (e) { error = e; }
  if (!error) return { success: true, deck };
  try {
    const { error: deleteError } = await client.from('decks').delete().eq('id', deck.id);
    if (deleteError) console.error('[create-imported-deck] leeres Deck nicht geloescht:', deleteError.message);
  } catch (e) { console.error('[create-imported-deck] leeres Deck nicht geloescht:', e.message); }
  return { success: false, error: error.message || String(error) };
}

const FORMAT_SAVE_FAILED = 'Format konnte nicht gespeichert werden';

// Spec E3 §6 -- Zeilen fuer "Save Deck". role steht nur an Starter-Zeilen des Main Decks: so bleibt ein Deck ohne Sterne
// auch vor decks_format_role.sql speicherbar (supabase-js nennt im Insert nur Spalten, die in einer Zeile vorkommen).
// detailOf(passcode) -> { name, image_url } aus der lokalen Sammlung (Rueckfall, wenn der Renderer nichts mitschickt).
function saveDeckRows(deckId, cards, detailOf = () => null) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const det = detailOf(String(card.id)) || {};
    const row = {
      deck_id: deckId, card_id: String(card.id),
      name: card.name || det.name || null,
      image_url: card.image_url || det.image_url || null,
      count: card.quantity || 1,
      section: card.type || 'main',
    };
    if (card.role === 'starter' && row.section === 'main') row.role = 'starter';
    return row;
  });
}

// "Save Deck" (bisher direkt in main.cjs): alle Deckkarten loeschen und neu einfuegen, dann Notizen (Spec E2 §5) und
// Format (Spec E3 §4), jeweils nur, wenn der Renderer sie mitschickt (er tut es nur bei einer Aenderung).
// Spec E3 §8: scheitert der Insert mit Sternen (Spalte role fehlt noch), werden dieselben Zeilen ohne role eingefuegt --
// sonst waeren die Deckkarten nach dem Loeschen verloren; roleSaved = false. Ein gescheitertes Format meldet
// "Format konnte nicht gespeichert werden".
async function saveDeck(client, { deckId, cards, notes, format } = {}, detailOf = () => null) {
  await client.from('deck_cards').delete().eq('deck_id', deckId);
  let roleSaved = true;
  const rows = saveDeckRows(deckId, cards, detailOf);
  if (rows.length) {
    let { error } = await client.from('deck_cards').insert(rows);
    if (error && rows.some((r) => r.role)) {
      ({ error } = await client.from('deck_cards').insert(rows.map(({ role: _role, ...rest }) => rest)));
      if (!error) roleSaved = false;
    }
    if (error) throw new Error(error.message);
  }
  if (notes !== undefined) {
    const { error } = await client.from('decks').update({ notes: notes || null }).eq('id', deckId);
    if (error) throw new Error(error.message);
  }
  if (format !== undefined) {
    const { error } = await client.from('decks').update({ format }).eq('id', deckId);
    if (error) throw new Error(FORMAT_SAVE_FAILED);
  }
  return { success: true, roleSaved };
}

module.exports = {
  DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck,
  FORMAT_SAVE_FAILED, saveDeckRows, saveDeck,
};
