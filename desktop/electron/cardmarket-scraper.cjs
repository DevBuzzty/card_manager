// desktop/electron/cardmarket-scraper.cjs
// Scrapes per-rarity Cardmarket EUR "Trend" prices for owned cards, via a hidden BrowserWindow
// (real Chromium on the user's residential IP). Sequential + polite; the user solves the rare
// Cloudflare/captcha challenge manually, then the run resumes.
const { BrowserWindow, session } = require('electron');
const { matchRow } = require('./cardmarket-parse.cjs');
const { fetchCardData } = require('./api-handler.cjs');

const BASE = 'https://www.cardmarket.com';
const DELAY_MIN_MS = 2000, DELAY_MAX_MS = 4000; // jittered polite delay per page
const FRESH_MS = 7 * 24 * 3600 * 1000; // skip printings priced < 7 days ago

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In-page DOM extraction. Cardmarket renders each printing as a row in the versions/offer table;
// this reads expansion name, rarity (from the rarity icon's title/aria-label), and the Trend price.
// NOTE: selectors are pinned against a live page during Step 3 and adjusted there.
const EXTRACT_JS = `(() => {
  const num = (t) => { const m = (t||'').replace(/\\./g,'').replace(',', '.').match(/[0-9]+(?:\\.[0-9]+)?/); return m ? parseFloat(m[0]) : null; };
  const rows = [];
  // Versions table rows (adjust selector against the real page in Step 3):
  document.querySelectorAll('.table-body > .row, table tbody tr').forEach(tr => {
    const exp = (tr.querySelector('[data-expansion], .expansion-name, a[href*="/Products/Singles/"]')?.textContent || '').trim();
    const rar = (tr.querySelector('[aria-label*="Rare"], [title*="Rare"], .icon[title]')?.getAttribute('title')
              || tr.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();
    const trendCell = Array.from(tr.querySelectorAll('td, .col')).map(c => c.textContent).join(' ');
    const trend = num(trendCell);
    if (exp || rar) rows.push({ expansion: exp, rarity: rar, trend });
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

// Navigate; if a Cloudflare/captcha challenge is up, surface the window and wait for the real page.
async function loadPage(win, url, onChallenge) {
  await win.loadURL(url);
  for (let i = 0; i < 60; i++) { // up to ~2 min for a human to solve
    const title = win.webContents.getTitle();
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => '');
    if (!looksLikeChallenge(html, title)) return true;
    if (i === 0) { win.show(); onChallenge && onChallenge(); }
    await sleep(2000);
  }
  return false; // still challenged after timeout
}

// Resolve a card's Cardmarket product/metacard URL via search (first Singles result).
async function resolveUrl(win, name, onChallenge) {
  const url = `${BASE}/en/YuGiOh/Products/Search?searchString=${encodeURIComponent(name)}`;
  if (!(await loadPage(win, url, onChallenge))) return null;
  const href = await win.webContents.executeJavaScript(
    `(document.querySelector('a[href*="/en/YuGiOh/Products/Singles/"]')||{}).href || null`
  ).catch(() => null);
  return href || null;
}

async function runCardmarketScrape(db, { onProgress, shouldAbort, onChallenge } = {}) {
  // Distinct owned cards (one page scrape covers all their printings).
  const cards = db.prepare(
    "SELECT DISTINCT id, name FROM cards WHERE deleted = 0 AND quantity > 0"
  ).all();
  const now = Date.now();
  let updated = 0, noMatch = 0, errors = 0;
  const win = await makeWindow();
  try {
    for (let i = 0; i < cards.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      onProgress && onProgress({ current: i + 1, total: cards.length, name: cards[i].name });
      const printings = db.prepare(
        "SELECT set_code, language, rarity, cm_updated_at FROM cards WHERE id = ? AND deleted = 0 AND quantity > 0"
      ).all(String(cards[i].id));
      // Skip if every printing was priced recently.
      const stale = printings.filter(p => !p.cm_updated_at || (now - new Date(p.cm_updated_at + 'Z').getTime()) > FRESH_MS);
      if (stale.length === 0) continue;
      try {
        const name = cards[i].name || (await fetchCardData(cards[i].id))?.data?.[0]?.name;
        if (!name) { noMatch++; continue; }
        const url = await resolveUrl(win, name, onChallenge);
        if (!url) { noMatch++; continue; }
        if (!(await loadPage(win, url, onChallenge))) { errors++; continue; }
        const rows = await win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []);
        for (const p of stale) {
          const setName = await setNameFor(cards[i].id, p.set_code);
          const hit = setName ? matchRow(rows, setName, p.rarity) : null;
          if (hit && hit.trend != null) {
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(hit.trend, url, String(cards[i].id), p.set_code, p.language, p.rarity);
            updated++;
          } else {
            db.prepare("UPDATE cards SET cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ? AND cm_url IS NULL")
              .run(String(cards[i].id), p.set_code, p.language, p.rarity); // mark attempted (no match)
            noMatch++;
          }
        }
      } catch (e) { errors++; }
      await sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
    }
  } finally { win.destroy(); }
  return { updated, noMatch, errors };
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
