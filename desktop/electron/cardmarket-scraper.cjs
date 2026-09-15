// desktop/electron/cardmarket-scraper.cjs
// Scrapes per-rarity Cardmarket EUR "Trend" prices for owned cards, via a hidden BrowserWindow
// (real Chromium on the user's residential IP). Sequential + polite; the user solves the rare
// Cloudflare/captcha challenge manually, then the run resumes.
const { BrowserWindow, session } = require('electron');
const { rarityRank, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor } = require('./cardmarket-parse.cjs');
const { idProductFromImageUrl } = require('./cardmarket-bulk-parse.cjs');
const { fetchCardData } = require('./api-handler.cjs');
const { recordPrice } = require('./price-history.cjs');

const BASE = 'https://www.cardmarket.com';
const DELAY_MIN_MS = 2000, DELAY_MAX_MS = 4000; // jittered polite delay per page
const FRESH_MS = 7 * 24 * 3600 * 1000; // skip printings priced < 7 days ago

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In-page DOM extraction — pinned against the real /Cards/{name}/Versions grid (2026-09-01).
// Each printing is a `.card-column` in `#ReprintSection` carrying the expansion name + symbol code,
// the rarity (inside the image alt parenthetical, e.g. "... (V.4 - Secret Rare)"), and the "Ab"
// (from) price. `trend` here holds that from-price (the user chose the pure-scrape from-price).
// Spec G4: href = Produkt-Link der Printing-Spalte (/Products/Singles/{Expansion}/{Karte}[-V{n}-{Rarity}]).
const EXTRACT_JS = `(() => {
  const num = (t) => { const m = (t||'').replace(/\\./g,'').replace(',', '.').match(/[0-9]+(?:\\.[0-9]+)?/); return m ? parseFloat(m[0]) : null; };
  const rows = [];
  document.querySelectorAll('#ReprintSection .card-column').forEach(col => {
    const link = col.querySelector('a[href*="/Products/Singles/"]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const exp = (col.querySelector('h3 .text-start')?.textContent || '').trim();
    const code = (col.querySelector('.expansion-symbol span')?.textContent || '').trim();
    const imgEl = col.querySelector('img');
    const alt = imgEl?.getAttribute('alt') || '';
    const srcset = imgEl ? (imgEl.getAttribute('srcset') || '').split(/[ ,]/)[0] : '';
    const imgSrc = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-echo') || srcset || '') : '';
    let rarity = '';
    const pm = alt.match(/\\(([^)]+)\\)\\s*$/);
    if (pm) { const parts = pm[1].split(' - '); rarity = parts[parts.length - 1].trim(); }
    let price = null;
    col.querySelectorAll('p').forEach(p => {
      if (/\\b(Ab|From)\\b/i.test(p.textContent)) { const b = p.querySelector('b'); price = num(b ? b.textContent : p.textContent); }
    });
    if (rarity || code) rows.push({ expansion: exp, code, rarity, trend: price, imgSrc, href });
  });
  return rows;
})()`;

// Spec G4 §4 — dt/dd-Paare des Infokastens einer Produktseite; die Auswertung (Label "From"/"Ab") macht
// der reine Parser parseFromPrice in cardmarket-parse.cjs.
const INFO_PAIRS_JS = `(() => {
  const out = [];
  document.querySelectorAll('.info-list-container dt').forEach(dt => {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') out.push({ label: (dt.textContent || '').trim(), value: (dd.textContent || '').trim() });
  });
  return out;
})()`;

function looksLikeChallenge(html, title) {
  const t = (title || '').toLowerCase(), h = (html || '').toLowerCase();
  return t.includes('just a moment') || t.includes('attention required')
      || h.includes('cf-challenge') || h.includes('challenge-platform') || h.includes('turnstile');
}

async function makeWindow() {
  const ses = session.fromPartition('persist:cardmarket'); // cookies survive between runs
  const win = new BrowserWindow({ show: false, skipTaskbar: true, width: 1200, height: 900, webPreferences: { session: ses, sandbox: true } });
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
    if (i === 0 && !headless) { onChallenge && onChallenge(win); } // notify; window is revealed only if the user opts in
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

async function runCardmarketScrape(db, { onProgress, shouldAbort, onChallenge, minRank = 1, maxCards = Infinity, headless = false, force = false } = {}) {
  // Distinct owned cards (one page scrape covers all their printings). Oldest-scraped first so the
  // background poller (which passes a small maxCards) works through the collection round-robin.
  const cards = db.prepare(
    "SELECT c.id, c.name FROM cards c WHERE c.deleted = 0 AND c.quantity > 0 AND c.cm_product_id IS NULL " +
    "AND COALESCE(c.price_locked, 0) != 2 GROUP BY c.id ORDER BY MIN(COALESCE(c.cm_updated_at, '1970-01-01')) ASC"
  ).all();
  const now = Date.now();
  let updated = 0, noMatch = 0, errors = 0, scraped = 0, idMissed = 0;
  const noMatchList = []; // card names/set codes that couldn't be matched -> user sets them manually
  const win = await makeWindow();
  try {
    for (let i = 0; i < cards.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      if (scraped >= maxCards) break; // background poller: stop after a small batch per tick
      onProgress && onProgress({ current: i + 1, total: cards.length, name: cards[i].name });
      const printings = db.prepare(
        "SELECT set_code, language, rarity, cm_updated_at, cm_product_id FROM cards WHERE id = ? AND deleted = 0 AND quantity > 0 AND cm_product_id IS NULL " +
        "AND COALESCE(price_locked, 0) != 2"
      ).all(String(cards[i].id));
      // Only printings at/above the chosen rarity threshold, and not priced recently. Cards with no
      // qualifying printing are skipped entirely (no page load, no delay) — this is what keeps a
      // large collection fast: e.g. "from Secret Rare up" never touches the cheap Commons.
      // Printings that already carry a cm_product_id are excluded above — the daily bulk refresh
      // (cardmarket-bulk.cjs) prices those from the price-guide file; scraping is only for the rest.
      const stale = printings.filter(p =>
        rarityRank(p.rarity) >= minRank
        && (force || !p.cm_updated_at || (now - new Date(p.cm_updated_at + 'Z').getTime()) > FRESH_MS));
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
          const hit = await selectVersionRow(rows, p, () => setNameFor(cards[i].id, p.set_code));
          if (hit && hit.trend != null) {
            const pid = idProductFromImageUrl(hit.imgSrc);
            if (!pid) { if (idMissed === 0) console.warn('[cardmarket] no idProduct in image URL:', hit.imgSrc); idMissed++; }
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_product_id = COALESCE(?, cm_product_id), cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(hit.trend, url, pid, String(cards[i].id), p.set_code, p.language, p.rarity);
            recordPrice(db, { id: cards[i].id, set_code: p.set_code, language: p.language, rarity: p.rarity }, hit.trend, 'cm_scrape');
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
  return { updated, noMatch, errors, noMatchList, idMissed };
}

// Spec G4 §4 — Kandidaten des 1st-Ed-Durchgangs: Printings mit mindestens einem lebenden Exemplar edition = 'first',
// Rarity ab minRank, nicht manuell gesperrt (price_locked 2), 1st-Ed-Stand aelter als 7 Tage (force ignoriert die Frist),
// unabhaengig von cm_product_id (Bulk-Printings zaehlen). Aeltester Stand zuerst.
function firstEdCandidates(db, { minRank = 1, force = false, nowMs = Date.now(), limit = Infinity } = {}) {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.set_code, c.language, c.rarity, c.cm_first_ed_updated_at
      FROM cards c
     WHERE c.deleted = 0 AND COALESCE(c.price_locked, 0) != 2
       AND EXISTS (SELECT 1 FROM card_copies cp
                    WHERE cp.card_id = c.id AND cp.set_code = c.set_code AND cp.language = c.language
                      AND cp.rarity = c.rarity AND cp.deleted = 0 AND cp.edition = 'first')
     ORDER BY COALESCE(c.cm_first_ed_updated_at, '1970-01-01') ASC, c.id, c.set_code, c.language, c.rarity`).all();
  return rows
    .filter(r => rarityRank(r.rarity) >= minRank
      && (force || !r.cm_first_ed_updated_at || (nowMs - new Date(r.cm_first_ed_updated_at + 'Z').getTime()) > FRESH_MS))
    .slice(0, limit);
}

// Spec G4 §4 — zweiter Durchgang: je Kandidat Versions-Seite (Zeile + Produkt-Link), Produktseite ohne Filter
// (fromAll) und mit ?isFirstEd=Y (fromFirst). Schreibt nur cm_first_ed_factor + cm_first_ed_updated_at;
// price_first_ed setzt der Trigger (copies-schema.cjs). Keine price_history-Zeile. Challenge, keine Zeile,
// kein Link oder fehlendes fromAll: nichts schreiben, der naechste Lauf versucht es wieder.
// `deps` ersetzt im Test Fenster, Netz und Pausen.
async function runFirstEdPass(db, { minRank = 1, force = false, maxCards = Infinity, headless = false, onChallenge, shouldAbort, onProgress, deps = {} } = {}) {
  const d = {
    makeWindow,
    loadPage,
    readRows: (win) => win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []),
    readInfoPairs: (win) => win.webContents.executeJavaScript(INFO_PAIRS_JS).catch(() => []),
    sleep: () => sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS)),
    setNameFor,
    cardName: async (c) => c.name || (await fetchCardData(c.id))?.data?.[0]?.name,
    ...deps,
  };
  const list = firstEdCandidates(db, { minRank, force, nowMs: Date.now(), limit: maxCards });
  const out = { candidates: list.length, updated: 0, noOffers: 0, skipped: 0, errors: 0 };
  if (list.length === 0) return out;
  const write = db.prepare('UPDATE cards SET cm_first_ed_factor = ?, cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?');
  const win = await d.makeWindow();
  try {
    for (let i = 0; i < list.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      const p = list[i];
      onProgress && onProgress({ current: i + 1, total: list.length, name: p.name });
      try {
        const name = await d.cardName(p);
        const versionsUrl = name ? resolveUrl(name) : null;
        if (!versionsUrl || !(await d.loadPage(win, versionsUrl, onChallenge, headless))) { out.skipped++; continue; }
        const hit = await selectVersionRow(await d.readRows(win), p, () => d.setNameFor(p.id, p.set_code));
        const product = hit ? productUrl(hit.href) : null;
        if (!product) { out.skipped++; continue; }
        await d.sleep();
        if (!(await d.loadPage(win, product, onChallenge, headless))) { out.skipped++; continue; }
        const fromAll = parseFromPrice(await d.readInfoPairs(win));
        if (!(fromAll > 0)) { out.skipped++; continue; }
        await d.sleep();
        if (!(await d.loadPage(win, firstEdUrl(product), onChallenge, headless))) { out.skipped++; continue; }
        const { write: ok, factor } = firstEdFactor(fromAll, parseFromPrice(await d.readInfoPairs(win)));
        if (!ok) { out.skipped++; continue; }
        write.run(factor, String(p.id), p.set_code, p.language, p.rarity);
        out.updated++;
        if (factor == null) out.noOffers++;
      } catch (e) {
        out.errors++;
      } finally {
        await d.sleep();
      }
    }
  } finally { win.destroy(); }
  return out;
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

module.exports = { runCardmarketScrape, runFirstEdPass, firstEdCandidates };
