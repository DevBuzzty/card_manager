const https = require('https');
const { getDb } = require('./database.cjs');

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

// ---- German / Japanese set-code lookup -------------------------------------------------------
// We want the COMPLETE set of real printings for a card, so we UNION several real sources rather
// than stopping at the first hit (we never GUESS codes — the region infix varies DE/G):
//   1. Fandom wiki  ({lang}_sets block)  — usually most current on brand-new sets
//   2. Yugipedia    ({lang}_sets block)  — extra printings the other wiki lacks
//   3. Konami official DB                — authoritative; catches niche printings (e.g. Speed
//                                          Duel "SGX3-DEA10") that the community wikis miss
// English printings + prices still come from YGOPRODeck (fetchCardData).

const KONAMI_BASE = 'https://www.db.yugioh-card.com/yugiohdb/card_search.action';
const KONAMI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// Konami prints rarity as a short abbreviation; map the common ones to the wikis' full spelling
// so identical printings from the two source kinds de-duplicate cleanly.
const KONAMI_RARITY = {
    N: 'Common', C: 'Common', R: 'Rare', SR: 'Super Rare', UR: 'Ultra Rare',
    UtR: 'Ultimate Rare', ScR: 'Secret Rare', HR: 'Holographic Rare', GR: 'Ghost Rare',
    PScR: 'Prismatic Secret Rare', CR: "Collector's Rare", QCSR: 'Quarter Century Secret Rare',
    '20thSR': '20th Secret Rare',
};

// Raw-text HTTP with the SQLite cache (Konami returns HTML, not JSON, so cachedFetch can't parse it).
function fetchText(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': KONAMI_UA, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchText(res.headers.location).then(resolve);
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', () => resolve(null));
    });
}

async function cachedFetchText(url, cacheKeyPrefix, ttlHours) {
    const db = getDb();
    const cacheKey = `${cacheKeyPrefix}:${url}`;
    const cached = db.prepare("SELECT data, timestamp FROM api_cache WHERE key = ?").get(cacheKey);
    if (cached) {
        const age = (new Date() - new Date(cached.timestamp + "Z")) / (1000 * 60 * 60);
        if (age < ttlHours) return cached.data;
    }
    const data = await fetchText(url);
    if (data) {
        db.prepare("INSERT OR REPLACE INTO api_cache (key, data, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)")
          .run(cacheKey, data);
    }
    return data;
}

// Parse a wiki page's `{lang}_sets` block into [{set_code, set_rarity}]. Two interchangeable
// formats appear inside these blocks:
//   A) "SET-CODE; Set Name; Rarity[,Rarity]"          (semicolon lines)
//   B) "{{Card table set|SET-CODE|Set Name|Rarity}}"  (pipe template)
async function parseWikiSets(apiBase, title, lang, cachePrefix) {
    const parseUrl = `${apiBase}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
    const parseData = await cachedFetch(parseUrl, cachePrefix, 24);
    if (!parseData || !parseData.parse || !parseData.parse.wikitext) return [];

    const wikitext = parseData.parse.wikitext['*'];
    const blockMatch = wikitext.match(new RegExp(`\\|\\s*${lang}_sets\\s*=\\s*([\\s\\S]*?)\\n\\s*(?:\\||\\}\\})`));
    if (!blockMatch) return [];

    const sets = [];
    for (const rawLine of blockMatch[1].split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;

        let setCode, rarityField;
        const tmpl = line.match(/\{\{\s*Card table set\s*\|([^}]*)\}\}/i);
        if (tmpl) {
            const a = tmpl[1].split('|').map(s => s.trim());
            setCode = a[0];
            rarityField = a[2] || 'Common';
        } else {
            const parts = line.split(';');
            if (parts.length < 3) continue;
            setCode = parts[0].trim();
            rarityField = parts[2].trim();
        }
        if (!setCode) continue;
        for (const rarity of rarityField.split(',').map(r => r.trim())) {
            if (rarity) sets.push({ set_code: setCode, set_rarity: rarity });
        }
    }
    return sets;
}

// Konami official DB: find the card's global `cid` by English name, then read the printing list
// for a locale ('de'|'ja'|'en'). Each printing row has a card number + a rarity abbreviation.
// A name search can return several cards (e.g. "Mirage Dragon" matches 3). Return ALL candidate
// cids; the caller picks the one whose printings actually match this card.
async function konamiCids(englishName) {
    if (!englishName) return [];
    const url = `${KONAMI_BASE}?ope=1&sess=1&rp=20&mode=&sort=1&keyword=${encodeURIComponent(englishName)}&stype=1&request_locale=en`;
    const html = await cachedFetchText(url, 'konami_search', 168);
    if (!html) return [];
    const seen = new Set();
    const ids = [];
    const re = /cid=(\d+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
    }
    return ids.slice(0, 8); // bound the number of detail fetches
}

async function fetchKonamiSets(cid, locale) {
    if (!cid) return [];
    const url = `${KONAMI_BASE}?ope=2&cid=${cid}&request_locale=${locale}`;
    const html = await cachedFetchText(url, 'konami_detail', 168);
    if (!html) return [];
    const sets = [];
    for (const row of html.split(/class="t_row/)) {
        const codeM = row.match(/class="card_number">\s*([^<]+?)\s*</);
        if (!codeM) continue;
        const code = codeM[1].trim();
        if (!code) continue;
        const rarM = row.match(/class="lr_icon[^"]*">\s*<p>\s*([^<]*?)\s*<\/p>/);
        const abbr = rarM ? rarM[1].trim() : '';
        sets.push({ set_code: code, set_rarity: KONAMI_RARITY[abbr] || abbr || 'Common' });
    }
    return sets;
}

// A set code belongs to German if its region infix is DE (incl. Speed Duel DES/DEA) or the old
// German "G" (e.g. TP1-G015). Wikis sometimes drop a foreign code (DOOD-EN001) into a de_sets
// block by mistake, so we keep only genuinely-German codes when listing German printings.
function isGermanCode(code) {
    return /-DE/i.test(code) || /-G\d/i.test(code);
}
// Japanese printings are JP-region codes or region-less OCG codes (B3-17, KA-39); anything with a
// foreign TCG region infix does not belong in the Japanese list.
function isForeignForJapanese(code) {
    return /-(EN|DE|FR|IT|PT|SP|KR|AE|EU)\d/i.test(code);
}

// Konami branch: resolve the search hits, then in PARALLEL read each candidate's EN printings and
// pick the one that overlaps YGOPRODeck's (validates the card + selects the right one of several).
async function fetchKonamiForCard(englishName, ygoprodeckCodes, konamiLocale) {
    const cids = await konamiCids(englishName);
    if (cids.length === 0) return [];
    const enLists = await Promise.all(
        cids.map(cid => fetchKonamiSets(cid, 'en').then(s => ({ cid, codes: s.map(x => x.set_code) })))
    );
    const match = enLists.find(e => e.codes.some(c => ygoprodeckCodes.includes(c)));
    if (!match) return [];
    return await fetchKonamiSets(match.cid, konamiLocale);
}

// Union of all sources for one language. wikiLang = 'de'|'jp', konamiLocale = 'de'|'ja'.
async function fetchSetsUnion(passcode, wikiLang, konamiLocale) {
    // English name = the wiki page title for both wikis, and the Konami search key.
    let englishName = null;
    let ygoprodeckCodes = [];
    try {
        const card = await fetchCardData(passcode);
        const c0 = card && card.data && card.data[0];
        englishName = c0 && c0.name;
        ygoprodeckCodes = ((c0 && c0.card_sets) || []).map(s => s.set_code);
    } catch (e) { /* ignore */ }

    // Run the three sources CONCURRENTLY (each is independent) so total latency ≈ the slowest one,
    // not the sum. The wiki-parse cache key is lang-independent (same page URL), so a later JP
    // lookup reuses the DE lookup's fetched wikitext instead of downloading it again.
    const [fandomSets, yugiSets, konamiSets] = await Promise.all([
        englishName
            ? parseWikiSets('https://yugioh.fandom.com/api.php', englishName, wikiLang, 'wiki_parse')
            : Promise.resolve([]),
        (async () => {
            // Yugipedia's own title via passcode redirect (handles alt spellings), else English name.
            const redirectData = await cachedFetch(
                `https://yugipedia.com/api.php?action=query&titles=${passcode}&redirects&format=json`,
                'yugipedia_redirect', 168);
            let yugiTitle = null;
            if (redirectData && redirectData.query && redirectData.query.pages) {
                const pages = redirectData.query.pages;
                const pageId = Object.keys(pages)[0];
                if (pageId !== '-1') yugiTitle = pages[pageId].title;
            }
            yugiTitle = yugiTitle || englishName;
            return yugiTitle ? parseWikiSets('https://yugipedia.com/api.php', yugiTitle, wikiLang, 'wiki_parse') : [];
        })(),
        (englishName && ygoprodeckCodes.length > 0)
            ? fetchKonamiForCard(englishName, ygoprodeckCodes, konamiLocale)
            : Promise.resolve([]),
    ]);

    const collected = [...fandomSets, ...yugiSets, ...konamiSets];

    // Keep only codes that really belong to the requested language (drops foreign codes a wiki
    // mislabelled into the block).
    const belongs = wikiLang === 'de' ? (c) => isGermanCode(c) : (c) => !isForeignForJapanese(c);

    const seen = new Set();
    const out = [];
    for (const s of collected) {
        if (!belongs(s.set_code)) continue;
        const key = `${s.set_code}|${s.set_rarity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

// German set codes (name kept for the existing IPC channel). JP counterpart below.
async function fetchYugipediaSets(passcode) {
    try { return await fetchSetsUnion(passcode, 'de', 'de'); }
    catch (e) { console.error("German set lookup error:", e); return []; }
}

async function fetchJapaneseSets(passcode) {
    try { return await fetchSetsUnion(passcode, 'jp', 'ja'); }
    catch (e) { console.error("Japanese set lookup error:", e); return []; }
}

async function fetchCardData(passcode) {
    // Cache YGOPRODeck responses for 24h
    return await cachedFetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${passcode}`, 'ygoprodeck', 24);
}

module.exports = { fetchJson, fetchYugipediaSets, fetchJapaneseSets, fetchCardData };
