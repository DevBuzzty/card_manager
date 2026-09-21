const { createClient } = require('@supabase/supabase-js');
const { copyCount } = require('./valuation.cjs');
const { portfolioTotals, recordPortfolioValue } = require('./portfolio-value.cjs');
const { SEALED_COLS } = require('./sealed-items.cjs');
const { toUtcMillis } = require('./sealed-value.cjs');
const { CONTAINER_COLS, clearContainerLocations } = require('./containers-schema.cjs');
const { mergeRemotePriceHistory } = require('./price-history.cjs');
const { nextNotification, openSignature } = require('./alert-notify.cjs');
const { CHANNEL_COLS, SALE_COLS, ITEM_COLS } = require('./sales-schema.cjs');

// Columns mirrored to the cloud (desktop is authoritative for all of them).
// cm_product_id + price_locked let the cloud's daily Cardmarket refresh (Edge Function) price the
// phone's rows and skip manual prices (price_locked = 2) without the desktop being on.
// quantity is NOT mirrored any more: both sides derive it from card_copies via triggers.
// Spec G4 §5: cm_first_ed_factor mit; die Cloud rechnet price_first_ed per Trigger aus price x Faktor.
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute',
  'rarity', 'price', 'deleted', 'cm_product_id', 'price_locked', 'price_first_ed', 'cm_first_ed_factor'];

const COPY_COLS = ['copy_id', 'card_id', 'set_code', 'language', 'rarity', 'edition', 'condition', 'deleted',
  'container_id', 'page', 'slot', 'tags', 'note', 'needs_review', 'review_reason', 'for_sale', 'sold_in'];
const COPY_BOOLS = new Set(['deleted', 'needs_review', 'for_sale']);

// CONTAINER_COLS (from containers-schema.cjs) is the full local column set -- used as-is only for
// schema checks. Neither direction of the sync may touch the two timestamp columns directly, same
// as MIRROR_COLS/COPY_COLS above: the push payload drops updated_at (Supabase stamps that column
// server-side, like user_id via auth.uid(), so sending our local value would be pointless) and
// created_at (same reasoning as the other two streams, neither of which mirrors it: the local
// value is a naive-UTC SQLite string, the cloud column is timestamptz, and interpreting a
// timezone-less string server-side risks shifting it — the column already defaults to now()).
// CONTAINER_LOCAL_COLS is the pull-direction analogue of CONTAINER_PUSH_COLS: applying a pulled
// row must never write Supabase's own timestamptz string (e.g. "2026-09-05T10:00:00.123456+00:00")
// into the local, sekundengenaue DATETIME column -- every comparison against it is a string
// comparison, and 'T' (0x54) sorts above the space (0x20) the local format uses, so a pulled row
// from an EARLIER day would still satisfy the push cursor's `updated_at > cursor` and get pushed
// right back. Local rows get their own fresh stamp instead, exactly like MIRROR_COLS/COPY_COLS
// already do for cards/card_copies (trg_containers_updated in containers-schema.cjs re-stamps
// updated_at on UPDATE; CURRENT_TIMESTAMP defaults handle INSERT).
const CONTAINER_BOOLS = new Set(['deleted']);
// Zwei eigene Konstanten statt einer gemeinsamen, obwohl der Filter heute identisch aussieht --
// sie schliessen updated_at und created_at aus verschiedenen Gruenden aus (Begruendung fuer
// beide Spalten im Block zwoelf Zeilen darueber) und duerfen kuenftig auseinanderlaufen.
const CONTAINER_PUSH_COLS = CONTAINER_COLS.filter(c => c !== 'updated_at' && c !== 'created_at');
// LOCAL darf die Cloud-Zeitstempel nicht in die lokalen Spalten schreiben: dort gilt das
// sekundengenaue SQLite-Format, und jeder Vergleich (auch der Push-Cursor) ist ein
// Zeichenkettenvergleich -- ein Postgres-timestamptz-String wuerde ihn verfaelschen.
const CONTAINER_LOCAL_COLS = CONTAINER_COLS.filter(c => c !== 'updated_at' && c !== 'created_at');

// Local SQLite row -> remote upsert payload. `updated_at` is server-stamped, never sent.
function rowToRemote(row) {
  const out = {};
  for (const c of MIRROR_COLS) {
    if (c === 'deleted') out.deleted = !!row.deleted;
    else if (c === 'price_locked') out.price_locked = Number(row.price_locked) || 0; // cloud column is smallint 0/1/2
    else if (c === 'cm_product_id') out.cm_product_id = row.cm_product_id ?? null;
    else if (c === 'price_first_ed') out.price_first_ed = row.price_first_ed ?? null;
    else if (c === 'cm_first_ed_factor') out.cm_first_ed_factor = row.cm_first_ed_factor ?? null;
    else out[c] = row[c];
  }
  return out;
}

// Remote row -> the only field the phone may still change on a printing row.
function remoteToLocalPatch(r) {
  return { id: String(r.id), set_code: r.set_code, language: r.language || 'DE', rarity: r.rarity || 'Unknown', deleted: r.deleted ? 1 : 0 };
}

// Remote row -> full local INSERT payload for a phone-created printing the desktop doesn't have yet.
// quantity is carried once here; the copies stream + trigger correct it right after.
function remoteToLocalFull(r) {
  return {
    id: String(r.id), set_code: r.set_code || 'Unknown', language: r.language || 'DE',
    name: r.name ?? null, type: r.type ?? null, desc: r.desc ?? null, image_url: r.image_url ?? null,
    atk: r.atk ?? null, def: r.def ?? null, level: r.level ?? null, race: r.race ?? null,
    attribute: r.attribute ?? null, quantity: r.quantity ?? 1, rarity: r.rarity ?? 'Unknown',
    price: r.price ?? null, deleted: r.deleted ? 1 : 0,
    cm_product_id: r.cm_product_id ?? null, price_locked: Number(r.price_locked) || 0,
    price_first_ed: r.price_first_ed ?? null,
    cm_first_ed_factor: r.cm_first_ed_factor ?? null,
  };
}

function copyToRemote(row) {
  const out = {};
  for (const c of COPY_COLS) out[c] = COPY_BOOLS.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalCopy(r) {
  const out = {};
  for (const c of COPY_COLS) out[c] = COPY_BOOLS.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  out.copy_id = String(r.copy_id); out.card_id = String(r.card_id);
  out.language = out.language || 'DE'; out.rarity = out.rarity || 'Unknown';
  out.edition = out.edition || 'unknown'; out.condition = out.condition || 'NM';
  return out;
}

// Apply one pulled remote row: existing local row -> patch deleted only (desktop stays
// authoritative for detail columns, quantity is derived from copies); missing local row -> insert the full row.
function applyRemoteRow(db, r) {
  const p = remoteToLocalPatch(r);
  const exists = db.prepare('SELECT 1 FROM cards WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity LIMIT 1').get(p);
  if (!exists) {
    db.prepare(`INSERT OR IGNORE INTO cards
      (id, set_code, language, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, price, deleted, cm_product_id, price_locked, price_first_ed, cm_first_ed_factor)
      VALUES (@id,@set_code,@language,@name,@type,@desc,@image_url,@atk,@def,@level,@race,@attribute,@quantity,@rarity,@price,@deleted,@cm_product_id,@price_locked,@price_first_ed,@cm_first_ed_factor)`)
      .run(remoteToLocalFull(r));
    return;
  }
  db.prepare(`UPDATE cards SET deleted = @deleted
    WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted IS NOT @deleted`).run(p);
}

// Upsert one pulled copy; only writes when something differs so the local updated_at trigger
// (and therefore the next push) fires only for real changes.
// Fix I2 (final-review-report.md): siehe pulledUpdatedAtCeiling/pulledUpdatedAtFor weiter unten --
// ohne ein explizites updated_at stempelt trg_copies_updated (copies-schema.cjs) eine angewandte
// Zeile auf CURRENT_TIMESTAMP, und der naechste pushCopies schiebt sie als "lokale Aenderung" zurueck.
function applyRemoteCopy(db, r) {
  const l = remoteToLocalCopy(r);
  const cur = db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(l.copy_id);
  const ceiling = pulledUpdatedAtCeiling(db, 'sync_copies_last_push');
  if (!cur) {
    l.updated_at = ceiling;
    db.prepare(`INSERT INTO card_copies (${COPY_COLS.join(',')}, updated_at) VALUES (${COPY_COLS.map(c => '@' + c).join(',')}, @updated_at)`).run(l);
    return;
  }
  const changed = COPY_COLS.some(c => c !== 'copy_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  l.updated_at = pulledUpdatedAtFor(ceiling, cur.updated_at);
  const sets = COPY_COLS.filter(c => c !== 'copy_id').map(c => `${c} = @${c}`).join(', ') + ', updated_at = @updated_at';
  db.prepare(`UPDATE card_copies SET ${sets} WHERE copy_id = @copy_id`).run(l);
}

function containerToRemote(row) {
  const out = {};
  for (const c of CONTAINER_PUSH_COLS) out[c] = CONTAINER_BOOLS.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalContainer(r) {
  const out = {};
  for (const c of CONTAINER_LOCAL_COLS) out[c] = CONTAINER_BOOLS.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  out.container_id = String(r.container_id);
  out.name = out.name || 'Ohne Namen';
  out.kind = out.kind || 'box';
  out.sort_order = out.sort_order ?? 0;
  return out;
}
// Ein Behaelter, der bereits geloescht ankommt (ein anderes Geraet hat ihn geloescht, moeglicherweise
// bevor der Desktop ein inzwischen zugewiesenes Exemplar gezogen hatte), muss dieselbe Aufraeumpflicht
// ausloesen wie das lokale Loeschen (deleteContainer) -- sonst zeigt ein Exemplar auf einen Behaelter,
// den es lokal nicht mehr (oder nie) lebend gab, und ist nirgends mehr sichtbar (Befund 1).
// Fix I2 (final-review-report.md): siehe pulledUpdatedAtCeiling/pulledUpdatedAtFor weiter unten --
// ohne ein explizites updated_at stempelt trg_containers_updated (containers-schema.cjs) eine
// angewandte Zeile auf CURRENT_TIMESTAMP, und der naechste pushContainers schiebt sie als "lokale
// Aenderung" zurueck.
function applyRemoteContainer(db, r) {
  const l = remoteToLocalContainer(r);
  const cur = db.prepare('SELECT * FROM containers WHERE container_id = ?').get(l.container_id);
  const ceiling = pulledUpdatedAtCeiling(db, 'sync_containers_last_push');
  if (l.deleted && (!cur || !cur.deleted)) clearContainerLocations(db, l.container_id);
  if (!cur) {
    l.updated_at = ceiling;
    db.prepare(`INSERT INTO containers (${CONTAINER_LOCAL_COLS.join(',')}, updated_at)
                VALUES (${CONTAINER_LOCAL_COLS.map(c => '@' + c).join(',')}, @updated_at)`).run(l);
    return;
  }
  const changed = CONTAINER_LOCAL_COLS.some(c => c !== 'container_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  l.updated_at = pulledUpdatedAtFor(ceiling, cur.updated_at);
  const sets = CONTAINER_LOCAL_COLS.filter(c => c !== 'container_id').map(c => `${c} = @${c}`).join(', ') + ', updated_at = @updated_at';
  db.prepare(`UPDATE containers SET ${sets} WHERE container_id = @container_id`).run(l);
}

// Spec G3 §7.1 — Sealed-Bestand als vierter Strom, gebaut wie die Behaelter. created_at/updated_at wandern
// aus denselben Gruenden wie bei CONTAINER_PUSH_COLS/CONTAINER_LOCAL_COLS in keine Richtung mit.
// price_updated_at MUSS mit, wird aber umgeformt: lokal sekundengenau ohne Zone ('2026-09-15 05:00:03'),
// in der Cloud timestamptz. So bleibt jeder lokale Vergleich ein Vergleich gleicher Formen.
const SEALED_SYNC_COLS = SEALED_COLS.filter(c => c !== 'updated_at' && c !== 'created_at');
function tsLocalToCloud(s) {
  const ms = toUtcMillis(s);
  return ms == null ? null : new Date(ms).toISOString();
}
function tsCloudToLocal(s) {
  const ms = toUtcMillis(s);
  return ms == null ? null : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
function sealedToRemote(row) {
  const out = {};
  for (const c of SEALED_SYNC_COLS) out[c] = row[c] ?? null;
  out.deleted = !!row.deleted;
  out.price_updated_at = tsLocalToCloud(row.price_updated_at);
  return out;
}
function remoteToLocalSealed(r) {
  const out = {};
  for (const c of SEALED_SYNC_COLS) out[c] = r[c] ?? null;
  out.sealed_id = String(r.sealed_id);
  out.cm_product_id = Number(r.cm_product_id);
  out.quantity = Number(r.quantity);
  out.price = r.price == null ? null : Number(r.price);
  out.price_updated_at = tsCloudToLocal(r.price_updated_at);
  out.deleted = r.deleted ? 1 : 0;
  return out;
}
// Fix I2 (final-review-report.md): ohne ein explizites updated_at stempeln die AFTER-UPDATE-Trigger
// (trg_sealed_updated in sealed-items.cjs, trg_containers_updated in containers-schema.cjs,
// trg_copies_updated in copies-schema.cjs -- alle drei mit derselben WHEN NEW.updated_at = OLD.updated_at
// Bedingung) eine angewandte Zeile auf CURRENT_TIMESTAMP, und der naechste push* schiebt sie als "lokale
// Aenderung" zurueck -- das kann eine inzwischen neuere Handy-Schreibaktion ueberschreiben. Deshalb
// bekommt jede gezogene Zeile in allen drei Stroemen ihr updated_at explizit auf eine Grenze gesetzt,
// die den jeweiligen Push-Cursor (cursorKey) nie ueberholt (den Cursor selbst, oder '1970-01-01
// 00:00:00' ohne Cursor). Gemeinsam extrahiert, weil alle drei Stroeme genau dasselbe brauchen.
function pulledUpdatedAtCeiling(db, cursorKey) {
  const cursor = getSetting(db, cursorKey) || '1970-01-01T00:00:00Z';
  return tsCloudToLocal(cursor) || '1970-01-01 00:00:00';
}
// Faellt die Grenze zufaellig mit dem bisherigen updated_at zusammen (z.B. zwei Zeilen derselben Zeile,
// gezogen ohne dass sich der Push-Cursor dazwischen bewegt hat), wuerde UPDATE ... SET updated_at = @x
// NEW.updated_at = OLD.updated_at hinterlassen -- genau die Bedingung, unter der der jeweilige Trigger
// erneut auf CURRENT_TIMESTAMP stempelt. Dann eine Sekunde vor die Grenze ausweichen: das bleibt weiterhin
// nicht neuer als der Cursor, unterscheidet sich aber von OLD.updated_at.
function pulledUpdatedAtFor(ceiling, oldValue) {
  if (ceiling !== oldValue) return ceiling;
  const ms = toUtcMillis(ceiling);
  return new Date(ms - 1000).toISOString().slice(0, 19).replace('T', ' ');
}
// Nur schreiben, wenn sich etwas unterscheidet -- sonst stempelte trg_sealed_updated die Zeile neu und der
// naechste Push schoebe sie grundlos zurueck.
function applyRemoteSealed(db, r) {
  const l = remoteToLocalSealed(r);
  const cur = db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ?').get(l.sealed_id);
  const ceiling = pulledUpdatedAtCeiling(db, 'sync_sealed_last_push');
  if (!cur) {
    l.updated_at = ceiling;
    db.prepare(`INSERT INTO sealed_items (${SEALED_SYNC_COLS.join(',')}, updated_at)
                VALUES (${SEALED_SYNC_COLS.map(c => '@' + c).join(',')}, @updated_at)`).run(l);
    return;
  }
  const changed = SEALED_SYNC_COLS.some(c => c !== 'sealed_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  l.updated_at = pulledUpdatedAtFor(ceiling, cur.updated_at);
  const sets = SEALED_SYNC_COLS.filter(c => c !== 'sealed_id').map(c => `${c} = @${c}`).join(', ') + ', updated_at = @updated_at';
  db.prepare(`UPDATE sealed_items SET ${sets} WHERE sealed_id = @sealed_id`).run(l);
}

// Spec H2 §4.3 — Verkaeufe, Positionen und Kanaele als drei weitere Stroeme, gebaut wie Sealed (G3).
// created_at/updated_at wandern aus denselben Gruenden wie bei CONTAINER_PUSH_COLS in keine Richtung mit.
const noStamps = (cols) => cols.filter((c) => c !== 'updated_at' && c !== 'created_at');
const SALES_STREAMS = {
  sale_channels: { cols: noStamps(CHANNEL_COLS), bools: new Set(['builtin', 'deleted']), key: ['channel_id'], cursor: 'sync_sale_channels' },
  sales: { cols: noStamps(SALE_COLS), bools: new Set(['deleted']), key: ['sale_id'], cursor: 'sync_sales' },
  sale_items: { cols: noStamps(ITEM_COLS), bools: new Set(['was_for_sale', 'deleted']), key: ['sale_id', 'copy_id'], cursor: 'sync_sale_items' },
};
const recentlyPushedSalesByTable = { sale_channels: new Map(), sales: new Map(), sale_items: new Map() };
const echoKey = (table, r) => SALES_STREAMS[table].key.map((k) => String(r[k])).join('|');

function salesRowToRemote(table, row) {
  const s = SALES_STREAMS[table]; const out = {};
  for (const c of s.cols) out[c] = s.bools.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalSalesRow(table, r) {
  const s = SALES_STREAMS[table]; const out = {};
  for (const c of s.cols) out[c] = s.bools.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  for (const k of ['gross', 'fees', 'shipping', 'value_at_sale', 'share', 'fee_percent']) if (k in out && out[k] != null) out[k] = Number(out[k]);
  if ('sold_on' in out && out.sold_on) out.sold_on = String(out.sold_on).slice(0, 10);
  return out;
}
function applyRemoteSalesRow(db, table, r) {
  const s = SALES_STREAMS[table];
  const l = remoteToLocalSalesRow(table, r);
  const where = s.key.map((k) => `${k} = @${k}`).join(' AND ');
  const cur = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(l);
  const ceiling = pulledUpdatedAtCeiling(db, `${s.cursor}_last_push`);
  if (!cur) {
    l.updated_at = ceiling;
    db.prepare(`INSERT INTO ${table} (${s.cols.join(',')}, updated_at) VALUES (${s.cols.map((c) => '@' + c).join(',')}, @updated_at)`).run(l);
    return;
  }
  if (!s.cols.some((c) => !s.key.includes(c) && (cur[c] ?? null) !== (l[c] ?? null))) return;
  l.updated_at = pulledUpdatedAtFor(ceiling, cur.updated_at);
  const sets = s.cols.filter((c) => !s.key.includes(c)).map((c) => `${c} = @${c}`).join(', ') + ', updated_at = @updated_at';
  db.prepare(`UPDATE ${table} SET ${sets} WHERE ${where}`).run(l);
}
function applyPulledSalesRows(db, table, rows) {
  let applied = 0;
  const echo = recentlyPushedSalesByTable[table];
  for (const r of rows) {
    const k = echoKey(table, r);
    if (echo.get(k) === r.updated_at) { echo.delete(k); continue; }
    applyRemoteSalesRow(db, table, r);
    applied++;
  }
  return applied;
}
function salesPushRows(db, table, cursor) {
  return db.prepare(`SELECT * FROM ${table} WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')`).all(cursor);
}

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value')
    .run({ key, value: String(value) });
}

// Rows the desktop just pushed; their cloud echo is skipped on the next pull so it
// doesn't re-dirty local state. Keyed by composite key -> the cloud updated_at we created.
const recentlyPushed = new Map();
const recentlyPushedCopies = new Map();
const recentlyPushedContainers = new Map();
const recentlyPushedSealed = new Map();

// Apply a page of pulled container rows, skipping any that are the echo of our own push
// (same container_id, same updated_at as what Supabase just handed back on push). Factored
// out of pullContainers so the echo-lock behaviour can be unit-tested directly via the
// _applyPulledContainers export below (see test-sync.cjs).
function applyPulledContainers(db, rows) {
  let applied = 0;
  for (const r of rows) {
    if (recentlyPushedContainers.get(r.container_id) === r.updated_at) {
      recentlyPushedContainers.delete(r.container_id);
      continue;
    }
    applyRemoteContainer(db, r);
    applied++;
  }
  return applied;
}

// Spec G3 §7.1: eine gezogene Seite Sealed-Zeilen anwenden, das Echo des eigenen Pushs ueberspringen.
function applyPulledSealed(db, rows) {
  let applied = 0;
  for (const r of rows) {
    if (recentlyPushedSealed.get(r.sealed_id) === r.updated_at) {
      recentlyPushedSealed.delete(r.sealed_id);
      continue;
    }
    applyRemoteSealed(db, r);
    applied++;
  }
  return applied;
}

// Spec F1 §3: ein Card-Dex-Import legt auf einen Schlag tausende Printings an. In Bloecken schieben
// wie pushCopies/pushContainers/pushSealed (dieselbe Blockgroesse 500): kleine Anfragen statt einer
// grossen. Nebenbei bleibt jede einzelne Antwort dadurch ohnehin unter PostgRESTs Zeilenlimit von
// rund 1000 Zeilen je Antwort -- das Limit bestimmt aber nicht die Wahl von 500, jede Blockgroesse
// darunter waere ebenso sicher. Jeder erfolgreiche Block traegt seine Zeilen sofort in die
// Echo-Sperre ein (wie die anderen drei Stroeme das inline in ihrer eigenen Schleife tun), damit ein
// erst in einem spaeteren Block scheiternder Push die bereits in der Cloud angekommenen Zeilen nicht
// ungesperrt laesst -- sonst wertet der naechste Pull ihr eigenes Echo faelschlich als fremde
// Aenderung. Ein Fehler bricht ab, bevor der Cursor weiterrueckt -- der naechste Zyklus schiebt
// alles erneut (Upsert, also ohne Doppel).
const CARDS_PUSH_CHUNK = 500;
async function upsertCardsInChunks(c, rows) {
  const pushed = [];
  for (let i = 0; i < rows.length; i += CARDS_PUSH_CHUNK) {
    const { data, error } = await c.from('cards')
      .upsert(rows.slice(i, i + CARDS_PUSH_CHUNK).map(rowToRemote), { onConflict: 'id,set_code,language,rarity' })
      .select('id,set_code,language,updated_at');
    if (error) throw new Error('Push failed: ' + error.message);
    for (const r of (data || [])) {
      recentlyPushed.set(`${r.id}|${r.set_code}|${r.language}`, r.updated_at);
      pushed.push(r);
    }
  }
  return pushed;
}

// Lokale Sealed-Zeilen seit dem Push-Cursor, ohne die der laufenden Sekunde (Begruendung in push()).
function sealedPushRows(db, cursor) {
  return db.prepare("SELECT * FROM sealed_items WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')").all(cursor);
}

function startSync(db, getWindow, { onPriceAlerts } = {}) {
  let client = null;
  let running = false;
  let lastAlertSignature = null;

  // One-time backfill (2026-09-02): rows resolved before cm_product_id/price_locked were mirrored
  // were already pushed without them. Touch them once so the normal dirty-row push re-uploads
  // them with the new columns. Guarded by a setting so it never runs twice.
  if (getSetting(db, 'cm_cloud_backfill_done') !== 'true') {
    try {
      const info = db.prepare(
        "UPDATE cards SET updated_at = CURRENT_TIMESTAMP WHERE cm_product_id IS NOT NULL OR price_locked = 2"
      ).run();
      setSetting(db, 'cm_cloud_backfill_done', 'true');
      console.log(`[sync] cloud backfill: marked ${info.changes} rows dirty for cm_product_id/price_locked`);
    } catch (e) { console.error('[sync] cloud backfill failed:', e.message); }
  }

  const emit = (state, message) => {
    const w = getWindow();
    if (w) w.webContents.send('sync-status', { state, message, at: new Date().toISOString() });
  };

  async function ensureClient() {
    const url = getSetting(db, 'supabase_url');
    const key = getSetting(db, 'supabase_key');
    const email = getSetting(db, 'supabase_email');
    const password = getSetting(db, 'supabase_password');
    if (getSetting(db, 'sync_enabled') !== 'true' || !url || !key || !email || !password) return null;
    if (!client) {
      client = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) { client = null; throw new Error('Auth failed: ' + error.message); }
    }
    return client;
  }

  async function pull(c) {
    const cursor = getSetting(db, 'sync_last_pull') || '1970-01-01T00:00:00Z';
    // PostgREST caps each response at ~1000 rows. A single unpaginated select could return
    // only the first 1000 rows changed since the cursor and then advance the cursor to that
    // page's last updated_at — permanently skipping the rest (and any row sharing the boundary
    // timestamp). Page through everything > cursor in this cycle over a STABLE order
    // (updated_at, then the composite key) and only advance the cursor once fully drained.
    const PAGE = 1000;
    let appliedCount = 0;
    let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('cards').select('*')
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .order('set_code', { ascending: true })
        .order('language', { ascending: true })
        .order('rarity', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull failed: ' + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => {
        for (const r of data) {
          const key = `${r.id}|${r.set_code}|${r.language}`;
          if (recentlyPushed.get(key) === r.updated_at) {
            // Our own echo: the desktop pushed this row and this is the cloud trigger's
            // re-stamp coming back. Skip applying it so we don't re-dirty local state.
            recentlyPushed.delete(key);
            continue;
          }
          applyRemoteRow(db, r);
          appliedCount++;
        }
      })();
      // updated_at is the primary sort key, so the last row of the last page is the max.
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_last_pull', lastTs);
    return appliedCount;
  }

  async function push(c) {
    const cursor = getSetting(db, 'sync_last_push') || '1970-01-01T00:00:00Z';
    // Exclude rows stamped in the current second: a row's updated_at only has second
    // precision, so a write landing after this SELECT but still within the same second
    // as `cursor` would advance past it unpushed once the cursor moves to today's max.
    // Deferring same-second rows to the next cycle keeps every row eventually pushed.
    const changed = db.prepare("SELECT * FROM cards WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')").all(cursor);
    if (changed.length > 0) {
      // upsertCardsInChunks sets the echo lock itself, per successful block --
      // so an echo of an already-pushed earlier block still gets skipped on the next pull even
      // when a later block fails and the cursor stays behind.
      await upsertCardsInChunks(c, changed);
      const maxTs = changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
      setSetting(db, 'sync_last_push', maxTs);
    }
  }

  async function pullCopies(c) {
    const cursor = getSetting(db, 'sync_copies_last_pull') || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('card_copies').select('*')
        .gt('updated_at', cursor).order('updated_at', { ascending: true }).order('copy_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull copies failed: ' + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => {
        for (const r of data) {
          if (recentlyPushedCopies.get(r.copy_id) === r.updated_at) { recentlyPushedCopies.delete(r.copy_id); continue; }
          applyRemoteCopy(db, r); applied++;
        }
      })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_copies_last_pull', lastTs);
    return applied;
  }

  async function pushCopies(c) {
    const cursor = getSetting(db, 'sync_copies_last_push') || '1970-01-01T00:00:00Z';
    const changed = db.prepare("SELECT * FROM card_copies WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')").all(cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from('card_copies')
        .upsert(changed.slice(i, i + 500).map(copyToRemote), { onConflict: 'copy_id' }).select('copy_id,updated_at');
      if (error) throw new Error('Push copies failed: ' + error.message);
      for (const r of (data || [])) recentlyPushedCopies.set(r.copy_id, r.updated_at);
    }
    setSetting(db, 'sync_copies_last_push', changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }

  async function pullContainers(c) {
    const cursor = getSetting(db, 'sync_containers_last_pull') || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('containers').select('*')
        .gt('updated_at', cursor).order('updated_at', { ascending: true }).order('container_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull containers failed: ' + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => { applied += applyPulledContainers(db, data); })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_containers_last_pull', lastTs);
    return applied;
  }

  async function pushContainers(c) {
    const cursor = getSetting(db, 'sync_containers_last_push') || '1970-01-01T00:00:00Z';
    const changed = db.prepare("SELECT * FROM containers WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')").all(cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from('containers')
        .upsert(changed.slice(i, i + 500).map(containerToRemote), { onConflict: 'container_id' }).select('container_id,updated_at');
      if (error) throw new Error('Push containers failed: ' + error.message);
      for (const r of (data || [])) recentlyPushedContainers.set(r.container_id, r.updated_at);
    }
    setSetting(db, 'sync_containers_last_push', changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }

  async function pullSealed(c) {
    const cursor = getSetting(db, 'sync_sealed_last_pull') || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('sealed_items').select('*')
        .gt('updated_at', cursor).order('updated_at', { ascending: true }).order('sealed_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull sealed failed: ' + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => { applied += applyPulledSealed(db, data); })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_sealed_last_pull', lastTs);
    return applied;
  }

  async function pushSealed(c) {
    const cursor = getSetting(db, 'sync_sealed_last_push') || '1970-01-01T00:00:00Z';
    const changed = sealedPushRows(db, cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from('sealed_items')
        .upsert(changed.slice(i, i + 500).map(sealedToRemote), { onConflict: 'sealed_id' }).select('sealed_id,updated_at');
      if (error) throw new Error('Push sealed failed: ' + error.message);
      for (const r of (data || [])) recentlyPushedSealed.set(r.sealed_id, r.updated_at);
    }
    setSetting(db, 'sync_sealed_last_push', changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }

  // Spec G3 §7.1: fehlt die Cloud-Tabelle sealed_items noch (SQL nicht eingespielt) oder scheitert der
  // Strom sonst, laufen Preishistorie, Tageswert und Preis-Alarme trotzdem. Die Cursor bleiben dann stehen.
  async function pullSealedSafe(c) {
    try { return await pullSealed(c); }
    catch (e) { console.error('[sync] sealed pull:', e.message); return 0; }
  }
  async function pushSealedSafe(c) {
    try { await pushSealed(c); }
    catch (e) { console.error('[sync] sealed push:', e.message); }
  }

  async function pullSalesTable(c, table) {
    const s = SALES_STREAMS[table];
    const cursor = getSetting(db, `${s.cursor}_last_pull`) || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      let q = c.from(table).select('*').gt('updated_at', cursor).order('updated_at', { ascending: true });
      for (const k of s.key) q = q.order(k, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`Pull ${table} failed: ` + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => { applied += applyPulledSalesRows(db, table, data); })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, `${s.cursor}_last_pull`, lastTs);
    return applied;
  }
  async function pushSalesTable(c, table) {
    const s = SALES_STREAMS[table];
    const cursor = getSetting(db, `${s.cursor}_last_push`) || '1970-01-01T00:00:00Z';
    const changed = salesPushRows(db, table, cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from(table)
        .upsert(changed.slice(i, i + 500).map((r) => salesRowToRemote(table, r)), { onConflict: s.key.join(',') })
        .select(`${s.key.join(',')},updated_at`);
      if (error) throw new Error(`Push ${table} failed: ` + error.message);
      for (const r of (data || [])) recentlyPushedSalesByTable[table].set(echoKey(table, r), r.updated_at);
    }
    setSetting(db, `${s.cursor}_last_push`, changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }
  // Spec H2 §4.3: fehlen die Cloud-Tabellen (SQL nicht eingespielt), laufen alle anderen Stroeme weiter.
  async function pullSalesSafe(c) {
    let n = 0;
    for (const t of ['sale_channels', 'sales', 'sale_items']) {
      try { n += await pullSalesTable(c, t); } catch (e) { console.error(`[sync] ${t} pull:`, e.message); }
    }
    return n;
  }
  async function pushSalesSafe(c) {
    for (const t of ['sale_channels', 'sales', 'sale_items']) {
      try { await pushSalesTable(c, t); } catch (e) { console.error(`[sync] ${t} push:`, e.message); }
    }
  }

  // Spec G1 §4.12 — the daily cloud Edge Function writes source='cloud' rows the desktop would
  // otherwise never see; pull them first (INSERT OR IGNORE via mergeRemotePriceHistory, so an
  // existing local row with the same key is left untouched), then push local rows as before.
  async function pullPriceHistory(c) {
    const cursor = getSetting(db, 'sync_price_history_last_pull') || '1970-01-01T00:00:00Z';
    const PAGE = 1000;
    let applied = 0;
    let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('price_history')
        .select('card_id,set_code,language,rarity,variant,day,price,source,recorded_at')
        .eq('source', 'cloud')
        .gt('recorded_at', cursor)
        .order('recorded_at', { ascending: true })
        .order('card_id', { ascending: true })
        .order('set_code', { ascending: true })
        .order('language', { ascending: true })
        .order('rarity', { ascending: true })
        .order('variant', { ascending: true })
        .order('day', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull price_history failed: ' + error.message);
      if (!data || data.length === 0) break;
      applied += mergeRemotePriceHistory(db, data);
      // recorded_at is the primary sort key, so the last row of the last page is the max. One Edge
      // Function run stamps many rows with the SAME recorded_at, so the cursor only advances once
      // every page has been drained -- never mid-run, or same-timestamp rows on a later page would
      // be skipped for good.
      lastTs = data[data.length - 1].recorded_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_price_history_last_pull', lastTs);
    return applied;
  }

  // Append-only from the desktop's side: local rows are pushed once and never updated/deleted.
  async function pushPriceHistory(c) {
    const cursor = getSetting(db, 'sync_price_history_last_push') || '1970-01-01T00:00:00Z';
    const rows = db.prepare("SELECT card_id, set_code, language, rarity, variant, day, price, source, recorded_at FROM price_history WHERE recorded_at > ? AND recorded_at < strftime('%Y-%m-%d %H:%M:%S','now')").all(cursor);
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await c.from('price_history')
        .upsert(rows.slice(i, i + 500).map(({ recorded_at, ...r }) => r), { onConflict: 'card_id,set_code,language,rarity,variant,day' });
      if (error) throw new Error('Push price_history failed: ' + error.message);
    }
    setSetting(db, 'sync_price_history_last_push', rows.reduce((m, r) => (r.recorded_at > m ? r.recorded_at : m), cursor));
  }

  // Additive: record today's collection value to Supabase so the phone's value chart fills
  // even when only the desktop runs. One row per user per day (merge-duplicates). Non-fatal.
  // Spec G3 §4.2: total_value = Karten + Sealed, sealed_value = Sealed-Anteil.
  async function syncSnapshot(c) {
    try {
      const t = portfolioTotals(db);
      await c.from('portfolio_snapshots')
        .upsert({ total_value: t.total, sealed_value: t.sealed, card_count: copyCount(db) }, { onConflict: 'user_id,day' });
    } catch (e) {
      // table may not be created yet, or a transient error — never break the sync cycle
    }
  }

  // Spec G2 §6.2: die Cloud wertet Preis-Alarme aus, der Desktop liest nur. Neue Treffer meldet
  // onPriceAlerts (Windows-Benachrichtigung in main.cjs); eine geaenderte Menge offener Treffer
  // (neu oder anderswo erledigt) bekommt der Renderer als price-alerts-changed. Nie fatal fuer den
  // Zyklus — die Tabelle kann noch fehlen.
  async function syncPriceAlerts(c) {
    try {
      const { data, error } = await c.from('price_alert_events').select('*')
        .eq('dismissed', false).order('id', { ascending: false }).limit(200);
      if (error) return;
      const events = data || [];
      const before = getSetting(db, 'price_alerts_notified_until');
      const r = nextNotification(events, before);
      // Marke vor dem Melden speichern: scheitert die Benachrichtigung, kommt sie nicht jede 20 s wieder.
      if (String(r.marker) !== before) setSetting(db, 'price_alerts_notified_until', r.marker);
      if (r.notify !== 'none' && onPriceAlerts) onPriceAlerts(r);
      const sig = openSignature(events);
      if (sig !== lastAlertSignature) {
        lastAlertSignature = sig;
        const w = getWindow();
        if (w) w.webContents.send('price-alerts-changed');
      }
    } catch (e) {
      console.error('[sync] price alerts:', e.message);
    }
  }

  async function cycle() {
    if (running) return;
    running = true;
    try {
      const c = await ensureClient();
      if (!c) { running = false; return; }
      emit('syncing');
      const pulled = await pull(c);
      // Containers before copies, both ways: a card_copies row can point at a container_id, and
      // there is deliberately NO foreign key enforcing that the container exists locally (see
      // containers-schema.cjs). This pull/push order is the only thing that keeps an incoming
      // copy from ever pointing at a container the desktop doesn't have yet. Do not reorder.
      const pulledContainers = await pullContainers(c);
      const pulledCopies = await pullCopies(c);
      // Spec G3 §7.1: Sealed als vierter Strom nach den Exemplaren, in beide Richtungen; nie fatal.
      const pulledSealed = await pullSealedSafe(c);
      const pulledSales = await pullSalesSafe(c);
      await push(c);
      await pushContainers(c);
      await pushCopies(c);
      await pushSealedSafe(c);
      await pushSalesSafe(c);
      await pullPriceHistory(c);
      await pushPriceHistory(c);
      await syncSnapshot(c);
      await syncPriceAlerts(c);
      const pulledCollection = pulled + pulledContainers + pulledCopies;
      if (pulledCollection > 0) { const w = getWindow(); if (w) w.webContents.send('collection-changed'); }
      // M1: gezogene Sealed-Aenderungen (Handy-Schreibvorgaenge, Cloud-Preislauf) sollen die Tageshistorie
      // sofort mitziehen, nicht erst mit der naechsten Preisaenderung ueber der Schwelle. Nie fatal.
      if (pulledSealed > 0) {
        const w = getWindow(); if (w) w.webContents.send('sealed-changed');
        try { recordPortfolioValue(db); } catch (e) { console.error('[sync] recordPortfolioValue:', e.message); }
      }
      if (pulledSales > 0) { const w = getWindow(); if (w) w.webContents.send('sales-changed'); }
      const totalPulled = pulledCollection + pulledSealed + pulledSales;
      emit('idle', totalPulled > 0 ? `pulled ${totalPulled}` : 'up to date');
    } catch (e) {
      // Only drop the session on auth/token failures; keep it through transient
      // network blips so we don't re-authenticate every cycle (rate-limit risk).
      if (/jwt|token|expired|invalid.*(api key|claim)|401|not authenticated/i.test(e.message || '')) {
        client = null;
      }
      emit('error', e.message);
    } finally {
      running = false;
    }
  }

  setInterval(cycle, 20000);
  setTimeout(cycle, 3000); // initial kick shortly after launch

  // Expose the authed client so other main-process features (deals) can use the same
  // signed-in Supabase session instead of a separate local store.
  return { ensureClient };
}

module.exports = {
  startSync, rowToRemote, remoteToLocalPatch, remoteToLocalFull, applyRemoteRow,
  copyToRemote, remoteToLocalCopy, applyRemoteCopy,
  containerToRemote, remoteToLocalContainer, applyRemoteContainer,
  sealedToRemote, remoteToLocalSealed, applyRemoteSealed,
  saleToRemote: (r) => salesRowToRemote('sales', r), remoteToLocalSale: (r) => remoteToLocalSalesRow('sales', r),
  itemToRemote: (r) => salesRowToRemote('sale_items', r), remoteToLocalItem: (r) => remoteToLocalSalesRow('sale_items', r),
  channelToRemote: (r) => salesRowToRemote('sale_channels', r), remoteToLocalChannel: (r) => remoteToLocalSalesRow('sale_channels', r),
  _applyPulledSales: (db, rows) => applyPulledSalesRows(db, 'sales', rows),
  _applyPulledItems: (db, rows) => applyPulledSalesRows(db, 'sale_items', rows),
  _applyPulledChannels: (db, rows) => applyPulledSalesRows(db, 'sale_channels', rows),
  _recentlyPushedSales: recentlyPushedSalesByTable.sales,
  _recentlyPushedItems: recentlyPushedSalesByTable.sale_items,
  _recentlyPushedChannels: recentlyPushedSalesByTable.sale_channels,
  _salesPushRows: salesPushRows,
  // Test-only hooks into the containers echo-lock (see test-sync.cjs): the module-level map and
  // apply function that pullContainers itself uses internally. Not called by production code
  // outside sync.cjs; calling startSync() just to reach them would also start its real timers.
  _recentlyPushedContainers: recentlyPushedContainers,
  _applyPulledContainers: applyPulledContainers,
  // Test-only hooks for the sealed stream (sealed-sync.test.cjs), same reasoning as the containers hooks.
  _recentlyPushedSealed: recentlyPushedSealed,
  _applyPulledSealed: applyPulledSealed,
  _sealedPushRows: sealedPushRows,
  // Test-only hook (sync-push-chunks.test.cjs): the chunked cards upsert that push() uses.
  _upsertCardsInChunks: upsertCardsInChunks,
  // Test-only hook (sync-push-chunks.test.cjs): the cards echo-lock map, to verify
  // upsertCardsInChunks populates it per successful block even when a later block fails.
  _recentlyPushed: recentlyPushed,
};
