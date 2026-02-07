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
  onUpdateProgress: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('update-progress', subscription);
    return () => ipcRenderer.removeListener('update-progress', subscription);
  },

  // Deck Builder
  getDecks: () => ipcRenderer.invoke('get-decks'),
  createDeck: (name) => ipcRenderer.invoke('create-deck', name),
  deleteDeck: (id) => ipcRenderer.invoke('delete-deck', id),
  saveDeck: (deckId, cards) => ipcRenderer.invoke('save-deck', { deckId, cards }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
  importDeckYdk: () => ipcRenderer.invoke('import-deck-ydk'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', { key, value }),
});
