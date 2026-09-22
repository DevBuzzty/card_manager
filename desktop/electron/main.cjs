const { app, BrowserWindow, ipcMain, dialog, Notification, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const os = require('os');
const { initDatabase, getDb } = require('./database.cjs');
const { fetchCardData, fetchYugipediaSets, fetchJapaneseSets, cachedFetch } = require('./api-handler.cjs');
const { belongsToCard, resolveSetCode } = require('./setcode-resolve.cjs');
const { startSync } = require('./sync.cjs');
const { startDealPoller } = require('./deals/poller.cjs');
const { runCardmarketScrape, runFirstEdPass } = require('./cardmarket-scraper.cjs');
const { runBulkRefresh, getBulkStatus } = require('./cardmarket-bulk.cjs');
const { runCatalogBuild, getCatalogStatus, uploadModel, ALLOWED_MODEL_KINDS } = require('./catalog-builder.cjs');
const { recordPrice } = require('./price-history.cjs');
const { computeMovers, addDays } = require('./movers.cjs');
const { referenceRows, cardHistory } = require('./price-reference.cjs');
const { recordPortfolioValue, portfolioTotals } = require('./portfolio-value.cjs');
const { copyCount } = require('./valuation.cjs');
const { alertText } = require('./alert-text.cjs');
const copies = require('./copies.cjs');
const { deleteContainer } = require('./containers-schema.cjs');
const sealed = require('./sealed-items.cjs');
const sales = require('./sales.cjs');
const listings = require('./listings.cjs');
const { saveListingImages } = require('./listing-images.cjs');
const photos = require('./listing-photos.cjs');
const { readSealedProducts, searchSealedProducts, sealedProductsAvailable } = require('./sealed-products.cjs');
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');
const { setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck, saveDeck } = require('./decks.cjs');
const { catalogPrices, catalogCards, readCatalogCards, catalogSearchNames, catalogMainId, catalogLegality } = require('./catalog-prices.cjs');
const { createImportSessions, importOpen, importResolve, importRun } = require('./carddex-import.cjs');
const { onlineSearch } = require('./online-search.cjs');
const { buildExport, exportCount, exportResultText } = require('./collection-export.cjs');

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

  // `phone-connected` only fires the moment a socket connects, so the renderer misses it when it
  // mounts after an already-running phone reconnected, and forgets it on every reload. Replay the
  // current socket state on each load instead of adding a second channel.
  mainWindow.webContents.on('did-finish-load', () => {
    if (io?.sockets?.sockets?.size) mainWindow.webContents.send('phone-connected');
  });
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

// Der Set-Code schlaegt das Bild. Das Handy meldet in `readSetCode`, was es WIRKLICH gelesen hat
// (unabhaengig davon, ob das zur erkannten Karte passt). Zeigt der Code auf eine andere Karte und
// loest er sich EINDEUTIG auf, wird der Passcode hier getauscht -- noch bevor der Renderer die
// Meldung sieht, damit in der Staging-Liste gleich die richtige Karte steht (Nutzerentscheid
// 20.09.: still korrigieren, nur klein vermerken).
//
// Alles daran ist zurueckhaltend: ohne gelesenen Code, bei einem Code, der zur erkannten Karte
// passt, bei einer uneindeutigen Aufloesung, bei einem Netzfehler oder nach 2 s bleibt die Meldung
// unveraendert. Eine stille Falschkorrektur waere schlimmer als der Fehler, den sie behebt.
const SETCODE_KORREKTUR_MS = 2000;
async function korrigiereNachSetCode(data) {
  try {
    const gelesen = data && data.readSetCode;
    if (!gelesen || !data.passcode) return data;
    const arbeit = (async () => {
      const karte = await fetchCardData(String(data.passcode));
      const sets = (karte && karte.data && karte.data[0] && karte.data[0].card_sets) || [];
      if (belongsToCard(gelesen, sets)) return data;   // Bild und Code sind sich einig
      const treffer = await resolveSetCode({
        listSets: () => cachedFetch('https://db.ygoprodeck.com/api/v7/cardsets.php', 'ygo_sets', 24 * 7),
        cardsOfSet: async (name) => {
          const j = await cachedFetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(name)}`, 'ygo_setcards', 24 * 7);
          return (j && j.data) || [];
        },
      }, gelesen);
      if (!treffer || treffer.id === String(data.passcode)) return data;
      console.log(`[set-code] ${gelesen} -> ${treffer.id} ${treffer.name} (Bild sagte ${data.passcode})`);
      // Set-Code und Rarity des Handys gehoerten zur FALSCHEN Karte: der gelesene Code ersetzt sie,
      // die Rarity faellt weg und wird aus den Drucken des richtigen Codes geholt. Sprache und
      // Auflage kommen aus dem Kartentext und bleiben gueltig.
      const korrigiert = { ...data, passcode: treffer.id, setCode: gelesen, setCodeCandidates: [gelesen],
        correctedFrom: String(data.passcode), correctedBy: gelesen };
      delete korrigiert.rarity;
      return korrigiert;
    })();
    const zeit = new Promise(r => setTimeout(() => r(data), SETCODE_KORREKTUR_MS));
    return await Promise.race([arbeit, zeit]);
  } catch (e) {
    console.error('[set-code] Korrektur fehlgeschlagen:', e && e.message);
    return data;
  }
}

function startSocketServer() {
  io = new Server(4000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('phone-connected');
    // Eine Kette statt nebenlaeufiger Bearbeitung: die Korrektur darf warten (Netz), die
    // REIHENFOLGE darf nicht kippen. Im Stapel-Modus zaehlt sie -- kaeme eine Wiederholung vor
    // ihrer Erstsichtung an, legte applyScan zwei Eintraege statt einer "+1" an.
    let kette = Promise.resolve();
    socket.on('card_scanned', (data) => {
      kette = kette
        .then(() => korrigiereNachSetCode(data))
        .then((korrigiert) => { if (mainWindow) mainWindow.webContents.send('card-scanned', korrigiert); })
        .catch((e) => console.error('[card_scanned]', e && e.message));
    });
    socket.on('disconnect', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('phone-disconnected');
    });
    // (Removed stale pre-cloud deal socket handlers: the phone now reads/writes the shared
    // Supabase deal tables directly, so add_deal_watch/request_deals over the socket — which
    // hit orphaned local SQLite tables and referenced an undeclared poller — are dead.)
  });
  console.log('Socket.io server running on port 4000');
}

let priceUpdateInterval;
let cmPollInterval;
let cmBulkInterval;
let catalogInterval;
let catalogRunning = false;
let sync;   // { ensureClient } handle from startSync, for cloud deal handlers

const getSetting = (key) => {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
};

app.whenReady().then(() => {
  // Windows zeigt Benachrichtigungen nur mit App-ID (gleich appId in package.json).
  if (process.platform === 'win32') app.setAppUserModelId('com.yugioh.cardmanager');
  createWindow();
  startSocketServer();
  startPricePoller();
  startCardmarketPoller();
  startCardmarketBulkScheduler();
  sync = startSync(db, () => mainWindow, { onPriceAlerts: showPriceAlertNotification });
  startCatalogScheduler();
  // Deals now live in Supabase (the cloud Edge Function scrapes, shared with the phone).
  // The old local SQLite poller is disabled — the desktop reads/writes the cloud tables.

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

// Spec D4 §6.4: der PC meldet dem Handy, dass es eine Karte wieder freigeben darf -- nach dem
// Uebernehmen, dem Verwerfen und dem Alles-Verwerfen. Ohne das waechst die Merkliste des Handys
// unbegrenzt, sobald der PC das Staging fuehrt, und dieselbe Karte waere in einem spaeteren
// Stapel nie wieder scannbar. Ist kein Handy verbunden, ist das emit wirkungslos -- kein Sonderfall.
ipcMain.handle('release-staged', (_e, passcodes) => {
  if (!io || !Array.isArray(passcodes) || passcodes.length === 0) return { success: true };
  io.emit('staging_released', { passcodes: passcodes.map(String) });
  return { success: true };
});

// --- Deal-scraper: watches + alerts (Supabase cloud — same source as the phone) ---
async function dealsClient() {
    const c = sync && await sync.ensureClient();
    if (!c) throw new Error('Cloud nicht verbunden — Supabase-Login in den Einstellungen prüfen.');
    return c;
}
function triggerCloudScrape(c) {
    // Fire the scrape-deals Edge Function so new watches get results immediately. Best-effort.
    try { c.functions.invoke('scrape-deals').catch(() => {}); } catch (e) {}
}
ipcMain.handle('add-deal-watch', async (event, { query, maxPrice, sources, condition }) => {
    const c = await dealsClient();
    const { data, error } = await c.from('deal_watches')
        .insert({
            query: String(query || ''),
            max_price: Number(maxPrice) || 0,
            sources: sources ? JSON.stringify(sources) : null,
            condition: ['new', 'used', 'any'].includes(condition) ? condition : 'any',
        })
        .select('id').single();
    if (error) throw new Error(error.message);
    triggerCloudScrape(c);
    return data.id;
});
ipcMain.handle('get-deal-watches', async () => {
    const c = await dealsClient();
    const { data, error } = await c.from('deal_watches').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
});
ipcMain.handle('delete-deal-watch', async (event, id) => {
    const c = await dealsClient();
    const { error } = await c.from('deal_watches').delete().eq('id', id);   // deal_alerts cascade in the DB
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('toggle-deal-watch', async (event, { id, active }) => {
    const c = await dealsClient();
    const { error } = await c.from('deal_watches').update({ active: !!active }).eq('id', id);
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('get-deal-alerts', async () => {
    const c = await dealsClient();
    const { data, error } = await c.from('deal_alerts').select('*')
        .eq('dismissed', false).order('found_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return data || [];
});
ipcMain.handle('dismiss-deal-alert', async (event, id) => {
    const c = await dealsClient();
    const { error } = await c.from('deal_alerts').update({ dismissed: true }).eq('id', id);
    if (error) throw new Error(error.message);
    return true;
});
// Run the cloud scrape and WAIT for it (so the UI can reload fresh results afterwards).
ipcMain.handle('trigger-deal-scrape', async () => {
    const c = await dealsClient();
    const { error } = await c.functions.invoke('scrape-deals');
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('open-external', (event, url) => { if (url) shell.openExternal(url); });

// --- Spec G2: Preis-Alarme (Supabase; ausgewertet nur von der Edge Function evaluate-price-alerts) ---
async function alertsClient() {
    const c = sync && await sync.ensureClient();
    if (!c) throw new Error('Cloud nicht verbunden');
    return c;
}
const alertPrinting = (p = {}) => ({
    card_id: String(p.id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown',
});
function cardNameOf(cardId) {
    try { return db.prepare('SELECT name FROM cards WHERE id = ? AND name IS NOT NULL LIMIT 1').get(String(cardId))?.name || null; }
    catch { return null; }
}
function withAlertText(e) {
    const name = cardNameOf(e.card_id);
    return { ...e, name, text: alertText({ ...e, name }) };
}
function notifyPriceAlertsChanged() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('price-alerts-changed');
}
// Referenz halten, sonst raeumt der GC die Notification weg und der Klick kommt nie an.
const liveNotifications = new Set();
function showPriceAlertNotification(r) {
    if (!Notification.isSupported()) return;
    const body = r.notify === 'one' ? withAlertText(r.event).text : `${r.count} neue Preis-Alarme`;
    const n = new Notification({ title: 'Preis-Alarm', body });
    liveNotifications.add(n);
    const drop = () => liveNotifications.delete(n);
    n.on('click', () => {
        drop();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('open-price-alerts');
    });
    n.on('close', drop);
    n.show();
}
ipcMain.handle('price-alerts-move-get', async () => {
    const c = await alertsClient();
    const { data, error } = await c.from('price_alert_rules').select('id,pct,min_eur,days,active')
        .eq('kind', 'move').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...data, pct: Number(data.pct), min_eur: Number(data.min_eur), days: Number(data.days) } : null;
});
// Ohne Zeile ist der Bewegungsalarm aus (Spec §4.1); speichern legt sie an oder aktualisiert sie.
ipcMain.handle('price-alerts-move-save', async (event, { pct, min_eur, days, active } = {}) => {
    const c = await alertsClient();
    const row = { pct: Number(pct), min_eur: Number(min_eur), days: Number(days) === 30 ? 30 : 7, active: !!active };
    const { data: cur, error: readError } = await c.from('price_alert_rules').select('id').eq('kind', 'move').maybeSingle();
    if (readError) throw new Error(readError.message);
    const { error } = cur
        ? await c.from('price_alert_rules').update(row).eq('id', cur.id)
        : await c.from('price_alert_rules').insert({ kind: 'move', ...row });
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('price-alerts-targets-get', async (event, printing) => {
    const c = await alertsClient();
    const { data, error } = await c.from('price_alert_rules').select('kind,threshold,armed')
        .in('kind', ['above', 'below']).eq('active', true).match(alertPrinting(printing));
    if (error) throw new Error(error.message);
    const pick = (kind) => {
        const r = (data || []).find((x) => x.kind === kind);
        return r ? { threshold: Number(r.threshold), armed: !!r.armed } : null;
    };
    return { above: pick('above'), below: pick('below') };
});
// threshold null = entfernen (active = false, Treffer bleiben). Setzen macht den Zielpreis wieder scharf.
ipcMain.handle('price-alerts-target-save', async (event, { printing, kind, threshold } = {}) => {
    if (kind !== 'above' && kind !== 'below') throw new Error('Unbekannte Alarmart');
    const c = await alertsClient();
    const key = alertPrinting(printing);
    const value = threshold == null || threshold === '' ? null : Number(threshold);
    const { error } = value == null
        ? await c.from('price_alert_rules').update({ active: false }).eq('kind', kind).match(key)
        : await c.from('price_alert_rules').upsert(
            { kind, ...key, threshold: value, active: true, armed: true },
            { onConflict: 'user_id,kind,card_id,set_code,language,rarity' },
        );
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('price-alerts-events-list', async () => {
    const c = await alertsClient();
    const { data, error } = await c.from('price_alert_events').select('*')
        .eq('dismissed', false).order('id', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data || []).map(withAlertText);
});
ipcMain.handle('price-alerts-event-dismiss', async (event, id) => {
    const c = await alertsClient();
    const { error } = await c.from('price_alert_events').update({ dismissed: true }).eq('id', id);
    if (error) throw new Error(error.message);
    notifyPriceAlertsChanged();
    return true;
});
// Nur die beim Laden angezeigten Treffer (id <= maxId), damit ein Treffer, der zwischen Laden und
// Klick dazukommt, nicht ungesehen mit erledigt wird (Spec G2 §5.4).
ipcMain.handle('price-alerts-events-dismiss-all', async (event, maxId) => {
    if (!Number.isFinite(maxId)) throw new Error('Ungültige Auswahl');
    const c = await alertsClient();
    const { error } = await c.from('price_alert_events').update({ dismissed: true })
        .eq('dismissed', false).lte('id', maxId);
    if (error) throw new Error(error.message);
    notifyPriceAlertsChanged();
    return true;
});

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

ipcMain.handle('fetch-japanese-sets', async (event, passcode) => {
    return await fetchJapaneseSets(passcode);
});

ipcMain.handle('add-card-to-db', (event, card) => {
  try {
    const id = String(card.id);
    const setCode = card.set_code || 'Unknown';
    const language = card.language || 'DE';
    const rarity = card.rarity || 'Unknown';
    const printing = { id, set_code: setCode, language, rarity };
    // Copies to create: explicit groups from the staging chip, else quantity × defaults.
    const groups = (Array.isArray(card.copies) && card.copies.length) ? card.copies : [{ count: card.quantity || 1 }];

    const existing = db.prepare('SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?').get(id, setCode, language, rarity);
    let inserted = false;
    const copiesAdded = db.transaction(() => {
      if (existing) {
        db.prepare('UPDATE cards SET price = @price, deleted = 0 WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity')
          .run({ price: card.price || 0, id, set_code: setCode, language, rarity });
      } else {
        const imageUrl = card.card_images && card.card_images.length > 0 ? card.card_images[0].image_url : (card.image_url || '');
        let level = card.level;
        if (card.type && card.type.includes('Link') && card.linkval !== undefined) level = card.linkval;
        db.prepare(`INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language)
          VALUES (@id, @name, @type, @desc, @image_url, @atk, @def, @level, @race, @attribute, 0, @rarity, @set_code, @price, @language)`).run({
          id, name: card.name, type: card.type, desc: card.desc, image_url: imageUrl,
          atk: valOrNull(card.atk), def: valOrNull(card.def), level: valOrNull(level),
          race: card.race || null, attribute: card.attribute || null,
          rarity, set_code: setCode, price: card.price || 0, language
        });
        inserted = true;
      }
      let n = 0;
      for (const g of groups) n += copies.addCopies(db, printing, { edition: g.edition, condition: g.condition, count: g.count || 1 }).length;
      return n;
    })();
    return inserted ? { success: true, inserted: true, copiesAdded } : { success: true, updated: true, copiesAdded };
  } catch (error) {
    console.error('DB Insert Error:', error);
    return { success: false, error: error.message };
  }
});

// Der deutsche Kartenname steht NICHT in der Sammlung (cards.name ist englisch), sondern im
// Offline-Katalog. Wir haengen ihn beim Lesen an, statt ihn zu spiegeln: keine Spalte, kein Nachtrag,
// keine Sync-Last -- und er ist immer so aktuell wie der Katalog. Damit findet die Suche in der
// Sammlung auch "Ueberfallritter" (Nutzer 19.09.2026).
function withGermanNames(rows) {
    const cards = readCatalogCards(userDataPath);
    if (!cards) return rows;
    for (const r of rows) {
        const de = cards.get(String(r.id))?.name_de;
        if (de && de !== r.name) r.name_de = de;
    }
    return rows;
}

ipcMain.handle('get-collection', () => {
    const def = copies.defaults(db);
    return withGermanNames(db.prepare(collectionSql()).all({ def_condition: def.condition, def_edition: def.edition }));
});
ipcMain.handle('get-defaults', () => copies.defaults(db));
ipcMain.handle('list-copies', (event, printing) => {
    try { return copies.listCopies(db, printing); }
    catch (e) { console.error('[list-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// Spec B1 Task 7, Fix-Durchlauf 1, Befund 2: EIN Kanal fuer alle lebenden Exemplare der Sammlung,
// statt dass der Renderer listCopies() je Printing einzeln aufruft.
ipcMain.handle('list-all-copies', () => {
    try { return copies.listAllCopies(db); }
    catch (e) { console.error('[list-all-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
ipcMain.handle('add-copy', (event, { edition, condition, count, ...printing }) => {
    try { return { success: true, copyIds: copies.addCopies(db, printing, { edition, condition, count }) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('remove-copy', (event, { edition, condition, count, ...printing }) => {
    try { return { success: true, removed: copies.removeCopies(db, printing, { edition, condition, count }) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('update-copy-group', (event, { from, to, ...printing }) => {
    try { return { success: true, changed: copies.updateCopyGroup(db, printing, from, to) }; }
    catch (e) { return { success: false, error: e.message }; }
});

// Unerwartete Fehler (z.B. ein rohes better-sqlite3-Fehlerobjekt) sollen den Nutzer nie mit
// englischem Text erreichen: copies.ValidationError traegt bereits eine deutsche, fuer den
// Nutzer gedachte Meldung und wird unveraendert durchgereicht; alles andere wird durch eine
// generische deutsche Meldung ersetzt, der Originaltext geht in die Konsole (sonst waere er beim
// Suchen verloren).
const CONTAINER_COPY_ERROR_MSG = 'Unerwarteter Datenbankfehler. Bitte versuchen Sie es erneut.';
function containerCopyErrorMessage(e, channel) {
    if (e instanceof copies.ValidationError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}

ipcMain.handle('list-containers', () => {
    try { return copies.listContainers(db); }
    catch (e) { console.error('[list-containers]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
ipcMain.handle('save-container', (event, c) => {
    try { return { success: true, container_id: copies.saveContainer(db, c) }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'save-container') }; }
});
ipcMain.handle('delete-container', (event, containerId) => {
    try { return { success: true, cleared: deleteContainer(db, containerId) }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'delete-container') }; }
});
ipcMain.handle('set-copy-location', (event, loc) => {
    try { copies.setCopyLocation(db, loc); return { success: true }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'set-copy-location') }; }
});
ipcMain.handle('set-copy-tags-note', (event, d) => {
    try { copies.setCopyTagsNote(db, d); return { success: true }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'set-copy-tags-note') }; }
});
ipcMain.handle('delete-copy', (event, d) => {
    try { copies.deleteCopy(db, d); return { success: true }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'delete-copy') }; }
});
ipcMain.handle('list-unsorted-copies', () => {
    try { return copies.listUnsortedCopies(db); }
    catch (e) { console.error('[list-unsorted-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
ipcMain.handle('list-tags', () => {
    try { return copies.listTags(db); }
    catch (e) { console.error('[list-tags]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});

ipcMain.handle('delete-card', (event, { id, set_code, language, rarity }) => {
    try {
        if (!id || !set_code) return { success: false, error: 'Missing id or set_code' };
        // Delete only the given rarity when specified; without it, remove every rarity of the code
        // (legacy callers). rarity is part of a printing's identity.
        if (rarity !== undefined && rarity !== null) {
            copies.softDeletePrinting(db, { id: String(id), set_code, language: language || 'DE', rarity });
        } else {
            const rows = db.prepare('SELECT rarity FROM cards WHERE id = ? AND set_code = ? AND language = ? AND deleted = 0').all(String(id), set_code, language || 'DE');
            for (const r of rows) copies.softDeletePrinting(db, { id: String(id), set_code, language: language || 'DE', rarity: r.rarity });
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-portfolio', () => {
    try {
        const unique = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE quantity > 0 AND deleted = 0').get().n || 0;
        // Spec G3 §6/§7.3: totalValue = Karten + Sealed (Start, Insights › Wert); die Unterzeile nur mit Sealed-Bestand.
        const t = portfolioTotals(db);
        return { totalValue: t.total, cardValue: t.cards, sealedValue: t.sealed, hasSealed: t.sealedCount > 0, totalCards: copyCount(db), uniqueCards: unique };
    } catch (e) { return { totalValue: 0, cardValue: 0, sealedValue: 0, hasSealed: false, totalCards: 0, uniqueCards: 0 }; }
});

// --- Spec G3: Sealed-Bestand (lokal in SQLite; der Sync schiebt in die Cloud) ---
const SEALED_NO_PRODUCTS = 'Produktliste nicht verfügbar — Cardmarket-Preise einmal aktualisieren.';
// Wie containerCopyErrorMessage: erwartete Fehler (SealedError) tragen schon eine deutsche Meldung.
function sealedErrorMessage(e, channel) {
    if (e instanceof sealed.SealedError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}
ipcMain.handle('sealed-list', () => {
    try { return sealed.listSealed(db); }
    catch (e) { console.error('[sealed-list]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// Spec G3 M1: die Tageshistorie (7T/30T-Aenderung, Sparkline, Insights-Chart) soll Sealed-Aenderungen
// nicht erst mit der naechsten Preisaenderung nachziehen. Nie fatal fuer den IPC-Aufruf.
function recordPortfolioValueSafe() {
    try { recordPortfolioValue(db); } catch (e) { console.error('[sealed] recordPortfolioValue:', e); }
}
// Name, Art und Startpreis kommen aus der lokalen Produktliste, nie vom Renderer.
ipcMain.handle('sealed-add', (event, { cm_product_id, quantity } = {}) => {
    try {
        const products = readSealedProducts(userDataPath);
        if (!products) return { success: false, error: SEALED_NO_PRODUCTS };
        const product = products.find((p) => p.cm_product_id === Number(cm_product_id));
        const result = { success: true, ...sealed.addSealed(db, product, quantity) };
        recordPortfolioValueSafe();
        return result;
    } catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-add') }; }
});
ipcMain.handle('sealed-set-quantity', (event, { sealed_id, quantity } = {}) => {
    try { sealed.setSealedQuantity(db, { sealed_id, quantity }); recordPortfolioValueSafe(); return { success: true }; }
    catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-set-quantity') }; }
});
ipcMain.handle('sealed-open', (event, sealedId) => {
    try {
        const result = { success: true, ...sealed.openSealed(db, sealedId) };
        recordPortfolioValueSafe();
        return result;
    } catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-open') }; }
});
ipcMain.handle('sealed-delete', (event, sealedId) => {
    try { sealed.deleteSealed(db, sealedId); recordPortfolioValueSafe(); return { success: true }; }
    catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-delete') }; }
});
ipcMain.handle('sealed-products-search', (event, query) => {
    const products = readSealedProducts(userDataPath);
    if (!products) return { available: false, results: [] };
    return { available: true, results: searchSealedProducts(products, query) };
});
// Fix M3 (final-review-report.md): der Dialog soll beim Oeffnen nur pruefen, ob die Produktliste da ist,
// ohne die ~17 MB dafuer zu parsen (nur fs.statSync, siehe sealed-products.cjs).
ipcMain.handle('sealed-products-available', () => sealedProductsAvailable(userDataPath));

// --- Deck Builder Handlers ---

// Decks live in Supabase (structure shared with the phone). Desktop `type`/`quantity` map to
// Supabase `section`/`count`; full card details still come from the local `cards` table.
ipcMain.handle('get-decks', async () => {
    const c = await dealsClient();
    const { data, error } = await c.from('decks').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
});

ipcMain.handle('create-deck', async (event, name) => {
    const c = await dealsClient();
    const { data, error } = await c.from('decks').insert({ name }).select('*').single();
    if (error) throw new Error(error.message);
    return data;
});

ipcMain.handle('delete-deck', async (event, id) => {
    const c = await dealsClient();
    const { error } = await c.from('decks').delete().eq('id', id);   // deck_cards cascade in the DB
    if (error) throw new Error(error.message);
    return { success: true };
});

// Spec E3 §6: die Regeln (role an Starter-Zeilen, Rueckfall ohne role, Notizen und Format nur bei Aenderung) wohnen
// in decks.cjs#saveDeck; hier nur Client und lokaler Namens-/Bild-Rueckfall.
ipcMain.handle('save-deck', async (event, { deckId, cards, notes, format }) => {
    const c = await dealsClient();
    const lookup = db.prepare('SELECT name, image_url FROM cards WHERE id = ? LIMIT 1');
    return saveDeck(c, { deckId, cards, notes, format }, (id) => lookup.get(id));
});

ipcMain.handle('get-deck-details', async (event, id) => {
    const c = await dealsClient();
    const { data, error } = await c.from('deck_cards').select('*').eq('deck_id', id).order('id', { ascending: true });
    if (error) throw new Error(error.message);
    const detail = db.prepare(
        'SELECT name, image_url, type AS card_type, desc, atk, def, level, race, attribute, price ' +
        'FROM cards WHERE id = ? AND deleted = 0 LIMIT 1'
    );
    // Spec E2 §6: "→ Deck" braucht den Kartentyp auch fuer nicht besessene Karten -- Rueckfall auf den Katalog
    // (Spec E3 §3: fuer Artwork-Passcodes ueber die Hauptkarte).
    const catalog = readCatalogCards(userDataPath);
    return (data || []).map(dc => {
        const d = detail.get(String(dc.card_id)) || {};
        const cat = (catalog && catalog.get(catalogMainId(userDataPath, dc.card_id))) || {};
        return {
            deck_id: dc.deck_id, card_id: dc.card_id, type: dc.section, quantity: dc.count,
            // Spec E3 §6: Starter-Stern; ohne Spalte role (SQL fehlt) undefined -> null.
            role: dc.role === 'starter' ? 'starter' : null,
            name: dc.name || d.name || null, image_url: dc.image_url || d.image_url || null,
            card_type: d.card_type || cat.type || null, desc: d.desc || null,
            atk: d.atk ?? null, def: d.def ?? null, level: d.level ?? null,
            race: d.race || null, attribute: d.attribute || null, price: d.price ?? null,
        };
    });
});

// Spec E2 §5: nur Datei waehlen und lesen -- geparst wird im Renderer mit dem gemeinsamen Parser (deckFormats.js).
ipcMain.handle('import-deck-ydk', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'YDK Deck', extensions: ['ydk'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return readYdkFile(result.filePaths[0]);
});

// Spec E2 §6: der Renderer baut den YDK-Text (deckFormats.js#buildYdk, mit Side-Deck); hier nur speichern.
ipcMain.handle('export-deck-ydk', async (event, { name, content }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Deck',
        defaultPath: `${name}.ydk`,
        filters: [{ name: 'YDK Deck', extensions: ['ydk'] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, String(content));
    return { success: true };
});

// --- Spec E1: Sammlungsabgleich & Deckbox ---
// Lebende Exemplare lebender Printings mit Standort und Preisfeldern, dazu die Behaelterliste (lokal, SQLite).
ipcMain.handle('list-deck-copies', () => {
    try { return { copies: copies.listDeckCopies(db), containers: copies.listContainers(db) }; }
    catch (e) { console.error('[list-deck-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// Alle Deckkarten aller Decks in einer Abfrage (Deck-Liste mit Zahlen, "in Deck X").
ipcMain.handle('get-all-deck-cards', async () => {
    const c = await dealsClient();
    const { data, error } = await c.from('deck_cards').select('deck_id, card_id, name, count, section').order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
});
// Deckbox zuordnen; die Unique-Verletzung kommt als deutsche Meldung zurueck, nichts wird geaendert.
ipcMain.handle('set-deck-container', async (event, { deckId, containerId } = {}) => {
    const c = await dealsClient();
    return setDeckContainer(c, { deckId, containerId });
});
// Katalogpreise (cm_price) aus der zuletzt gebauten Katalogdatei; ohne Datei available = false.
ipcMain.handle('get-catalog-prices', () => catalogPrices(userDataPath));
// Fehlende auf die Wunschliste: Eintrag fuer Eintrag, die Cloud-Suche hoechstens einmal am Ende.
ipcMain.handle('deck-missing-to-wishlist', async (event, items) => {
    const c = await dealsClient();
    return addMissingToWishlist(c, items, triggerCloudScrape);
});
// Box befuellen: Exemplar fuer Exemplar in die Deckbox, Fehlschlaege je Zeile.
ipcMain.handle('move-copies-to-container', (event, { copyIds, containerId } = {}) => {
    try {
        const results = moveCopiesToContainer(db, { copyIds, containerId }, (e) => containerCopyErrorMessage(e, 'move-copies-to-container'));
        return { success: true, results };
    } catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'move-copies-to-container') }; }
});

// --- Spec E2: Import & Export ---
// Katalog-Index fuer die Namensaufloesung im Renderer: mit ids nur diese Passcodes, ohne ids alle Karten kompakt.
ipcMain.handle('get-catalog-cards', (event, ids) => catalogCards(userDataPath, Array.isArray(ids) ? ids : undefined));
// Neues Deck mit Notizen und allen Karten; scheitern die Karten, wird das leere Deck wieder geloescht.
ipcMain.handle('create-imported-deck', async (event, input) => {
    const c = await dealsClient();
    const catalog = readCatalogCards(userDataPath);
    // Spec E3 §3: Artwork-Passcodes bekommen das Bild der Hauptkarte; die Deckkarte behaelt den Artwork-Passcode.
    const imageOf = (id) => { const cat = catalog && catalog.get(catalogMainId(userDataPath, id)); return cat ? cat.image : null; };
    return createImportedDeck(c, input, imageOf);
});

// --- Spec E3: Legalitaet & Simulation ---
// Name, Typ und Banlist aller Katalogkarten, Artwork-Zuordnung und Baudatum; ohne (E3-)Katalog available = false.
ipcMain.handle('get-catalog-legality', () => catalogLegality(userDataPath));

// --- Spec F1: Export & eigenes Format ---
// Regeln in carddex-format/-resolve/-import.cjs, export-formats.cjs und collection-export.cjs; hier nur Dialoge und Dateien.
const importSessions = createImportSessions();
// Katalogkarte ueber die Artwork-Zuordnung (Name, Typ, Bild der Hauptkarte); ohne Datei null ("Offline-Katalog fehlt").
function importCatalog() {
    const cards = readCatalogCards(userDataPath);
    return cards ? { card: (p) => cards.get(catalogMainId(userDataPath, p)) || null } : null;
}
ipcMain.handle('import-open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Card-Dex-CSV importieren', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    let text;
    try { text = fs.readFileSync(result.filePaths[0], 'utf8'); }
    catch (e) { console.error('[import-open]', e); return { error: 'Datei nicht lesbar' }; }
    try { return importOpen(db, importSessions, { fileName: path.basename(result.filePaths[0]), text }, importCatalog()); }
    catch (e) { console.error('[import-open]', e); return { error: CONTAINER_COPY_ERROR_MSG }; }
});
ipcMain.handle('import-resolve', (event, input) => {
    try { return importResolve(db, importSessions, input, importCatalog()); }
    catch (e) { console.error('[import-resolve]', e); return { error: CONTAINER_COPY_ERROR_MSG }; }
});
// Busy-Schutz am Anfang von importRun: die Vorschau-Sitzung wird verbraucht, ein zweiter Klick findet keine mehr.
ipcMain.handle('import-run', (event, input) => {
    try {
        return importRun(db, importSessions, input, {
            catalog: importCatalog(), logDir: path.join(userDataPath, 'imports'), now: new Date(),
            onChanged: () => {
                recordPortfolioValueSafe();
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-changed');
            },
        });
    } catch (e) { console.error('[import-run]', e); return { success: false, error: `Import fehlgeschlagen: ${CONTAINER_COPY_ERROR_MSG}` }; }
});
// Wunschliste nur fuer die Wantslist (Cloud); englische Namen aus dem Katalog.
async function exportWishlist(format) {
    if (format !== 'wantslist') return undefined;
    const c = await dealsClient();
    const { data, error } = await c.from('wishlist').select('card_id, name');
    if (error) throw new Error(error.message);
    return data || [];
}
async function exportBuild({ format, scope } = {}) {
    const catalog = importCatalog();
    // I1 -- nameEn je Build mit einer Map (Passcode -> Name) memoisieren: sortGroups ruft nameEn einmal je Gruppe auf,
    // ohne die Map wuerde jeder Aufruf trotzdem den Katalog samt fs.statSync erneut nachschlagen.
    const nameEnCache = new Map();
    const nameEn = (p) => {
        if (nameEnCache.has(p)) return nameEnCache.get(p);
        const c = catalog && catalog.card(p);
        const name = (c && c.name_en) || null;
        nameEnCache.set(p, name);
        return name;
    };
    const wishlist = await exportWishlist(format);
    return buildExport(db, { format, scope }, { nameEn, wishlist, now: new Date() });
}
// I1 -- baut nicht mehr den ganzen Inhalt fuer die Zaehlung, nur die Anzahl (exportCount in collection-export.cjs).
ipcMain.handle('export-count', async (event, input) => {
    try {
        const { format, scope } = input || {};
        const wishlist = await exportWishlist(format);
        return { count: exportCount(db, { format, scope }, { wishlist }) };
    } catch (e) { return { count: 0, error: e.message }; }
});
ipcMain.handle('export-run', async (event, input) => {
    let built;
    try { built = await exportBuild(input); }
    catch (e) { return { success: false, error: `Export fehlgeschlagen: ${e.message}` }; }
    if (built.count === 0) return { success: false, error: 'Nichts zu exportieren' };
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exportieren', defaultPath: built.defaultName,
        filters: [{ name: built.ext === 'csv' ? 'CSV' : 'Text', extensions: [built.ext] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try { fs.writeFileSync(result.filePath, built.content, 'utf8'); }
    catch (e) { return { success: false, error: `Export fehlgeschlagen: ${e.message}` }; }
    return { success: true, text: exportResultText(built) };
});

// --- Spec H1: Duplikate & Verkaufsliste ---
// Regeln in copies.cjs (setForSale, listSaleCopies, Minus-Regel) und src/utils/duplicates.js; hier nur die Kanaele.
// Exemplare fuer Duplikate/Verkaufsliste mit Haupt-Passcode ueber die Artwork-Zuordnung (ohne Katalog der gespeicherte).
ipcMain.handle('list-sale-copies', () => {
    try { return copies.listSaleCopies(db, (id) => catalogMainId(userDataPath, id)); }
    catch (e) { console.error('[list-sale-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// { copyIds: string[], value: boolean } -> { success, changed }; idempotent, setzt updated_at nur bei Aenderung.
ipcMain.handle('set-for-sale', (event, d) => {
    try { return { success: true, changed: copies.setForSale(db, d || {}) }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'set-for-sale') }; }
});

// --- Spec H2: Verkaufs-Historie ---
// Regeln in sales.cjs/sales-math.cjs; hier nur die Kanaele. Erwartete Fehler (SaleError) tragen eine deutsche Meldung.
function saleErrorMessage(e, channel) {
    if (e instanceof sales.SaleError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}
const saleWrite = (channel, fn) => (event, d) => {
    try { return { success: true, ...fn(d) }; }
    catch (e) { return { success: false, error: saleErrorMessage(e, channel) }; }
};
const saleRead = (channel, fn) => (event, d) => {
    try { return fn(d); }
    catch (e) { throw new Error(saleErrorMessage(e, channel)); }
};
ipcMain.handle('sale-channels', saleRead('sale-channels', () => sales.listChannels(db)));
ipcMain.handle('sale-channel-save', saleWrite('sale-channel-save', (d) => ({ channel_id: sales.saveChannel(db, d || {}) })));
ipcMain.handle('sale-channel-hide', saleWrite('sale-channel-hide', (id) => { sales.hideChannel(db, id); return {}; }));
ipcMain.handle('sale-preview', saleRead('sale-preview', (ids) => sales.previewSale(db, ids)));
ipcMain.handle('sale-book', saleWrite('sale-book', (d) => {
    // Spec H3a §7: dieselbe Buchung, dazu Erinnerung/Teilverkauf aus dem Aufraeumen in derselben Transaktion.
    const r = sales.bookSaleDetailed(db, d || {});
    kickEbay(); // Spec H3b1: Aufräumen kann eBay-Angebote verkleinern/beenden
    return { sale_id: r.saleId, reminders: r.reminders, askAdjust: r.askAdjust, listingSkipped: r.listingSkipped };
}));
ipcMain.handle('sale-update', saleWrite('sale-update', (d) => { sales.updateSale(db, d || {}); return {}; }));
ipcMain.handle('sale-cancel', saleWrite('sale-cancel', (id) => { sales.cancelSale(db, id); return {}; }));
ipcMain.handle('sales-overview', saleRead('sales-overview', (d) => sales.salesOverview(db, d || {})));
ipcMain.handle('sale-detail', saleRead('sale-detail', (id) => sales.saleDetail(db, id)));
ipcMain.handle('card-sales', saleRead('card-sales', (id) => sales.cardSales(db, id)));

// --- Spec H3a: Angebote (halbautomatisch) ---
// Regeln in listings.cjs/listing-text.cjs; hier nur die Kanaele. Erwartete Fehler (ListingError) tragen eine deutsche Meldung.
// Anzeigename/englischer Name aus dem Offline-Katalog ueber die Artwork-Zuordnung (Befund 1); ohne Katalog null.
function listingNames(id) {
    const cards = readCatalogCards(userDataPath);
    const c = cards && cards.get(catalogMainId(userDataPath, id));
    return c ? { de: c.name_de || null, en: c.name_en || null } : null;
}
function listingErrorMessage(e, channel) {
    if (e instanceof listings.ListingError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}
const listingWrite = (channel, fn) => (event, d) => {
    try { const r = { success: true, ...fn(d) }; kickEbay(); return r; }
    catch (e) { return { success: false, error: listingErrorMessage(e, channel) }; }
};
const listingRead = (channel, fn) => (event, d) => {
    try { return fn(d); }
    catch (e) { throw new Error(listingErrorMessage(e, channel)); }
};
ipcMain.handle('listing-preview', listingRead('listing-preview', (ids) => listings.previewListing(db, ids, listingNames)));
ipcMain.handle('listing-create', listingWrite('listing-create', (d) => ({ listing_ids: listings.createListings(db, d || {}, listingNames) })));
ipcMain.handle('listing-update', listingWrite('listing-update', (d) => listings.updateListing(db, d || {})));
ipcMain.handle('listing-remove-items', listingWrite('listing-remove-items', (d) => listings.removeListingItems(db, d?.listing_id, d?.copyIds)));
ipcMain.handle('listing-end', listingWrite('listing-end', (id) => { listings.endListing(db, id); return {}; }));
ipcMain.handle('listing-relist', listingRead('listing-relist', (id) => listings.relistPrefill(db, id)));
ipcMain.handle('listings-overview', listingRead('listings-overview', (d) => listings.listingsOverview(db, d || {})));
ipcMain.handle('listing-detail', listingRead('listing-detail', (d) => listings.listingDetail(db, d?.listing_id, d || {})));
ipcMain.handle('listing-offers', listingRead('listing-offers', () => listings.listingOffers(db)));
// Spec §5.5/§6: nur http(s) an den Browser (Abweichung 8) -- open-external prueft nichts.
ipcMain.handle('listing-open-url', async (event, url) => {
    const u = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(u)) return { success: false, error: 'Ungültiger Link.' };
    try { await shell.openExternal(u); return { success: true }; }
    catch (e) { console.error('[listing-open-url]', e); return { success: false, error: 'Link konnte nicht geöffnet werden.' }; }
});
// Spec §5.6: Katalogbilder nach Bilder\Yu-Gi-Oh Angebote\<Titel>\, danach den Ordner im Explorer oeffnen.
ipcMain.handle('listing-save-images', async (event, d) => {
    try {
        const r = await saveListingImages({ baseDir: app.getPath('pictures'), title: d?.title, urls: d?.urls }, {
            fetch: (u) => fetch(u, { signal: AbortSignal.timeout(15000) }),
            mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
            writeFile: (file, buf) => fs.writeFileSync(file, buf),
        });
        const openError = await shell.openPath(r.folder); // '' bei Erfolg
        if (openError) console.error('[listing-save-images] Ordner:', openError);
        return { success: true, ...r };
    } catch (e) {
        console.error('[listing-save-images]', e);
        return { success: false, error: 'Bilder konnten nicht gespeichert werden.' };
    }
});

// --- Spec H3b1: eBay (Verbinden, Einstellen, eigene Fotos) ---
// Alles eBay-Wissen liegt in den Edge Functions; hier nur Aufrufe, der Nur-Lese-Stand (sync.cjs) und Fotos (listing-photos.cjs).
const EBAY_AUTH_ACTIONS = ['start', 'check', 'select', 'create_location', 'set_environment', 'disconnect'];
const EBAY_OFFLINE = 'Cloud nicht verbunden — Supabase-Login in den Einstellungen prüfen.';
function ebayStatusCached() {
    try { return JSON.parse(getSetting('ebay_status_cache') || 'null'); } catch { return null; }
}
// Funktion aufrufen: erwartete Fehler kommen als { ok: false, error } mit Status 200, 401 als FunctionsHttpError.
async function invokeEbay(name, body) {
    const c = sync && await sync.ensureClient();
    if (!c) return { ok: false, error: EBAY_OFFLINE };
    const { data, error } = await c.functions.invoke(name, { body });
    if (!error) return data && typeof data === 'object' ? data : { ok: false, error: 'Unerwartete Antwort der eBay-Funktion.' };
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* Text behalten */ }
    return { ok: false, error: msg };
}
// Spec §5.4 (Abweichung 9): nach Angebots-/Foto-Änderungen anstoßen -- entprellt, nur wenn verbunden; erst schieben,
// dann ebay-sync, dann den neuen eBay-Stand ziehen. Fehler nur ins Protokoll (der Zeitplan holt es nach).
let ebayKickTimer = null;
function kickEbay() {
    if (!sync || !ebayStatusCached()?.connected) return;
    clearTimeout(ebayKickTimer);
    ebayKickTimer = setTimeout(async () => {
        try {
            // Fixrunde 1 §3: syncNow() meldet jetzt Push-Fehler/Zeitueberschreitung statt sie zu verschlucken --
            // dann NICHT anstossen (die naechste Kick/Zeitplan-Runde holt es nach), nur ins Protokoll.
            const s1 = await sync.syncNow();
            if (!s1.ok) { console.error('[ebay-kick]', s1.error); return; }
            const r = await invokeEbay('ebay-sync', {});
            if (r?.ok === false) console.error('[ebay-kick]', r.error);
            await sync.syncNow();
        } catch (e) { console.error('[ebay-kick]', e.message); }
    }, 1500);
}
ipcMain.handle('ebay-status', () => ({ status: ebayStatusCached() }));
ipcMain.handle('ebay-listings', () => Object.fromEntries(db.prepare('SELECT * FROM ebay_listings').all().map((r) => [r.listing_id, r])));
ipcMain.handle('ebay-auth', async (event, d) => {
    const action = d?.action;
    if (!EBAY_AUTH_ACTIONS.includes(action)) return { ok: false, error: 'Unbekannte Aktion.' };
    try {
        const r = await invokeEbay('ebay-auth', { ...d, action });
        if (action === 'start') {
            if (!r?.ok) return r;
            // Nur eine https-Adresse an den Browser (Global Constraints: Links nur http(s), hier strenger https).
            if (!/^https:\/\//i.test(String(r.url || ''))) return { ok: false, error: 'Ungültige Adresse von eBay.' };
            await shell.openExternal(r.url);
            return { ok: true };
        }
        if (r?.ok && sync) await sync.syncNow(); // ebay_status frisch ziehen -> Einstellungen zeigen den neuen Stand
        return r;
    } catch (e) { console.error('[ebay-auth]', action, e.message); return { ok: false, error: 'eBay-Aufruf fehlgeschlagen.' }; }
});
ipcMain.handle('ebay-sync-now', async (event, d) => {
    try {
        // Fixrunde 1 §3: schlaegt der Push (oder das Zeitlimit) fehl, wird ebay-sync NICHT angestossen --
        // sonst liefe die Cloud-Funktion auf einem Stand, den der PC noch nicht geschoben hat.
        if (sync) {
            const s1 = await sync.syncNow();
            if (!s1.ok) return s1;
        }
        const r = await invokeEbay('ebay-sync', d?.retry ? { retry: String(d.retry) } : {});
        if (sync) await sync.syncNow();
        return r;
    } catch (e) { console.error('[ebay-sync-now]', e.message); return { ok: false, error: 'eBay-Abgleich fehlgeschlagen.' }; }
});
// Spec §6: Fotos verkleinern mit nativeImage (Hauptprozess), hochladen in den Speicher der angemeldeten Sitzung.
function photoDeps(c) {
    return {
        fileSize: (f) => fs.statSync(f).size,
        readFile: (f) => fs.readFileSync(f),
        decode: (buf) => {
            let img = nativeImage.createFromBuffer(buf);
            if (img.isEmpty()) return null;
            let { width, height } = img.getSize();
            // Fixrunde 1 §1: nativeImage verwirft das EXIF-Orientation-Tag; ohne Korrektur landen Hochformat-
            // Handyfotos seitlich auf eBay. jpegOrientation liest das Tag noch aus dem rohen Dateipuffer (nur
            // JPEG hat es -- bei PNG/ohne EXIF liefert es 1 und die Bitmap bleibt unangetastet).
            const orientation = photos.jpegOrientation(buf);
            if (orientation !== 1) {
                const oriented = photos.orientBitmap(img.toBitmap(), width, height, orientation);
                img = nativeImage.createFromBitmap(oriented.data, { width: oriented.width, height: oriented.height });
                width = oriented.width; height = oriented.height;
            }
            return { width, height, resize: (s) => { const r = img.resize({ ...s, quality: 'best' }); return { toJPEG: (q) => r.toJPEG(q) }; } };
        },
        upload: async (p, buf) => {
            const { error } = await c.storage.from('listing-photos').upload(p, buf, { contentType: 'image/jpeg', upsert: false });
            if (error) throw new photos.PhotoError(`Hochladen fehlgeschlagen: ${error.message}`);
        },
        uuid: () => require('crypto').randomUUID(),
    };
}
ipcMain.handle('listing-photos', (event, listingId) => {
    try { return photos.listPhotos(db, listingId, getSetting('supabase_url')); }
    catch (e) { console.error('[listing-photos]', e); throw new Error('Fotos konnten nicht geladen werden.'); }
});
ipcMain.handle('listing-photo-add', async (event, listingId) => {
    const c = sync && await sync.ensureClient();
    if (!c) return { success: false, added: 0, error: 'Fotos brauchen die Cloud – Supabase-Login in den Einstellungen prüfen.' };
    const pick = await dialog.showOpenDialog(mainWindow, { title: 'Fotos wählen', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png'] }] });
    if (pick.canceled || pick.filePaths.length === 0) return { success: true, added: 0 };
    let added = 0;
    for (const f of pick.filePaths) {
        try { await photos.addPhoto(db, { listingId, filePath: f }, photoDeps(c)); added++; }
        catch (e) {
            if (added > 0) kickEbay();
            if (!(e instanceof photos.PhotoError)) console.error('[listing-photo-add]', e);
            return { success: false, added, error: e instanceof photos.PhotoError ? e.message : 'Foto konnte nicht hinzugefügt werden.' };
        }
    }
    kickEbay();
    return { success: true, added };
});
const photoWrite = (channel, fn) => (event, d) => {
    try { fn(d); kickEbay(); return { success: true }; }
    catch (e) {
        if (e instanceof photos.PhotoError) return { success: false, error: e.message };
        console.error(`[${channel}]`, e);
        return { success: false, error: 'Speichern fehlgeschlagen.' };
    }
};
ipcMain.handle('listing-photo-delete', photoWrite('listing-photo-delete', (id) => photos.deletePhoto(db, id)));
ipcMain.handle('listing-photo-reorder', photoWrite('listing-photo-reorder', (d) => photos.reorderPhotos(db, d?.listing_id, d?.photoIds)));

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

// Spec G1 §4.3: Gewinner/Verlierer ueber 7 oder 30 Tage (Regel in movers.cjs).
ipcMain.handle('get-movers', (event, { days } = {}) => {
    try {
        const n = Number(days) === 30 ? 30 : 7;
        const today = new Date().toISOString().slice(0, 10);
        const cards = db.prepare('SELECT id, set_code, language, rarity, name, image_url, price, price_locked FROM cards WHERE deleted = 0').all();
        return computeMovers({ cards, copies: copies.listAllCopies(db), references: referenceRows(db, addDays(today, -n)), today, days: n, top: 10 });
    } catch (e) { console.error('[get-movers]', e); throw new Error('Bewegungen konnten nicht geladen werden.'); }
});

ipcMain.handle('get-card-history', (event, printing) => {
    try { return cardHistory(db, printing || {}); }
    catch (e) { console.error('[get-card-history]', e); throw new Error('Verlauf nicht verfügbar.'); }
});

ipcMain.handle('cleanup-database', async () => {
    db.exec('VACUUM');
    return { success: true };
});

ipcMain.handle('search-online', async (event, query) => {
    try {
        const q = String(query).trim();
        const fetchCards = async (url) => {
            const r = await fetch(url);
            if (!r.ok) return []; // YGOPRODeck antwortet mit HTTP 400 {"error":...}, wenn nichts passt
            const j = await r.json();
            return j.data || [];
        };
        // Bei einer Namenssuche kommt der Offline-Katalog als dritte Quelle dazu (deutsche Namen, die
        // YGOPRODecks fname-Suche auslaesst); bei einem Passcode braucht es ihn nicht.
        const catalogIds = /^\d+$/.test(q) ? [] : catalogSearchNames(userDataPath, q);
        return await onlineSearch(fetchCards, q, catalogIds);
    } catch (e) { return []; }
});

ipcMain.handle('update-card-meta', (event, data) => {
    // Expects { id, set_code, quantity, ... }
    // This is a generic update.
    try {
        const { id, set_code, quantity, language, rarity } = data;
        if (!id || !set_code) return { success: false };

        // Target the specific printing (incl. rarity) when the caller provides it, so editing the
        // quantity of one rarity doesn't touch the other rarities of the same set code.
        if (quantity !== undefined) {
            const printing = { id: String(id), set_code, language: language || 'DE', rarity: rarity || 'Unknown' };
            const current = copies.listCopies(db, printing).length;
            const target = Math.max(0, Number(quantity) || 0);
            if (target > current) copies.addCopies(db, printing, { count: target - current });
            else if (target < current) copies.removeCopies(db, printing, { count: current - target });
        }
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-card-price', (event, { id, set_code, language, rarity, price }) => {
  try {
    if (!id || !set_code) return { success: false, error: 'Missing id or set_code' };
    db.prepare("UPDATE cards SET price = ?, price_locked = 2 WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
      .run(Number(price) || 0, String(id), set_code, language || 'DE', rarity || 'Unknown');
    recordPrice(db, { id, set_code, language, rarity }, Number(price) || 0, 'manual');
    recordPortfolioValue(db);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

let cmAbort = false;
let cmRunning = false; // guards against manual + background scrape opening two windows at once
let cmWin = null;      // the in-flight scrape window, revealed only when the user opts to solve a challenge
ipcMain.handle('abort-cardmarket-scrape', () => { cmAbort = true; return { success: true }; });
// Reveal the hidden scrape window so the user can solve a Cloudflare challenge (user-triggered only).
ipcMain.handle('reveal-cm-window', () => {
  try { if (cmWin && !cmWin.isDestroyed()) { cmWin.show(); cmWin.focus(); } } catch (e) {}
  return { success: true };
});
ipcMain.handle('scrape-cardmarket-prices', async (event, { minRank } = {}) => {
  if (cmRunning) return { updated: 0, noMatch: 0, errors: 0, noMatchList: [], busy: true };
  cmAbort = false; cmRunning = true;
  const send = (p) => { try { event.sender.send('update-progress', p); } catch (e) {} };
  try {
    const onChallenge = (win) => { cmWin = win; try { event.sender.send('cm-challenge'); } catch (e) {} };
    const res = await runCardmarketScrape(db, {
      minRank: Number(minRank) || 1,
      force: true, // a manual click means "re-fetch now" — ignore the 7-day freshness window
      onProgress: (p) => send({ current: p.current, total: p.total }),
      shouldAbort: () => cmAbort,
      onChallenge,
    });
    // Spec G4 §4: 1st-Ed-Durchgang nach dem Basis-Durchgang, im selben cmRunning-Schutz, ohne Grenze.
    // Eigener try/catch: ein Ausfall hier laesst das Basis-Ergebnis unberuehrt.
    let firstEd = { candidates: 0, updated: 0, noOffers: 0, skipped: 0, errors: 0 };
    if (!cmAbort) {
      try {
        firstEd = await runFirstEdPass(db, {
          minRank: Number(minRank) || 1,
          force: true,
          onProgress: (p) => send({ current: p.current, total: p.total }),
          shouldAbort: () => cmAbort,
          onChallenge,
        });
      } catch (e) { console.error('[cardmarket] 1st-Ed-Durchgang:', e); }
    }
    if ((res && res.updated > 0) || firstEd.updated > 0) recordPortfolioValue(db);
    send({ current: 1, total: 1 }); // clears the bar
    return { ...res, firstEd };
  } finally { cmRunning = false; cmWin = null; }
});

// Background Cardmarket poller: every 10 min, trickle-scrape a few of the stalest qualifying cards
// (rarity >= cm_auto_min_rank, priced > 7 days ago), so per-rarity prices refresh on their own.
// Only the desktop can scrape (real browser + residential IP); the fresh prices then sync to Supabase.
// Spec G4: danach bis zu 2 Printings mit 1st-Ed-Exemplaren (Aufschlagsfaktor, runFirstEdPass).
function startCardmarketPoller() {
  if (cmPollInterval) clearInterval(cmPollInterval);
  cmPollInterval = setInterval(async () => {
    if (!mainWindow || cmRunning) return;
    if (getSetting('cm_auto_enabled') !== 'true') return;
    cmAbort = false; cmRunning = true;
    try {
      const minRank = Number(getSetting('cm_auto_min_rank')) || 5;
      const res = await runCardmarketScrape(db, {
        minRank,
        maxCards: 4,      // small polite batch per tick
        headless: true,   // never surface a window; skip challenged cards silently, retry next tick
        shouldAbort: () => cmAbort,
      });
      // Spec G4 §4: danach hoechstens 2 Kandidaten der Ersten Auflage; eigener try/catch.
      let firstEdUpdated = 0;
      if (!cmAbort) {
        try {
          const fe = await runFirstEdPass(db, { minRank, maxCards: 2, headless: true, shouldAbort: () => cmAbort });
          firstEdUpdated = fe.updated;
        } catch (e) { console.error('Cardmarket 1st-Ed poller error:', e); }
      }
      if (res.updated > 0 || firstEdUpdated > 0) {
        recordPortfolioValue(db);
        if (mainWindow) {
          const stats = { totalValue: portfolioTotals(db).total };
          mainWindow.webContents.send('price-update', { updates: [], totalValue: stats.totalValue || 0 });
        }
      }
    } catch (e) { console.error('Cardmarket poller error:', e); }
    finally { cmRunning = false; }
  }, 10 * 60 * 1000);
}

// Daily Cardmarket bulk refresh (no scraping): 30 s after start if the last run is older than 24 h,
// re-checked hourly so "daily" survives the app not being open at a fixed time. A failed download
// leaves cm_bulk_last_run untouched, so the next hourly tick simply retries.
function bulkDue() {
  const last = getSetting('cm_bulk_last_run');
  return !last || (Date.now() - new Date(last).getTime()) > 24 * 60 * 60 * 1000;
}
function notifyBulk(res) {
  if (res && (res.priced > 0 || res.sealedPriced > 0)) {
    recordPortfolioValue(db);
    if (mainWindow) {
      const stats = { totalValue: portfolioTotals(db).total };
      mainWindow.webContents.send('price-update', { updates: [], totalValue: stats.totalValue || 0 });
      // Spec G3: Schritt C hat Sealed-Preise geaendert -- Sealed-Liste, Start und Insights › Wert laden neu.
      if (res.sealedPriced > 0) mainWindow.webContents.send('sealed-changed');
    }
  }
}
function startCardmarketBulkScheduler() {
  const tick = async () => {
    if (!mainWindow || cmRunning || !bulkDue()) return;
    cmRunning = true;
    try { notifyBulk(await runBulkRefresh(db, { userDataPath })); }
    catch (e) { console.error('Cardmarket bulk error:', e); }
    finally { cmRunning = false; }
  };
  setTimeout(tick, 30 * 1000);
  if (cmBulkInterval) clearInterval(cmBulkInterval);
  cmBulkInterval = setInterval(tick, 60 * 60 * 1000);
}

ipcMain.handle('cardmarket-bulk-refresh', async () => {
  if (cmRunning) return { busy: true };
  cmRunning = true;
  try { const res = await runBulkRefresh(db, { userDataPath, force: true }); notifyBulk(res); return res; }
  catch (e) { console.error('Cardmarket bulk error:', e); return { error: 'internal', message: String(e && e.message || e) }; }
  finally { cmRunning = false; }
});
ipcMain.handle('cardmarket-bulk-status', () => {
  try { return getBulkStatus(db); } catch (e) { return { lastRun: null, resolvedCount: 0, unresolvedCount: 0 }; }
});

// Wöchentlicher Offline-Katalog-Bau (Spec D1): 45 s nach Start, wenn seit dem letzten Lauf mehr
// als 7 Tage vergangen sind, danach stündlich neu geprüft — überlebt so auch, wenn die App nicht
// durchgehend läuft. Spiegelt startCardmarketBulkScheduler()/bulkDue() oben.
const CATALOG_RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000;
function catalogDue() {
  const last = getSetting('catalog_last_run');
  const dueForBuild = !last || (Date.now() - new Date(last).getTime()) > 7 * 24 * 60 * 60 * 1000;
  if (!dueForBuild) return false;
  // Back off after a failed attempt (no client, upload/auth error, ...) so a broken upload doesn't
  // repeat the full build every hourly tick — retry at most every 6h until an attempt succeeds.
  const lastAttempt = getSetting('catalog_last_attempt');
  if (lastAttempt && (Date.now() - new Date(lastAttempt).getTime()) < CATALOG_RETRY_BACKOFF_MS) return false;
  return true;
}
function startCatalogScheduler() {
  const tick = async () => {
    if (catalogRunning || !sync || !catalogDue()) return;
    catalogRunning = true;
    try {
      const res = await runCatalogBuild(db, { ensureClient: sync.ensureClient, userDataPath });
      if (res && res.error) console.error('[catalog-builder] scheduled build failed:', res.error, res.message);
    } catch (e) { console.error('Catalog build error:', e); }
    finally { catalogRunning = false; }
  };
  setTimeout(tick, 45 * 1000);
  if (catalogInterval) clearInterval(catalogInterval);
  catalogInterval = setInterval(tick, 60 * 60 * 1000);
}

ipcMain.handle('catalog-build-now', async () => {
  if (catalogRunning) return { busy: true };
  catalogRunning = true;
  try {
    const ensureClient = sync ? sync.ensureClient : async () => null;
    return await runCatalogBuild(db, { ensureClient, force: true, userDataPath });
  } catch (e) { console.error('Catalog build error:', e); return { error: 'internal', message: String(e && e.message || e) }; }
  finally { catalogRunning = false; }
});
ipcMain.handle('catalog-status', () => {
  try { return getCatalogStatus(db); } catch (e) { return { lastRun: null, version: 0, bytes: 0 }; }
});
ipcMain.handle('model-upload', async (event, { kind, filePath } = {}) => {
  try {
    // Kind zuerst prüfen (Review Fix 4): sonst wählt der Nutzer eine Datei aus, bevor er erfährt,
    // dass die mitgeschickte Art fehlt oder falsch geschrieben ist.
    if (!ALLOWED_MODEL_KINDS.includes(kind)) {
      return { error: 'invalid-kind', message: `Unbekannte Modellart: ${kind}`, detail: null };
    }
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Modelldatei auswählen',
        properties: ['openFile'],
        filters: [{ name: 'Modelldateien', extensions: ['onnx', 'bin'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      filePath = result.filePaths[0];
    }
    const ensureClient = sync ? sync.ensureClient : async () => null;
    return await uploadModel(db, { ensureClient, kind, filePath });
  } catch (e) { console.error('Model upload error:', e); return { error: 'internal', message: String(e && e.message || e) }; }
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
            const cards = db.prepare('SELECT id, set_code, language, rarity, price FROM cards WHERE deleted = 0 AND (price_locked IS NULL OR price_locked = 0) ORDER BY last_updated ASC LIMIT 50').all();
            if (cards.length === 0) return;

            const uniqueIds = [...new Set(cards.map(c => c.id))].join(',');
            // We use standard fetch here, no cache, because we want FRESH prices
            const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${uniqueIds}`);
            if (!response.ok) return;
            const data = await response.json();
            if (!data.data) return;

            const apiCards = data.data;
            let updates = [];

            // Get price source
            let priceSource = 'cardmarket';
            try {
                const row = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get();
                if (row) priceSource = row.value;
            } catch(e) {}
            const sourceMap = { 'cardmarket': 'cardmarket_price', 'tcgplayer': 'tcgplayer_price', 'ebay': 'ebay_price', 'amazon': 'amazon_price' };
            const apiField = sourceMap[priceSource] || 'cardmarket_price';

            const updateStmt = db.prepare('UPDATE cards SET price = @price, last_updated = CURRENT_TIMESTAMP WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity');

            db.transaction(() => {
                cards.forEach(localCard => {
                    const apiData = apiCards.find(api => String(api.id) === String(localCard.id));
                    if (!apiData) return;

                    let newPrice = 0;
                    let foundSetPrice = false;
                    if (localCard.set_code && localCard.set_code !== 'Unknown' && apiData.card_sets) {
                        // Prefer the exact (set_code + rarity) price so different rarities of the
                        // same code are priced correctly; fall back to any entry for that set_code.
                        const matchedSet = apiData.card_sets.find(s => s.set_code === localCard.set_code && s.set_rarity === localCard.rarity)
                            || apiData.card_sets.find(s => s.set_code === localCard.set_code);
                        if (matchedSet && matchedSet.set_price && parseFloat(matchedSet.set_price) > 0) {
                            newPrice = parseFloat(matchedSet.set_price);
                            foundSetPrice = true;
                        }
                    }
                    if (!foundSetPrice && apiData.card_prices && apiData.card_prices.length > 0) {
                        newPrice = parseFloat(apiData.card_prices[0][apiField]) || 0;
                    }

                    if (Math.abs(newPrice - (localCard.price || 0)) > 0.01) {
                        updateStmt.run({ price: newPrice, id: localCard.id, set_code: localCard.set_code, language: localCard.language, rarity: localCard.rarity });
                        recordPrice(db, localCard, newPrice, 'ygoprodeck');
                        updates.push({ id: localCard.id, newPrice });
                    } else {
                        // Still update timestamp
                        db.prepare('UPDATE cards SET last_updated = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?').run(localCard.id, localCard.set_code, localCard.language, localCard.rarity);
                    }
                });
            })();

            if (updates.length > 0) {
                recordPortfolioValue(db);
                mainWindow.webContents.send('price-update', { updates, totalValue: portfolioTotals(db).total });
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
        const unknowns = db.prepare("SELECT id, quantity, language, rarity FROM cards WHERE set_code = 'Unknown' AND deleted = 0").all();
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

                        const target = { id: unknown.id, set_code: newSetCode, language: 'DE', rarity: newRarity };
                        db.prepare(`INSERT OR IGNORE INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language, deleted)
  SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, 0, ?, ?, ?, 'DE', 0
  FROM cards WHERE id = ? AND set_code = 'Unknown'`).run(newRarity, newSetCode, newPrice, unknown.id);
                        db.prepare("UPDATE cards SET deleted = 0, price = ? WHERE id = ? AND set_code = ? AND language = 'DE' AND rarity = ?").run(newPrice, unknown.id, newSetCode, newRarity);
                        copies.moveCopies(db, { id: unknown.id, set_code: 'Unknown', language: unknown.language || 'DE', rarity: unknown.rarity || 'Unknown' }, target);
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
        const unknowns = db.prepare("SELECT id, quantity, language, rarity FROM cards WHERE set_code = 'Unknown' AND deleted = 0").all();
        let mergedCount = 0;
        db.transaction(() => {
            unknowns.forEach(u => {
                const specific = db.prepare("SELECT id, set_code, rarity, language FROM cards WHERE id = ? AND set_code != 'Unknown' AND deleted = 0 ORDER BY quantity DESC LIMIT 1").get(u.id);
                if (specific) {
                    copies.moveCopies(db, { id: u.id, set_code: 'Unknown', language: u.language || 'DE', rarity: u.rarity || 'Unknown' }, specific);
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
        const rows = db.prepare('SELECT id, set_code, language, rarity FROM cards').all();
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
            WHERE id=@id AND set_code=@set_code AND language=@language AND (price_locked IS NULL OR price_locked = 0)`);

        let updatedCount = 0;
        db.transaction(() => {
            rows.forEach(row => {
                const apiData = apiMap.get(String(row.id));
                if (!apiData) return;
                const d = detailsFromApi(apiData);
                const price = priceForCard(apiData, row.set_code, apiField);
                const before = db.prepare('SELECT price FROM cards WHERE id=? AND set_code=? AND language=? AND rarity=?').get(String(row.id), row.set_code, row.language, row.rarity);
                const info = updateStmt.run({ ...d, price, id: String(row.id), set_code: row.set_code, language: row.language });
                if (info.changes > 0 && before && Math.abs((before.price || 0) - price) > 0.01) recordPrice(db, row, price, 'ygoprodeck');
                updatedCount++;
            });
        })();

        try {
            recordPortfolioValue(db);
            if (mainWindow) mainWindow.webContents.send('price-update', { updates: [], totalValue: portfolioTotals(db).total });
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

// Wishlist (Supabase cloud — shared with the phone). Desktop `price` <-> Supabase `max_price`.
ipcMain.handle('get-wishlist', async () => {
    const c = await dealsClient();
    const { data, error } = await c.from('wishlist').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(w => ({ ...w, price: w.max_price }));   // keep the renderer's `price` field
});
ipcMain.handle('add-to-wishlist', async (event, card) => {
    const c = await dealsClient();
    const { data: existing } = await c.from('wishlist').select('id').eq('card_id', String(card.id)).limit(1);
    if (existing && existing.length) return { success: false };
    const maxPrice = card.price != null ? Number(card.price) : null;
    const { error } = await c.from('wishlist').insert({
        card_id: String(card.id), name: card.name, image_url: card.image_url, max_price: maxPrice,
    });
    if (error) throw new Error(error.message);
    // Like the phone: a wishlist card also spawns a deal watch so it's hunted across marketplaces.
    if (maxPrice != null && card.name) {
        try {
            await c.from('deal_watches').insert({ query: String(card.name), max_price: maxPrice });
            triggerCloudScrape(c);
        } catch (e) {}
    }
    return { success: true };
});
ipcMain.handle('remove-from-wishlist', async (event, id) => {
    const c = await dealsClient();
    const { error } = await c.from('wishlist').delete().eq('id', id);
    if (error) throw new Error(error.message);
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
    const cards = parseImportCsv(content);
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
        const allCards = db.prepare("SELECT id, set_code, rarity, language, quantity FROM cards WHERE deleted = 0").all();
        let changedCount = 0;
        const total = allCards.length;
        if (event.sender) event.sender.send('update-progress', { current: 0, total });

        let priceSource = 'cardmarket';
        try { const r = db.prepare("SELECT value FROM settings WHERE key = 'price_source'").get(); if(r) priceSource=r.value; } catch(e){}
        const apiField = (priceSource==='tcgplayer')?'tcgplayer_price':'cardmarket_price';

        for (let i = 0; i < total; i++) {
             const card = allCards[i];
             if (event.sender && i % 10 === 0) event.sender.send('update-progress', { current: i + 1, total });

             const current = db.prepare("SELECT quantity FROM cards WHERE id = ? AND set_code = ? AND rarity = ? AND language = ? AND deleted = 0").get(card.id, card.set_code, card.rarity, card.language);
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

                        const target = { id: card.id, set_code: newSetCode, language: card.language, rarity: newRarity };
                        db.prepare(`INSERT OR IGNORE INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language, deleted)
  SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, 0, ?, ?, ?, language, 0
  FROM cards WHERE id = ? AND set_code = ? AND rarity = ? AND language = ?`).run(newRarity, newSetCode, newPrice, card.id, card.set_code, card.rarity, card.language);
                        db.prepare("UPDATE cards SET deleted = 0 WHERE id = ? AND set_code = ? AND rarity = ? AND language = ?").run(card.id, newSetCode, newRarity, card.language);
                        copies.moveCopies(db, card, target);
                        changedCount++;
                    }
                }
             } catch (err) { console.error(err); }
        }
        if (event.sender) event.sender.send('update-progress', { current: total, total });
        return { success: true, count: changedCount };
    } catch (e) { return { success: false, error: e.message }; }
});
