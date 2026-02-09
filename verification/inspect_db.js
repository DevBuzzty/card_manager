const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Adjust path to where the app stores data in this environment
// Usually in the sandbox it's in the standard userData location or local
// For this script, we assume the default Electron userData path on Linux
const dbPath = path.join(os.homedir(), '.config', 'yugioh-card-manager', 'cards.db');

try {
    console.log(`Opening database at ${dbPath}...`);
    const db = new Database(dbPath);

    // Check for duplicates (same ID, different set_code including Unknown)
    const duplicates = db.prepare(`
        SELECT id, name, count(*) as variants, sum(quantity) as total_qty
        FROM cards
        GROUP BY id
        HAVING count(*) > 1
    `).all();

    console.log("--- DUPLICATE CHECK ---");
    if (duplicates.length === 0) {
        console.log("No ID duplicates found (Good).");
    } else {
        console.log(`Found ${duplicates.length} cards with multiple variants:`);
        duplicates.forEach(d => {
            console.log(`- ${d.name} (${d.id}): ${d.variants} variants, ${d.total_qty} total copies`);
            const variants = db.prepare('SELECT set_code, price, quantity FROM cards WHERE id = ?').all(d.id);
            console.log(variants);
        });
    }

    // Check for 'Unknown' sets with high value
    const unknowns = db.prepare(`
        SELECT name, set_code, price, quantity, (price * quantity) as total
        FROM cards
        WHERE set_code = 'Unknown' AND price > 10
        ORDER BY total DESC
    `).all();

    console.log("\n--- HIGH VALUE 'UNKNOWN' SETS ---");
    unknowns.forEach(u => {
        console.log(`- ${u.name}: $${u.price} x ${u.quantity} = $${u.total}`);
    });

    // Check Total Value
    const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards').get();
    console.log(`\nTOTAL PORTFOLIO VALUE: $${stats.totalValue}`);

} catch (e) {
    console.error("Error inspecting DB:", e);
    // If path failed, try local
    console.log("Trying local ./cards.db...");
    try {
        const db = new Database('./cards.db');
        const stats = db.prepare('SELECT SUM(price * quantity) as totalValue FROM cards').get();
        console.log(`TOTAL PORTFOLIO VALUE (Local): $${stats.totalValue}`);
    } catch(err) {
        console.log("Could not open local DB either.");
    }
}
