# Android Card Detail + Phone-Created Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tap a card in the Android collection to open a detail view (image, stats, description) that manages owned printings and adds a new printing — plus the desktop sync rework that lets the phone create rows safely.

**Architecture:** Android talks to Supabase over OkHttp REST; the desktop Electron `sync.cjs` loop mirrors the same `cards` table. This plan converts the desktop's remaining hard-deletes to soft-deletes, removes the mirror-delete step, makes the pull INSERT rows it doesn't have locally, and adds the Android detail screen + add-printing flow. No Supabase schema change (the table already mirrors every needed column).

**Tech Stack:** Electron (CommonJS main, better-sqlite3, @supabase/supabase-js), Android Kotlin/Compose + OkHttp + Coil, Supabase Postgres.

## Global Constraints

- Composite PK is `(id, set_code, language)`; `language` defaults `'DE'`. Copied verbatim from the schema.
- `electron/*.cjs` stay CommonJS; renderer `src/**` and all Android code unchanged in language.
- After this plan, **the phone MAY create new card rows**; the desktop pull inserts them. The desktop stays authoritative for detail columns (name/type/desc/image/atk/def/level/race/attribute/price) — pull only ever changes `quantity`+`deleted` on an *existing* local row, and only INSERTs full data for a *missing* row.
- Deletions are soft (`deleted=1`), never hard `DELETE FROM cards`. There is no mirror-delete step.
- Desktop node tests run via: plain `node <file>`, falling back to `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron.cmd <file>` from `desktop/` when better-sqlite3's Electron ABI blocks plain node.
- Android has no SDK in the implementer's environment — Kotlin is static-checked; the user compiles in Android Studio.
- Card detail groups printings by passcode (`id`). Add-a-printing is only for cards already owned; the set picker excludes printings the user already owns.

---

### Task 1: Desktop — convert remaining hard-deletes to soft-deletes

**Files:**
- Modify: `desktop/electron/main.cjs` — `convert-unknowns-to-default` (469-504), `merge-unknown-cards` (506-522), `downgrade-to-lowest-rarity` (~715-761)
- Modify: `desktop/electron/database.cjs` — the `quantity <= 0` cleanup (~203)

**Interfaces:**
- Produces: after any consolidation tool or the launch cleanup, a removed card is a tombstone (`deleted=1, quantity=0`) that still exists in SQLite and propagates via the normal push. Consumed by Task 2 (no mirror-delete needed).

- [ ] **Step 1: Soft-delete in `convert-unknowns-to-default` (main.cjs)**

Change the source SELECT to skip tombstones, resurrect a tombstoned merge target, and soft-delete the merged-away source:

- Line 471: `const unknowns = db.prepare("SELECT id, quantity FROM cards WHERE set_code = 'Unknown' AND deleted = 0").all();`
- Line 492 (target merge update): `db.prepare("UPDATE cards SET quantity = ?, deleted = 0 WHERE id = ? AND set_code = ? AND language = 'DE'").run(existing.quantity + unknown.quantity, unknown.id, newSetCode);`
- Line 493 (was a DELETE): `db.prepare("UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = 'Unknown'").run(unknown.id);`

(The else-branch at line 495 repurposes the Unknown row in place — no delete — leave it unchanged.)

- [ ] **Step 2: Soft-delete in `merge-unknown-cards` (main.cjs)**

- Line 508: `const unknowns = db.prepare("SELECT id, quantity FROM cards WHERE set_code = 'Unknown' AND deleted = 0").all();`
- Line 512: `const specific = db.prepare("SELECT id, set_code, quantity FROM cards WHERE id = ? AND set_code != 'Unknown' AND deleted = 0 ORDER BY quantity DESC LIMIT 1").get(u.id);`
- Line 514: `db.prepare("UPDATE cards SET quantity = ?, deleted = 0 WHERE id = ? AND set_code = ?").run(specific.quantity + u.quantity, specific.id, specific.set_code);`
- Line 515 (was a DELETE): `db.prepare("UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = 'Unknown'").run(u.id);`

- [ ] **Step 3: Soft-delete in `downgrade-to-lowest-rarity` (main.cjs)**

In the handler (around lines 715-761):
- The `SELECT id, set_code, quantity FROM cards` (≈718): add `WHERE deleted = 0`.
- The current-quantity check `SELECT quantity FROM cards WHERE id = ? AND set_code = ?` (≈731): add `AND deleted = 0`.
- The `existingTarget` merge update `UPDATE cards SET quantity = ? WHERE id = ? AND set_code = ?` (≈748): change to `UPDATE cards SET quantity = ?, deleted = 0 WHERE id = ? AND set_code = ?`.
- The following `DELETE FROM cards WHERE id = ? AND set_code = ?` (≈749): change to `UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = ?`.

(The `UPDATE cards SET set_code=?, rarity=?, price=? …` in-place branch has no delete — leave it.)

- [ ] **Step 4: Soft-delete the launch cleanup (database.cjs)**

At the `quantity <= 0` cleanup (≈203), replace the hard delete:

```javascript
const info = db.prepare("UPDATE cards SET deleted = 1 WHERE quantity <= 0 AND deleted = 0").run();
if (info.changes > 0) console.log(`Quantity cleanup: tombstoned ${info.changes} zero-quantity row(s).`);
```

- [ ] **Step 5: Verify no hard-deletes of cards remain in these paths**

Run: `cd desktop && rg "DELETE FROM cards" electron/`
Expected: zero matches (the only card deletions are now soft `UPDATE … deleted = 1`). If any remain outside restore/reset-database (which drop the whole DB file and are unrelated), convert them too.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/database.cjs
git commit -m "feat(sync): soft-delete consolidation tools + launch cleanup so deletions propagate"
```

---

### Task 2: Desktop — pull inserts missing rows; remove mirror-delete

**Files:**
- Modify: `desktop/electron/sync.cjs` (pull loop 62-87; remove mirror-delete 105-117; exports)
- Test: `desktop/electron/test-sync-insert.cjs` (new, throwaway)

**Interfaces:**
- Consumes: `remoteToLocalPatch` (existing).
- Produces: `remoteToLocalFull(remoteRow)` and `applyRemoteRow(db, remoteRow)` (exported). `applyRemoteRow` UPDATEs quantity+deleted when the local row exists, else INSERTs the full row. `pull()` uses it; `push()` no longer mirror-deletes.

- [ ] **Step 1: Write the failing test**

Create `desktop/electron/test-sync-insert.cjs`:

```javascript
const assert = require('assert');
const Database = require('better-sqlite3');
const { applyRemoteRow } = require('./sync.cjs');

const db = new Database(':memory:');
db.exec(`CREATE TABLE cards (
  id TEXT, name TEXT, type TEXT, desc TEXT, image_url TEXT, atk INTEGER, def INTEGER,
  level INTEGER, race TEXT, attribute TEXT, quantity INTEGER DEFAULT 1, rarity TEXT,
  set_code TEXT, price REAL, language TEXT DEFAULT 'DE', deleted INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, set_code, language)
)`);

// Existing local row -> only quantity+deleted change; details untouched.
db.prepare("INSERT INTO cards (id,set_code,language,name,quantity,deleted) VALUES ('111','A-DE001','DE','Local Name',1,0)").run();
applyRemoteRow(db, { id: '111', set_code: 'A-DE001', language: 'DE', name: 'REMOTE NAME', quantity: 5, deleted: false, updated_at: 'x' });
let row = db.prepare("SELECT name, quantity, deleted FROM cards WHERE id='111' AND set_code='A-DE001'").get();
assert.strictEqual(row.quantity, 5, 'existing row quantity updated');
assert.strictEqual(row.deleted, 0);
assert.strictEqual(row.name, 'Local Name', 'existing row detail NOT overwritten by pull');
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM cards').get().c, 1, 'no duplicate row inserted');

// Missing local row (phone-created printing) -> inserted with full data.
applyRemoteRow(db, { id: '222', set_code: 'B-DE009', language: 'DE', name: 'New Card', type: 'Effect Monster',
  image_url: 'http://img', atk: 1800, def: 1200, level: 4, race: 'Warrior', attribute: 'EARTH',
  quantity: 2, rarity: 'Common', price: 0.25, deleted: false, updated_at: 'y' });
const ins = db.prepare("SELECT * FROM cards WHERE id='222' AND set_code='B-DE009' AND language='DE'").get();
assert.ok(ins, 'missing row was inserted');
assert.strictEqual(ins.name, 'New Card'); assert.strictEqual(ins.atk, 1800);
assert.strictEqual(ins.quantity, 2); assert.strictEqual(ins.rarity, 'Common'); assert.strictEqual(ins.deleted, 0);

console.log('sync insert test: PASS');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop && node electron/test-sync-insert.cjs` (fallback: the ELECTRON_RUN_AS_NODE form)
Expected: FAIL — `applyRemoteRow` is not exported yet.

- [ ] **Step 3: Add `remoteToLocalFull` and `applyRemoteRow` in sync.cjs**

After `remoteToLocalPatch` (line 24), add:

```javascript
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
```

- [ ] **Step 4: Use `applyRemoteRow` in `pull()`**

Replace the pull loop's apply. Remove the `const apply = db.prepare(...)` statement (67-68) and change the body (line 79) from `apply.run(remoteToLocalPatch(r));` to `applyRemoteRow(db, r);`. The surrounding transaction, echo-skip, `appliedCount`, and cursor advance stay exactly as they are.

- [ ] **Step 5: Remove the mirror-delete block in `push()`**

Delete lines 105-117 (the `// Mirror hard-deletes …` comment through the `for (const rk …)` loop). `push()` ends after the `recentlyPushed.set(...)` loop. Nothing else in `push()` changes.

- [ ] **Step 6: Export the new helpers**

Change the export line (150) to: `module.exports = { startSync, rowToRemote, remoteToLocalPatch, remoteToLocalFull, applyRemoteRow };`

- [ ] **Step 7: Run both sync tests to verify they pass**

Run: `cd desktop && node electron/test-sync.cjs && node electron/test-sync-insert.cjs` (ELECTRON_RUN_AS_NODE fallback if needed)
Expected: `sync mapping test: PASS` and `sync insert test: PASS`.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/test-sync-insert.cjs
git commit -m "feat(sync): pull inserts missing rows (phone-created printings); drop mirror-delete"
```

---

### Task 3: Android — extend CardRow with detail fields

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt` (`parse`)

**Interfaces:**
- Produces: `CardRow` with added nullable fields `type, desc, atk, def, level, race, attribute`. Consumed by Tasks 4-6.

- [ ] **Step 1: Add fields to CardRow**

Replace `CardRow.kt`'s data class with (keep the file comment):

```kotlin
data class CardRow(
    val id: String,
    val setCode: String,
    val language: String,
    val name: String?,
    val imageUrl: String?,
    val rarity: String?,
    val quantity: Int,
    val price: Double?,
    val type: String? = null,
    val desc: String? = null,
    val atk: Int? = null,
    val def: Int? = null,
    val level: Int? = null,
    val race: String? = null,
    val attribute: String? = null,
)
```

- [ ] **Step 2: Parse the new fields in CollectionRepository.parse**

In `parse()`, extend the `CardRow(...)` construction with the new fields (using the existing `strOrNull` helper and null-safe int/optDouble patterns). After `price = …`, add:

```kotlin
                    type = o.strOrNull("type"),
                    desc = o.strOrNull("desc"),
                    atk = if (o.isNull("atk")) null else o.optInt("atk"),
                    def = if (o.isNull("def")) null else o.optInt("def"),
                    level = if (o.isNull("level")) null else o.optInt("level"),
                    race = o.strOrNull("race"),
                    attribute = o.strOrNull("attribute"),
```

- [ ] **Step 3: Static self-check**

Confirm the file compiles logically: `strOrNull` is the existing private `JSONObject` extension; `optInt` is a standard org.json method; every added field has a default so other call sites (which build `CardRow` positionally in Task 4) still work. No `import` changes needed.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt
git commit -m "feat(android): carry card detail fields (type/desc/atk/def/level/race/attribute) on CardRow"
```

---

### Task 4: Android — fetch printings from YGOPRODeck + add a printing to the cloud

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/PrintingRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt` (add `addPrinting`)

**Interfaces:**
- Consumes: `SupabaseCloud` (http/base/key/token/jsonMedia), `CardRow`.
- Produces: `data class SetOption(val setCode: String, val rarity: String, val price: Double)`; `suspend fun PrintingRepository.fetchSets(passcode: String): List<SetOption>`; `suspend fun CollectionRepository.addPrinting(base: CardRow, setCode: String, rarity: String, price: Double)`.

- [ ] **Step 1: Create PrintingRepository (YGOPRODeck set lookup)**

Create `PrintingRepository.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class SetOption(val setCode: String, val rarity: String, val price: Double)

// Looks up the printings (card_sets) of a passcode from YGOPRODeck. Independent of Supabase.
object PrintingRepository {
    private val client = OkHttpClient()

    suspend fun fetchSets(passcode: String): List<SetOption> = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("https://db.ygoprodeck.com/api/v7/cardinfo.php?id=$passcode")
            .get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("YGOPRODeck (${resp.code})")
            val data = JSONObject(text).optJSONArray("data") ?: return@withContext emptyList()
            if (data.length() == 0) return@withContext emptyList()
            val sets = data.getJSONObject(0).optJSONArray("card_sets") ?: return@withContext emptyList()
            val seen = HashSet<String>()
            val out = ArrayList<SetOption>()
            for (i in 0 until sets.length()) {
                val s = sets.getJSONObject(i)
                val code = s.optString("set_code", "")
                val rarity = s.optString("set_rarity", "")
                if (code.isBlank()) continue
                val key = "$code|$rarity"
                if (!seen.add(key)) continue
                val price = s.optString("set_price", "0").toDoubleOrNull() ?: 0.0
                out.add(SetOption(code, rarity, price))
            }
            out
        }
    }
}
```

- [ ] **Step 2: Add `addPrinting` to CollectionRepository**

Add to `CollectionRepository` (reusing the existing `executeWithReauth` + `SupabaseCloud`):

```kotlin
    // Creates a new printing row in the cloud, reusing the base card's shared detail fields.
    // Only for a printing the user does NOT already own (the picker excludes owned ones).
    suspend fun addPrinting(base: CardRow, setCode: String, rarity: String, price: Double) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("id", base.id).put("set_code", setCode).put("language", "DE")
            .put("name", base.name).put("type", base.type).put("desc", base.desc)
            .put("image_url", base.imageUrl).put("atk", base.atk ?: JSONObject.NULL)
            .put("def", base.def ?: JSONObject.NULL).put("level", base.level ?: JSONObject.NULL)
            .put("race", base.race).put("attribute", base.attribute)
            .put("quantity", 1).put("rarity", rarity).put("price", price).put("deleted", false)
            .toString()
        executeWithReauth {
            Request.Builder()
                .url("${SupabaseCloud.base()}/rest/v1/cards")
                .addHeader("apikey", SupabaseCloud.key())
                .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia))
                .build()
        }.use { resp ->
            if (!resp.isSuccessful)
                throw RuntimeException("Hinzufügen fehlgeschlagen (${resp.code}): ${resp.body?.string()}")
        }
    }
```

Ensure the `okhttp3.RequestBody.Companion.toRequestBody` import is present (it already is, used by `patch`).

- [ ] **Step 3: Static self-check**

Confirm: `executeWithReauth` is the existing private helper (returns `Response`); `SupabaseCloud.base()/key()/token()/jsonMedia` exist; `base.*` fields exist after Task 3; `Prefer: return=minimal` means the response body is empty on success. No new dependency.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/PrintingRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt
git commit -m "feat(android): YGOPRODeck set lookup + addPrinting (create a cloud row from the phone)"
```

---

### Task 5: Android — card detail screen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt`

**Interfaces:**
- Consumes: `CardRow`, `CollectionRepository.setQuantity/softDelete/loadCards/addPrinting`, `PrintingRepository.fetchSets`, `SetOption`.
- Produces: `@Composable fun CardDetailScreen(cardId: String, initial: List<CardRow>, onClose: () -> Unit, onChanged: () -> Unit)`.

- [ ] **Step 1: Implement the detail screen**

Create `CardDetailScreen.kt`:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetOption
import kotlinx.coroutines.launch

@Composable
fun CardDetailScreen(cardId: String, initial: List<CardRow>, onClose: () -> Unit, onChanged: () -> Unit) {
    var printings by remember { mutableStateOf(initial.filter { it.id == cardId }) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Reload this card's printings from the cloud after a mutation, and tell the parent to refresh.
    suspend fun refresh() {
        printings = CollectionRepository.loadCards().filter { it.id == cardId }
        onChanged()
    }

    val base = printings.firstOrNull() ?: initial.firstOrNull { it.id == cardId }
    if (base == null) { onClose(); return }

    val isLink = base.type?.contains("Link") == true
    val isXyz = base.type?.contains("XYZ") == true
    val levelLabel = if (isLink) "Link" else if (isXyz) "Rang" else "Level"

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.ArrowBack, "Zurück") }
            Text(base.name ?: base.id, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        AsyncImage(model = base.imageUrl, contentDescription = base.name,
            modifier = Modifier.fillMaxWidth().height(320.dp))
        Spacer(Modifier.height(8.dp))
        Text(listOfNotNull(base.type, base.race, base.attribute).joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            base.level?.let { Stat(levelLabel, it.toString()) }
            base.atk?.let { Stat("ATK", it.toString()) }
            if (!isLink) base.def?.let { Stat("DEF", it.toString()) }
            Stat("Passcode", base.id)
        }
        base.desc?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall)
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(16.dp))
        Text("Deine Varianten", style = MaterialTheme.typography.titleMedium)
        printings.forEach { v ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${v.setCode} · ${v.rarity ?: "?"}", style = MaterialTheme.typography.bodyMedium)
                    Text("%.2f €".format(v.price ?: 0.0), style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = {
                    if (v.quantity > 1) scope.launch {
                        try { CollectionRepository.setQuantity(v, v.quantity - 1); error = null; refresh() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Icon(Icons.Default.Remove, "−") }
                Text("${v.quantity}")
                IconButton(onClick = {
                    scope.launch {
                        try { CollectionRepository.setQuantity(v, v.quantity + 1); error = null; refresh() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Icon(Icons.Default.Add, "+") }
                IconButton(onClick = {
                    scope.launch {
                        try { CollectionRepository.softDelete(v); error = null; refresh() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Icon(Icons.Default.Delete, "Löschen") }
            }
        }

        Spacer(Modifier.height(16.dp))
        AddPrintingSection(base = base, owned = printings, onError = { error = it }, onAdded = { scope.launch { refresh() } })
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun AddPrintingSection(base: CardRow, owned: List<CardRow>, onError: (String) -> Unit, onAdded: () -> Unit) {
    var sets by remember { mutableStateOf<List<SetOption>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Text("Weitere Druckvariante hinzufügen", style = MaterialTheme.typography.titleMedium)
    Button(enabled = !loading, onClick = {
        loading = true
        scope.launch {
            try {
                val ownedKeys = owned.map { "${it.setCode}|${it.rarity}" }.toHashSet()
                sets = PrintingRepository.fetchSets(base.id).filter { "${it.setCode}|${it.rarity}" !in ownedKeys }
                expanded = true
            } catch (e: Exception) { onError(e.message ?: "Sets laden fehlgeschlagen") }
            loading = false
        }
    }) { Text(if (loading) "Lade Sets…" else "Sets anzeigen") }

    if (expanded) {
        if (sets.isEmpty()) {
            Text("Keine weiteren Sets gefunden.", style = MaterialTheme.typography.bodySmall)
        } else {
            LazyColumn(Modifier.heightIn(max = 240.dp)) {
                items(sets, key = { "${it.setCode}|${it.rarity}" }) { s ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${s.setCode} · ${s.rarity}", style = MaterialTheme.typography.bodyMedium)
                            Text("%.2f €".format(s.price), style = MaterialTheme.typography.bodySmall)
                        }
                        Button(enabled = !adding, onClick = {
                            adding = true
                            scope.launch {
                                try { CollectionRepository.addPrinting(base, s.setCode, s.rarity, s.price); onAdded(); expanded = false }
                                catch (e: Exception) { onError(e.message ?: "Hinzufügen fehlgeschlagen") }
                                adding = false
                            }
                        }) { Text("Hinzufügen") }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Static self-check**

Confirm: all imported symbols exist (`CollectionRepository.loadCards/setQuantity/softDelete/addPrinting`, `PrintingRepository.fetchSets`, `SetOption`, extended `CardRow`); suspend calls are inside `scope.launch`/suspend `refresh`; `Icons.Default.ArrowBack` is in `material-icons-extended`; brace balance holds.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt
git commit -m "feat(android): card detail screen (info, owned printings, add printing)"
```

---

### Task 6: Android — open detail from the collection list

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt`

**Interfaces:**
- Consumes: `CardDetailScreen(cardId, initial, onClose, onChanged)` from Task 5.
- Produces: tapping a card tile's image/text opens the detail; the +/- and delete buttons keep their existing behavior.

- [ ] **Step 1: Add detail state + render the detail**

In `CollectionScreen`, add near the other state: `var detailId by remember { mutableStateOf<String?>(null) }`. Immediately after `if (loading) { CircularProgressIndicator(); return@Column }`, short-circuit to the detail when one is open:

```kotlin
        detailId?.let { id ->
            CardDetailScreen(
                cardId = id,
                initial = cards,
                onClose = { detailId = null },
                onChanged = { scope.launch { runCatching { reload() } } },
            )
            return@Column
        }
```

Add the import: `import com.example.yugiohscanner.ui.CardDetailScreen` is unnecessary (same package `ui`); ensure no import is needed since both are in `com.example.yugiohscanner.ui`.

- [ ] **Step 2: Make the tile open the detail**

Pass an `onOpen` lambda into `CardListItem` and attach it to the image+text area (not the buttons). Change the `items(...)` call to add `onOpen = { detailId = card.id }`, and update `CardListItem`'s signature + the tappable area:

```kotlin
@Composable
private fun CardListItem(card: CardRow, onOpen: () -> Unit, onInc: () -> Unit, onDec: () -> Unit, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).clickable { onOpen() }, verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(model = card.imageUrl, contentDescription = card.name,
                modifier = Modifier.width(48.dp).height(70.dp))
            Spacer(Modifier.width(8.dp))
            Column {
                Text(card.name ?: card.id, style = MaterialTheme.typography.bodyLarge)
                Text("${card.setCode} · ${card.rarity ?: "?"} · ${"%.2f".format(card.price ?: 0.0)} €",
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        IconButton(onClick = onDec) { Icon(Icons.Default.Remove, "−") }
        Text("${card.quantity}")
        IconButton(onClick = onInc) { Icon(Icons.Default.Add, "+") }
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Löschen") }
    }
}
```

Add the import `import androidx.compose.foundation.clickable`. In the `items(...)` block, pass `onOpen = { detailId = card.id }` alongside the existing `onInc/onDec/onDelete`.

- [ ] **Step 3: Static self-check**

Confirm: `clickable` import added; `CardListItem` now takes `onOpen`; the detail short-circuit returns before the list renders; `scope` is in scope for `onChanged`. Brace balance holds.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt
git commit -m "feat(android): tap a collection card to open its detail"
```

---

## Self-Review

**Spec coverage:**
- Soft-delete everywhere (consolidation tools + cleanup) → Task 1. ✅
- Remove mirror-delete → Task 2 Step 5. ✅
- Pull inserts missing rows, patches existing → Task 2 (`applyRemoteRow` + test). ✅
- CardRow detail fields → Task 3. ✅
- Detail screen (image/stats/desc, owned printings manage) → Task 5. ✅
- Add a new printing (YGOPRODeck sets + phone-created row) → Task 4 + Task 5 `AddPrintingSection`. ✅
- Tap-to-open, grouped by passcode → Task 6 + Task 5 (filter by `id`). ✅
- Error handling (no crash; 401-reauth covers POST) → Task 4 uses `executeWithReauth`; Task 5 try/catch. ✅
- No schema change → confirmed (all columns already mirrored). ✅

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `applyRemoteRow(db, r)` / `remoteToLocalFull` exported from sync.cjs and used in the test; `CardRow` extended fields defaulted so Task 4/5/6 compile; `SetOption(setCode, rarity, price)` and `addPrinting(base, setCode, rarity, price)` / `fetchSets(passcode)` signatures consistent across Tasks 4-5; `CardDetailScreen(cardId, initial, onClose, onChanged)` matches Task 6's call.

## Known limitations (carried forward, single-user)

- Cross-clock LWW is coarse; tombstones accumulate (no purge); RLS is a single shared account. Unchanged from the sync spec.
- Re-adding a soft-deleted printing from the desktop scanner sums onto its pre-deletion quantity (existing behavior).
