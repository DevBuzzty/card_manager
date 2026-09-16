const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onCardScanned: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('card-scanned', subscription);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('card-scanned', subscription);
  },
  onPhoneStatus: (cb) => {
    const on = () => cb(true);
    const off = () => cb(false);
    ipcRenderer.on('phone-connected', on);
    ipcRenderer.on('phone-disconnected', off);
    return () => { ipcRenderer.removeListener('phone-connected', on); ipcRenderer.removeListener('phone-disconnected', off); };
  },
  fetchCardData: (passcode) => ipcRenderer.invoke('fetch-card-data', passcode),
  releaseStaged: (passcodes) => ipcRenderer.invoke('release-staged', passcodes),
  addCardToDb: (card) => ipcRenderer.invoke('add-card-to-db', card),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  listCopies: (printing) => ipcRenderer.invoke('list-copies', printing),
  listAllCopies: () => ipcRenderer.invoke('list-all-copies'),
  addCopy: (data) => ipcRenderer.invoke('add-copy', data),
  removeCopy: (data) => ipcRenderer.invoke('remove-copy', data),
  updateCopyGroup: (data) => ipcRenderer.invoke('update-copy-group', data),
  listContainers: () => ipcRenderer.invoke('list-containers'),
  saveContainer: (c) => ipcRenderer.invoke('save-container', c),
  deleteContainer: (id) => ipcRenderer.invoke('delete-container', id),
  setCopyLocation: (loc) => ipcRenderer.invoke('set-copy-location', loc),
  // d.tags ist ein ROHES string[], KEIN vorserialisierter JSON-String -- copies.cjs#setCopyTagsNote
  // serialisiert selbst noch einmal, siehe Kommentar dort.
  setCopyTagsNote: (d) => ipcRenderer.invoke('set-copy-tags-note', d),
  deleteCopy: (d) => ipcRenderer.invoke('delete-copy', d),
  listUnsortedCopies: () => ipcRenderer.invoke('list-unsorted-copies'),
  listTags: () => ipcRenderer.invoke('list-tags'),
  getCollection: () => ipcRenderer.invoke('get-collection'),
  getIpAddress: () => ipcRenderer.invoke('get-ip-address'),
  importCsv: () => ipcRenderer.invoke('import-csv'),
  updateAllCards: () => ipcRenderer.invoke('update-all-cards'),
  updateMissingCards: () => ipcRenderer.invoke('update-missing-cards'),
  checkCardExists: (passcode) => ipcRenderer.invoke('check-card-exists', passcode),
  getPortfolio: () => ipcRenderer.invoke('get-portfolio'),
  getPriceHistory: () => ipcRenderer.invoke('get-price-history'),
  getMovers: (days) => ipcRenderer.invoke('get-movers', { days }),
  getCardHistory: (printing) => ipcRenderer.invoke('get-card-history', printing),
  updateCardMeta: (data) => ipcRenderer.invoke('update-card-meta', data),
  setCardPrice: (data) => ipcRenderer.invoke('set-card-price', data),
  deleteCard: (data) => ipcRenderer.invoke('delete-card', data),
  scrapeCardmarketPrices: (minRank) => ipcRenderer.invoke('scrape-cardmarket-prices', { minRank }),
  abortCardmarketScrape: () => ipcRenderer.invoke('abort-cardmarket-scrape'),
  revealCmWindow: () => ipcRenderer.invoke('reveal-cm-window'),
  onCmChallenge: (cb) => { const l = () => cb(); ipcRenderer.on('cm-challenge', l); return () => ipcRenderer.removeListener('cm-challenge', l); },
  cardmarketBulkRefresh: () => ipcRenderer.invoke('cardmarket-bulk-refresh'),
  cardmarketBulkStatus: () => ipcRenderer.invoke('cardmarket-bulk-status'),
  onUpdateProgress: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('update-progress', subscription);
    return () => ipcRenderer.removeListener('update-progress', subscription);
  },
  onPriceUpdate: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('price-update', subscription);
    return () => ipcRenderer.removeListener('price-update', subscription);
  },
  onSyncStatus: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('sync-status', subscription);
    return () => ipcRenderer.removeListener('sync-status', subscription);
  },
  onCollectionChanged: (cb) => { const s=(_e)=>cb(); ipcRenderer.on('collection-changed', s); return () => ipcRenderer.removeListener('collection-changed', s); },

  // Deck Builder
  getDecks: () => ipcRenderer.invoke('get-decks'),
  createDeck: (name) => ipcRenderer.invoke('create-deck', name),
  deleteDeck: (id) => ipcRenderer.invoke('delete-deck', id),
  saveDeck: (deckId, cards, notes, format) => ipcRenderer.invoke('save-deck', { deckId, cards, notes, format }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
  importDeckYdk: () => ipcRenderer.invoke('import-deck-ydk'),
  exportDeckYdk: (data) => ipcRenderer.invoke('export-deck-ydk', data),
  // Spec E1: Sammlungsabgleich & Deckbox
  listDeckCopies: () => ipcRenderer.invoke('list-deck-copies'),
  getAllDeckCards: () => ipcRenderer.invoke('get-all-deck-cards'),
  setDeckContainer: (data) => ipcRenderer.invoke('set-deck-container', data),
  getCatalogPrices: () => ipcRenderer.invoke('get-catalog-prices'),
  addMissingToWishlist: (items) => ipcRenderer.invoke('deck-missing-to-wishlist', items),
  moveCopiesToContainer: (data) => ipcRenderer.invoke('move-copies-to-container', data),
  // Spec E2: Import & Export
  getCatalogCards: (ids) => ipcRenderer.invoke('get-catalog-cards', ids),
  createImportedDeck: (data) => ipcRenderer.invoke('create-imported-deck', data),
  // Spec E3: Legalitaet & Simulation
  getCatalogLegality: () => ipcRenderer.invoke('get-catalog-legality'),

  // Wishlist
  getWishlist: () => ipcRenderer.invoke('get-wishlist'),
  addToWishlist: (card) => ipcRenderer.invoke('add-to-wishlist', card),
  removeFromWishlist: (id) => ipcRenderer.invoke('remove-from-wishlist', id),
  searchOnline: (query) => ipcRenderer.invoke('search-online', query),

  // Manual Scan
  manualScan: (passcode) => ipcRenderer.invoke('manual-scan', passcode),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSetting: (data) => ipcRenderer.invoke('save-setting', data),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),
  moveDatabase: () => ipcRenderer.invoke('move-database'),

  // Reset
  resetDatabase: () => ipcRenderer.invoke('reset-database'),
  cleanupDatabase: () => ipcRenderer.invoke('cleanup-database'),
  mergeUnknownCards: () => ipcRenderer.invoke('merge-unknown-cards'),
  convertUnknownsToDefault: () => ipcRenderer.invoke('convert-unknowns-to-default'),
  downgradeToLowestRarity: () => ipcRenderer.invoke('downgrade-to-lowest-rarity'),
  fetchYugipediaSets: (passcode) => ipcRenderer.invoke('fetch-yugipedia-sets', passcode),
  fetchJapaneseSets: (passcode) => ipcRenderer.invoke('fetch-japanese-sets', passcode),

  // Offline-Katalog (Spec D1)
  buildCatalogNow: () => ipcRenderer.invoke('catalog-build-now'),
  getCatalogStatus: () => ipcRenderer.invoke('catalog-status'),
  uploadModel: (kind) => ipcRenderer.invoke('model-upload', { kind }),

  // Deals (price-alert scraper)
  addDealWatch: (data) => ipcRenderer.invoke('add-deal-watch', data),
  getDealWatches: () => ipcRenderer.invoke('get-deal-watches'),
  deleteDealWatch: (id) => ipcRenderer.invoke('delete-deal-watch', id),
  toggleDealWatch: (data) => ipcRenderer.invoke('toggle-deal-watch', data),
  getDealAlerts: () => ipcRenderer.invoke('get-deal-alerts'),
  dismissDealAlert: (id) => ipcRenderer.invoke('dismiss-deal-alert', id),
  triggerDealScrape: () => ipcRenderer.invoke('trigger-deal-scrape'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onDealAlert: (cb) => { const s = (_e, v) => cb(v); ipcRenderer.on('deal-alert', s); return () => ipcRenderer.removeListener('deal-alert', s); },
  onDealWatchesChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('deal-watches-changed', s); return () => ipcRenderer.removeListener('deal-watches-changed', s); },

  // Preis-Alarme (Spec G2) — ausgewertet in der Cloud, hier nur lesen/pflegen
  getPriceAlertMove: () => ipcRenderer.invoke('price-alerts-move-get'),
  savePriceAlertMove: (data) => ipcRenderer.invoke('price-alerts-move-save', data),
  getPriceAlertTargets: (printing) => ipcRenderer.invoke('price-alerts-targets-get', printing),
  savePriceAlertTarget: (data) => ipcRenderer.invoke('price-alerts-target-save', data),
  listPriceAlertEvents: () => ipcRenderer.invoke('price-alerts-events-list'),
  dismissPriceAlertEvent: (id) => ipcRenderer.invoke('price-alerts-event-dismiss', id),
  dismissAllPriceAlertEvents: (maxId) => ipcRenderer.invoke('price-alerts-events-dismiss-all', maxId),
  onPriceAlertsChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('price-alerts-changed', s); return () => ipcRenderer.removeListener('price-alerts-changed', s); },
  onOpenPriceAlerts: (cb) => { const s = (_e) => cb(); ipcRenderer.on('open-price-alerts', s); return () => ipcRenderer.removeListener('open-price-alerts', s); },

  // Sealed-Bestand (Spec G3) — lokal in SQLite, der Sync schiebt
  listSealed: () => ipcRenderer.invoke('sealed-list'),
  addSealed: (data) => ipcRenderer.invoke('sealed-add', data),
  setSealedQuantity: (data) => ipcRenderer.invoke('sealed-set-quantity', data),
  openSealed: (sealedId) => ipcRenderer.invoke('sealed-open', sealedId),
  deleteSealed: (sealedId) => ipcRenderer.invoke('sealed-delete', sealedId),
  searchSealedProducts: (query) => ipcRenderer.invoke('sealed-products-search', query),
  sealedProductsAvailable: () => ipcRenderer.invoke('sealed-products-available'),
  onSealedChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('sealed-changed', s); return () => ipcRenderer.removeListener('sealed-changed', s); },
});
