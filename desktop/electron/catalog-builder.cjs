// desktop/electron/catalog-builder.cjs
// Orchestriert den Offline-Katalog: EN+DE-Dumps laden, mit den im Desktop bereits bestätigten
// deutschen Set-Codes anreichern, packen und nach Supabase Storage hochladen. Spiegelt den
// Aufbau von cardmarket-bulk.cjs (kein Werfen — jede Stufe liefert { error } zurück).
const fs = require('fs');
const crypto = require('crypto');
const { cachedFetch } = require('./api-handler.cjs');
const { mergeCards, attachVerified, packCatalog } = require('./catalog-build.cjs');

const EN_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const DE_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?language=de';
const DUMP_TTL_HOURS = 7 * 24;
const BUCKET = 'catalog';
const ALLOWED_MODEL_KINDS = ['index', 'embedder', 'detector'];

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// `force` (das manuelle "Jetzt bauen") verwirft einen evtl. noch nicht abgelaufenen Cache-Eintrag,
// damit die Karten- und Namensliste garantiert frisch von YGOPRODeck kommt — dieselbe Idee wie
// `force || !fresh` in cardmarket-bulk.cjs' loadFile, nur dass cachedFetch selbst kein force kennt.
function bustCache(db, cacheKeyPrefix, url) {
  try { db.prepare('DELETE FROM api_cache WHERE key = ?').run(`${cacheKeyPrefix}:${url}`); } catch { /* ignore */ }
}

async function loadDumps(db, force) {
  if (force) { bustCache(db, 'catalog_en', EN_URL); bustCache(db, 'catalog_de', DE_URL); }
  const [enData, deData] = await Promise.all([
    cachedFetch(EN_URL, 'catalog_en', DUMP_TTL_HOURS),
    cachedFetch(DE_URL, 'catalog_de', DUMP_TTL_HOURS),
  ]);
  if (!enData || !Array.isArray(enData.data)) {
    return { error: 'download', message: 'Englischer YGOPRODeck-Dump nicht verfügbar (kein Cache, kein Netz).' };
  }
  if (!deData || !Array.isArray(deData.data)) {
    return { error: 'download', message: 'Deutscher YGOPRODeck-Dump nicht verfügbar (kein Cache, kein Netz).' };
  }
  return { en: enData.data, de: deData.data };
}

// ---- Bestätigte deutsche Set-Codes aus dem api_cache -------------------------------------------
// api-handler.cjs speichert für jede Karte KEINEN fertigen "verified"-Eintrag pro Passcode — die
// Vereinigung aus fetchSetsUnion() wird nur im Speicher gebildet und nie selbst gecacht. Was im
// api_cache liegt, sind die Zwischenschritte:
//   - "ygoprodeck:<url mit ?id=<passcode>>"      -> { data: [{ id, name, card_sets, ... }] }
//   - "wiki_parse:<fandom/yugipedia-URL mit page=<Kartenname>>" -> { parse: { wikitext: { '*': ... } } }
// Der wiki_parse-Schlüssel trägt den Seitentitel (= englischer Kartenname), keinen Passcode. Also:
// 1) aus den ygoprodeck-Zeilen eine Name->Passcode-Tabelle bauen (Namenskollisionen -> verwerfen),
// 2) für jede wiki_parse-Zeile den Titel aus der URL lesen, den Passcode nachschlagen,
// 3) denselben de_sets-Regex wie parseWikiSets() auf den Wikitext anwenden.
// Konami (konami_detail/konami_search) bleibt aussen vor: der Cache-Schlüssel trägt nur die cid
// bzw. den Suchnamen, keinen Passcode, und die einzige verlässliche Zuordnung (welcher von
// mehreren Namens-Treffern zur Karte gehört) passiert nur live in fetchKonamiForCard() beim
// Abgleich mit den YGOPRODeck-Codes — das aus dem Cache nachzubilden hiesse raten. Lieber weniger,
// aber korrekte Einträge (siehe Task-Brief).
const WIKI_PARSE_KEY_RE = /^wiki_parse:https?:\/\/[^?]+\?action=parse&page=([^&]+)&prop=wikitext&format=json$/;
const DE_SETS_BLOCK_RE = /\|\s*de_sets\s*=\s*([\s\S]*?)\n\s*(?:\||\}\})/;
const CARD_TABLE_SET_RE = /\{\{\s*Card table set\s*\|([^}]*)\}\}/i;
const isGermanCode = (code) => /-DE/i.test(code) || /-G\d/i.test(code);

function readVerified(db) {
  const verified = new Map(); // passcode -> Map<"code|rarity", {code, rarity, lang}>
  try {
    const nameToPasscode = new Map();
    const collidedNames = new Set();
    const ygoRows = db.prepare("SELECT data FROM api_cache WHERE key LIKE 'ygoprodeck:%'").all();
    for (const row of ygoRows) {
      let parsed;
      try { parsed = JSON.parse(row.data); } catch { continue; }
      const c0 = parsed && Array.isArray(parsed.data) && parsed.data[0];
      if (!c0 || c0.id == null || !c0.name) continue;
      const key = String(c0.name).trim().toLowerCase();
      const passcode = String(c0.id);
      if (nameToPasscode.has(key) && nameToPasscode.get(key) !== passcode) { collidedNames.add(key); continue; }
      nameToPasscode.set(key, passcode);
    }
    for (const key of collidedNames) nameToPasscode.delete(key);

    const wikiRows = db.prepare("SELECT key, data FROM api_cache WHERE key LIKE 'wiki_parse:%'").all();
    for (const row of wikiRows) {
      const m = WIKI_PARSE_KEY_RE.exec(row.key);
      if (!m) continue;
      let title;
      try { title = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { continue; }
      const passcode = nameToPasscode.get(title.trim().toLowerCase());
      if (!passcode) continue;

      let parsed;
      try { parsed = JSON.parse(row.data); } catch { continue; }
      const wikitext = parsed && parsed.parse && parsed.parse.wikitext && parsed.parse.wikitext['*'];
      if (!wikitext) continue;
      const blockMatch = DE_SETS_BLOCK_RE.exec(wikitext);
      if (!blockMatch) continue;

      const entries = verified.get(passcode) || new Map();
      for (const rawLine of blockMatch[1].split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        let code, rarityField;
        const tmpl = CARD_TABLE_SET_RE.exec(line);
        if (tmpl) {
          const a = tmpl[1].split('|').map(s => s.trim());
          code = a[0];
          rarityField = a[2] || 'Common';
        } else {
          const parts = line.split(';');
          if (parts.length < 3) continue;
          code = parts[0].trim();
          rarityField = parts[2].trim();
        }
        if (!code || !isGermanCode(code)) continue;
        for (const rarity of rarityField.split(',').map(r => r.trim())) {
          if (!rarity) continue;
          entries.set(`${code}|${rarity}`, { code, rarity, lang: 'DE' });
        }
      }
      if (entries.size > 0) verified.set(passcode, entries);
    }
  } catch (e) {
    console.error('[catalog-builder] readVerified failed:', e.message);
    return new Map();
  }

  const out = new Map();
  for (const [passcode, entries] of verified) out.set(passcode, Array.from(entries.values()));
  return out;
}

// ---- Bauen, hochladen, Version verbuchen --------------------------------------------------------

async function runCatalogBuild(db, { ensureClient, force = false } = {}) {
  try {
    const dumps = await loadDumps(db, force);
    if (dumps.error) return dumps;

    const verifiedByPasscode = readVerified(db);
    const cards = attachVerified(mergeCards(dumps.en, dumps.de), verifiedByPasscode);

    const prevVersion = Number(getSetting(db, 'catalog_version')) || 0;
    const version = prevVersion + 1;
    const { buffer, bytes } = packCatalog(cards, version);

    let client;
    try { client = await ensureClient(); }
    catch (e) { return { error: 'auth', message: e.message }; }
    if (!client) return { error: 'no-client', message: 'Cloud-Sync ist nicht eingerichtet oder deaktiviert.' };

    const fileName = `catalog.v${version}.json.gz`;
    const { error: upErr } = await client.storage.from(BUCKET).upload(fileName, buffer, { contentType: 'application/gzip', upsert: true });
    if (upErr) return { error: 'upload', message: upErr.message };

    const { data: pub } = client.storage.from(BUCKET).getPublicUrl(fileName);
    const url = pub && pub.publicUrl;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const built_at = new Date().toISOString();

    const { error: verErr } = await client.from('catalog_versions')
      .upsert({ kind: 'catalog', version, url, bytes, sha256, built_at }, { onConflict: 'kind' });
    if (verErr) return { error: 'catalog_versions', message: verErr.message };

    // Erst NACH erfolgreichem Upload verbuchen — schlägt der Upload fehl, bleibt die Version
    // stehen und der nächste Lauf versucht dieselbe Nummer erneut, statt sie zu verbrennen.
    setSetting(db, 'catalog_version', version);
    setSetting(db, 'catalog_last_run', built_at);
    setSetting(db, 'catalog_bytes', bytes);

    return { version, bytes, url, cards: cards.length, verified: verifiedByPasscode.size };
  } catch (e) {
    console.error('[catalog-builder] runCatalogBuild failed:', e.message);
    return { error: 'internal', message: e.message };
  }
}

function getCatalogStatus(db) {
  return {
    lastRun: getSetting(db, 'catalog_last_run'),
    version: Number(getSetting(db, 'catalog_version')) || 0,
    bytes: Number(getSetting(db, 'catalog_bytes')) || 0,
  };
}

// `kind` ist eines der Modell-Artefakte (nicht 'catalog' — das läuft über runCatalogBuild), je mit
// eigener, lokal fortlaufender Versionsnummer nach demselben "erst nach Erfolg verbuchen"-Muster.
async function uploadModel(db, { ensureClient, kind, filePath } = {}) {
  try {
    if (!ALLOWED_MODEL_KINDS.includes(kind)) {
      return { error: 'invalid-kind', message: `Unbekannte Modellart: ${kind}` };
    }
    let buffer;
    try { buffer = fs.readFileSync(filePath); }
    catch (e) { return { error: 'read', message: e.message }; }

    let client;
    try { client = await ensureClient(); }
    catch (e) { return { error: 'auth', message: e.message }; }
    if (!client) return { error: 'no-client', message: 'Cloud-Sync ist nicht eingerichtet oder deaktiviert.' };

    const settingKey = `model_version_${kind}`;
    const prevVersion = Number(getSetting(db, settingKey)) || 0;
    const version = prevVersion + 1;
    const fileName = `${kind}.v${version}.bin`;

    const { error: upErr } = await client.storage.from(BUCKET).upload(fileName, buffer, { contentType: 'application/octet-stream', upsert: true });
    if (upErr) return { error: 'upload', message: upErr.message };

    const { data: pub } = client.storage.from(BUCKET).getPublicUrl(fileName);
    const url = pub && pub.publicUrl;
    const bytes = buffer.length;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const built_at = new Date().toISOString();

    const { error: verErr } = await client.from('catalog_versions')
      .upsert({ kind, version, url, bytes, sha256, built_at }, { onConflict: 'kind' });
    if (verErr) return { error: 'catalog_versions', message: verErr.message };

    setSetting(db, settingKey, version);

    return { kind, version, bytes, sha256, url };
  } catch (e) {
    console.error('[catalog-builder] uploadModel failed:', e.message);
    return { error: 'internal', message: e.message };
  }
}

module.exports = { loadDumps, readVerified, runCatalogBuild, getCatalogStatus, uploadModel };
