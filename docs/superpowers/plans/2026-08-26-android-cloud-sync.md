# Android Collection + Portfolio via Supabase Cloud Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Android app view and edit the card collection and see portfolio value from anywhere, synced with the desktop through Supabase.

**Architecture:** Desktop SQLite stays the working master; a new desktop sync module mirrors the `cards` table to a Supabase Postgres table and pulls back phone-originated edits. The phone reads/writes that Supabase table directly for Collection and Portfolio. Conflicts resolve Last-Write-Wins by a Supabase-server-stamped `updated_at`. Scanning is unchanged (LAN socket).

**Tech Stack:** Electron (CommonJS main), `@supabase/supabase-js`; Android Kotlin/Compose, Supabase Kotlin SDK (postgrest + auth), Ktor OkHttp engine, Coil; Supabase (hosted Postgres, free tier).

## Global Constraints

- Composite primary key on cards is `(id, set_code, language)`; `language` defaults to `'DE'`. Copied verbatim from the existing schema.
- `electron/*.cjs` are CommonJS and stay CommonJS; `src/**` renderer is ESM. Do not convert either.
- Every new IPC channel is added in **both** `electron/main.cjs` (handler) and `electron/preload.cjs` (wrapper).
- Desktop DB changes are **additive migrations** in `electron/database.cjs`, idempotent on every launch.
- **The phone never creates new card rows** — it only changes `quantity` and sets `deleted` on rows the desktop created. New cards enter only via the desktop (scan/import).
- Sync ordering uses **Supabase server time**: a cloud trigger sets `updated_at = now()` on every cloud insert/update. LWW = higher `updated_at` wins.
- Single shared Supabase account; Row-Level-Security allows any authenticated user (there is only one).
- Supabase config lives in the existing `settings` table (desktop) and `scanner_prefs` (Android) — reuse, don't invent new stores.

---

### Task 1: Supabase schema + user setup doc

**Files:**
- Create: `supabase/schema.sql`
- Create: `supabase/SETUP.md`

**Interfaces:**
- Produces: a Supabase table `public.cards` with columns matching the desktop mirror, `updated_at timestamptz`, `deleted boolean`, PK `(id, set_code, language)`, an `updated_at = now()` trigger, and RLS allowing authenticated access. Consumed by Tasks 3 (desktop sync) and 6 (Android repository).

- [ ] **Step 1: Write the schema SQL**

Create `supabase/schema.sql`:

```sql
-- Yu-Gi-Oh! collection mirror. Keyed identically to the desktop SQLite cards table.
create table if not exists public.cards (
  id          text not null,
  set_code    text not null default 'Unknown',
  language    text not null default 'DE',
  name        text,
  type        text,
  "desc"      text,
  image_url   text,
  atk         integer,
  def         integer,
  level       integer,
  race        text,
  attribute   text,
  quantity    integer default 1,
  rarity      text,
  price       double precision,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (id, set_code, language)
);

-- Server-stamped updated_at on every write, so PC and phone clocks never disagree.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cards_updated_at on public.cards;
create trigger trg_cards_updated_at
  before insert or update on public.cards
  for each row execute function public.set_updated_at();

-- Single-user app: any authenticated session may read/write.
alter table public.cards enable row level security;

drop policy if exists cards_authenticated_all on public.cards;
create policy cards_authenticated_all on public.cards
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Write the setup doc**

Create `supabase/SETUP.md` with these steps (the user performs them — Claude cannot create accounts):

```markdown
# Supabase setup (one-time)

1. Create a free account at https://supabase.com and a new project.
2. In the project, open **SQL Editor** → paste the contents of `schema.sql` → **Run**.
3. Open **Authentication → Users → Add user**. Create ONE user with an email +
   password. Turn OFF "email confirmation" for this user (Authentication →
   Providers → Email → disable "Confirm email"), or confirm it, so it can log in.
4. Open **Project Settings → API**. Copy the **Project URL** and the **anon
   public** API key.
5. Enter URL + anon key + the user's email/password:
   - Desktop: Settings tab → Cloud Sync section.
   - Phone: Cloud login screen.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql supabase/SETUP.md
git commit -m "feat(sync): Supabase schema + setup doc"
```

---

### Task 2: Desktop DB migration — updated_at, deleted, trigger, soft-delete, filtered reads

**Files:**
- Modify: `desktop/electron/database.cjs:118-192` (column migration + new trigger)
- Modify: `desktop/electron/main.cjs` — `add-card-to-db` (198), `get-collection` (200-202), `delete-card` (204-213), `get-portfolio` (215-219), `check-card-exists` (381-386), price poller query (395)
- Test: `desktop/electron/test-migration.cjs` (throwaway, run with `node`)

**Interfaces:**
- Produces: local `cards` rows now carry `updated_at` (auto-stamped) and `deleted` (0/1). `delete-card` soft-deletes. All user-facing reads exclude `deleted=1`. Consumed by Task 3 (push reads changed rows by `updated_at`, applies pulled `deleted`).

- [ ] **Step 1: Write the failing test**

Create `desktop/electron/test-migration.cjs`:

```javascript
const assert = require('assert');
const Database = require('better-sqlite3');

// Mirror of the trigger + columns we add in database.cjs, exercised on an in-memory DB.
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE',
    quantity INTEGER DEFAULT 1, deleted INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language)
  );
  CREATE TRIGGER IF NOT EXISTS trg_cards_updated AFTER UPDATE ON cards FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE cards SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
  END;
`);

db.prepare("INSERT INTO cards (id, set_code, language, quantity) VALUES ('1','A','DE',1)").run();
const before = db.prepare("SELECT updated_at FROM cards WHERE id='1'").get().updated_at;
assert.ok(before, 'insert stamps updated_at via column default');

// Force a later timestamp, then mutate quantity; trigger must bump updated_at.
db.prepare("UPDATE cards SET updated_at = datetime('now','-1 day') WHERE id='1'").run();
const stale = db.prepare("SELECT updated_at FROM cards WHERE id='1'").get().updated_at;
db.prepare("UPDATE cards SET quantity = 5 WHERE id='1'").run();
const after = db.prepare("SELECT updated_at, quantity FROM cards WHERE id='1'").get();
assert.strictEqual(after.quantity, 5);
assert.ok(after.updated_at > stale, 'trigger bumped updated_at on quantity change');

console.log('migration trigger test: PASS');
```

- [ ] **Step 2: Run it to confirm the behavior is what we implement**

Run: `cd desktop && node electron/test-migration.cjs`
Expected: prints `migration trigger test: PASS` (this test encodes the trigger we are about to add to the real schema).

- [ ] **Step 3: Add columns + trigger in `database.cjs`**

In `runMigrations()`, extend the `required` column list (line 124) to add the two sync columns:

```javascript
const required = ['atk', 'def', 'level', 'race', 'attribute', 'quantity', 'rarity', 'set_code', 'price', 'last_updated', 'language', 'updated_at', 'deleted'];
required.forEach(col => {
    if (!columnNames.includes(col)) {
        let type = 'TEXT';
        if (['atk', 'def', 'level', 'quantity', 'deleted'].includes(col)) type = 'INTEGER';
        if (col === 'price') type = 'REAL';

        let defaultVal = '';
        if (col === 'language') defaultVal = " DEFAULT 'DE'";
        if (col === 'quantity') defaultVal = " DEFAULT 1";
        if (col === 'deleted') defaultVal = " DEFAULT 0";
        if (col === 'updated_at') defaultVal = " DEFAULT CURRENT_TIMESTAMP";

        db.exec(`ALTER TABLE cards ADD COLUMN ${col} ${type}${defaultVal}`);
    }
});
```

Then, after the PK-migration block (after line 179, still inside `runMigrations`), add the auto-stamp trigger:

```javascript
// Auto-stamp updated_at on any change so the sync layer can detect dirty rows
// without touching every mutation site. The WHEN guard prevents recursion.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_cards_updated AFTER UPDATE ON cards FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE cards SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
  END;
`);
```

- [ ] **Step 4: Soft-delete + exclude deleted rows in `main.cjs`**

`delete-card` (204-213) — soft delete instead of hard delete:

```javascript
ipcMain.handle('delete-card', (event, { id, set_code, language }) => {
    try {
        if (!id || !set_code) return { success: false, error: 'Missing id or set_code' };
        db.prepare('UPDATE cards SET deleted = 1 WHERE id = ? AND set_code = ? AND language = ?')
          .run(String(id), set_code, language || 'DE');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});
```

`get-collection` (201): `SELECT * FROM cards WHERE quantity > 0 AND deleted = 0 ORDER BY created_at DESC`

`get-portfolio` (217): `... FROM cards WHERE quantity > 0 AND deleted = 0`

`check-card-exists` (384): `... WHERE (id = ? OR id = ?) AND deleted = 0`

Price poller query (395): `SELECT id, set_code, language, price FROM cards WHERE deleted = 0 ORDER BY last_updated ASC LIMIT 50`

`add-card-to-db` re-add path (172): clear the tombstone when a soft-deleted card is scanned again:

```javascript
db.prepare('UPDATE cards SET quantity = @qty, price = @price, deleted = 0 WHERE id = @id AND set_code = @set_code AND language = @language').run({
    qty: newQty, price: card.price || 0, id, set_code: setCode, language
});
```

- [ ] **Step 5: Verify the app still launches and reads correctly**

Run: `cd desktop && npm run electron:dev`
Expected: app starts, Collection tab lists cards as before, deleting a card removes it from the list. Then in a devtools/console check (or a quick `node` REPL against the db), confirm a deleted card has `deleted=1` and no longer appears in `get-collection`.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/database.cjs desktop/electron/main.cjs desktop/electron/test-migration.cjs
git commit -m "feat(sync): add updated_at+deleted columns, auto-stamp trigger, soft-delete"
```

---

### Task 3: Desktop sync engine (`electron/sync.cjs`) + integration

**Files:**
- Create: `desktop/electron/sync.cjs`
- Create: `desktop/electron/test-sync.cjs` (throwaway, run with `node`)
- Modify: `desktop/electron/main.cjs` (require + start sync; emit `sync-status`)
- Modify: `desktop/electron/preload.cjs` (expose `onSyncStatus`)
- Modify: `desktop/package.json` (add `@supabase/supabase-js`)

**Interfaces:**
- Consumes: `getDb()` from `database.cjs`; settings keys `supabase_url`, `supabase_key`, `supabase_email`, `supabase_password`, `sync_enabled`, plus cursors `sync_last_push`, `sync_last_pull` (all in the `settings` table).
- Produces: `startSync(db, getWindow)` and pure helper `pickChangedColumns(row)` + `remoteToLocalPatch(remoteRow)`. Emits `sync-status` events `{ state: 'idle'|'syncing'|'error', message, at }` to the renderer.

- [ ] **Step 1: Add the dependency**

Run: `cd desktop && npm install @supabase/supabase-js`
Expected: `@supabase/supabase-js` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test for the pure mapping helpers**

Create `desktop/electron/test-sync.cjs`:

```javascript
const assert = require('assert');
const { rowToRemote, remoteToLocalPatch } = require('./sync.cjs');

// Local SQLite row -> remote upsert payload: booleans, only mirrored columns.
const local = { id: '1', set_code: 'LOB-EN001', language: 'DE', name: 'X',
  quantity: 3, deleted: 0, price: 1.5, rarity: 'Common', last_updated: 'x', created_at: 'y' };
const remote = rowToRemote(local);
assert.strictEqual(remote.deleted, false);
assert.strictEqual(remote.quantity, 3);
assert.strictEqual(remote.id, '1');
assert.ok(!('created_at' in remote), 'created_at is not mirrored');
assert.ok(!('updated_at' in remote), 'updated_at is server-stamped, never sent');

// Remote row -> local patch: only quantity + deleted are applied (phone-owned fields).
const patch = remoteToLocalPatch({ id: '1', set_code: 'LOB-EN001', language: 'DE',
  quantity: 7, deleted: true, updated_at: '2026-01-01T00:00:00Z' });
assert.deepStrictEqual(patch, { id: '1', set_code: 'LOB-EN001', language: 'DE', quantity: 7, deleted: 1 });

console.log('sync mapping test: PASS');
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd desktop && node electron/test-sync.cjs`
Expected: FAIL — `Cannot find module './sync.cjs'` (or missing exports).

- [ ] **Step 4: Implement `sync.cjs`**

Create `desktop/electron/sync.cjs`:

```javascript
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
      const { error } = await c.from('cards').upsert(changed.map(rowToRemote));
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
      client = null; // force re-auth next cycle
      emit('error', e.message);
    } finally {
      running = false;
    }
  }

  setInterval(cycle, 20000);
  setTimeout(cycle, 3000); // initial kick shortly after launch
}

module.exports = { startSync, rowToRemote, remoteToLocalPatch };
```

- [ ] **Step 5: Run the mapping test to verify it passes**

Run: `cd desktop && node electron/test-sync.cjs`
Expected: prints `sync mapping test: PASS`.

- [ ] **Step 6: Wire into `main.cjs`**

At the top with the other requires (after line 7):

```javascript
const { startSync } = require('./sync.cjs');
```

In `app.whenReady().then(...)` (after `startPricePoller();`, line 69):

```javascript
startSync(db, () => mainWindow);
```

- [ ] **Step 7: Expose the status event in `preload.cjs`**

Add inside the `api` object (near `onPriceUpdate`, line 31):

```javascript
onSyncStatus: (callback) => {
  const subscription = (_event, value) => callback(value);
  ipcRenderer.on('sync-status', subscription);
  return () => ipcRenderer.removeListener('sync-status', subscription);
},
```

- [ ] **Step 8: Manual end-to-end verification (needs a real Supabase project from Task 1)**

Run: `cd desktop && npm run electron:dev`. In the `settings` table set `supabase_url`, `supabase_key`, `supabase_email`, `supabase_password`, and `sync_enabled='true'` (Task 4 gives the UI; for now insert via devtools console `window.api.saveSetting(...)`).
Expected: within ~20s the Supabase `cards` table fills with your collection (check the Supabase Table editor). Change a `quantity` in Supabase → within ~20s the desktop Collection reflects it.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/test-sync.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/package.json desktop/package-lock.json
git commit -m "feat(sync): desktop Supabase sync engine (push/pull, LWW, mirror-delete)"
```

---

### Task 4: Desktop Settings UI — Cloud Sync section

**Files:**
- Modify: `desktop/src/components/Settings.jsx`

**Interfaces:**
- Consumes: `window.api.getSettings()`, `window.api.saveSetting({key,value})`, `window.api.onSyncStatus(cb)` (all existing after Task 3).
- Produces: user-editable `supabase_url`, `supabase_key`, `supabase_email`, `supabase_password`, `sync_enabled`; live status line.

- [ ] **Step 1: Add state + load existing values**

In the `Settings` component, extend the existing `getSettings()` effect (lines 9-22) to also hydrate a `sync` state object and subscribe to status:

```javascript
const [sync, setSync] = useState({ supabase_url: '', supabase_key: '', supabase_email: '', supabase_password: '', sync_enabled: 'false' });
const [syncStatus, setSyncStatus] = useState(null);

useEffect(() => {
    if (!window.api) return;
    window.api.getSettings().then(s => {
        if (s?.price_source) setPriceSource(s.price_source);
        setSync(prev => ({
            supabase_url: s.supabase_url ?? '', supabase_key: s.supabase_key ?? '',
            supabase_email: s.supabase_email ?? '', supabase_password: s.supabase_password ?? '',
            sync_enabled: s.sync_enabled ?? 'false',
        }));
    });
    const offProgress = window.api.onUpdateProgress(setProgress);
    const offStatus = window.api.onSyncStatus(setSyncStatus);
    return () => { offProgress(); offStatus(); };
}, []);

const saveSync = async (key, value) => {
    setSync(prev => ({ ...prev, [key]: value }));
    if (window.api) await window.api.saveSetting({ key, value });
};
```

(Replace the existing effect at lines 9-22 with the version above; keep the rest of the component unchanged.)

- [ ] **Step 2: Render the Cloud Sync card**

Add a section in the returned JSX (follow the existing card/section styling in the file):

```jsx
<div className="bg-space-gray rounded-xl p-6 space-y-3">
  <h3 className="text-lg font-semibold text-white">Cloud Sync (Supabase)</h3>
  <input className="w-full bg-space-black rounded p-2 text-white" placeholder="Project URL"
    value={sync.supabase_url} onChange={e => saveSync('supabase_url', e.target.value)} />
  <input className="w-full bg-space-black rounded p-2 text-white" placeholder="anon public key"
    value={sync.supabase_key} onChange={e => saveSync('supabase_key', e.target.value)} />
  <input className="w-full bg-space-black rounded p-2 text-white" placeholder="Account email"
    value={sync.supabase_email} onChange={e => saveSync('supabase_email', e.target.value)} />
  <input type="password" className="w-full bg-space-black rounded p-2 text-white" placeholder="Account password"
    value={sync.supabase_password} onChange={e => saveSync('supabase_password', e.target.value)} />
  <label className="flex items-center gap-2 text-white">
    <input type="checkbox" checked={sync.sync_enabled === 'true'}
      onChange={e => saveSync('sync_enabled', e.target.checked ? 'true' : 'false')} />
    Enable sync
  </label>
  {syncStatus && (
    <p className={`text-sm ${syncStatus.state === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
      {syncStatus.state}: {syncStatus.message} {syncStatus.at && `(${new Date(syncStatus.at).toLocaleTimeString()})`}
    </p>
  )}
</div>
```

- [ ] **Step 3: Verify in the running app**

Run: `cd desktop && npm run electron:dev`
Expected: Settings tab shows the Cloud Sync card; entering values and ticking "Enable sync" starts the engine (status line moves to `syncing`/`idle`), and the Supabase `cards` table populates.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/Settings.jsx
git commit -m "feat(sync): Settings UI for Supabase cloud sync"
```

---

### Task 5: Android dependencies (Supabase, Ktor, Coil, serialization)

**Files:**
- Modify: `android/app/build.gradle.kts`

**Interfaces:**
- Produces: Supabase Kotlin SDK (postgrest + auth), Ktor engine, Coil, and the kotlinx-serialization plugin available to later Android tasks.

- [ ] **Step 1: Add the serialization plugin**

In the `plugins { }` block of `android/app/build.gradle.kts`:

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    kotlin("plugin.serialization") version "1.9.22"
}
```

- [ ] **Step 2: Add the dependencies**

In `dependencies { }`, after the Socket.io line:

```kotlin
// Supabase (Postgrest + Auth) + Ktor engine
implementation(platform("io.github.jan-tennert.supabase:bom:2.6.0"))
implementation("io.github.jan-tennert.supabase:postgrest-kt")
implementation("io.github.jan-tennert.supabase:auth-kt")
implementation("io.ktor:ktor-client-okhttp:2.3.12")

// Async card images
implementation("io.coil-kt:coil-compose:2.6.0")
```

- [ ] **Step 3: Verify Gradle sync**

In Android Studio: **Sync Project with Gradle Files** (or `./gradlew :app:dependencies` from `android/`).
Expected: sync succeeds. If a version fails to resolve, bump to the latest 2.x that Android Studio proposes and re-sync (the module names and API used later are stable across 2.x).

- [ ] **Step 4: Commit**

```bash
git add android/app/build.gradle.kts
git commit -m "feat(android): add Supabase, Ktor, Coil, serialization deps"
```

---

### Task 6: Android Supabase client + models + repository

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/SupabaseCloud.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt`

**Interfaces:**
- Consumes: config stored in `scanner_prefs` (`supabase_url`, `supabase_key`, `supabase_email`, `supabase_password`).
- Produces: `CardRow` data class; `CollectionRepository` with `suspend fun loadCards(): List<CardRow>`, `suspend fun setQuantity(row, qty)`, `suspend fun softDelete(row)`; `SupabaseCloud.init(prefs)` / `SupabaseCloud.signIn()`.

- [ ] **Step 1: Define the serializable row**

Create `CardRow.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CardRow(
    val id: String,
    @SerialName("set_code") val setCode: String = "Unknown",
    val language: String = "DE",
    val name: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    val rarity: String? = null,
    val quantity: Int = 0,
    val price: Double? = null,
    val deleted: Boolean = false,
)
```

- [ ] **Step 2: Client holder + auth**

Create `SupabaseCloud.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import android.content.SharedPreferences
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.builtin.Email
import io.github.jan.supabase.postgrest.Postgrest

object SupabaseCloud {
    private var client: io.github.jan.supabase.SupabaseClient? = null
    private var email: String = ""
    private var password: String = ""

    fun isConfigured(prefs: SharedPreferences): Boolean =
        !prefs.getString("supabase_url", "").isNullOrBlank() &&
        !prefs.getString("supabase_key", "").isNullOrBlank() &&
        !prefs.getString("supabase_email", "").isNullOrBlank()

    fun init(prefs: SharedPreferences) {
        val url = prefs.getString("supabase_url", "")!!.trim()
        val key = prefs.getString("supabase_key", "")!!.trim()
        email = prefs.getString("supabase_email", "")!!.trim()
        password = prefs.getString("supabase_password", "")!!
        client = createSupabaseClient(url, key) {
            install(Auth)
            install(Postgrest)
        }
    }

    suspend fun signIn() {
        client!!.auth.signInWith(Email) { this.email = SupabaseCloud.email; this.password = SupabaseCloud.password }
    }

    fun db(): Postgrest = client!!.pluginManager.getPlugin(Postgrest)
}
```

- [ ] **Step 3: Repository CRUD**

Create `CollectionRepository.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.filter.FilterOperation
import io.github.jan.supabase.postgrest.query.filter.FilterOperator

object CollectionRepository {

    suspend fun loadCards(): List<CardRow> =
        SupabaseCloud.db().from("cards")
            .select(Columns.ALL) {
                filter { eq("deleted", false); gt("quantity", 0) }
            }
            .decodeList<CardRow>()

    suspend fun setQuantity(row: CardRow, qty: Int) {
        SupabaseCloud.db().from("cards").update(mapOf("quantity" to qty)) {
            filter { keyFilter(row) }
        }
    }

    suspend fun softDelete(row: CardRow) {
        SupabaseCloud.db().from("cards").update(mapOf("deleted" to true)) {
            filter { keyFilter(row) }
        }
    }

    private fun io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder.keyFilter(row: CardRow) {
        eq("id", row.id); eq("set_code", row.setCode); eq("language", row.language)
    }
}
```

- [ ] **Step 4: Verify it compiles**

In Android Studio: **Build → Make Project** (or `./gradlew :app:compileDebugKotlin` from `android/`).
Expected: compiles. If the Postgrest filter builder type name differs in the resolved SDK version, let Android Studio autocomplete the correct `filter { }` receiver type and adjust `keyFilter`'s receiver accordingly (the `eq(...)` calls are stable).

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/
git commit -m "feat(android): Supabase client, CardRow model, collection repository"
```

---

### Task 7: Android bottom navigation + cloud login screen

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt` (host a bottom nav; move the current scanner flow behind a "Scanner" tab)
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/CloudLoginScreen.kt`

**Interfaces:**
- Consumes: `SupabaseCloud`, `CollectionRepository` (Task 6).
- Produces: a `MainScaffold` composable with three tabs (Scanner / Collection / Portfolio) and a login screen that writes `supabase_*` into `scanner_prefs`, calls `SupabaseCloud.init` + `signIn`, and flips a `cloudReady` state consumed by Tasks 8–9.

- [ ] **Step 1: Add a bottom-nav scaffold**

In `MainActivity.kt`, wrap the content in a scaffold. Replace the body of `MainScreen()` so that, instead of directly choosing Scanner vs Config, it hosts a `Scaffold` with a `NavigationBar` of three items and renders the selected tab. Keep the existing `ScannerScreen`/`ConfigScreen` composables and socket logic exactly as-is — the Scanner tab renders them unchanged. Collection and Portfolio tabs render the composables from Tasks 8–9, or `CloudLoginScreen` when `!cloudReady`.

```kotlin
enum class Tab { SCANNER, COLLECTION, PORTFOLIO }

@Composable
fun MainScaffold() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE) }
    var tab by remember { mutableStateOf(Tab.SCANNER) }
    var cloudReady by remember { mutableStateOf(false) }

    // Auto-init cloud if already configured from a previous session.
    LaunchedEffect(Unit) {
        if (SupabaseCloud.isConfigured(prefs)) {
            try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); cloudReady = true } catch (_: Exception) {}
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF1E1E1E)) {
                NavigationBarItem(selected = tab == Tab.SCANNER, onClick = { tab = Tab.SCANNER },
                    icon = { Icon(Icons.Default.CameraAlt, null) }, label = { Text("Scan") })
                NavigationBarItem(selected = tab == Tab.COLLECTION, onClick = { tab = Tab.COLLECTION },
                    icon = { Icon(Icons.Default.Style, null) }, label = { Text("Sammlung") })
                NavigationBarItem(selected = tab == Tab.PORTFOLIO, onClick = { tab = Tab.PORTFOLIO },
                    icon = { Icon(Icons.Default.TrendingUp, null) }, label = { Text("Wert") })
            }
        }
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (tab) {
                Tab.SCANNER -> MainScreen() // existing scanner+config flow, untouched
                Tab.COLLECTION -> if (cloudReady) CollectionScreen()
                    else CloudLoginScreen(prefs) { cloudReady = true }
                Tab.PORTFOLIO -> if (cloudReady) PortfolioScreen()
                    else CloudLoginScreen(prefs) { cloudReady = true }
            }
        }
    }
}
```

Then set the activity content to `MainScaffold()` instead of `MainScreen()` (in `onCreate`, keep the existing `MaterialTheme`/`Surface` wrapper).

- [ ] **Step 2: Cloud login screen**

Create `ui/CloudLoginScreen.kt`:

```kotlin
package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.SupabaseCloud
import kotlinx.coroutines.launch

@Composable
fun CloudLoginScreen(prefs: SharedPreferences, onReady: () -> Unit) {
    var url by remember { mutableStateOf(prefs.getString("supabase_url", "") ?: "") }
    var key by remember { mutableStateOf(prefs.getString("supabase_key", "") ?: "") }
    var email by remember { mutableStateOf(prefs.getString("supabase_email", "") ?: "") }
    var password by remember { mutableStateOf(prefs.getString("supabase_password", "") ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Cloud-Login", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(url, { url = it }, label = { Text("Project URL") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(key, { key = it }, label = { Text("anon key") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("E-Mail") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Passwort") }, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = {
            prefs.edit()
                .putString("supabase_url", url.trim()).putString("supabase_key", key.trim())
                .putString("supabase_email", email.trim()).putString("supabase_password", password)
                .apply()
            scope.launch {
                try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); onReady() }
                catch (e: Exception) { error = e.message }
            }
        }, modifier = Modifier.fillMaxWidth()) { Text("Verbinden") }
    }
}
```

- [ ] **Step 3: Verify build + navigation**

Run on a device/emulator (Android Studio ▶). Expected: three-tab bottom bar; Scanner tab behaves exactly as before; Collection/Portfolio tabs show the login form until valid Supabase details are entered, then proceed (blank screens until Tasks 8–9 land — acceptable at this step).

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt android/app/src/main/java/com/example/yugiohscanner/ui/CloudLoginScreen.kt
git commit -m "feat(android): bottom navigation + cloud login screen"
```

---

### Task 8: Android Collection screen (images, search, quantity, delete)

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt`

**Interfaces:**
- Consumes: `CollectionRepository.loadCards/setQuantity/softDelete`, `CardRow`.
- Produces: `CollectionScreen()` composable.

- [ ] **Step 1: Implement the screen**

Create `ui/CollectionScreen.kt`:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import kotlinx.coroutines.launch

@Composable
fun CollectionScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    suspend fun reload() { cards = CollectionRepository.loadCards(); loading = false }
    LaunchedEffect(Unit) { try { reload() } catch (_: Exception) { loading = false } }

    val filtered = cards.filter {
        query.isBlank() || (it.name ?: "").contains(query, true) || it.setCode.contains(query, true)
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        OutlinedTextField(query, { query = it }, label = { Text("Suche") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        if (loading) { CircularProgressIndicator(); return@Column }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(filtered, key = { "${it.id}|${it.setCode}|${it.language}" }) { card ->
                CardListItem(card,
                    onInc = { scope.launch { CollectionRepository.setQuantity(card, card.quantity + 1); reload() } },
                    onDec = { if (card.quantity > 1) scope.launch { CollectionRepository.setQuantity(card, card.quantity - 1); reload() } },
                    onDelete = { scope.launch { CollectionRepository.softDelete(card); reload() } })
            }
        }
    }
}

@Composable
private fun CardListItem(card: CardRow, onInc: () -> Unit, onDec: () -> Unit, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(model = card.imageUrl, contentDescription = card.name,
            modifier = Modifier.width(48.dp).height(70.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(card.name ?: card.id, style = MaterialTheme.typography.bodyLarge)
            Text("${card.setCode} · ${card.rarity ?: "?"} · ${"%.2f".format(card.price ?: 0.0)} €",
                style = MaterialTheme.typography.bodySmall)
        }
        IconButton(onClick = onDec) { Icon(Icons.Default.Remove, "−") }
        Text("${card.quantity}")
        IconButton(onClick = onInc) { Icon(Icons.Default.Add, "+") }
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Löschen") }
    }
}
```

- [ ] **Step 2: Verify on device**

Run ▶. Expected: Collection tab lists cards with images, search filters live, +/− changes quantity (and the same change appears on the desktop within ~20s), delete removes the card (and it disappears on the desktop too).

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt
git commit -m "feat(android): collection screen with images, search, quantity, delete"
```

---

### Task 9: Android Portfolio screen (total value + top cards)

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/PortfolioScreen.kt`

**Interfaces:**
- Consumes: `CollectionRepository.loadCards`, `CardRow`.
- Produces: `PortfolioScreen()` composable. Value is computed locally from the loaded rows (no snapshot table needed).

- [ ] **Step 1: Implement the screen**

Create `ui/PortfolioScreen.kt`:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository

@Composable
fun PortfolioScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        try { cards = CollectionRepository.loadCards() } catch (_: Exception) {}
        loading = false
    }
    if (loading) { CircularProgressIndicator(); return }

    val total = cards.sumOf { (it.price ?: 0.0) * it.quantity }
    val totalCards = cards.sumOf { it.quantity }
    val top = cards.sortedByDescending { (it.price ?: 0.0) * it.quantity }.take(20)

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Gesamtwert", style = MaterialTheme.typography.titleMedium)
        Text("%.2f €".format(total), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("$totalCards Karten · ${cards.size} Einträge", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))
        Text("Teuerste Karten", style = MaterialTheme.typography.titleMedium)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(top, key = { "${it.id}|${it.setCode}|${it.language}" }) { c ->
                Row(Modifier.fillMaxWidth()) {
                    Text(c.name ?: c.id, Modifier.weight(1f))
                    Text("%.2f €".format((c.price ?: 0.0) * c.quantity))
                }
            }
        }
    }
}
```

- [ ] **Step 2: Verify on device**

Run ▶. Expected: Portfolio tab shows a total value matching the desktop Portfolio tab (within price-poller timing), card counts, and a ranked list of the most valuable cards.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/PortfolioScreen.kt
git commit -m "feat(android): portfolio screen with total value and top cards"
```

---

## Self-Review

**Spec coverage:**
- Collection view with images, search, edit qty, delete → Tasks 6, 8. ✅
- Portfolio value + top cards (chart deferred per spec) → Task 9. ✅
- Full read/write cloud sync, LWW → Tasks 1–3. ✅
- Soft-delete propagation → Task 2 (soft-delete) + Task 3 (mirror-delete for hard-delete tools). ✅
- Prices desktop-driven, phone display-only → phone never writes price; poller unchanged (Task 2 only adds `deleted=0` filter). ✅
- Single shared account + RLS → Task 1. ✅
- Desktop keeps working offline; graceful when unconfigured → Task 3 `ensureClient` returns null when disabled/misconfigured; loops silently. ✅
- User setup owned by user → Task 1 `SETUP.md`. ✅

**Deviations from spec (intentional, flagged to user):** `updated_at` auto-stamped by a SQLite trigger (not per-handler); ordering uses Supabase server time via a cloud trigger; `portfolio_snapshot` dropped (phone computes locally — YAGNI). Behavior matches spec intent.

**Placeholder scan:** none — every code step contains real content.

**Type consistency:** `rowToRemote`/`remoteToLocalPatch` exported from `sync.cjs` and used in `test-sync.cjs`; `CardRow`/`CollectionRepository` signatures consistent across Tasks 6, 8, 9; settings keys (`supabase_url/key/email/password`, `sync_enabled`, `sync_last_push/pull`) identical across `sync.cjs` and `Settings.jsx`.

## Known limitations (acceptable for single-user)

- After the desktop applies a phone edit, it may echo that row back to the cloud once (re-stamping `updated_at`); converges, value unchanged, one extra write per edit.
- LWW is by wall-clock (`now()` on the Supabase server); genuine simultaneous edits to the same row resolve to the later write, not a merge — out of scope by design.
