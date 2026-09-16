// F1 -- Deckkarten-Payload fuer save-deck (main.cjs, ipcMain.handle('save-deck')). Name/Bild MUESSEN mitgeschickt
// werden: save-deck faellt fuer fehlende Werte auf die lokale cards-Tabelle zurueck, die fuer nicht besessene
// (importierte) Karten kein Zeile hat -- ohne dieses Feld loescht "Save Deck" also Katalognamen/-bilder.
export function buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }) {
  const map = (list, type) => list.map((c) => ({
    id: c.card_id, type, quantity: c.quantity, name: c.name, image_url: c.image_url,
  }));
  return [...map(mainDeck, 'main'), ...map(extraDeck, 'extra'), ...map(sideDeck, 'side')];
}
