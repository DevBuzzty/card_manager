const { createClient } = require('@supabase/supabase-js');
const { totalValue, copyCount } = require('./valuation.cjs');
const { CONTAINER_COLS } = require('./containers-schema.cjs');

// Columns mirrored to the cloud (desktop is authoritative for all of them).
// cm_product_id + price_locked let the cloud's daily Cardmarket refresh (Edge Function) price the
// phone's rows and skip manual prices (price_locked = 2) without the desktop being on.
// quantity is NOT mirrored any more: both sides derive it from card_copies via triggers.
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute',
  'rarity', 'price', 'deleted', 'cm_product_id', 'price_locked', 'price_first_ed'];

const COPY_COLS = ['copy_id', 'card_id', 'set_code', 'language', 'rarity', 'edition', 'condition', 'deleted',
  'container_id', 'page', 'slot', 'tags', 'note', 'needs_review', 'review_reason', 'for_sale'];
const COPY_BOOLS = new Set(['deleted', 'needs_review', 'for_sale']);

// CONTAINER_COLS (from containers-schema.cjs) is the full local column set, used as-is for
// applying pulled rows. The push payload drops updated_at (Supabase stamps that column
// server-side, like user_id via auth.uid(), so sending our local value would be pointless) and
// created_at (same reasoning as the other two streams, neither of which mirrors it: the local
// value is a naive-UTC SQLite string, the cloud column is timestamptz, and interpreting a
// timezone-less string server-side risks shifting it — the column already defaults to now()).
const CONTAINER_BOOLS = new Set(['deleted']);
const CONTAINER_PUSH_COLS = CONTAINER_COLS.filter(c => c !== 'updated_at' && c !== 'created_at');

// Local SQLite row -> remote upsert payload. `updated_at` is server-stamped, never sent.
function rowToRemote(row) {
  const out = {};
  for (const c of MIRROR_COLS) {
    if (c === 'deleted') out.deleted = !!row.deleted;
    else if (c === 'price_locked') out.price_locked = Number(row.price_locked) || 0; // cloud column is smallint 0/1/2
    else if (c === 'cm_product_id') out.cm_product_id = row.cm_product_id ?? null;
    else if (c === 'price_first_ed') out.price_first_ed = row.price_first_ed ?? null;
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
      (id, set_code, language, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, price, deleted, cm_product_id, price_locked, price_first_ed)
      VALUES (@id,@set_code,@language,@name,@type,@desc,@image_url,@atk,@def,@level,@race,@attribute,@quantity,@rarity,@price,@deleted,@cm_product_id,@price_locked,@price_first_ed)`)
      .run(remoteToLocalFull(r));
    return;
  }
  db.prepare(`UPDATE cards SET deleted = @deleted
    WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted IS NOT @deleted`).run(p);
}

// Upsert one pulled copy; only writes when something differs so the local updated_at trigger
// (and therefore the next push) fires only for real changes.
function applyRemoteCopy(db, r) {
  const l = remoteToLocalCopy(r);
  const cur = db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(l.copy_id);
  if (!cur) {
    db.prepare(`INSERT INTO card_copies (${COPY_COLS.join(',')}) VALUES (${COPY_COLS.map(c => '@' + c).join(',')})`).run(l);
    return;
  }
  const changed = COPY_COLS.some(c => c !== 'copy_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  const sets = COPY_COLS.filter(c => c !== 'copy_id').map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE card_copies SET ${sets} WHERE copy_id = @copy_id`).run(l);
}

function containerToRemote(row) {
  const out = {};
  for (const c of CONTAINER_PUSH_COLS) out[c] = CONTAINER_BOOLS.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalContainer(r) {
  const out = {};
  for (const c of CONTAINER_COLS) out[c] = CONTAINER_BOOLS.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  out.container_id = String(r.container_id);
  out.name = out.name || 'Ohne Namen';
  out.kind = out.kind || 'box';
  out.sort_order = out.sort_order ?? 0;
  return out;
}
function applyRemoteContainer(db, r) {
  const l = remoteToLocalContainer(r);
  const cur = db.prepare('SELECT * FROM containers WHERE container_id = ?').get(l.container_id);
  if (!cur) {
    db.prepare(`INSERT INTO containers (${CONTAINER_COLS.join(',')})
                VALUES (${CONTAINER_COLS.map(c => '@' + c).join(',')})`).run(l);
    return;
  }
  const changed = CONTAINER_COLS.some(c => c !== 'container_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  const sets = CONTAINER_COLS.filter(c => c !== 'container_id').map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE containers SET ${sets} WHERE container_id = @container_id`).run(l);
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

function startSync(db, getWindow) {
  let client = null;
  let running = false;

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
      const { data, error } = await c.from('cards')
        .upsert(changed.map(rowToRemote), { onConflict: 'id,set_code,language,rarity' })
        .select('id,set_code,language,updated_at');
      if (error) throw new Error('Push failed: ' + error.message);
      const maxTs = changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
      setSetting(db, 'sync_last_push', maxTs);
      // Remember the cloud updated_at the trigger stamped on each row we just pushed,
      // so the next pull can recognize its own echo and skip re-applying it.
      for (const r of (data || [])) {
        recentlyPushed.set(`${r.id}|${r.set_code}|${r.language}`, r.updated_at);
      }
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

  // Append-only: the desktop pushes price history, never pulls it (phone charts read the cloud table).
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
  async function syncSnapshot(c) {
    try {
      await c.from('portfolio_snapshots')
        .upsert({ total_value: totalValue(db), card_count: copyCount(db) }, { onConflict: 'user_id,day' });
    } catch (e) {
      // table may not be created yet, or a transient error — never break the sync cycle
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
      await push(c);
      await pushContainers(c);
      await pushCopies(c);
      await pushPriceHistory(c);
      await syncSnapshot(c);
      const totalPulled = pulled + pulledContainers + pulledCopies;
      if (totalPulled > 0) { const w = getWindow(); if (w) w.webContents.send('collection-changed'); }
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
  // Test-only hooks into the containers echo-lock (see test-sync.cjs): the module-level map and
  // apply function that pullContainers itself uses internally. Not called by production code
  // outside sync.cjs; calling startSync() just to reach them would also start its real timers.
  _recentlyPushedContainers: recentlyPushedContainers,
  _applyPulledContainers: applyPulledContainers,
};
