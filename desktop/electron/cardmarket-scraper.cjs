// desktop/electron/cardmarket-scraper.cjs
// Scrapes per-rarity Cardmarket EUR "Trend" prices for owned cards, via a hidden BrowserWindow
// (real Chromium on the user's residential IP). Sequential + polite; the user solves the rare
// Cloudflare/captcha challenge manually, then the run resumes.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const { rarityRank, selectVersionRow, productUrl, CM_LANGUAGES, offersUrl, parseOffers, offersPageBroken, robustLow, robustFactor } = require('./cardmarket-parse.cjs');
const { idProductFromImageUrl } = require('./cardmarket-bulk-parse.cjs');
const { fetchCardData } = require('./api-handler.cjs');
const { recordPrice } = require('./price-history.cjs');
const { applyLangFactor } = require('./language-kr.cjs');

const BASE = 'https://www.cardmarket.com';
const DELAY_MIN_MS = 2000, DELAY_MAX_MS = 4000; // jittered polite delay per page
const FRESH_MS = 7 * 24 * 3600 * 1000; // skip printings priced < 7 days ago
const REST_MS = 3 * 24 * 3600 * 1000; // Ruhe je Druck nach gescheiterter Pruefung

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Hoeflicheres Tempo nach einer Cloudflare-Pruefung (21.09.2026). Am 19.09. verlangte ein Durchlauf
// per Knopf die Pruefung "alle 3-4 Karten" -- das Muster einer Ratenbremse, denn der Knopf laedt
// alle 2-4 s eine Seite. Nach jeder Pruefung verdoppelt sich die Pause bis hoechstens
// PAUSE_MAX_MS. Das ist schlicht LANGSAMER, keine Umgehung: geklickt wird die Pruefung weiterhin
// ausschliesslich vom Nutzer, und nichts an Kennung oder Verhalten des Browsers wird verstellt.
const PAUSE_MAX_MS = 16000;
function pauseNachPruefungen(pruefungen) {
  const faktor = Math.min(2 ** Math.max(0, pruefungen), PAUSE_MAX_MS / DELAY_MIN_MS);
  const lo = Math.min(DELAY_MIN_MS * faktor, PAUSE_MAX_MS);
  const hi = Math.min(DELAY_MAX_MS * faktor, PAUSE_MAX_MS);
  return { lo, hi };
}

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
    const srcset = imgEl ? (imgEl.getAttribute('srcset') || imgEl.getAttribute('data-srcset') || '').split(/[ ,]/)[0] : '';
    const real = (u) => u && !/transparent\.gif|^data:/i.test(u) ? u : '';
    const imgSrc = imgEl ? (real(imgEl.getAttribute('data-src')) || real(imgEl.getAttribute('data-echo')) || real(imgEl.getAttribute('data-original'))
      || real(srcset) || real(imgEl.getAttribute('src')) || '') : '';
    const imgAttrs = imgEl ? [...imgEl.attributes].map(a => a.name + '=' + String(a.value).slice(0, 160)).join(' | ') : '';
    let rarity = '';
    const pm = alt.match(/\\(([^)]+)\\)\\s*$/);
    if (pm) { const parts = pm[1].split(' - '); rarity = parts[parts.length - 1].trim(); }
    let price = null;
    col.querySelectorAll('p').forEach(p => {
      if (/\\b(Ab|From)\\b/i.test(p.textContent)) { const b = p.querySelector('b'); price = num(b ? b.textContent : p.textContent); }
    });
    if (rarity || code) rows.push({ expansion: exp, code, rarity, trend: price, imgSrc, imgAttrs, href, alt });
  });
  return rows;
})()`;

// Spec G4b §5: Angebotstabelle der Produktseite (gemessen 2026-10-05, siehe Ledger messung.md). Reine Extraktion
// ohne Logik: je Zeile Preis-Text, Zustand, Attribut-Labels (Sprache, Erste Auflage …). `found` sagt, ob der
// Behaelter der Angebotsliste im DOM steht (auch bei 0 Treffern), `empty` die Leer-Meldung .noResults — die
// Unterscheidung "leer" vs. "Markup geaendert" trifft offersPageBroken in cardmarket-parse.cjs.
// Die Auswertung macht der reine Parser parseOffers/robustLow in cardmarket-parse.cjs.
const OFFERS_JS = `(() => {
  const table = document.querySelector('.article-table, #table .table-body, #table');
  const rows = [];
  if (table) table.querySelectorAll('.article-row').forEach(r => {
    const priceEl = r.querySelector('.price-container .color-primary, .price-container span, .price-container');
    const condEl = r.querySelector('.article-condition .badge, .article-condition');
    const labels = [...r.querySelectorAll('.product-attributes [aria-label], .product-attributes [data-bs-original-title], .product-attributes [data-original-title], .product-attributes [title]')]
      .map(e => e.getAttribute('aria-label') || e.getAttribute('data-bs-original-title') || e.getAttribute('data-original-title') || e.getAttribute('title') || '')
      .filter(l => l && !l.includes('<'));
    rows.push({ priceText: (priceEl && priceEl.textContent || '').trim(), condition: (condEl && condEl.textContent || '').trim(), labels });
  });
  return { found: !!table, empty: !!document.querySelector('.noResults'), rows };
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

// Navigate; wait for the real page. Das Fenster bleibt immer unsichtbar. Bei einer Cloudflare-Pruefung
// wird ~10 s auf eine sich selbst loesende Pruefung gewartet (5 Versuche a 2 s); danach gibt der Aufruf
// auf (false). Geklickt oder umgangen wird nie etwas.
// zaehler.gesehen: Pruefung bemerkt; zaehler.gescheitert: sie hat sich nicht geloest.
async function loadPage(win, url, zaehler = null) {
  await win.loadURL(url);
  for (let i = 0; i < 5; i++) {
    const title = win.webContents.getTitle();
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => '');
    if (!looksLikeChallenge(html, title)) return true;
    if (i === 0 && zaehler) zaehler.gesehen++;
    await sleep(2000);
  }
  if (zaehler) zaehler.gescheitert++;
  return false;
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

// `deriver` (cardmarket-bulk makeDeriver, optional): orders the cards so each set/rarity group gets its
// real example ids first, and after every found id derives the siblings, which then drop out of the run.
// Diagnose (02.10.2026): 123 Drucke bekamen einen Preis, aber keine idProduct aus der Bild-Adresse, und
// einige Karten finden nie eine Versionszeile. Jeder Lauf schreibt diese Faelle frisch nach
// userData/cardmarket-scraper.log (eine JSON-Zeile je Fall), damit man das Seitenformat nachsehen kann.
function openDiagLog() {
  let file = null;
  try { file = path.join(app.getPath('userData'), 'cardmarket-scraper.log'); fs.writeFileSync(file, ''); } catch { file = null; }
  return (entry) => { if (file) try { fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch { /* Diagnose ist best-effort */ } };
}
const rowSummary = (r) => ({ code: r.code, rarity: r.rarity, expansion: r.expansion, alt: r.alt, imgSrc: r.imgSrc, imgAttrs: r.imgAttrs, href: r.href });

// Basis-Durchgang: nur Drucke ab minEur (bei Schaetzpreisen zaehlt das Maximum der Spanne), immer still.
// Nach einer gescheiterten Pruefung ruhen die Drucke der Karte REST_MS lang (cm_challenge_at) und der Lauf
// bricht ab. `deps` ersetzt im Test Fenster, Seitenaufruf, Pausen und Diagnose-Datei.
async function runCardmarketScrape(db, { onProgress, shouldAbort, minEur = 5, maxCards = Infinity, deriver = null, nowMs = Date.now(), deps = {} } = {}) {
  const d = {
    makeWindow,
    loadPage,
    readRows: (win) => win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []),
    sleep: (lo, hi) => sleep(lo + Math.random() * (hi - lo)),
    setNameFor,
    cardName: async (c) => c.name || (await fetchCardData(c.id))?.data?.[0]?.name,
    diag: null,
    ...deps,
  };
  const ruheBis = new Date(nowMs - REST_MS).toISOString().slice(0, 19).replace('T', ' '); // SQLite: naive UTC
  const kandidat = "deleted = 0 AND quantity > 0 AND cm_product_id IS NULL AND language != 'KR' AND COALESCE(price_locked, 0) != 2 " +
    "AND COALESCE(cm_estimate_max, price) >= ? AND (cm_challenge_at IS NULL OR cm_challenge_at < ?)";
  // Distinct owned cards (one page scrape covers all their printings). Oldest-scraped first so the
  // background poller (which passes a small maxCards) works through the collection round-robin.
  let cards = db.prepare(
    `SELECT id, name FROM cards WHERE ${kandidat} GROUP BY id ORDER BY MIN(COALESCE(cm_updated_at, '1970-01-01')) ASC`
  ).all(minEur, ruheBis);
  if (deriver) cards = await deriver.order(cards);
  let updated = 0, noMatch = 0, errors = 0, scraped = 0, idMissed = 0, derived = 0, abgebrochen = false;
  const noMatchList = []; // card names/set codes that couldn't be matched -> user sets them manually
  const zaehler = { gesehen: 0, gescheitert: 0 };
  const diag = d.diag || openDiagLog();
  const win = await d.makeWindow();
  try {
    for (let i = 0; i < cards.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      if (scraped >= maxCards) break; // background poller: stop after a small batch per tick
      onProgress && onProgress({ current: i + 1, total: cards.length, name: cards[i].name });
      const printings = db.prepare(
        `SELECT set_code, language, rarity, cm_updated_at, cm_product_id, cm_lang_factor FROM cards WHERE id = ? AND ${kandidat}`
      ).all(String(cards[i].id), minEur, ruheBis);
      // Nur Drucke, die nicht kuerzlich bepreist wurden. Karten ohne passenden Druck werden uebersprungen
      // (kein Seitenaufruf, keine Pause). Drucke mit cm_product_id sind oben ausgeschlossen — die taegliche
      // Bulk-Aktualisierung (cardmarket-bulk.cjs) bepreist die aus der Preisliste; Scrapen ist nur fuer den Rest.
      const stale = printings.filter(p => !p.cm_updated_at || (nowMs - new Date(p.cm_updated_at + 'Z').getTime()) > FRESH_MS);
      if (stale.length === 0) continue;
      try {
        const name = await d.cardName(cards[i]);
        if (!name) { noMatch++; continue; }
        const url = resolveUrl(name);
        if (!url) { noMatch++; continue; }
        if (!(await d.loadPage(win, url, zaehler))) {
          // Pruefung nicht aufgeloest: Drucke der Karte ruhen lassen, Lauf beenden (nie weiterdruecken).
          for (const p of stale) {
            db.prepare("UPDATE cards SET cm_challenge_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(String(cards[i].id), p.set_code, p.language, p.rarity);
          }
          errors++;
          abgebrochen = true;
          break;
        }
        scraped++; // a page was actually loaded — counts toward the poller's per-tick budget
        const rows = await d.readRows(win);
        let foundId = false;
        for (const p of stale) {
          // Match primarily by set-code prefix ↔ Cardmarket expansion symbol (e.g. "25LP-DE085" ->
          // "25LP") + rarity — far more reliable than the expansion name. Some expansions list the
          // same rarity twice (alt-art versions we can't tell apart from the set code); take the
          // cheapest of those. Fall back to fuzzy expansion-name matching when no code matches.
          const hit = await selectVersionRow(rows, p, () => d.setNameFor(cards[i].id, p.set_code));
          if (hit && hit.trend != null) {
            let pid = idProductFromImageUrl(hit.imgSrc);
            let pidDerived = 0;
            if (!pid && deriver) { // Bild ohne Adresse: idProduct aus "V.n" + Set (als abgeleitet markiert)
              pid = deriver.idForRow(name, hit) || null;
              if (pid) pidDerived = 1;
            }
            if (!pid) {
              if (idMissed === 0) console.warn('[cardmarket] no idProduct in image URL:', hit.imgSrc);
              idMissed++;
              diag({ kind: 'id-missed', card: cards[i].name, set_code: p.set_code, rarity: p.rarity, url, hit: rowSummary(hit) });
            } else foundId = true;
            const price = applyLangFactor(hit.trend, p.cm_lang_factor);
            db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_url = ?, cm_product_id = COALESCE(?, cm_product_id), cm_product_derived = CASE WHEN ? IS NULL THEN cm_product_derived ELSE ? END, cm_updated_at = CURRENT_TIMESTAMP, cm_estimate = 0, cm_estimate_max = NULL, cm_challenge_at = NULL WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(price, url, pid, pid, pidDerived, String(cards[i].id), p.set_code, p.language, p.rarity);
            recordPrice(db, { id: cards[i].id, set_code: p.set_code, language: p.language, rarity: p.rarity }, price, 'cm_scrape');
            updated++;
          } else {
            db.prepare("UPDATE cards SET cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?")
              .run(String(cards[i].id), p.set_code, p.language, p.rarity); // mark attempted (no match)
            noMatch++;
            if (noMatchList.length < 100) noMatchList.push(`${cards[i].name} — ${p.set_code} (${p.rarity})`);
            diag({ kind: 'no-match', card: cards[i].name, set_code: p.set_code, rarity: p.rarity, url, rows: rows.map(rowSummary) });
          }
        }
        if (deriver && foundId) {
          try { derived += await deriver.derive(); } catch (e) { console.error('[cardmarket] ableiten:', e.message); }
        }
      } catch (e) { errors++; }
      const { lo, hi } = pauseNachPruefungen(zaehler.gesehen);
      await d.sleep(lo, hi);
    }
  } finally { win.destroy(); }
  if (zaehler.gesehen > 0) console.log(`[cardmarket] ${zaehler.gesehen} Pruefung(en) gesehen, ${zaehler.gescheitert} nicht geloest, ${scraped} Seiten`);
  if (derived > 0) console.log(`[cardmarket] ${derived} Druck(e) aus dem Set abgeleitet`);
  return { updated, noMatch, errors, noMatchList, idMissed, derived, seiten: scraped, pruefungenGesehen: zaehler.gesehen, pruefungenGescheitert: zaehler.gescheitert, abgebrochen };
}

// Spec G4 §4 — Kandidaten des 1st-Ed-Durchgangs: Printings mit mindestens einem lebenden Exemplar edition = 'first',
// Rarity ab minRank, nicht manuell gesperrt (price_locked 2), 1st-Ed-Stand aelter als 7 Tage (force ignoriert die Frist),
// unabhaengig von cm_product_id (Bulk-Printings zaehlen). set_code 'Unknown' ausgeschlossen: dieser Sammelposten
// findet nie eine Versionszeile, bleibt daher ohne Zeitstempel und wuerde sonst dauerhaft (rarityRank 99, aeltester
// Stand) die Poller-Plaetze belegen. Aeltester Stand zuerst.
// Spec G4b: nur Sprachen mit Cardmarket-Filter (CM_LANGUAGES); z. B. KR-Preise kommen aus k-tcg.
function firstEdCandidates(db, { minRank = 1, force = false, nowMs = Date.now(), limit = Infinity } = {}) {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.set_code, c.language, c.rarity, c.cm_first_ed_updated_at
      FROM cards c
     WHERE c.deleted = 0 AND COALESCE(c.price_locked, 0) != 2 AND c.set_code <> 'Unknown'
       AND c.language IN (${Object.keys(CM_LANGUAGES).map(() => '?').join(', ')})
       AND EXISTS (SELECT 1 FROM card_copies cp
                    WHERE cp.card_id = c.id AND cp.set_code = c.set_code AND cp.language = c.language
                      AND cp.rarity = c.rarity AND cp.deleted = 0 AND cp.edition = 'first')
     ORDER BY COALESCE(c.cm_first_ed_updated_at, '1970-01-01') ASC, c.id, c.set_code, c.language, c.rarity`).all(...Object.keys(CM_LANGUAGES));
  return rows
    .filter(r => rarityRank(r.rarity) >= minRank
      && (force || !r.cm_first_ed_updated_at || (nowMs - new Date(r.cm_first_ed_updated_at + 'Z').getTime()) > FRESH_MS))
    .slice(0, limit);
}

// Spec G4b §5 — zweiter Durchgang: je Kandidat Versions-Seite (Zeile + Produkt-Link), dann die Angebotslisten
// "nicht 1. Auflage" (N) und "1. Auflage" (Y), beide gefiltert auf die Sprache des Printings und Zustand EX+.
// Faktor = Median der guenstigsten passenden Angebote Y ÷ N (robustLow/robustFactor); zu wenige Angebote -> NULL.
// Schreibt nur cm_first_ed_factor + cm_first_ed_updated_at; price_first_ed setzt der Trigger (copies-schema.cjs).
// Keine price_history-Zeile. Bei den deterministischen Fehlschlaegen "keine Versionszeile", "kein Produkt-Link" und
// "Angebotstabelle fehlt" wird NUR der Zeitstempel gesetzt (Faktor unveraendert) — sonst bliebe so ein Kandidat fuer
// immer der aelteste und wuerde die Poller-Plaetze belegen; ein Markup-Bruch setzt so nie still Faktoren auf NULL.
// Bei Cloudflare-Pruefung (loadPage false) und bei Exceptions wird nichts geschrieben, der naechste Lauf versucht es
// wieder. `deps` ersetzt im Test Fenster, Netz und Pausen.
async function runFirstEdPass(db, { minRank = 1, force = false, maxCards = Infinity, headless = false, onChallenge, shouldAbort, onProgress, deps = {} } = {}) {
  const d = {
    makeWindow,
    loadPage,
    readRows: (win) => win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []),
    readOffers: (win) => win.webContents.executeJavaScript(OFFERS_JS).catch(() => ({ found: false, rows: [] })),
    sleep: () => sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS)),
    setNameFor,
    cardName: async (c) => c.name || (await fetchCardData(c.id))?.data?.[0]?.name,
    ...deps,
  };
  const list = firstEdCandidates(db, { minRank, force, nowMs: Date.now(), limit: maxCards });
  const out = { candidates: list.length, updated: 0, noOffers: 0, skipped: 0, errors: 0 };
  if (list.length === 0) return out;
  // Already aborted before the loop starts — never open the hidden window for a run that won't do anything.
  if (shouldAbort && shouldAbort()) return out;
  const write = db.prepare('UPDATE cards SET cm_first_ed_factor = ?, cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?');
  const stamp = db.prepare('UPDATE cards SET cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?');
  const win = await d.makeWindow();
  try {
    for (let i = 0; i < list.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      const p = list[i];
      const key = [String(p.id), p.set_code, p.language, p.rarity];
      onProgress && onProgress({ current: i + 1, total: list.length, name: p.name });
      try {
        const name = await d.cardName(p);
        const versionsUrl = name ? resolveUrl(name) : null;
        if (!versionsUrl || !(await d.loadPage(win, versionsUrl))) { out.skipped++; continue; }
        const hit = await selectVersionRow(await d.readRows(win), p, () => d.setNameFor(p.id, p.set_code));
        const product = hit ? productUrl(hit.href) : null;
        if (!product) { stamp.run(...key); out.skipped++; continue; }
        await d.sleep();
        if (!(await d.loadPage(win, offersUrl(product, false, p.language)))) { out.skipped++; continue; }
        const pageN = await d.readOffers(win);
        await d.sleep();
        if (!(await d.loadPage(win, offersUrl(product, true, p.language)))) { out.skipped++; continue; }
        const pageY = await d.readOffers(win);
        if (offersPageBroken(pageN) || offersPageBroken(pageY)) {
          stamp.run(...key);
          out.errors++;
          console.warn('[cardmarket] 1st Ed: Angebotsliste unlesbar (Markup?)', p.set_code, p.rarity,
            { N: { found: pageN.found, empty: pageN.empty, rows: (pageN.rows || []).length }, Y: { found: pageY.found, empty: pageY.empty, rows: (pageY.rows || []).length } });
          continue;
        }
        const base = robustLow(parseOffers(pageN.rows), { language: p.language });
        const first = robustLow(parseOffers(pageY.rows), { language: p.language });
        const { factor, capped, raw } = robustFactor(base, first);
        if (capped) console.warn('[cardmarket] 1st Ed: Faktor gekappt', p.set_code, p.rarity, { base, first, raw });
        write.run(factor, ...key);
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

module.exports = { runCardmarketScrape, runFirstEdPass, firstEdCandidates, pauseNachPruefungen, loadPage, REST_MS };
