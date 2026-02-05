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
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    desc TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

let mainWindow;
let io;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

ipcMain.handle('add-card-to-db', (event, card) => {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO cards (id, name, type, desc, image_url)
      VALUES (@id, @name, @type, @desc, @image_url)
    `);

    // card object from API might vary, let's map it safely
    // YGOPRODeck images: card_images[0].image_url
    const imageUrl = card.card_images && card.card_images.length > 0 ? card.card_images[0].image_url : '';

    const info = stmt.run({
      id: String(card.id),
      name: card.name,
      type: card.type,
      desc: card.desc,
      image_url: imageUrl
    });
    return { success: true, changes: info.changes };
  } catch (error) {
    console.error('DB Insert Error:', error);
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
