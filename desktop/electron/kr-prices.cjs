// desktop/electron/kr-prices.cjs
// Preise fuer koreanische Drucke (02.10.2026). Cardmarket fuehrt kein Koreanisch; bisher stand dort der
// EU-Preis x KR-Faktor, bei teuren Karten grob falsch. Quelle ist jetzt k-tcg.com, ein koreanischer
// Export-Laden, ueber seine oeffentliche WooCommerce-Shop-Schnittstelle (robots.txt erlaubt sie).
// Das ist ein LADENPREIS in USD mit Mindestpreis 1 USD -- darunter kennen wir den Wert nicht.
// Umrechnung USD -> EUR mit dem Tageskurs der EZB.
const { recordPrice } = require('./price-history.cjs');

const KTCG_SEARCH = 'https://k-tcg.com/wp-json/wc/store/v1/products?per_page=50&search=';
const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0';
const FLOOR_USD = 1;      // k-tcg verkauft nichts unter 1 USD
const FLOOR_EUR = 0.1;    // Rechenwert fuer Karten auf dem Mindestpreis (Nutzer, 02.10.2026)
const STALE_MS = 24 * 3600 * 1000;
const DELAY_MS = 1000;

const normRarity = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const decode = (s) => String(s || '').replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#8211;|&#8212;/g, '-').replace(/&#8217;|&#039;|&#39;/g, "'").replace(/&amp;/g, '&');

// 'Yugioh Card "Name" CORI-KR027 Korean Ver Ultra Rare' -> { code, rarity, variant }.
// variant = eine Klammer ausserhalb des Kartennamens, z. B. "(extended art)" -- ein anderer Druck.
function parseKtcgName(name) {
  const s = decode(name);
  const m = s.match(/\b([A-Z0-9]+-KR[A-Z]?\d+)\s+Korean Ver\.?\s+(.+?)\s*$/i);
  if (!m) return null;
  const outsideName = s.replace(/"[^"]*"/g, '');
  return { code: m[1].toUpperCase(), rarity: m[2], variant: /\(/.test(outsideName) };
}

// Preis eines Store-API-Produkts in USD; null bei anderer Waehrung oder ohne Preis.
function productUsd(p) {
  const pr = p && p.prices;
  if (!pr || pr.currency_code !== 'USD' || pr.price == null || pr.price === '') return null;
  const v = Number(pr.price) / 10 ** Number(pr.currency_minor_unit ?? 2);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Das Produkt zu genau diesem Druck: gleicher Code, gleiche Seltenheit, keine Variante.
function matchProduct(products, { set_code, rarity }) {
  const code = String(set_code || '').toUpperCase();
  const want = normRarity(rarity);
  for (const p of products || []) {
    const n = parseKtcgName(p.name);
    if (n && !n.variant && n.code === code && normRarity(n.rarity) === want && productUsd(p) != null) return p;
  }
  return null;
}

// USD -> EUR; auf dem Mindestpreis nur der Rechenwert FLOOR_EUR.
function eurFromUsd(usd, usdPerEur) {
  if (usd <= FLOOR_USD) return FLOOR_EUR;
  return Math.round((usd / usdPerEur) * 100) / 100;
}

// <Cube currency='USD' rate='1.0846'/> aus dem EZB-Tageskurs.
function parseEcbUsd(xml) {
  const m = String(xml || '').match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/);
  const r = m ? Number(m[1]) : NaN;
  return Number.isFinite(r) && r > 0 ? r : null;
}

async function httpText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const setting = (db, key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
const saveSetting = (db, key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

// Tageskurs, bei Ausfall der zuletzt gespeicherte; null wenn es nie einen gab.
async function usdPerEur(db, getText) {
  try {
    const r = parseEcbUsd(await getText(ECB_DAILY));
    if (r) { saveSetting(db, 'fx_usd_per_eur', r); return r; }
  } catch (e) { console.warn('[kr-prices] EZB-Kurs:', e.message); }
  const last = Number(setting(db, 'fx_usd_per_eur'));
  return Number.isFinite(last) && last > 0 ? last : null;
}

// Lebende KR-Drucke ohne Handpreis, deren letzter Abruf aelter als 24 h ist (force: alle).
function dueRows(db, force, nowMs) {
  return db.prepare(
    "SELECT id, set_code, language, rarity, price, kr_updated_at FROM cards WHERE language = 'KR' AND deleted = 0 AND quantity > 0 " +
    "AND set_code != 'Unknown' AND COALESCE(price_locked, 0) != 2"
  ).all().filter(r => force || !r.kr_updated_at || (nowMs - new Date(r.kr_updated_at + 'Z').getTime()) > STALE_MS);
}

// Je Set-Code eine Suche bei k-tcg; jeder Druck bekommt den Preis seines Produkts, ohne Treffer 0.
// KR-Drucke verlieren dabei ihre Cardmarket-Nummer, sonst ueberschreibt der Cardmarket-Lauf (lokal und
// in der Cloud, Funktion refresh-cardmarket-prices) den Preis wieder mit EU-Preis x Faktor.
// `deps` ersetzt im Test Netz und Pause.
async function refreshKrPrices(db, { force = false, deps = {} } = {}) {
  const d = { getText: httpText, sleep: (ms) => new Promise(r => setTimeout(r, ms)), now: Date.now(), ...deps };
  const rows = dueRows(db, force, d.now);
  const out = { checked: rows.length, priced: 0, noMatch: 0, errors: 0 };
  if (rows.length === 0) return out;
  const rate = await usdPerEur(db, d.getText);
  if (!rate) return { ...out, error: 'no-fx' };

  const byCode = new Map();
  for (const r of rows) {
    const k = r.set_code.toUpperCase();
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(r);
  }
  const upd = db.prepare(
    "UPDATE cards SET price = @price, price_locked = 1, cm_product_id = NULL, cm_product_derived = 0, kr_ktcg_usd = @usd, kr_updated_at = CURRENT_TIMESTAMP " +
    "WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity"
  );
  let first = true;
  for (const [code, printings] of byCode) {
    if (!first) await d.sleep(DELAY_MS);
    first = false;
    let products;
    try { products = JSON.parse(await d.getText(KTCG_SEARCH + encodeURIComponent(code))); }
    catch (e) { out.errors++; console.warn('[kr-prices]', code, e.message); continue; } // naechste Stunde erneut
    if (!Array.isArray(products)) { out.errors++; continue; }
    for (const r of printings) {
      const hit = matchProduct(products, r);
      const usd = hit ? productUsd(hit) : null;
      const price = usd == null ? 0 : eurFromUsd(usd, rate);
      upd.run({ price, usd, id: r.id, set_code: r.set_code, language: r.language, rarity: r.rarity });
      if (usd == null) out.noMatch++;
      else { out.priced++; recordPrice(db, r, price, 'ktcg'); }
    }
  }
  console.log('[kr-prices]', JSON.stringify(out));
  return out;
}

module.exports = { refreshKrPrices, parseKtcgName, matchProduct, productUsd, eurFromUsd, parseEcbUsd, FLOOR_EUR };
