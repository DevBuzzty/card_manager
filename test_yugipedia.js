const https = require('https');

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function getYugipediaData(passcode) {
    console.log(`Fetching ${passcode}...`);

    // 1. Resolve Passcode to Page Title
    // Yugipedia Semantic Search or simple query?
    // Using cargoquery is robust but 'action=query&titles=...' works if we know name.
    // We don't know name from passcode reliably (unless we use YGOPRODeck name).
    // Let's assume we use the Name from YGOPRODeck as the search key,
    // OR we use the redirect trick: https://yugipedia.com/wiki/89631139 -> Redirects to "Blue-Eyes White Dragon"

    // Let's try searching by ID using action=query&prop=info
    // Actually, Yugipedia creates redirect pages for Passcodes!
    // e.g. https://yugipedia.com/api.php?action=query&titles=89631139&redirects&format=json

    const redirectUrl = `https://yugipedia.com/api.php?action=query&titles=${passcode}&redirects&format=json`;
    const redirectData = await fetchJson(redirectUrl);

    let title = null;
    const pages = redirectData.query.pages;
    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') {
        console.log("Passcode page not found on Yugipedia.");
        return null;
    }
    title = pages[pageId].title;
    console.log(`Resolved Title: ${title}`);

    // 2. Fetch Wikitext
    const parseUrl = `https://yugipedia.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
    const parseData = await fetchJson(parseUrl);

    if (!parseData.parse || !parseData.parse.wikitext) {
        console.log("No wikitext found.");
        return null;
    }

    const wikitext = parseData.parse.wikitext['*'];

    // 3. Parse German Sets
    // Look for | de_sets = ...
    // Format: Code; Name; Rarity
    // Ends at next |

    const deSetsMatch = wikitext.match(/\|\s*de_sets\s*=\s*([\s\S]*?)\n\s*\|/);
    if (!deSetsMatch) {
        console.log("No German sets found in wikitext.");
        return [];
    }

    const rawSets = deSetsMatch[1];
    const sets = [];

    // Split by newlines
    const lines = rawSets.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Split by semicolon
        // Example: SDK-G001; Starter Deck: Kaiba; Ultra Rare
        // Example: SBCB-SP087; Speed Duel: Battle City Box; Common, Secret Rare
        const parts = trimmed.split(';');
        if (parts.length >= 3) {
            const setCode = parts[0].trim();
            const setName = parts[1].trim();
            const rarities = parts[2].trim().split(',').map(r => r.trim());

            // Generate an entry for each rarity
            for (const rarity of rarities) {
                sets.push({
                    set_code: setCode,
                    set_name: setName,
                    set_rarity: rarity,
                    // No price data here, use fallback later
                });
            }
        }
    }

    return sets;
}

// Test with Blue-Eyes (89631139)
getYugipediaData('89631139').then(sets => {
    console.log("German Sets Found:", sets);
}).catch(console.error);
