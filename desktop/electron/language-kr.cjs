// Koreanische Karten (Spec 2026-10-01). ZWILLING: android/.../cloud/LanguageKr.kt.
// Gemeinsame Fixture: docs/fixtures/language/kr.json. Wer eine Fassung aendert, aendert beide.
const KR_DEFAULT_FACTOR = 0.5;

const { recordPrice } = require('./price-history.cjs');

// KR-Region ("CORI-KR001", "MVP1-KRQ54") oder das alte einzelne K ("LOB-K005") direkt vor der Nummer.
const KOREAN_CODE_RE = /-KR?[A-Z]?\d/i;
function isKoreanCode(code) {
  return KOREAN_CODE_RE.test(String(code || ''));
}

// Preis x Sprachfaktor, auf Cent gerundet (+1e-7 wie FIRST_ED_SQL, damit 0.075 auf 0.08 rundet).
function applyLangFactor(price, factor) {
  if (price == null) return null;
  if (factor == null) return price;
  return Math.round(price * factor * 100 + 1e-7) / 100;
}

function normalizeKrFactor(value) {
  const f = Number(value);
  return (value != null && Number.isFinite(f) && f > 0 && f <= 1) ? f : KR_DEFAULT_FACTOR;
}

// Nur ein Name mit Hangul (U+AC00-U+D7A3) ist ein koreanischer -- sonst liefert z. B. Konami bei
// einer Karte ohne KR-Veroeffentlichung den englischen Titel.
const HANGUL_RE = /[가-힣]/;
function nurHangul(name) {
  return name && HANGUL_RE.test(name) ? name : null;
}

// "| ko_name = 블랙 매지션" aus Yugipedia-Wikitext; HTML-Tags (z. B. <ruby>) werden entfernt.
function extractKoName(wikitext) {
  const m = String(wikitext || '').match(/^\|\s*ko_name\s*=[ \t]*(.*)$/m);
  if (!m) return null;
  return nurHangul(m[1].replace(/<[^>]+>/g, '').trim());
}

// Konami-Detailseite mit request_locale=ko: "<title>블랙 매지션 | 카드 상세 | ...".
function konamiTitleName(html) {
  const m = String(html || '').match(/<title>\s*([^|<]+?)\s*\|/);
  return m ? nurHangul(m[1]) : null;
}

function getKrFactor(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'kr_price_factor'").get();
  return normalizeKrFactor(r ? r.value : null);
}

// Preisfelder fuer eine neu geschriebene Zeile: KR bekommt Faktor + multiplizierten Preis.
function krPriceFields(db, language, rawPrice) {
  if (language !== 'KR') return { price: rawPrice, cm_lang_factor: null };
  const f = getKrFactor(db);
  return { price: applyLangFactor(rawPrice, f), cm_lang_factor: f };
}

const KEY_WHERE = 'id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity';

// Rechnet den Preis einer Zeile vom gespeicherten auf newFactor um (fehlender Faktor = 1).
function rescaleKrRow(db, key, newFactor) {
  const row = db.prepare(`SELECT price, cm_lang_factor FROM cards WHERE ${KEY_WHERE}`).get(key);
  if (!row) return;
  const old = row.cm_lang_factor ?? 1;
  const price = row.price == null ? null : applyLangFactor(row.price / old, newFactor);
  db.prepare(`UPDATE cards SET price = @price, cm_lang_factor = @f WHERE ${KEY_WHERE}`)
    .run({ ...key, price, f: newFactor });
  // Jede Preisaenderung gehoert in den Verlauf (eine Zeile je Druck/Variante/Tag).
  if (price !== row.price) recordPrice(db, key, price, 'kr_factor');
}

// Neuer KR-Faktor: speichern und alle lebenden, nicht manuell gesperrten KR-Zeilen umrechnen.
function setKrFactor(db, value) {
  const factor = normalizeKrFactor(value);
  let changed = 0;
  db.transaction(() => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('kr_price_factor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(factor));
    const rows = db.prepare(
      "SELECT id, set_code, language, rarity FROM cards WHERE language = 'KR' AND deleted = 0 AND COALESCE(price_locked, 0) != 2 AND kr_updated_at IS NULL AND cm_lang_factor IS NOT ?"
    ).all(factor);
    for (const r of rows) { rescaleKrRow(db, r, factor); changed++; }
  })();
  return { factor, changed };
}

module.exports = {
  KR_DEFAULT_FACTOR, isKoreanCode, applyLangFactor, normalizeKrFactor, extractKoName, konamiTitleName,
  getKrFactor, krPriceFields, rescaleKrRow, setKrFactor,
};
