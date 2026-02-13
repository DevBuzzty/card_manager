const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const os = require('os');

// Database Setup
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

// Load config to find DB path
let dbPath = path.join(userDataPath, 'cards.db');
try {
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.dbPath && fs.existsSync(config.dbPath)) {
            dbPath = config.dbPath;
        }
    }
} catch (e) {
    console.error("Failed to load config:", e);
}

console.log("Using Database at:", dbPath);
let db = new Database(dbPath);

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT,
    name TEXT,
    type TEXT,
    desc TEXT,
    image_url TEXT,
    atk INTEGER,
    def INTEGER,
    level INTEGER,
    race TEXT,
    attribute TEXT,
    quantity INTEGER DEFAULT 1,
    rarity TEXT,
    set_code TEXT,
    price REAL,
    language TEXT DEFAULT 'DE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language)
  )
`);

// Create portfolio history table
db.exec(`
  CREATE TABLE IF NOT EXISTS portfolio_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_value REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Create Decks table
db.exec(`
  CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create Deck Cards table
db.exec(`
  CREATE TABLE IF NOT EXISTS deck_cards (
    deck_id INTEGER,
    card_id TEXT,
    type TEXT,
    quantity INTEGER,
    PRIMARY KEY (deck_id, card_id, type),
    FOREIGN KEY(deck_id) REFERENCES decks(id)
  )
`);

// Create Wishlist table
db.exec(`
  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT,
    name TEXT,
    image_url TEXT,
    price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: Add new columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(cards)").all();
  const columnNames = columns.map(c => c.name);
  // Basic column additions
  if (!columnNames.includes('atk')) db.exec("ALTER TABLE cards ADD COLUMN atk INTEGER");
  if (!columnNames.includes('def')) db.exec("ALTER TABLE cards ADD COLUMN def INTEGER");
  if (!columnNames.includes('level')) db.exec("ALTER TABLE cards ADD COLUMN level INTEGER");
  if (!columnNames.includes('race')) db.exec("ALTER TABLE cards ADD COLUMN race TEXT");
  if (!columnNames.includes('attribute')) db.exec("ALTER TABLE cards ADD COLUMN attribute TEXT");
  if (!columnNames.includes('quantity')) db.exec("ALTER TABLE cards ADD COLUMN quantity INTEGER DEFAULT 1");
  if (!columnNames.includes('rarity')) db.exec("ALTER TABLE cards ADD COLUMN rarity TEXT");
  if (!columnNames.includes('set_code')) db.exec("ALTER TABLE cards ADD COLUMN set_code TEXT");
  if (!columnNames.includes('price')) db.exec("ALTER TABLE cards ADD COLUMN price REAL");
  if (!columnNames.includes('last_updated')) db.exec("ALTER TABLE cards ADD COLUMN last_updated DATETIME");
  if (!columnNames.includes('language')) db.exec("ALTER TABLE cards ADD COLUMN language TEXT DEFAULT 'DE'");

  // PRIMARY KEY Migration (id, set_code -> id, set_code, language)
  const pkColumns = columns.filter(c => c.pk > 0);
  // We need to check if PK is exactly (id, set_code) or needs upgrade
  // If language is missing from PK, we must migrate
  const pkNames = pkColumns.map(c => c.name).sort().join(',');
  if (pkNames === 'id,set_code' || pkNames === 'id') {
      console.log("Migrating cards table to include LANGUAGE in PRIMARY KEY...");
      db.transaction(() => {
          db.exec("ALTER TABLE cards RENAME TO cards_temp_v2");
          db.exec(`
            CREATE TABLE cards (
                id TEXT,
                name TEXT,
                type TEXT,
                desc TEXT,
                image_url TEXT,
                atk INTEGER,
                def INTEGER,
                level INTEGER,
                race TEXT,
                attribute TEXT,
                quantity INTEGER DEFAULT 1,
                rarity TEXT,
                set_code TEXT,
                price REAL,
                language TEXT DEFAULT 'DE',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_updated DATETIME,
                PRIMARY KEY (id, set_code, language)
            )
          `);
          // Note: we default existing rows to 'DE' since user said 99.5% are German
          db.exec(`
            INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity,
                   rarity, set_code, price, language, created_at, last_updated)
            SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, quantity,
                   COALESCE(rarity, 'Unknown'), COALESCE(set_code, 'Unknown'), price, 'DE', created_at, last_updated
            FROM cards_temp_v2
          `);
          db.exec("DROP TABLE cards_temp_v2");
      })();
      console.log("Migration complete.");
  }
} catch (e) {
  console.log("Migration check failed or not needed", e);
}

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
    // Production build
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function startSocketServer() {
  io = new Server(4000, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('card_scanned', (data) => {
      console.log('Card scanned event:', data);
      if (mainWindow) {
        mainWindow.webContents.send('card-scanned', data);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });

  console.log('Socket.io server running on port 4000');
}

let priceUpdateInterval;

app.whenReady().then(() => {
  createWindow();
  startSocketServer();
  startPricePoller();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function startPricePoller() {
    if (priceUpdateInterval) clearInterval(priceUpdateInterval);

    // Poll every 60 seconds (can be adjusted)
    priceUpdateInterval = setInterval(async () => {
        if (!mainWindow) return;

        console.log("Polling for price updates...");
        try {
            // 1. Get a batch of cards to update (oldest updated first)
            // Prioritize cards that haven't been updated recently to ensure full coverage over time
            const cards = db.prepare('SELECT id, set_code, price FROM cards ORDER BY last_updated ASC LIMIT 50').all();

            if (cards.length === 0) return;

            // 2. Extract IDs for batch API call
            // YGOPRODeck API supports comma-separated IDs: ?id=123,456,789
            // Note: We need to handle duplicates in the ID list if we have multiple printings of same card,
            // but the API call only needs unique IDs.
            const uniqueIds = [...new Set(cards.map(c => c.id))];
            const idString = uniqueIds.join(',');

            const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${idString}`);
            if (!response.ok) return; // Silent fail

            const data = await response.json();
            if (!data.data) return;

            const apiCards = data.data; // Array of card info

            let updates = [];
            let totalValueChange = 0;

            // 3. Determine price source
            let priceSource = 'cardmarket';
            try {
                const row = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
                if (row && row.value) priceSource = row.value;
            } catch (e) {}

            const sourceMap = {
                'cardmarket': 'cardmarket_price',
                'tcgplayer': 'tcgplayer_price',
                'ebay': 'ebay_price',
                'amazon': 'amazon_price',
                'coolstuffinc': 'coolstuffinc_price'
            };
            const apiField = sourceMap[priceSource] || 'cardmarket_price';

            // 4. Update Database & prepare events
            const updateStmt = db.prepare('UPDATE cards SET price = @price WHERE id = @id AND set_code = @set_code');

            db.transaction(() => {
                cards.forEach(localCard => {
                    const apiData = apiCards.find(api => String(api.id) === String(localCard.id));
                    if (!apiData) return;

                    let newPrice = 0;

                    // Price Logic (Same as manual update)
                    let foundSetPrice = false;
                    if (localCard.set_code && localCard.set_code !== 'Unknown' && apiData.card_sets) {
                        const matchedSet = apiData.card_sets.find(s => s.set_code === localCard.set_code);
                        // Check if matched set exists AND has a non-zero price
                        if (matchedSet && matchedSet.set_price && parseFloat(matchedSet.set_price) > 0) {
                            newPrice = parseFloat(matchedSet.set_price);
                            foundSetPrice = true;
                        }
                    }

                    // Fallback if no set matched, no set code, OR set price was 0
                    if (!foundSetPrice) {
                        if (apiData.card_prices && apiData.card_prices.length > 0) {
                            newPrice = parseFloat(apiData.card_prices[0][apiField]) || 0;
                        }
                    }

                    // Check if price changed
                    if (Math.abs(newPrice - (localCard.price || 0)) > 0.01) {
                         updateStmt.run({
                             price: newPrice,
                             id: localCard.id,
                             set_code: localCard.set_code
                         });
                         updates.push({
                             id: localCard.id,
                             set_code: localCard.set_code,
                             oldPrice: localCard.price,
                             newPrice: newPrice
                         });
                         totalValueChange += (newPrice - (localCard.price || 0));
                    }
                });
            })();

            // 5. Emit event if there were changes
            if (updates.length > 0) {
                console.log(`Updated ${updates.length} prices via background polling.`);

                // Recalculate total portfolio value efficiently
                const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards').get();

                // Update history if change is significant
                if (Math.abs(totalValueChange) > 0.5) {
                    db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: stats.totalValue || 0 });
                }

                mainWindow.webContents.send('price-update', {
                    updates,
                    totalValue: stats.totalValue || 0
                });
            }

        } catch (e) {
            console.error("Background Price Polling Error:", e);
        }
    }, 60000); // 60 seconds
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Helper for numeric/value fields to preserve 0
const valOrNull = (v) => (v !== undefined && v !== null && v !== '') ? v : null;

// Helper to find best default set (Lowest Rarity > Lowest Price)
function findBestDefaultSet(cardSets) {
    if (!cardSets || cardSets.length === 0) return null;

    return cardSets.sort((a, b) => {
        // Priority 1: Rarity Ranking (Common is best default)
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

        if (rankA !== rankB) {
            return rankA - rankB;
        }

        // Priority 2: Lowest Price (if rarities are equal)
        const pA = parseFloat(a.set_price) || 0;
        const pB = parseFloat(b.set_price) || 0;

        // Treat 0 as Infinity to avoid preferring "unknown price" over "known price"
        const priceA = pA === 0 ? 999999 : pA;
        const priceB = pB === 0 ? 999999 : pB;

        return priceA - priceB;
    })[0];
}

// IPC Handlers

ipcMain.handle('get-ip-address', () => {
  return getLocalIpAddress();
});

ipcMain.handle('export-deck-ydk', async (event, { name, content }) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Export Deck',
            defaultPath: `${name}.ydk`,
            filters: [{ name: 'YDK Deck', extensions: ['ydk'] }]
        });

        if (result.canceled || !result.filePath) return { canceled: true };

        fs.writeFileSync(result.filePath, content, 'utf-8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('cleanup-database', async () => {
    // Legacy cleanup handler, now aliased to the smarter logic
    return await mergeUnknownCardsLogic();
});

ipcMain.handle('merge-unknown-cards', async () => {
    return await mergeUnknownCardsLogic();
});

ipcMain.handle('convert-unknowns-to-default', async () => {
    try {
        // Find cards with 'Unknown' set_code
        const unknowns = db.prepare("SELECT id, quantity, price FROM cards WHERE set_code = 'Unknown'").all();
        let convertedCount = 0;

        // Determine price source
        let priceSource = 'cardmarket';
        try {
            const row = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
            if (row && row.value) priceSource = row.value;
        } catch (e) {}

        const sourceMap = {
            'cardmarket': 'cardmarket_price',
            'tcgplayer': 'tcgplayer_price',
            'ebay': 'ebay_price',
            'amazon': 'amazon_price',
            'coolstuffinc': 'coolstuffinc_price'
        };
        const apiField = sourceMap[priceSource] || 'cardmarket_price';

        // Process in small batches to not block event loop
        for (let i = 0; i < unknowns.length; i++) {
            const unknown = unknowns[i];

            try {
                const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${unknown.id}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.data && data.data.length > 0) {
                        const apiCard = data.data[0];

                        // Updated Logic: Pick the best default (Lowest Price / Common)
                        const bestSet = findBestDefaultSet(apiCard.card_sets);

                        if (bestSet) {
                            const newSetCode = bestSet.set_code;
                            const newRarity = bestSet.set_rarity;
                            const newPrice = parseFloat(bestSet.set_price) ||
                                             (parseFloat(apiCard.card_prices[0][apiField]) || 0);

                            // Check if this specific set already exists
                            const existing = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ?").get(unknown.id, newSetCode);

                            if (existing) {
                                // Merge into existing
                                const newQty = existing.quantity + unknown.quantity;
                                db.prepare("UPDATE cards SET quantity = ? WHERE id = ? AND set_code = ?").run(newQty, unknown.id, newSetCode);
                                db.prepare("DELETE FROM cards WHERE id = ? AND set_code = 'Unknown'").run(unknown.id);
                            } else {
                                // Update current Unknown row to become the specific row
                                db.prepare("UPDATE cards SET set_code = ?, rarity = ?, price = ? WHERE id = ? AND set_code = 'Unknown'").run(newSetCode, newRarity, newPrice, unknown.id);
                            }
                            convertedCount++;
                        }
                    }
                }
            } catch (err) {
                console.error(`Failed to convert card ${unknown.id}`, err);
            }
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 50));
        }

        // Update History
        const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
        if (totalVal) {
             db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val || 0 });
        }

        return { success: true, converted: convertedCount };
    } catch (e) {
        console.error("Convert Default Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('downgrade-to-lowest-rarity', async (event) => {
    try {
        const allCards = db.prepare("SELECT id, set_code, quantity FROM cards").all();
        let changedCount = 0;
        const total = allCards.length;

        if (event.sender) event.sender.send('update-progress', { current: 0, total });

        // Determine price source for fallback
        let priceSource = 'cardmarket';
        try {
            const row = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
            if (row && row.value) priceSource = row.value;
        } catch (e) {}

        const sourceMap = {
            'cardmarket': 'cardmarket_price',
            'tcgplayer': 'tcgplayer_price',
            'ebay': 'ebay_price',
            'amazon': 'amazon_price',
            'coolstuffinc': 'coolstuffinc_price'
        };
        const apiField = sourceMap[priceSource] || 'cardmarket_price';

        for (let i = 0; i < total; i++) {
             const card = allCards[i];
             if (event.sender && i % 5 === 0) event.sender.send('update-progress', { current: i + 1, total });

             // Verify card still exists
             const current = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ?").get(card.id, card.set_code);
             if (!current) continue;

             try {
                const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${card.id}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.data && data.data.length > 0) {
                        const apiCard = data.data[0];
                        const bestSet = findBestDefaultSet(apiCard.card_sets);

                        // If we found a better set, and it's different from current
                        if (bestSet && bestSet.set_code !== card.set_code) {
                            const newSetCode = bestSet.set_code;
                            const newRarity = bestSet.set_rarity;
                            const newPrice = parseFloat(bestSet.set_price) ||
                                             (parseFloat(apiCard.card_prices[0][apiField]) || 0);

                            // Check if target set already exists
                            const existingTarget = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ?").get(card.id, newSetCode);

                            if (existingTarget) {
                                // Merge
                                const newQty = existingTarget.quantity + current.quantity;
                                db.prepare("UPDATE cards SET quantity = ? WHERE id = ? AND set_code = ?").run(newQty, card.id, newSetCode);
                                db.prepare("DELETE FROM cards WHERE id = ? AND set_code = ?").run(card.id, card.set_code);
                            } else {
                                // Move (Rename set_code)
                                db.prepare("UPDATE cards SET set_code = ?, rarity = ?, price = ? WHERE id = ? AND set_code = ?").run(newSetCode, newRarity, newPrice, card.id, card.set_code);
                            }
                            changedCount++;
                        }
                    }
                }
             } catch (err) {
                 console.error(`Failed to downgrade card ${card.id}`, err);
             }

             // Sleep to avoid rate limits
             await new Promise(r => setTimeout(r, 50));
        }

        if (event.sender) event.sender.send('update-progress', { current: total, total });

        // Update History
        const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
        if (totalVal) {
             db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val || 0 });
        }

        return { success: true, count: changedCount };
    } catch (e) {
        console.error("Downgrade Error:", e);
        return { success: false, error: e.message };
    }
});

function mergeUnknownCardsLogic() {
    try {
        // Find cards with 'Unknown' set_code
        const unknowns = db.prepare("SELECT id, quantity FROM cards WHERE set_code = 'Unknown'").all();
        let mergedCount = 0;

        db.transaction(() => {
            unknowns.forEach(unknown => {
                // Find the MOST COMMON specific variant for this card ID
                // ORDER BY quantity DESC ensures we merge into the one user has the most of
                const specific = db.prepare(`
                    SELECT id, set_code, quantity
                    FROM cards
                    WHERE id = ? AND set_code != 'Unknown'
                    ORDER BY quantity DESC
                    LIMIT 1
                `).get(unknown.id);

                if (specific) {
                    // Merge quantity to the specific one
                    const newQty = specific.quantity + unknown.quantity;
                    db.prepare("UPDATE cards SET quantity = ? WHERE id = ? AND set_code = ?").run(newQty, specific.id, specific.set_code);

                    // Delete the unknown one
                    db.prepare("DELETE FROM cards WHERE id = ? AND set_code = 'Unknown'").run(unknown.id);

                    mergedCount++;
                }
            });

            // Recalculate portfolio value
            const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
            if (totalVal) {
                 db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val || 0 });
            }
        })();

        return { success: true, merged: mergedCount };
    } catch (e) {
        console.error("Merge Unknown Error:", e);
        return { success: false, error: e.message };
    }
}

// Backup & Restore
ipcMain.handle('backup-database', async () => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Backup Database',
            defaultPath: `cards_backup_${new Date().toISOString().slice(0,10)}.db`,
            filters: [{ name: 'SQLite Database', extensions: ['db'] }]
        });

        if (result.canceled || !result.filePath) return { canceled: true };

        // Flush WAL if needed? better-sqlite3 handles this usually.
        // Copy the file
        fs.copyFileSync(dbPath, result.filePath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('restore-database', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Restore Database',
            properties: ['openFile'],
            filters: [{ name: 'SQLite Database', extensions: ['db'] }]
        });

        if (result.canceled || result.filePaths.length === 0) return { canceled: true };

        const backupPath = result.filePaths[0];

        // Close current connection
        db.close();

        // Copy backup to userData
        fs.copyFileSync(backupPath, dbPath);

        // Restart app to reload DB
        app.relaunch();
        app.exit(0);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Settings Handlers
ipcMain.handle('get-settings', () => {
    try {
        const rows = db.prepare('SELECT * FROM settings').all();
        // Convert to object
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        return settings;
    } catch (e) {
        return {};
    }
});

ipcMain.handle('save-setting', (event, { key, value }) => {
    try {
        db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value').run({ key, value });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-db-path', () => {
    return dbPath;
});

ipcMain.handle('move-database', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select New Database Folder',
            properties: ['openDirectory']
        });

        if (result.canceled || result.filePaths.length === 0) return { canceled: true };

        const newFolder = result.filePaths[0];
        const newDbPath = path.join(newFolder, 'cards.db');

        // Check if DB already exists there
        if (fs.existsSync(newDbPath)) {
            const confirm = await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                buttons: ['Use Existing', 'Overwrite', 'Cancel'],
                message: 'A database already exists in this folder.',
                detail: 'Do you want to use the existing one or overwrite it with your current data?'
            });

            if (confirm.response === 2) return { canceled: true };

            if (confirm.response === 1) {
                // Overwrite: Close current, copy file
                db.close();
                fs.copyFileSync(dbPath, newDbPath);
            }
            // If response === 0 (Use Existing), we just switch paths without copying
        } else {
            // Copy current DB to new location
            db.close();
            fs.copyFileSync(dbPath, newDbPath);
        }

        // Update config
        fs.writeFileSync(configPath, JSON.stringify({ dbPath: newDbPath }, null, 2));

        // Restart to load new DB
        app.relaunch();
        app.exit(0);

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('reset-database', async () => {
    try {
        db.close();
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
        app.relaunch();
        app.exit(0);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('manual-scan', (event, passcode) => {
    // Emit 'card-scanned' event to the renderer, just like a socket event would
    if (mainWindow) {
        mainWindow.webContents.send('card-scanned', { passcode });
    }
    return { success: true };
});

ipcMain.handle('fetch-card-data', async (event, passcode) => {
  try {
    const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${passcode}`);
    if (!response.ok) {
      throw new Error('Card not found');
    }
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      return data.data[0];
    }
    return null;
  } catch (error) {
    console.error('Fetch error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('get-decks', () => {
    return db.prepare('SELECT * FROM decks ORDER BY created_at DESC').all();
});

ipcMain.handle('create-deck', (event, name) => {
    const info = db.prepare('INSERT INTO decks (name) VALUES (?)').run(name);
    return { id: info.lastInsertRowid, name };
});

ipcMain.handle('delete-deck', (event, id) => {
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM decks WHERE id = ?').run(id);
    return true;
});

ipcMain.handle('save-deck', (event, { deckId, cards }) => {
    const deleteStmt = db.prepare('DELETE FROM deck_cards WHERE deck_id = ?');
    const insertStmt = db.prepare('INSERT INTO deck_cards (deck_id, card_id, type, quantity) VALUES (@deckId, @cardId, @type, @quantity)');

    const transaction = db.transaction((cards) => {
        deleteStmt.run(deckId);
        for (const card of cards) {
            insertStmt.run({
                deckId,
                cardId: card.id,
                type: card.type || 'main',
                quantity: card.quantity
            });
        }
    });

    try {
        transaction(cards);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-deck-details', (event, deckId) => {
    const cards = db.prepare(`
        SELECT dc.*, c.name, c.image_url, c.type as card_type
        FROM deck_cards dc
        LEFT JOIN cards c ON dc.card_id = c.id
        WHERE dc.deck_id = ?
        GROUP BY dc.card_id, dc.type
    `).all(deckId);
    return cards;
});

ipcMain.handle('import-deck-ydk', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'YDK Deck', extensions: ['ydk'] }]
        });

        if (result.canceled || result.filePaths.length === 0) return { canceled: true };

        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        const lines = content.split(/\r?\n/);

        let currentSection = 'main';
        const deck = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '#main') currentSection = 'main';
            else if (trimmed === '#extra') currentSection = 'extra';
            else if (trimmed === '!side') currentSection = 'side';
            else if (/^\d+$/.test(trimmed)) {
                deck.push({ id: trimmed, type: currentSection, quantity: 1 });
            }
        }

        return { canceled: false, deck, name: path.basename(result.filePaths[0], '.ydk') };
    } catch (e) {
        return { error: e.message };
    }
});

// Wishlist Handlers
ipcMain.handle('get-wishlist', () => {
    return db.prepare('SELECT * FROM wishlist ORDER BY created_at DESC').all();
});

ipcMain.handle('add-to-wishlist', (event, card) => {
    try {
        const exists = db.prepare('SELECT id FROM wishlist WHERE card_id = ?').get(String(card.id));
        if (exists) return { success: false, message: 'Already in wishlist' };

        db.prepare('INSERT INTO wishlist (card_id, name, image_url, price) VALUES (@id, @name, @image_url, @price)').run({
            id: String(card.id),
            name: card.name,
            image_url: card.image_url,
            price: card.price || 0
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('remove-from-wishlist', (event, id) => {
    db.prepare('DELETE FROM wishlist WHERE id = ?').run(id);
    return true;
});

ipcMain.handle('search-online', async (event, query) => {
    try {
        if (!query || query.length < 3) return [];
        const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.data || [];
    } catch (e) {
        console.error("Online Search Error:", e);
        return [];
    }
});

ipcMain.handle('add-card-to-db', (event, card) => {
  try {
    const id = String(card.id);
    const setCode = card.set_code || 'Unknown';
    const language = card.language || 'DE'; // Default to German if not specified

    // Check for exact variant match (including language)
    const existing = db.prepare('SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND language = ?').get(id, setCode, language);

    if (existing) {
        const newQty = existing.quantity + (card.quantity || 1);
        db.prepare('UPDATE cards SET quantity = @qty, price = @price WHERE id = @id AND set_code = @set_code AND language = @language').run({
            qty: newQty,
            price: card.price || 0,
            id: id,
            set_code: setCode,
            language: language
        });
        return { success: true, updated: true };
    } else {
        const stmt = db.prepare(`
          INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language)
          VALUES (@id, @name, @type, @desc, @image_url, @atk, @def, @level, @race, @attribute, @quantity, @rarity, @set_code, @price, @language)
        `);

        const imageUrl = card.card_images && card.card_images.length > 0 ? card.card_images[0].image_url : '';

        // Handle Link Rating mapping
        let level = card.level;
        if (card.type && card.type.includes('Link') && card.linkval !== undefined) {
            level = card.linkval;
        }

        stmt.run({
          id: String(card.id),
          name: card.name,
          type: card.type,
          desc: card.desc,
          image_url: imageUrl,
          atk: valOrNull(card.atk),
          def: valOrNull(card.def),
          level: valOrNull(level),
          race: card.race || null,
          attribute: card.attribute || null,
          quantity: card.quantity || 1,
          rarity: card.rarity || 'Unknown',
          set_code: card.set_code || 'Unknown',
          price: card.price || 0,
          language: language
        });
        return { success: true, inserted: true };
    }
  } catch (error) {
    console.error('DB Insert Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-portfolio', () => {
    try {
        const stats = db.prepare('SELECT SUM(price * quantity) as totalValue, SUM(quantity) as totalCards, COUNT(*) as uniqueCards FROM cards').get();
        return stats;
    } catch (error) {
        return { totalValue: 0, totalCards: 0, uniqueCards: 0 };
    }
});

ipcMain.handle('get-price-history', () => {
    try {
        return db.prepare('SELECT * FROM portfolio_history ORDER BY timestamp ASC').all();
    } catch (error) {
        return [];
    }
});

ipcMain.handle('update-card-meta', (event, data) => {
    try {
        // We need to handle PK updates carefully (id, set_code, language)
        // If the new PK already exists, we might need to merge.
        // For simplicity, let's assume UI prevents conflict or we handle it via catch

        // We also need to know the OLD language to target the row
        const language = data.language || 'DE';
        const oldLanguage = data.old_language || language;

        const stmt = db.prepare(`
            UPDATE cards
            SET set_code = @new_set_code, rarity = @rarity, quantity = @quantity, price = @price, language = @language
            WHERE id = @passcode AND set_code = @old_set_code AND language = @old_language
        `);

        const result = stmt.run({
            passcode: String(data.passcode),
            old_set_code: data.old_set_code || 'Unknown',
            old_language: oldLanguage,
            new_set_code: data.new_set_code || 'Unknown',
            language: language,
            rarity: data.rarity || 'Unknown',
            quantity: data.quantity || 1,
            price: data.price || 0
        });

        const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
        if (totalVal) {
             db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val || 0 });
        }

        return { success: true, changes: result.changes };
    } catch (error) {
        console.error("Update Meta Error:", error);
        return { success: false, error: error.message };
    }
});

async function performCardUpdate(cardsToUpdate, eventSender) {
    let updatedCount = 0;
    const total = cardsToUpdate.length;

    let priceSource = 'cardmarket';
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
        if (row && row.value) priceSource = row.value;
    } catch (e) {
        console.log("Error reading price source settings:", e);
    }

    const sourceMap = {
        'cardmarket': 'cardmarket_price',
        'tcgplayer': 'tcgplayer_price',
        'ebay': 'ebay_price',
        'amazon': 'amazon_price',
        'coolstuffinc': 'coolstuffinc_price'
    };
    const apiField = sourceMap[priceSource] || 'cardmarket_price';

    // Record history BEFORE update
    try {
        const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
        if (totalVal && totalVal.val > 0) {
             db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val });
        }
    } catch(e) { console.log(e); }

    for (let i = 0; i < total; i++) {
       const cardEntry = cardsToUpdate[i];

       if (eventSender) {
           eventSender.send('update-progress', { current: i + 1, total });
       }

       try {
          const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${cardEntry.id}`);
          if (response.ok) {
             const data = await response.json();
             if (data.data && data.data.length > 0) {
                const apiCard = data.data[0];
                const imageUrl = apiCard.card_images && apiCard.card_images.length > 0 ? apiCard.card_images[0].image_url : '';

                let newPrice = 0;

                // --- PRICE LOGIC START ---
                // If the stored card has a set_code, try to find specific price
                let foundSetPrice = false;
                if (cardEntry.set_code && cardEntry.set_code !== 'Unknown' && apiCard.card_sets) {
                    const matchedSet = apiCard.card_sets.find(s => s.set_code === cardEntry.set_code);
                    // Check if matched set exists AND has a non-zero price
                    if (matchedSet && matchedSet.set_price && parseFloat(matchedSet.set_price) > 0) {
                        newPrice = parseFloat(matchedSet.set_price);
                        foundSetPrice = true;
                    }
                }

                // Fallback if no set matched, no set code, OR set price was 0
                if (!foundSetPrice) {
                    if (apiCard.card_prices && apiCard.card_prices.length > 0) {
                        newPrice = parseFloat(apiCard.card_prices[0][apiField]) || 0;
                    }
                }
                // --- PRICE LOGIC END ---

                // Map Link Rating to Level if Link Monster
                let level = apiCard.level;
                if (apiCard.type && apiCard.type.includes('Link') && apiCard.linkval !== undefined) {
                    level = apiCard.linkval;
                }

                db.prepare(`
                  UPDATE cards SET
                    name = @name, type = @type, desc = @desc, image_url = @image_url,
                    atk = @atk, def = @def, level = @level, race = @race, attribute = @attribute, price = @price,
                    last_updated = CURRENT_TIMESTAMP
                  WHERE id = @id AND set_code = @set_code
                `).run({
                   id: String(apiCard.id),
                   set_code: cardEntry.set_code || 'Unknown', // Update specific row
                   name: apiCard.name,
                   type: apiCard.type,
                   desc: apiCard.desc,
                   image_url: imageUrl,
                   atk: valOrNull(apiCard.atk),
                   def: valOrNull(apiCard.def),
                   level: valOrNull(level),
                   race: apiCard.race || null,
                   attribute: apiCard.attribute || null,
                   price: newPrice
                });
                updatedCount++;
             }
          }
       } catch (err) {
          console.error(`Failed to update card ${cardEntry.id}`, err);
       }
       await new Promise(r => setTimeout(r, 100));
    }

    // Record history AFTER update
    try {
        const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
        if (totalVal && totalVal.val > 0) {
             db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val });
        }
    } catch(e) { console.log(e); }

    if (eventSender) {
        eventSender.send('update-progress', { current: total, total });
    }

    return updatedCount;
}

ipcMain.handle('update-all-cards', async (event) => {
  try {
    // We must select set_code too, to identify unique rows
    const cards = db.prepare('SELECT id, set_code FROM cards').all();
    const updatedCount = await performCardUpdate(cards, event.sender);
    return { success: true, updatedCount };
  } catch (error) {
    console.error('Update All Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-missing-cards', async (event) => {
  try {
    // Select specific rows (id, set_code) that need update
    const cardsToUpdate = db.prepare(`
        SELECT id, set_code FROM cards
        WHERE atk IS NULL
           OR level IS NULL
           OR (def IS NULL AND (type IS NULL OR type NOT LIKE '%Link%'))
    `).all();

    const updatedCount = await performCardUpdate(cardsToUpdate, event.sender);
    return { success: true, updatedCount };
  } catch (error) {
    console.error('Update Missing Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-collection', () => {
  try {
    const stmt = db.prepare('SELECT * FROM cards ORDER BY created_at DESC');
    return stmt.all();
  } catch (error) {
    console.error('DB Select Error:', error);
    return [];
  }
});

ipcMain.handle('check-card-exists', (event, passcode) => {
  try {
    // Check SUM of quantity for this ID regardless of set_code
    const stmt = db.prepare('SELECT SUM(quantity) as count FROM cards WHERE id = ?');
    const result = stmt.get(String(passcode)); // Ensure string for text ID column
    const totalQty = result.count || 0;
    return { exists: totalQty > 0, quantity: totalQty };
  } catch (error) {
    console.error('DB Check Error:', error);
    return { exists: false, quantity: 0 };
  }
});

ipcMain.handle('import-csv', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const cards = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(';');
      if (parts.length >= 2) {
        const passcode = parts[1].trim();
        if (/^\d+$/.test(passcode)) {
            cards.push({ passcode });
        }
      }
    }

    return { canceled: false, cards };
  } catch (error) {
    console.error('CSV Import Error:', error);
    return { error: error.message };
  }
});
