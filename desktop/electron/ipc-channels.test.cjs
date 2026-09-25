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

// Spec H1 §6: Exemplare fuer Duplikate/Verkaufsliste laden, Verkaufsliste umschalten.
const H1_CHANNELS = ['list-sale-copies', 'set-for-sale'];

// Spec H2 §5–§7: Kanaele, Vorschau, Buchen, Bearbeiten, Storno, Uebersicht, Detail, Kartenansicht.
const H2_CHANNELS = ['sale-channels', 'sale-channel-save', 'sale-channel-hide', 'sale-preview', 'sale-book', 'sale-update',
  'sale-cancel', 'sales-overview', 'sale-detail', 'card-sales'];

// Spec H3a §5–§7: Vorschau, Anlegen, Bearbeiten, Herausnehmen, Beenden, Erneut anbieten, Übersicht, Detail, Kürzel, Link, Bilder.
const H3A_CHANNELS = ['listing-preview', 'listing-create', 'listing-update', 'listing-remove-items', 'listing-end', 'listing-relist',
  'listings-overview', 'listing-detail', 'listing-offers', 'listing-open-url', 'listing-save-images'];

// Spec H3b1 §4.4/§5.4/§6: eBay-Stand, eBay-Zeilen, Verbinden/Einrichten, Abgleich anstoßen, eigene Fotos.
const H3B1_CHANNELS = ['ebay-status', 'ebay-listings', 'ebay-auth', 'ebay-sync-now', 'listing-photos', 'listing-photo-add',
  'listing-photo-delete', 'listing-photo-reorder'];

// Spec H3b2 §7.6: eBay-Hinweise, Wegtippen, Stand der eBay-Bestellungen.
const H3B2_CHANNELS = ['sale-notices', 'sale-notice-dismiss', 'ebay-orders'];

// Mehrfachauswahl (Plan 2026-09-26): verschieben und rückgängig.
const AUSWAHL_CHANNELS = ['relocate-copies', 'restore-copy-locations'];

// Spec I1 Task 6 §3.1: Zaehler der Seitenleiste (Scannen, Verkaufen).
const I1_CHANNELS = ['nav-counts'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS, ...F1_CHANNELS, ...H1_CHANNELS, ...H2_CHANNELS, ...H3A_CHANNELS, ...H3B1_CHANNELS, ...H3B2_CHANNELS, ...AUSWAHL_CHANNELS, ...I1_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
    assert.ok(MAIN.includes(`ipcMain.handle('${ch}'`), `main.cjs fehlt ipcMain.handle('${ch}'`);
    assert.ok(PRELOAD.includes(`ipcRenderer.invoke('${ch}'`), `preload.cjs fehlt ipcRenderer.invoke('${ch}'`);
  });
}
