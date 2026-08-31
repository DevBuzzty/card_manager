const { createClient } = require('@supabase/supabase-js');

// Columns mirrored to the cloud (desktop is authoritative for all of them).
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute', 'quantity',
  'rarity', 'price', 'deleted'];

// Local SQLite row -> remote upsert payload. `updated_at` is server-stamped, never sent.
function rowToRemote(row) {
  const out = {};
  for (const c of MIRROR_COLS) {
    if (c === 'deleted') out.deleted = !!row.deleted;
    else out[c] = row[c];
  }
  return out;
}

// Remote row -> the only fields the phone is allowed to have changed.
function remoteToLocalPatch(r) {
  return {
    id: String(r.id), set_code: r.set_code, language: r.language || 'DE',
    quantity: r.quantity, deleted: r.deleted ? 1 : 0,
  };
}

// Remote row -> full local INSERT payload (all mirrored columns), for a phone-created
// printing the desktop doesn't have yet.
function remoteToLocalFull(r) {
  return {
    id: String(r.id), set_code: r.set_code || 'Unknown', language: r.language || 'DE',
    name: r.name ?? null, type: r.type ?? null, desc: r.desc ?? null, image_url: r.image_url ?? null,
    atk: r.atk ?? null, def: r.def ?? null, level: r.level ?? null, race: r.race ?? null,
    attribute: r.attribute ?? null, quantity: r.quantity ?? 1, rarity: r.rarity ?? null,
    price: r.price ?? null, deleted: r.deleted ? 1 : 0,
  };
}

// Apply one pulled remote row: existing local row -> patch quantity+deleted (desktop stays
// authoritative for detail columns); missing local row -> insert the full row.
function applyRemoteRow(db, r) {
  const info = db.prepare(`UPDATE cards SET quantity = @quantity, deleted = @deleted
    WHERE id = @id AND set_code = @set_code AND language = @language`).run(remoteToLocalPatch(r));
  if (info.changes === 0) {
    db.prepare(`INSERT OR IGNORE INTO cards
      (id, set_code, language, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, price, deleted)
      VALUES (@id,@set_code,@language,@name,@type,@desc,@image_url,@atk,@def,@level,@race,@attribute,@quantity,@rarity,@price,@deleted)`)
      .run(remoteToLocalFull(r));
  }
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

function startSync(db, getWindow) {
  let client = null;
  let running = false;

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
    const { data, error } = await c.from('cards').select('*').gt('updated_at', cursor).order('updated_at');
    if (error) throw new Error('Pull failed: ' + error.message);
    if (!data || data.length === 0) return 0;
    let appliedCount = 0;
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
    // Advance past everything fetched (including skipped echoes) — rows are ordered
    // by updated_at ascending, so the cursor never jumps past a row we didn't see.
    setSetting(db, 'sync_last_pull', data[data.length - 1].updated_at);
    return appliedCount;
  }

  async function push(c) {
    const cursor = getSetting(db, 'sync_last_push') || '1970-01-01T00:00:00Z';
    const changed = db.prepare('SELECT * FROM cards WHERE updated_at > ?').all(cursor);
    if (changed.length > 0) {
      const { data, error } = await c.from('cards')
        .upsert(changed.map(rowToRemote), { onConflict: 'id,set_code,language' })
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

  // Additive: record today's collection value to Supabase so the phone's value chart fills
  // even when only the desktop runs. One row per user per day (merge-duplicates). Non-fatal.
  async function syncSnapshot(c) {
    try {
      const row = db.prepare(
        'SELECT COALESCE(SUM(price * quantity), 0) AS total, COALESCE(SUM(quantity), 0) AS cnt ' +
        'FROM cards WHERE deleted = 0'
      ).get();
      await c.from('portfolio_snapshots')
        .upsert({ total_value: row.total, card_count: row.cnt }, { onConflict: 'user_id,day' });
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
      await push(c);
      await syncSnapshot(c);
      if (pulled > 0) {
        const w = getWindow();
        if (w) w.webContents.send('collection-changed');
      }
      emit('idle', pulled > 0 ? `pulled ${pulled}` : 'up to date');
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
}

module.exports = { startSync, rowToRemote, remoteToLocalPatch, remoteToLocalFull, applyRemoteRow };
