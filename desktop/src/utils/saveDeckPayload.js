// F1 -- Deckkarten-Payload fuer save-deck (main.cjs, ipcMain.handle('save-deck')). Name/Bild MUESSEN mitgeschickt
// werden: save-deck faellt fuer fehlende Werte auf die lokale cards-Tabelle zurueck, die fuer nicht besessene
// (importierte) Karten kein Zeile hat -- ohne dieses Feld loescht "Save Deck" also Katalognamen/-bilder.
// Spec E3 §6: role MUSS ebenso mit -- save-deck loescht alle Deckkarten und fuegt sie neu ein; ohne role waeren die
// Starter-Sterne nach jedem Speichern weg. Starter gibt es nur im Main Deck.
export function buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }) {
  const map = (list, type) => list.map((c) => ({
    id: c.card_id, type, quantity: c.quantity, name: c.name, image_url: c.image_url,
    role: type === 'main' && c.role === 'starter' ? 'starter' : null,
  }));
  return [...map(mainDeck, 'main'), ...map(extraDeck, 'extra'), ...map(sideDeck, 'side')];
}
