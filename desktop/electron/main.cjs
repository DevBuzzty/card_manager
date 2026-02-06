const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const os = require('os');

// Database Setup
const dbPath = path.join(app.getPath('userData'), 'cards.db');
const db = new Database(dbPath);

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code)
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

// Migration: Add new columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(cards)").all();
  const columnNames = columns.map(c => c.name);
  if (!columnNames.includes('atk')) db.exec("ALTER TABLE cards ADD COLUMN atk INTEGER");
  if (!columnNames.includes('def')) db.exec("ALTER TABLE cards ADD COLUMN def INTEGER");
  if (!columnNames.includes('level')) db.exec("ALTER TABLE cards ADD COLUMN level INTEGER");
  if (!columnNames.includes('race')) db.exec("ALTER TABLE cards ADD COLUMN race TEXT");
  if (!columnNames.includes('attribute')) db.exec("ALTER TABLE cards ADD COLUMN attribute TEXT");
  if (!columnNames.includes('quantity')) db.exec("ALTER TABLE cards ADD COLUMN quantity INTEGER DEFAULT 1");
  if (!columnNames.includes('rarity')) db.exec("ALTER TABLE cards ADD COLUMN rarity TEXT");
  if (!columnNames.includes('set_code')) db.exec("ALTER TABLE cards ADD COLUMN set_code TEXT");
  if (!columnNames.includes('price')) db.exec("ALTER TABLE cards ADD COLUMN price REAL");

  // Note: Changing Primary Key from 'id' to '(id, set_code)' is hard in SQLite (requires recreation).
  // For dev environment, we assume user might reset DB or we just handle duplicates via logic if schema migration fails on constraints.
  // In a real app we would create a new table and copy data.
  // Here, we'll just ensure columns exist. Logic will handle upserts carefully.
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

  const isDev = !app.isPackaged; // Simple check, or check env var
  // In this environment, we will run with 'npm run electron:dev' which sets an env var usually,
  // or we just assume localhost:5173 for dev.

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
      origin: "*", // Allow Android app to connect
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

app.whenReady().then(() => {
  createWindow();
  startSocketServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers

ipcMain.handle('get-ip-address', () => {
  return getLocalIpAddress();
});

ipcMain.handle('fetch-card-data', async (event, passcode) => {
  try {
    const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${passcode}`);
    if (!response.ok) {
      throw new Error('Card not found');
    }
    const data = await response.json();
    // The API returns { data: [ ... ] }
    if (data.data && data.data.length > 0) {
      return data.data[0];
    }
    return null;
  } catch (error) {
    console.error('Fetch error:', error);
    return { error: error.message };
  }
});

// Deck Handlers
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
    // cards: { id, type, quantity }
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
        GROUP BY dc.card_id, dc.type -- avoid duplicates if multiple printings in DB, pick one for display
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

ipcMain.handle('add-card-to-db', (event, card) => {
  try {
    // Check if card with same ID and Set Code exists
    const existing = db.prepare('SELECT quantity FROM cards WHERE id = @id AND set_code = @set_code').get({
        id: String(card.id),
        set_code: card.set_code || 'Unknown'
    });

    if (existing) {
        // Increment quantity
        const newQty = existing.quantity + (card.quantity || 1);
        db.prepare('UPDATE cards SET quantity = @qty, price = @price WHERE id = @id AND set_code = @set_code').run({
            qty: newQty,
            price: card.price || 0,
            id: String(card.id),
            set_code: card.set_code || 'Unknown'
        });
        return { success: true, updated: true };
    } else {
        // Insert new
        const stmt = db.prepare(`
          INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price)
          VALUES (@id, @name, @type, @desc, @image_url, @atk, @def, @level, @race, @attribute, @quantity, @rarity, @set_code, @price)
        `);

        const imageUrl = card.card_images && card.card_images.length > 0 ? card.card_images[0].image_url : '';

        stmt.run({
          id: String(card.id),
          name: card.name,
          type: card.type,
          desc: card.desc,
          image_url: imageUrl,
          atk: card.atk || null,
          def: card.def || null,
          level: card.level || null,
          race: card.race || null,
          attribute: card.attribute || null,
          quantity: card.quantity || 1,
          rarity: card.rarity || 'Unknown',
          set_code: card.set_code || 'Unknown',
          price: card.price || 0
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
    // data: { passcode, old_set_code, new_set_code, rarity, quantity, price }
    try {
        // We identify the card by passcode AND old_set_code.
        // Update to new_set_code, rarity, quantity, price
        const stmt = db.prepare(`
            UPDATE cards
            SET set_code = @new_set_code, rarity = @rarity, quantity = @quantity, price = @price
            WHERE id = @passcode AND set_code = @old_set_code
        `);

        const result = stmt.run({
            passcode: String(data.passcode),
            old_set_code: data.old_set_code || 'Unknown',
            new_set_code: data.new_set_code || 'Unknown',
            rarity: data.rarity || 'Unknown',
            quantity: data.quantity || 1,
            price: data.price || 0
        });

        // Trigger portfolio recalculation immediately
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

async function performCardUpdate(cards, eventSender) {
    let updatedCount = 0;
    const total = cards.length;

    // Record history start
    try {
        const totalVal = db.prepare("SELECT SUM(price * quantity) as val FROM cards").get();
        if (totalVal && totalVal.val > 0) {
             db.prepare("INSERT INTO portfolio_history (total_value) VALUES (@val)").run({ val: totalVal.val });
        }
    } catch(e) { console.log(e); }

    for (let i = 0; i < total; i++) {
       const card = cards[i];

       // Report progress
       if (eventSender) {
           eventSender.send('update-progress', { current: i + 1, total });
       }

       try {
          const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${card.id}`);
          if (response.ok) {
             const data = await response.json();
             if (data.data && data.data.length > 0) {
                const apiCard = data.data[0];
                const imageUrl = apiCard.card_images && apiCard.card_images.length > 0 ? apiCard.card_images[0].image_url : '';

                // Fetch price for the specific set code if possible, or average
                // Simulating price extraction from apiCard.card_prices if available
                let price = card.price || 0;
                if (apiCard.card_prices && apiCard.card_prices.length > 0) {
                    price = parseFloat(apiCard.card_prices[0].cardmarket_price) || 0;
                }

                db.prepare(`
                  UPDATE cards SET
                    name = @name, type = @type, desc = @desc, image_url = @image_url,
                    atk = @atk, def = @def, level = @level, race = @race, attribute = @attribute, price = @price
                  WHERE id = @id
                `).run({
                   id: String(apiCard.id),
                   name: apiCard.name,
                   type: apiCard.type,
                   desc: apiCard.desc,
                   image_url: imageUrl,
                   atk: apiCard.atk || null,
                   def: apiCard.def || null,
                   level: apiCard.level || null,
                   race: apiCard.race || null,
                   attribute: apiCard.attribute || null,
                   price: price
                });
                updatedCount++;
             }
          }
       } catch (err) {
          console.error(`Failed to update card ${card.id}`, err);
       }
       // Respect API rate limits slightly
       await new Promise(r => setTimeout(r, 100));
    }

    // Ensure 100% is sent
    if (eventSender) {
        eventSender.send('update-progress', { current: total, total });
    }

    return updatedCount;
}

ipcMain.handle('update-all-cards', async (event) => {
  try {
    const cards = db.prepare('SELECT id FROM cards').all();
    // Run in background basically, but await here so frontend knows when started/done loop
    // Actually for long running, we should just return "started" and send events.
    // But request was "keep it running".
    // We will await it, but frontend will handle async.
    const updatedCount = await performCardUpdate(cards, event.sender);
    return { success: true, updatedCount };
  } catch (error) {
    console.error('Update All Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-missing-cards', async (event) => {
  try {
    // Select cards that are missing key details (like ATK/DEF/Level) or just generic "where atk is null"
    // Assuming 'type' is always present, but let's check for nulls in new columns
    const cards = db.prepare('SELECT id FROM cards WHERE atk IS NULL AND def IS NULL AND level IS NULL').all();
    const updatedCount = await performCardUpdate(cards, event.sender);
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
    const stmt = db.prepare('SELECT SUM(quantity) as count FROM cards WHERE id = ?');
    const result = stmt.get(passcode);
    return { exists: (result.count || 0) > 0, quantity: result.count || 0 };
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

    // Format: German Name;Passcode;English Name
    // Skip header (row 0)
    const cards = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(';');
      if (parts.length >= 2) {
        // Passcode is index 1
        const passcode = parts[1].trim();
        // Simple validation: must be digits
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
