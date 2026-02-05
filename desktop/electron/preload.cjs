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
  onUpdateProgress: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('update-progress', subscription);
    return () => ipcRenderer.removeListener('update-progress', subscription);
  },
});
