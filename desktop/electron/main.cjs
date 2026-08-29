const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const os = require('os');
const { initDatabase, getDb } = require('./database.cjs');
const { fetchCardData, fetchYugipediaSets } = require('./api-handler.cjs');
const { startSync } = require('./sync.cjs');

// Initialize Database
const userDataPath = app.getPath('userData');
const db = initDatabase(userDataPath);

let mainWindow;
let io;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#121212',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function startSocketServer() {
  io = new Server(4000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    socket.on('card_scanned', (data) => {
      if (mainWindow) mainWindow.webContents.send('card-scanned', data);
    });
  });
  console.log('Socket.io server running on port 4000');
}

let priceUpdateInterval;

app.whenReady().then(() => {
  createWindow();
  startSocketServer();
  startPricePoller();
  startSync(db, () => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Helper Functions ---

const valOrNull = (v) => (v !== undefined && v !== null && v !== '') ? v : null;

function findBestDefaultSet(cardSets) {
    if (!cardSets || cardSets.length === 0) return null;
    return cardSets.sort((a, b) => {
        const getRank = (r) => {
            if (!r) return 10;
            const lower = r.toLowerCase();
            if (lower === 'common') return 1;
            if (lower === 'short print') return 2;
            if (lower === 'rare') return 3;
            if (lower === 'super rare') return 4;
            if (lower === 'ultra rare') return 5;
            if (lower === 'secret rare') return 6;
            return 10;
        };
        const rankA = getRank(a.set_rarity);
        const rankB = getRank(b.set_rarity);
        if (rankA !== rankB) return rankA - rankB;
        const pA = parseFloat(a.set_price) || 0;
        const pB = parseFloat(b.set_price) || 0;
        const priceA = pA === 0 ? 999999 : pA;
        const priceB = pB === 0 ? 999999 : pB;
        return priceA - priceB;
    })[0];
}

// Resolve the configured price source to its YGOPRODeck API field.
function getPriceSourceField() {
    let priceSource = 'cardmarket';
    try {
        const r = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
        if (r) priceSource = r.value;
    } catch (e) { /* settings table may be empty */ }
    const sourceMap = { cardmarket: 'cardmarket_price', tcgplayer: 'tcgplayer_price', ebay: 'ebay_price', amazon: 'amazon_price' };
    return sourceMap[priceSource] || 'cardmarket_price';
}

// Pick the best price for a card: exact set price if the set_code matches, else card-level price.
function priceForCard(apiData, setCode, apiField) {
    if (setCode && setCode !== 'Unknown' && apiData.card_sets) {
        const matched = apiData.card_sets.find(s => s.set_code === setCode);
        if (matched && matched.set_price && parseFloat(matched.set_price) > 0) return parseFloat(matched.set_price);
    }
    if (apiData.card_prices && apiData.card_prices.length > 0) {
        return parseFloat(apiData.card_prices[0][apiField]) || 0;
    }
    return 0;
}

// Extract the language-independent detail fields from a YGOPRODeck card object.
function detailsFromApi(apiCard) {
    const imageUrl = apiCard.card_images && apiCard.card_images.length > 0 ? apiCard.card_images[0].image_url : '';
    let level = apiCard.level;
    if (apiCard.type && apiCard.type.includes('Link') && apiCard.linkval !== undefined) level = apiCard.linkval;
    return {
        name: apiCard.name, type: apiCard.type, desc: apiCard.desc, image_url: imageUrl,
        atk: valOrNull(apiCard.atk), def: valOrNull(apiCard.def), level: valOrNull(level),
        race: apiCard.race || null, attribute: apiCard.attribute || null
    };
}

// --- IPC Handlers ---

ipcMain.handle('get-ip-address', () => getLocalIpAddress());

ipcMain.handle('fetch-card-data', async (event, passcode) => {
    try {
        const data = await fetchCardData(passcode);
        if (data && data.data && data.data.length > 0) return data.data[0];
        return null;
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('fetch-yugipedia-sets', async (event, passcode) => {
    return await fetchYugipediaSets(passcode);
});

ipcMain.handle('add-card-to-db', (event, card) => {
  try {
    const id = String(card.id);
    const setCode = card.set_code || 'Unknown';
    const language = card.language || 'DE';

    const existing = db.prepare('SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND language = ?').get(id, setCode, language);

    if (existing) {
        const newQty = existing.quantity + (card.quantity || 1);
        db.prepare('UPDATE cards SET quantity = @qty, price = @price, deleted = 0 WHERE id = @id AND set_code = @set_code AND language = @language').run({
            qty: newQty, price: card.price || 0, id, set_code: setCode, language
        });
        return { success: true, updated: true };
    } else {
        const stmt = db.prepare(`
          INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language)
          VALUES (@id, @name, @type, @desc, @image_url, @atk, @def, @level, @race, @attribute, @quantity, @rarity, @set_code, @price, @language)
        `);
        const imageUrl = card.card_images && card.card_images.length > 0 ? card.card_images[0].image_url : '';
        let level = card.level;
        if (card.type && card.type.includes('Link') && card.linkval !== undefined) level = card.linkval;

        stmt.run({
          id, name: card.name, type: card.type, desc: card.desc, image_url: imageUrl,
          atk: valOrNull(card.atk), def: valOrNull(card.def), level: valOrNull(level),
          race: card.race || null, attribute: card.attribute || null,
          quantity: card.quantity || 1, rarity: card.rarity || 'Unknown',
          set_code: card.set_code || 'Unknown', price: card.price || 0, language
        });
        return { success: true, inserted: true };
    }
  } catch (error) {
    console.error('DB Insert Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-collection', () => {
    return db.prepare('SELECT * FROM cards WHERE quantity > 0 AND deleted = 0 ORDER BY created_at DESC').all();
});

ipcMain.handle('delete-card', (event, { id, set_code, language }) => {
    try {
        if (!id || !set_code) return { success: false, error: 'Missing id or set_code' };
        db.prepare('UPDATE cards SET deleted = 1 WHERE id = ? AND set_code = ? AND language = ?')
          .run(String(id), set_code, language || 'DE');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-portfolio', () => {
    try {
        return db.prepare('SELECT SUM(price * quantity) as totalValue, SUM(quantity) as totalCards, COUNT(*) as uniqueCards FROM cards WHERE quantity > 0 AND deleted = 0').get();
    } catch (e) { return { totalValue: 0, totalCards: 0, uniqueCards: 0 }; }
});

// --- Deck Builder Handlers ---

ipcMain.handle('get-decks', () => {
    return db.prepare('SELECT * FROM decks ORDER BY created_at DESC').all();
});

ipcMain.handle('create-deck', (event, name) => {
    const info = db.prepare('INSERT INTO decks (name) VALUES (?)').run(name);
    return { id: info.lastInsertRowid, name, created_at: new Date().toISOString() };
});

ipcMain.handle('delete-deck', (event, id) => {
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM decks WHERE id = ?').run(id);
    return { success: true };
});

ipcMain.handle('save-deck', (event, { deckId, cards }) => {
    const deleteStmt = db.prepare('DELETE FROM deck_cards WHERE deck_id = ?');
    const insertStmt = db.prepare('INSERT INTO deck_cards (deck_id, card_id, type, quantity) VALUES (@deck_id, @card_id, @type, @quantity)');

    const transaction = db.transaction((cardsToSave) => {
        deleteStmt.run(deckId);
        for (const card of cardsToSave) {
             insertStmt.run({
                 deck_id: deckId,
                 card_id: String(card.id),
                 type: card.type || 'main',
                 quantity: card.quantity
             });
        }
    });
    transaction(cards);
    return { success: true };
});

ipcMain.handle('get-deck-details', (event, id) => {
    // Join with cards to get details if available
    const query = `
        SELECT dc.*, c.name, c.image_url, c.type as card_type, c.desc, c.atk, c.def, c.level, c.race, c.attribute, c.price
        FROM deck_cards dc
        LEFT JOIN cards c ON dc.card_id = c.id
        WHERE dc.deck_id = ?
    `;
    return db.prepare(query).all(id);
});

ipcMain.handle('import-deck-ydk', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'YDK Deck', extensions: ['ydk'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const name = path.basename(result.filePaths[0], '.ydk');
    const lines = content.split(/\r?\n/);

    const cards = [];
    let currentSection = 'main';

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '#main') currentSection = 'main';
        else if (trimmed === '#extra') currentSection = 'extra';
        else if (trimmed === '!side') currentSection = 'side';
        else if (/^\d+$/.test(trimmed)) {
            cards.push({ id: trimmed, type: currentSection, quantity: 1 });
        }
    }

    // Consolidate duplicates
    const consolidated = [];
    cards.forEach(c => {
        const existing = consolidated.find(x => x.id === c.id && x.type === c.type);
        if (existing) existing.quantity++;
        else consolidated.push(c);
    });

    return { canceled: false, name, cards: consolidated };
});

ipcMain.handle('export-deck-ydk', async (event, { name, content }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Deck',
        defaultPath: `${name}.ydk`,
        filters: [{ name: 'YDK Deck', extensions: ['ydk'] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    let ydk = '#created by Yu-Gi-Oh! Card Manager\n#main\n';
    content.filter(c => c.type === 'main').forEach(c => {
        for(let i=0; i<(c.quantity||1); i++) ydk += `${c.id}\n`;
    });

    ydk += '#extra\n';
    content.filter(c => c.type === 'extra').forEach(c => {
        for(let i=0; i<(c.quantity||1); i++) ydk += `${c.id}\n`;
    });

    ydk += '!side\n';
    content.filter(c => c.type === 'side').forEach(c => {
        for(let i=0; i<(c.quantity||1); i++) ydk += `${c.id}\n`;
    });

    fs.writeFileSync(result.filePath, ydk);
    return { success: true };
});

// --- Other Handlers ---

ipcMain.handle('manual-scan', async (event, passcode) => {
    if (mainWindow) mainWindow.webContents.send('card-scanned', { passcode });
    return { success: true };
});

ipcMain.handle('get-price-history', () => {
    try {
        return db.prepare('SELECT * FROM portfolio_history ORDER BY timestamp ASC').all();
    } catch (e) { return []; }
});

ipcMain.handle('cleanup-database', async () => {
    db.exec('VACUUM');
    return { success: true };
});

ipcMain.handle('search-online', async (event, query) => {
    try {
        const q = String(query).trim();
        if (!q) return [];
        // A purely numeric query is an 8-digit passcode -> exact id lookup; otherwise fuzzy name search.
        const isPasscode = /^\d+$/.test(q);
        const url = isPasscode
            ? `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(q)}`
            : `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const json = await response.json();
        return json.data || [];
    } catch (e) { return []; }
});

ipcMain.handle('update-card-meta', (event, data) => {
    // Expects { id, set_code, quantity, ... }
    // This is a generic update.
    try {
        const { id, set_code, quantity, language } = data;
        if (!id || !set_code) return { success: false };

        // Construct update query dynamically? Or just update quantity for now?
        // Usually mostly for quantity.
        if (quantity !== undefined) {
             db.prepare("UPDATE cards SET quantity = ? WHERE id = ? AND set_code = ? AND language = ?").run(quantity, id, set_code, language || 'DE');
        }
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('check-card-exists', (event, passcode) => {
    const p = String(passcode);
    const normalized = String(parseInt(p, 10)); // removes leading zeros
    const res = db.prepare('SELECT SUM(quantity) as count FROM cards WHERE (id = ? OR id = ?) AND deleted = 0').get(p, normalized);
    return { exists: (res.count || 0) > 0, quantity: res.count || 0 };
});

// Optimization: Price Poller
function startPricePoller() {
    if (priceUpdateInterval) clearInterval(priceUpdateInterval);
    priceUpdateInterval = setInterval(async () => {
        if (!mainWindow) return;
        try {
            // Prioritize cards updated longest ago
            const cards = db.prepare('SELECT id, set_code, language, price FROM cards WHERE deleted = 0 ORDER BY last_updated ASC LIMIT 50').all();
            if (cards.length === 0) return;

            const uniqueIds = [...new Set(cards.map(c => c.id))].join(',');
            // We use standard fetch here, no cache, because we want FRESH prices
            const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${uniqueIds}`);
            if (!response.ok) return;
            const data = await response.json();
            if (!data.data) return;

            const apiCards = data.data;
            let updates = [];
            let totalValueChange = 0;

            // Get price source
            let priceSource = 'cardmarket';
            try {
                const row = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
                if (row) priceSource = row.value;
            } catch(e) {}
            const sourceMap = { 'cardmarket': 'cardmarket_price', 'tcgplayer': 'tcgplayer_price', 'ebay': 'ebay_price', 'amazon': 'amazon_price' };
            const apiField = sourceMap[priceSource] || 'cardmarket_price';

            const updateStmt = db.prepare('UPDATE cards SET price = @price, last_updated = CURRENT_TIMESTAMP WHERE id = @id AND set_code = @set_code AND language = @language');

            db.transaction(() => {
                cards.forEach(localCard => {
                    const apiData = apiCards.find(api => String(api.id) === String(localCard.id));
                    if (!apiData) return;

                    let newPrice = 0;
                    let foundSetPrice = false;
                    if (localCard.set_code && localCard.set_code !== 'Unknown' && apiData.card_sets) {
                        const matchedSet = apiData.card_sets.find(s => s.set_code === localCard.set_code);
                        if (matchedSet && matchedSet.set_price && parseFloat(matchedSet.set_price) > 0) {
                            newPrice = parseFloat(matchedSet.set_price);
                            foundSetPrice = true;
                        }
                    }
                    if (!foundSetPrice && apiData.card_prices && apiData.card_prices.length > 0) {
                        newPrice = parseFloat(apiData.card_prices[0][apiField]) || 0;
                    }

                    if (Math.abs(newPrice - (localCard.price || 0)) > 0.01) {
                        updateStmt.run({ price: newPrice, id: localCard.id, set_code: localCard.set_code, language: localCard.language });
                        updates.push({ id: localCard.id, newPrice });
                        totalValueChange += (newPrice - (localCard.price || 0));
                    } else {
                        // Still update timestamp
                        db.prepare('UPDATE cards SET last_updated = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ?').run(localCard.id, localCard.set_code, localCard.language);
                    }
                });
            })();

            if (updates.length > 0) {
                const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards WHERE deleted = 0').get();
                if (Math.abs(totalValueChange) > 0.5) {
                    db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: stats.totalValue || 0 });
                }
                mainWindow.webContents.send('price-update', { updates, totalValue: stats.totalValue || 0 });
            }
        } catch (e) { console.error("Price Poller Error:", e); }
    }, 60000);
}

// ... Re-add other handlers (downgrade, etc) ensuring they use `db`
// To keep file size manageable, I'm omitting the exact copy of every single handler if they are identical to before,
// but essentially they all need to reference the `db` variable initialized from `initDatabase`.

// Wait, I should make sure I don't break existing functionality by omitting code.
// Since I am `write_file` overwriting `main.cjs`, I MUST include all handlers.

ipcMain.handle('convert-unknowns-to-default', async () => {
    try {
        const unknowns = db.prepare("SELECT id, quantity FROM cards WHERE set_code = 'Unknown' AND deleted = 0").all();
        let convertedCount = 0;

        let priceSource = 'cardmarket';
        try { const r = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get(); if(r) priceSource=r.value; } catch(e){}
        const apiField = (priceSource === 'tcgplayer') ? 'tcgplayer_price' : 'cardmarket_price'; // Simplified map

        for (const unknown of unknowns) {
            try {
                const data = await fetchCardData(unknown.id); // Uses Cache!
                if (data && data.data && data.data.length > 0) {
                    const apiCard = data.data[0];
                    const bestSet = findBestDefaultSet(apiCard.card_sets);
                    if (bestSet) {
                        const newSetCode = bestSet.set_code;
                        const newRarity = bestSet.set_rarity;
                        const newPrice = parseFloat(bestSet.set_price) || (parseFloat(apiCard.card_prices[0][apiField]) || 0);

                        // Check existing
                        const existing = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND language = 'DE'").get(unknown.id, newSetCode);
                        if (existing) {
                            db.prepare("UPDATE cards SET quantity = ?, deleted = 0 WHERE id = ? AND set_code = ? AND language = 'DE'").run(existing.quantity + unknown.quantity, unknown.id, newSetCode);
                            db.prepare("UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = 'Unknown'").run(unknown.id);
                        } else {
                            db.prepare("UPDATE cards SET set_code = ?, rarity = ?, price = ? WHERE id = ? AND set_code = 'Unknown'").run(newSetCode, newRarity, newPrice, unknown.id);
                        }
                        convertedCount++;
                    }
                }
            } catch (e) { console.error(e); }
        }
        return { success: true, converted: convertedCount };
    } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle('merge-unknown-cards', async () => {
    try {
        const unknowns = db.prepare("SELECT id, quantity FROM cards WHERE set_code = 'Unknown' AND deleted = 0").all();
        let mergedCount = 0;
        db.transaction(() => {
            unknowns.forEach(u => {
                const specific = db.prepare("SELECT id, set_code, quantity FROM cards WHERE id = ? AND set_code != 'Unknown' AND deleted = 0 ORDER BY quantity DESC LIMIT 1").get(u.id);
                if (specific) {
                    db.prepare("UPDATE cards SET quantity = ?, deleted = 0 WHERE id = ? AND set_code = ?").run(specific.quantity + u.quantity, specific.id, specific.set_code);
                    db.prepare("UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = 'Unknown'").run(u.id);
                    mergedCount++;
                }
            });
        })();
        return { success: true, merged: mergedCount };
    } catch (e) { return { success: false, error: e.message }; }
});

// "Update All": force-refresh details + prices for every card. Bypasses the API cache
// (prices change) by batching unique passcodes directly against YGOPRODeck.
ipcMain.handle('update-all-cards', async (event) => {
    try {
        const rows = db.prepare('SELECT id, set_code, language FROM cards').all();
        const total = rows.length;
        if (total === 0) return { success: true, updatedCount: 0 };

        const apiField = getPriceSourceField();
        const uniqueIds = [...new Set(rows.map(r => String(r.id)))];
        const apiMap = new Map();
        const CHUNK = 40;

        if (event.sender) event.sender.send('update-progress', { current: 0, total: uniqueIds.length });
        for (let i = 0; i < uniqueIds.length; i += CHUNK) {
            const chunk = uniqueIds.slice(i, i + CHUNK);
            try {
                const resp = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${chunk.join(',')}`);
                if (resp.ok) {
                    const json = await resp.json();
                    (json.data || []).forEach(c => apiMap.set(String(c.id), c));
                }
            } catch (e) { console.error('update-all fetch error:', e); }
            if (event.sender) event.sender.send('update-progress', { current: Math.min(i + CHUNK, uniqueIds.length), total: uniqueIds.length });
        }

        const updateStmt = db.prepare(`UPDATE cards SET name=@name, type=@type, desc=@desc, image_url=@image_url,
            atk=@atk, def=@def, level=@level, race=@race, attribute=@attribute, price=@price, last_updated=CURRENT_TIMESTAMP
            WHERE id=@id AND set_code=@set_code AND language=@language`);

        let updatedCount = 0;
        db.transaction(() => {
            rows.forEach(row => {
                const apiData = apiMap.get(String(row.id));
                if (!apiData) return;
                const d = detailsFromApi(apiData);
                const price = priceForCard(apiData, row.set_code, apiField);
                updateStmt.run({ ...d, price, id: String(row.id), set_code: row.set_code, language: row.language });
                updatedCount++;
            });
        })();

        try {
            const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards WHERE deleted = 0').get();
            db.prepare('INSERT INTO portfolio_history (total_value) VALUES (@val)').run({ val: stats.totalValue || 0 });
            if (mainWindow) mainWindow.webContents.send('price-update', { updates: [], totalValue: stats.totalValue || 0 });
        } catch (e) { /* history snapshot is best-effort */ }

        if (event.sender) event.sender.send('update-progress', { current: uniqueIds.length, total: uniqueIds.length });
        return { success: true, updatedCount };
    } catch (e) { return { success: false, error: e.message }; }
});

// "Fetch Missing": fill in cards that lack critical detail fields. Detail fields are the same
// across printings/languages, so we refresh by passcode and use the cache (details don't change).
ipcMain.handle('update-missing-cards', async (event) => {
    try {
        const candidates = db.prepare(`
            SELECT DISTINCT id FROM cards
            WHERE name IS NULL OR name = '' OR image_url IS NULL OR image_url = ''
               OR (type IS NOT NULL AND type NOT LIKE '%Spell%' AND type NOT LIKE '%Trap%'
                   AND (atk IS NULL OR level IS NULL))
        `).all();
        const total = candidates.length;
        let updatedCount = 0;
        if (event.sender) event.sender.send('update-progress', { current: 0, total });

        const updateStmt = db.prepare(`UPDATE cards SET name=@name, type=@type, desc=@desc, image_url=@image_url,
            atk=@atk, def=@def, level=@level, race=@race, attribute=@attribute, last_updated=CURRENT_TIMESTAMP
            WHERE id=@id`);

        for (let i = 0; i < total; i++) {
            if (event.sender && i % 5 === 0) event.sender.send('update-progress', { current: i, total });
            try {
                const data = await fetchCardData(candidates[i].id); // cached
                if (data && data.data && data.data.length > 0) {
                    const d = detailsFromApi(data.data[0]);
                    updateStmt.run({ ...d, id: candidates[i].id });
                    updatedCount++;
                }
            } catch (e) { console.error('update-missing error:', e); }
        }

        if (event.sender) event.sender.send('update-progress', { current: total, total });
        return { success: true, updatedCount };
    } catch (e) { return { success: false, error: e.message }; }
});

// Wishlist
ipcMain.handle('get-wishlist', () => db.prepare('SELECT * FROM wishlist ORDER BY created_at DESC').all());
ipcMain.handle('add-to-wishlist', (event, card) => {
    const exists = db.prepare('SELECT id FROM wishlist WHERE card_id = ?').get(String(card.id));
    if (exists) return { success: false };
    db.prepare('INSERT INTO wishlist (card_id, name, image_url, price) VALUES (@id, @name, @image_url, @price)').run({
        id: String(card.id), name: card.name, image_url: card.image_url, price: card.price || 0
    });
    return { success: true };
});
ipcMain.handle('remove-from-wishlist', (event, id) => {
    db.prepare('DELETE FROM wishlist WHERE id = ?').run(id);
    return true;
});

// Settings
ipcMain.handle('get-settings', () => {
    try {
        const rows = db.prepare('SELECT * FROM settings').all();
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        return settings;
    } catch (e) { return {}; }
});
ipcMain.handle('save-setting', (event, { key, value }) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value').run({ key, value });
    return { success: true };
});

// Import CSV
ipcMain.handle('import-csv', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const lines = content.split(/\r?\n/);
    const cards = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(';'); // support semicolon csv
        if (parts.length >= 2) {
            const passcode = parts[1].trim();
            if (/^\d+$/.test(passcode)) cards.push({ passcode });
        }
    }
    return { canceled: false, cards };
});

ipcMain.handle('backup-database', async () => {
    try {
        const dbPath = path.join(userDataPath, 'cards.db');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Backup Database',
            defaultPath: `cards_backup_${new Date().toISOString().slice(0,10)}.db`,
            filters: [{ name: 'SQLite Database', extensions: ['db'] }]
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        fs.copyFileSync(dbPath, result.filePath);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('restore-database', async () => {
    try {
        const dbPath = path.join(userDataPath, 'cards.db');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Restore Database',
            properties: ['openFile'],
            filters: [{ name: 'SQLite Database', extensions: ['db'] }]
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        db.close(); // Close current
        fs.copyFileSync(result.filePaths[0], dbPath);
        app.relaunch();
        app.exit(0);
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('move-database', async () => {
    try {
        const dbPath = path.join(userDataPath, 'cards.db');
        const result = await dialog.showOpenDialog(mainWindow, { title: 'Select New Database Folder', properties: ['openDirectory'] });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        const newDbPath = path.join(result.filePaths[0], 'cards.db');
        const configPath = path.join(userDataPath, 'config.json');

        db.close();
        fs.copyFileSync(dbPath, newDbPath);
        fs.writeFileSync(configPath, JSON.stringify({ dbPath: newDbPath }, null, 2));
        app.relaunch();
        app.exit(0);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('reset-database', async () => {
    try {
        const dbPath = path.join(userDataPath, 'cards.db');
        db.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        app.relaunch();
        app.exit(0);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

// Downgrade Tool (Critical for user)
ipcMain.handle('downgrade-to-lowest-rarity', async (event) => {
    // Re-implemented fully
    try {
        const allCards = db.prepare("SELECT id, set_code, quantity FROM cards WHERE deleted = 0").all();
        let changedCount = 0;
        const total = allCards.length;
        if (event.sender) event.sender.send('update-progress', { current: 0, total });

        let priceSource = 'cardmarket';
        try { const r = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get(); if(r) priceSource=r.value; } catch(e){}
        const apiField = (priceSource==='tcgplayer')?'tcgplayer_price':'cardmarket_price';

        for (let i = 0; i < total; i++) {
             const card = allCards[i];
             if (event.sender && i % 10 === 0) event.sender.send('update-progress', { current: i + 1, total });

             const current = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND deleted = 0").get(card.id, card.set_code);
             if (!current) continue;

             try {
                // Use Cached Fetch!
                const data = await fetchCardData(card.id);
                if (data && data.data && data.data.length > 0) {
                    const apiCard = data.data[0];
                    const bestSet = findBestDefaultSet(apiCard.card_sets);

                    if (bestSet && bestSet.set_code !== card.set_code) {
                        const newSetCode = bestSet.set_code;
                        const newRarity = bestSet.set_rarity;
                        const newPrice = parseFloat(bestSet.set_price) || (parseFloat(apiCard.card_prices[0][apiField]) || 0);

                        const existingTarget = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ?").get(card.id, newSetCode);
                        if (existingTarget) {
                            db.prepare("UPDATE cards SET quantity = ?, deleted = 0 WHERE id = ? AND set_code = ?").run(existingTarget.quantity + current.quantity, card.id, newSetCode);
                            db.prepare("UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = ?").run(card.id, card.set_code);
                        } else {
                            db.prepare("UPDATE cards SET set_code = ?, rarity = ?, price = ? WHERE id = ? AND set_code = ?").run(newSetCode, newRarity, newPrice, card.id, card.set_code);
                        }
                        changedCount++;
                    }
                }
             } catch (err) { console.error(err); }
        }
        if (event.sender) event.sender.send('update-progress', { current: total, total });
        return { success: true, count: changedCount };
    } catch (e) { return { success: false, error: e.message }; }
});
