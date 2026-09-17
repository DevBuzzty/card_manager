const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Spec E1 §11: jeder neue Kanal steht in main.cjs (Handler) UND in preload.cjs (Bruecke) -- fehlt einer, kann der
// Renderer ihn nicht aufrufen, und das faellt erst beim Klicken auf.
const MAIN = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
const E1_CHANNELS = [
  'list-deck-copies', 'get-all-deck-cards', 'set-deck-container',
  'get-catalog-prices', 'deck-missing-to-wishlist', 'move-copies-to-container',
];

// Spec E2 §9: neue Kanaele plus die umgebauten Deck-Kanaele (YDK lesen/schreiben, Notizen).
const E2_CHANNELS = ['get-catalog-cards', 'create-imported-deck', 'import-deck-ydk', 'export-deck-ydk', 'save-deck'];

// Spec E3 §10: neuer Kanal fuer die Legalitaet plus die umgebauten Deck-Kanaele (Format, Starter).
const E3_CHANNELS = ['get-catalog-legality', 'get-deck-details'];

// Spec F1 §3/§4: Card-Dex-Import (Datei öffnen, Regel wechseln, Übernehmen) und Export (Anzahl, Datei schreiben).
const F1_CHANNELS = ['import-open', 'import-resolve', 'import-run', 'export-count', 'export-run'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS, ...F1_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
    assert.ok(MAIN.includes(`ipcMain.handle('${ch}'`), `main.cjs fehlt ipcMain.handle('${ch}'`);
    assert.ok(PRELOAD.includes(`ipcRenderer.invoke('${ch}'`), `preload.cjs fehlt ipcRenderer.invoke('${ch}'`);
  });
}
