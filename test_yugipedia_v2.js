const https = require('https');

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'YuGiOhCardManager/1.0 (test@example.com)'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            // Follow redirects if 3xx
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            }

            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    // Check if HTML
                    if (data.trim().startsWith('<')) {
                        console.error("Received HTML instead of JSON:", data.substring(0, 100));
                        reject(new Error("Received HTML"));
                        return;
                    }
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
    // Regex explanation:
    // \|\s*de_sets\s*= matches | de_sets =
    // ([\s\S]*?) matches everything lazy until...
    // \n\s*\| matches newline followed by | (start of next parameter)

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
                    set_price: "0" // Placeholder
                });
            }
        }
    }

    return sets;
}

// Test with Blue-Eyes (89631139)
getYugipediaData('89631139').then(sets => {
    console.log("German Sets Found:", JSON.stringify(sets, null, 2));
}).catch(console.error);
