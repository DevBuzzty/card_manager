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

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value')
    .run({ key, value: String(value) });
}

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
    const apply = db.prepare(`UPDATE cards SET quantity = @quantity, deleted = @deleted
      WHERE id = @id AND set_code = @set_code AND language = @language`);
    db.transaction(() => {
      for (const r of data) apply.run(remoteToLocalPatch(r));
    })();
    setSetting(db, 'sync_last_pull', data[data.length - 1].updated_at);
    return data.length;
  }

  async function push(c) {
    const cursor = getSetting(db, 'sync_last_push') || '1970-01-01T00:00:00Z';
    const changed = db.prepare('SELECT * FROM cards WHERE updated_at > ?').all(cursor);
    if (changed.length > 0) {
      const { error } = await c.from('cards').upsert(changed.map(rowToRemote), { onConflict: 'id,set_code,language' });
      if (error) throw new Error('Push failed: ' + error.message);
      const maxTs = changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
      setSetting(db, 'sync_last_push', maxTs);
    }
    // Mirror hard-deletes (consolidation tools bypass soft-delete): any cloud row
    // absent locally gets tombstoned so the phone stops showing it.
    const localKeys = new Set(db.prepare('SELECT id, set_code, language FROM cards').all()
      .map(r => `${r.id}|${r.set_code}|${r.language}`));
    const { data: remoteKeys, error: rkErr } = await c.from('cards')
      .select('id, set_code, language').eq('deleted', false);
    if (rkErr) throw new Error('Mirror check failed: ' + rkErr.message);
    for (const rk of (remoteKeys || [])) {
      if (!localKeys.has(`${rk.id}|${rk.set_code}|${rk.language}`)) {
        await c.from('cards').update({ deleted: true })
          .eq('id', rk.id).eq('set_code', rk.set_code).eq('language', rk.language);
      }
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

module.exports = { startSync, rowToRemote, remoteToLocalPatch };
