const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Use the standard Electron path for Linux
const dbPath = path.join(os.homedir(), '.config', 'yugioh-card-manager', 'cards.db');

try {
    console.log(`Opening database at ${dbPath}...`);
    const db = new Database(dbPath);

    const history = db.prepare('SELECT * FROM portfolio_history ORDER BY timestamp DESC LIMIT 5').all();
    console.log("--- Portfolio History ---");
    console.log(history);

} catch (e) {
    console.error("Error:", e.message);
}
