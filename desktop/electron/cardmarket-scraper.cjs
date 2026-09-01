// desktop/electron/cardmarket-scraper.cjs
// Scrapes per-rarity Cardmarket EUR "Trend" prices for owned cards, via a hidden BrowserWindow
// (real Chromium on the user's residential IP). Sequential + polite; the user solves the rare
// Cloudflare/captcha challenge manually, then the run resumes.
const { BrowserWindow, session } = require('electron');
const { matchRow, normName, rarityKey, rarityRank } = require('./cardmarket-parse.cjs');
const { fetchCardData } = require('./api-handler.cjs');

const BASE = 'https://www.cardmarket.com';
const DELAY_MIN_MS = 2000, DELAY_MAX_MS = 4000; // jittered polite delay per page
const FRESH_MS = 7 * 24 * 3600 * 1000; // skip printings priced < 7 days ago

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In-page DOM extraction — pinned against the real /Cards/{name}/Versions grid (2026-09-01).
// Each printing is a `.card-column` in `#ReprintSection` carrying the expansion name + symbol code,
// the rarity (inside the image alt parenthetical, e.g. "... (V.4 - Secret Rare)"), and the "Ab"
// (from) price. `trend` here holds that from-price (the user chose the pure-scrape from-price).
const EXTRACT_JS = `(() => {
  const num = (t) => { const m = (t||'').replace(/\\./g,'').replace(',', '.').match(/[0-9]+(?:\\.[0-9]+)?/); return m ? parseFloat(m[0]) : null; };
  const rows = [];
  document.querySelectorAll('#ReprintSection .card-column').forEach(col => {
    if (!col.querySelector('a[href*="/Products/Singles/"]')) return;
    const exp = (col.querySelector('h3 .text-start')?.textContent || '').trim();
    const code = (col.querySelector('.expansion-symbol span')?.textContent || '').trim();
    const alt = col.querySelector('img')?.getAttribute('alt') || '';
    let rarity = '';
    const pm = alt.match(/\\(([^)]+)\\)\\s*$/);
    if (pm) { const parts = pm[1].split(' - '); rarity = parts[parts.length - 1].trim(); }
    let price = null;
    col.querySelectorAll('p').forEach(p => {
      if (/\\b(Ab|From)\\b/i.test(p.textContent)) { const b = p.querySelector('b'); price = num(b ? b.textContent : p.textContent); }
    });
    if (rarity || code) rows.push({ expansion: exp, code, rarity, trend: price });
  });
  return rows;
})()`;

function looksLikeChallenge(html, title) {
  const t = (title || '').toLowerCase(), h = (html || '').toLowerCase();
  return t.includes('just a moment') || t.includes('attention required')
      || h.includes('cf-challenge') || h.includes('challenge-platform') || h.includes('turnstile');
}

async function makeWindow() {
  const ses = session.fromPartition('persist:cardmarket'); // cookies survive between runs
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session: ses, sandbox: true } });
  return win;
}

// Navigate; wait for the real page. On a Cloudflare/captcha challenge:
//  - interactive (manual run): surface the window and give a human up to ~2 min to solve;
//  - headless (background poller): stay invisible, wait ~10s for a non-interactive auto-clear,
//    then give up on this card silently and let a later tick / manual run refresh the session.
async function loadPage(win, url, onChallenge, headless = false) {
  await win.loadURL(url);
  const maxTries = headless ? 5 : 60; // ~10s silent vs ~2 min human-solvable
  for (let i = 0; i < maxTries; i++) {
    const title = win.webContents.getTitle();
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => '');
    if (!looksLikeChallenge(html, title)) return true;
    if (i === 0 && !headless) { win.show(); onChallenge && onChallenge(); }
    await sleep(2000);
  }
  return false; // still challenged after timeout (headless: skip quietly, retry next tick)
}

// Build the card's "all versions" page URL directly from its English name. The Cardmarket URL slug
// is the English name regardless of site locale: punctuation stripped, words joined with hyphens
// (e.g. "Ash Blossom & Joyous Spring" -> "Ash-Blossom-Joyous-Spring").
function resolveUrl(name) {
  const slug = String(name || '').trim()
    .replace(/[^\w\s-]/g, '')  // drop punctuation (apostrophes, colons, &, commas)
    .replace(/\s+/g, '-')      // spaces -> hyphens
    .replace(/-+/g, '-')       // collapse runs (archetype names "X - Y" would give "X---Y" -> "X-Y")
    .replace(/^-+|-+$/g, '');   // trim stray hyphens
  return slug ? `${BASE}/en/YuGiOh/Cards/${slug}/Versions` : null;
}

async function runCardmarketScrape(db, { onProgress, shouldAbort, onChallenge, minRank = 1, maxCards = Infinity, headless = false } = {}) {
  // Distinct owned cards (one page scrape covers all their printings). Oldest-scraped first so the
  // background poller (which passes a small maxCards) works through the collection round-robin.
  const cards = db.prepare(
    "SELECT c.id, c.name FROM cards c WHERE c.deleted = 0 AND c.quantity > 0 " +
    "GROUP BY c.id ORDER BY MIN(COALESCE(c.cm_updated_at, '1970-01-01')) ASC"
  ).all();
  const now = Date.now();
  let updated = 0, noMatch = 0, errors = 0, scraped = 0;
  const noMatchList = []; // card names/set codes that couldn't be matched -> user sets them manually
  const win = await makeWindow();
  try {
    for (let i = 0; i < cards.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      if (scraped >= maxCards) break; // background poller: stop after a small batch per tick
      onProgress && onProgress({ current: i + 1, total: cards.length, name: cards[i].name });
      const printings = db.prepare(
        "SELECT set_code, language, rarity, cm_updated_at FROM cards WHERE id = ? AND deleted = 0 AND quantity > 0"
      ).all(String(cards[i].id));
      // Only printings at/above the chosen rarity threshold, and not priced recently. Cards with no
      // qualifying printing are skipped entirely (no page load, no delay) — this is what keeps a
      // large collection fast: e.g. "from Secret Rare up" never touches the cheap Commons.
      const stale = printings.filter(p =>
        rarityRank(p.rarity) >= minRank
        && (!p.cm_updated_at || (now - new Date(p.cm_updated_at + 'Z').getTime()) > FRESH_MS));
      if (stale.length === 0) continue;
      try {
        const name = cards[i].name || (await fetchCardData(cards[i].id))?.data?.[0]?.name;
        if (!name) { noMatch++; continue; }
        const url = resolveUrl(name);
        if (!url) { noMatch++; continue; }
        if (!(await loadPage(win, url, onChallenge, headless))) { errors++; continue; }
        scraped++; // a page was actually loaded — counts toward the poller's per-tick budget
        const rows = await win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []);
        for (const p of stale) {
          // Match primarily by set-code prefix ↔ Cardmarket expansion symbol (e.g. "25LP-DE085" ->
          // "25LP") + rarity — far more reliable than the expansion name. Some expansions list the
          // same rarity twice (alt-art versions we can't tell apart from the set code); take the
          // cheapest of those. Fall back to fuzzy expansion-name matching when no code matches.
          const codePrefix = (p.set_code || '').split('-')[0];
          const wantRar = rarityKey(p.rarity), wantCode = normName(codePrefix);
          const codeRows = rows.filter(r => r.code && r.trend != null && normName(r.code) === wantCode);
          let hit = null;
          if (codeRows.length === 1) {
            hit = codeRows[0];               // one printing in that set -> unambiguous (Cardmarket omits the rarity label)
          } else if (codeRows.length > 1) {  // multiple in the set -> Cardmarket DOES label rarity; disambiguate, cheapest wins
            const rarHits = codeRows.filter(r => rarityKey(r.rarity) === wantRar);
            if (rarHits.length) hit = rarHits.reduce((a, b) => (b.trend < a.trend ? b : a));
          }
          if (!hit) {
            const setName = await setNameFor(cards[i].id, p.set_code);
            hit = setName ? matchRow(rows, setName, p.rarity) : null;
          }
          if (hit && hit.trend != null) {
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(hit.trend, url, String(cards[i].id), p.set_code, p.language, p.rarity);
            updated++;
          } else {
            db.prepare("UPDATE cards SET cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(String(cards[i].id), p.set_code, p.language, p.rarity); // mark attempted (no match)
            noMatch++;
            if (noMatchList.length < 100) noMatchList.push(`${cards[i].name} — ${p.set_code} (${p.rarity})`);
          }
        }
      } catch (e) { errors++; }
      await sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
    }
  } finally { win.destroy(); }
  return { updated, noMatch, errors, noMatchList };
}

// Set NAME for a (passcode, set_code) via YGOPRODeck card_sets (cached in api-handler).
async function setNameFor(id, setCode) {
  try {
    const card = await fetchCardData(id);
    const sets = card?.data?.[0]?.card_sets || [];
    const hit = sets.find(s => s.set_code === setCode);
    return hit ? hit.set_name : null;
  } catch { return null; }
}

module.exports = { runCardmarketScrape };
