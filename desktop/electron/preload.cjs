const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onCardScanned: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('card-scanned', subscription);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('card-scanned', subscription);
  },
  fetchCardData: (passcode) => ipcRenderer.invoke('fetch-card-data', passcode),
  addCardToDb: (card) => ipcRenderer.invoke('add-card-to-db', card),
  getCollection: () => ipcRenderer.invoke('get-collection'),
  getIpAddress: () => ipcRenderer.invoke('get-ip-address'),
  importCsv: () => ipcRenderer.invoke('import-csv'),
  updateAllCards: () => ipcRenderer.invoke('update-all-cards'),
  updateMissingCards: () => ipcRenderer.invoke('update-missing-cards'),
  checkCardExists: (passcode) => ipcRenderer.invoke('check-card-exists', passcode),
  getPortfolio: () => ipcRenderer.invoke('get-portfolio'),
  getPriceHistory: () => ipcRenderer.invoke('get-price-history'),
  updateCardMeta: (data) => ipcRenderer.invoke('update-card-meta', data),
  deleteCard: (data) => ipcRenderer.invoke('delete-card', data),
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

  // Deck Builder
  getDecks: () => ipcRenderer.invoke('get-decks'),
  createDeck: (name) => ipcRenderer.invoke('create-deck', name),
  deleteDeck: (id) => ipcRenderer.invoke('delete-deck', id),
  saveDeck: (deckId, cards) => ipcRenderer.invoke('save-deck', { deckId, cards }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
  importDeckYdk: () => ipcRenderer.invoke('import-deck-ydk'),
  exportDeckYdk: (data) => ipcRenderer.invoke('export-deck-ydk', data),

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
});
