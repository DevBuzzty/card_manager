const https = require('https');
const { getDb } = require('./database');

function fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            headers: {
                'User-Agent': 'YuGiOhCardManager/1.0 (test@example.com)',
                ...options.headers
            }
        };

        https.get(url, reqOptions, (res) => {
            let data = '';
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location, options).then(resolve).catch(reject);
            }
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (data.trim().startsWith('<')) { resolve(null); return; } // Handle HTML errors gracefully
                    resolve(JSON.parse(data));
                } catch (e) { resolve(null); }
            });
        }).on('error', (e) => resolve(null));
    });
}

// Cached Fetch Wrapper
async function cachedFetch(url, cacheKeyPrefix = 'api', ttlHours = 24) {
    const db = getDb();
    const cacheKey = `${cacheKeyPrefix}:${url}`;

    // Check Cache
    const cached = db.prepare("SELECT data, timestamp FROM api_cache WHERE key = ?").get(cacheKey);
    if (cached) {
        const age = (new Date() - new Date(cached.timestamp + "Z")) / (1000 * 60 * 60);
        if (age < ttlHours) {
            console.log(`Cache Hit for ${url}`);
            return JSON.parse(cached.data);
        }
    }

    // Fetch Fresh
    console.log(`Fetching Fresh: ${url}`);
    const data = await fetchJson(url);
    if (data) {
        db.prepare("INSERT OR REPLACE INTO api_cache (key, data, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)")
          .run(cacheKey, JSON.stringify(data));
    }
    return data;
}

async function fetchYugipediaSets(passcode) {
    try {
        // 1. Resolve Passcode -> Page Title
        // Cache this lookup for 7 days (titles rarely change)
        const redirectUrl = `https://yugipedia.com/api.php?action=query&titles=${passcode}&redirects&format=json`;
        const redirectData = await cachedFetch(redirectUrl, 'yugipedia_redirect', 168);

        if (!redirectData || !redirectData.query) return [];

        const pages = redirectData.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pageId === '-1') return [];

        const title = pages[pageId].title;

        // 2. Fetch Wikitext
        // Cache for 24 hours
        const parseUrl = `https://yugipedia.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
        const parseData = await cachedFetch(parseUrl, 'yugipedia_parse', 24);

        if (!parseData || !parseData.parse || !parseData.parse.wikitext) return [];

        const wikitext = parseData.parse.wikitext['*'];

        // 3. Parse German Sets
        const deSetsMatch = wikitext.match(/\|\s*de_sets\s*=\s*([\s\S]*?)\n\s*\|/);
        if (!deSetsMatch) return [];

        const rawSets = deSetsMatch[1];
        const sets = [];

        const lines = rawSets.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const parts = trimmed.split(';');
            if (parts.length >= 3) {
                const setCode = parts[0].trim();
                const rarities = parts[2].trim().split(',').map(r => r.trim());

                for (const rarity of rarities) {
                    sets.push({
                        set_code: setCode,
                        set_rarity: rarity
                    });
                }
            }
        }
        return sets;
    } catch (e) {
        console.error("Yugipedia Error:", e);
        return [];
    }
}

async function fetchCardData(passcode) {
    // Cache YGOPRODeck responses for 24h
    return await cachedFetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${passcode}`, 'ygoprodeck', 24);
}

module.exports = { fetchJson, fetchYugipediaSets, fetchCardData };
