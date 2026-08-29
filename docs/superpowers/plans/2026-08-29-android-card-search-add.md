# Android Card Search + Add — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "+" on the collection screen opens a search (name/passcode → YGOPRODeck), and tapping a result lets the user add a chosen printing to the collection.

**Architecture:** Pure Android feature. Search hits YGOPRODeck over OkHttp; adding reuses the existing `CollectionRepository.addPrinting` + `PrintingRepository.fetchSets` (built in the card-detail feature) and the desktop pull-inserts-missing sync. The printing picker is extracted from `CardDetailScreen` into a shared composable used by both detail and search. No desktop, sync, or schema change.

**Tech Stack:** Android Kotlin/Compose (material3), OkHttp + org.json, Coil.

## Global Constraints

- **Android only.** Do NOT touch `desktop/`, the Supabase schema, or `sync.cjs`.
- No new Gradle dependency. Everything needed is present (Compose material3, `material-icons-extended`, Coil, OkHttp, coroutines, org.json). No `io.github.jan.supabase.*` imports.
- Project is Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34 — no APIs newer than that.
- **No automated test harness exists for Android in the implementer environment (no SDK).** Every task's verification is a STATIC self-check (imports resolve, brace/paren balance, every called member exists in the real files) plus the user compiling in Android Studio. Do not fabricate a test run.
- Repo write/fetch funcs (`addPrinting`, `fetchSets`, `loadCards`, `setQuantity`, `softDelete`, `search`) are `suspend` and already switch to `Dispatchers.IO`; call them only from `LaunchedEffect` / `rememberCoroutineScope().launch`.
- The search-add printing picker shows only printings the user does NOT already own (exclude by `setCode`). Increasing an owned printing's quantity is done in collection/detail, not search.
- `CardRow` already has fields: `id, setCode, language, name, imageUrl, rarity, quantity, price, type, desc, atk, def, level, race, attribute` (all but id/setCode/language/quantity nullable).

---

### Task 1: Extract the shared printing picker

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/AddPrintingSection.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt` (remove the private `AddPrintingSection`, drop now-unused imports)

**Interfaces:**
- Produces: public `@Composable fun AddPrintingSection(base: CardRow, owned: List<CardRow>, onError: (String) -> Unit, onAdded: () -> Unit)` in package `com.example.yugiohscanner.ui`. Consumed by `CardDetailScreen` (Task 1) and `SearchScreen` (Task 3).

- [ ] **Step 1: Create the shared file**

Create `ui/AddPrintingSection.kt` with the composable moved verbatim from `CardDetailScreen.kt` (lines 115-160), made **public** (drop `private`), with its own imports:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetOption
import kotlinx.coroutines.launch

// Fetches a card's printings from YGOPRODeck, excludes ones the user already owns
// (by set_code), and adds the chosen printing to the cloud. Shared by card detail and search.
@Composable
fun AddPrintingSection(base: CardRow, owned: List<CardRow>, onError: (String) -> Unit, onAdded: () -> Unit) {
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
                val ownedKeys = owned.map { it.setCode }.toHashSet()
                sets = PrintingRepository.fetchSets(base.id).filter { it.setCode !in ownedKeys }
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

- [ ] **Step 2: Remove the private copy from CardDetailScreen.kt**

Delete the entire `@Composable private fun AddPrintingSection(...) { ... }` block (lines 115-160). `CardDetailScreen`'s call site `AddPrintingSection(base = base, owned = printings, ...)` (line 103) now resolves to the new public composable in the same package — no import needed. Then remove the now-unused imports from `CardDetailScreen.kt` (they were only used by the removed function): `androidx.compose.foundation.lazy.LazyColumn`, `androidx.compose.foundation.lazy.items`, `com.example.yugiohscanner.cloud.PrintingRepository`, `com.example.yugiohscanner.cloud.SetOption`. (Unused imports are only warnings, but remove them for cleanliness.) Leave everything else in `CardDetailScreen.kt` unchanged.

- [ ] **Step 3: Static self-check**

Confirm: the new file compiles logically (all imports used, braces balanced); `CardDetailScreen.kt` no longer declares `AddPrintingSection` and no longer imports the four removed symbols but still imports what its remaining body uses (`Icons`, `AsyncImage`, `CardRow`, `CollectionRepository`, layout, etc.). No behavior change to card detail.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/AddPrintingSection.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt
git commit -m "refactor(android): extract shared AddPrintingSection composable"
```

---

### Task 2: YGOPRODeck search repository

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/CardSearchRepository.kt`

**Interfaces:**
- Consumes: `CardRow`.
- Produces: `suspend fun CardSearchRepository.search(query: String): List<CardRow>` — YGOPRODeck by passcode (all-digits) or name; maps results to `CardRow` carrying shared detail fields, with `setCode="Unknown"`, `rarity=null`, `price=null`, `quantity=0`.

- [ ] **Step 1: Implement the repository**

Create `cloud/CardSearchRepository.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

// Searches YGOPRODeck for cards by name or passcode. Independent of Supabase.
object CardSearchRepository {
    private val client = OkHttpClient()

    suspend fun search(query: String): List<CardRow> = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isEmpty()) return@withContext emptyList()
        val isPasscode = q.all { it.isDigit() }
        val url = "https://db.ygoprodeck.com/api/v7/cardinfo.php".toHttpUrl().newBuilder()
            .addQueryParameter(if (isPasscode) "id" else "fname", q)
            .build()
        val req = Request.Builder().url(url).get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            // YGOPRODeck returns {"error": "..."} (HTTP 400) for no matches — treat as empty.
            val data = JSONObject(text).optJSONArray("data") ?: return@withContext emptyList()
            val out = ArrayList<CardRow>(data.length())
            for (i in 0 until data.length()) {
                val c = data.getJSONObject(i)
                val images = c.optJSONArray("card_images")
                val imageUrl = if (images != null && images.length() > 0)
                    images.getJSONObject(0).optString("image_url", "").ifBlank { null } else null
                val type = c.optString("type", "").ifBlank { null }
                val level = if (type?.contains("Link") == true) {
                    if (c.isNull("linkval")) null else c.optInt("linkval")
                } else if (c.isNull("level")) null else c.optInt("level")
                out.add(
                    CardRow(
                        id = c.get("id").toString(),
                        setCode = "Unknown",
                        language = "DE",
                        name = c.optString("name", "").ifBlank { null },
                        imageUrl = imageUrl,
                        rarity = null,
                        quantity = 0,
                        price = null,
                        type = type,
                        desc = c.optString("desc", "").ifBlank { null },
                        atk = if (c.isNull("atk")) null else c.optInt("atk"),
                        def = if (c.isNull("def")) null else c.optInt("def"),
                        level = level,
                        race = c.optString("race", "").ifBlank { null },
                        attribute = c.optString("attribute", "").ifBlank { null },
                    )
                )
            }
            out
        }
    }
}
```

- [ ] **Step 2: Static self-check**

Confirm: mirrors `PrintingRepository`'s OkHttp pattern; `c.get("id").toString()` (YGOPRODeck `id` is numeric) yields the passcode string; `CardRow` positional args match its declaration order (`id, setCode, language, name, imageUrl, rarity, quantity, price, type, desc, atk, def, level, race, attribute`); Link cards use `linkval` for `level`; no Supabase/auth dependency.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CardSearchRepository.kt
git commit -m "feat(android): YGOPRODeck card search repository"
```

---

### Task 3: Search screen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SearchScreen.kt`

**Interfaces:**
- Consumes: `CardSearchRepository.search`, `CollectionRepository.loadCards`, `AddPrintingSection` (Task 1), `CardRow`.
- Produces: `@Composable fun SearchScreen(onClose: () -> Unit, onAdded: () -> Unit)`.

- [ ] **Step 1: Implement the screen**

Create `ui/SearchScreen.kt`:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import kotlinx.coroutines.launch

@Composable
fun SearchScreen(onClose: () -> Unit, onAdded: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var owned by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var selected by remember { mutableStateOf<CardRow?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Add view for a chosen search result.
    selected?.let { card ->
        Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { selected = null; error = null }) { Icon(Icons.Default.ArrowBack, "Zurück") }
                Text(card.name ?: card.id, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            AsyncImage(model = card.imageUrl, contentDescription = card.name,
                modifier = Modifier.fillMaxWidth().height(280.dp))
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(16.dp))
            AddPrintingSection(
                base = card,
                owned = owned.filter { it.id == card.id },
                onError = { error = it },
                onAdded = { onAdded(); selected = null },
            )
        }
        return
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.ArrowBack, "Zurück") }
            Text("Karte suchen", style = MaterialTheme.typography.titleLarge)
        }
        OutlinedTextField(query, { query = it }, label = { Text("Name oder Passcode") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Button(enabled = !loading && query.isNotBlank(), onClick = {
            loading = true
            scope.launch {
                try {
                    results = CardSearchRepository.search(query)
                    owned = runCatching { CollectionRepository.loadCards() }.getOrDefault(emptyList())
                    error = if (results.isEmpty()) "Nichts gefunden." else null
                } catch (e: Exception) { error = e.message ?: "Suche fehlgeschlagen" }
                loading = false
            }
        }) { Text(if (loading) "Suche…" else "Suchen") }
        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(results, key = { it.id }) { card ->
                Row(Modifier.fillMaxWidth().clickable { error = null; selected = card }.padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    AsyncImage(model = card.imageUrl, contentDescription = card.name,
                        modifier = Modifier.width(40.dp).height(58.dp))
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(card.name ?: card.id, style = MaterialTheme.typography.bodyLarge)
                        Text(card.type ?: "", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Static self-check**

Confirm: `AddPrintingSection` (same package, public from Task 1) is callable; `CardSearchRepository.search`/`CollectionRepository.loadCards` exist and are suspend (called in `scope.launch`); `owned.filter { it.id == card.id }` gives the owned printings the picker excludes; imports resolve; brace balance holds. `results` keyed by `it.id` is unique (YGOPRODeck returns one entry per passcode).

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/SearchScreen.kt
git commit -m "feat(android): card search screen with add-a-printing"
```

---

### Task 4: "+" entry point in the collection

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt`

**Interfaces:**
- Consumes: `SearchScreen(onClose, onAdded)` (Task 3).
- Produces: a FAB in the collection that opens the search; the collection reloads after an add.

- [ ] **Step 1: Replace the `CollectionScreen` function body**

Replace the whole `@Composable fun CollectionScreen() { ... }` function (lines 21-73) with the version below. It adds a `showSearch` state, lifts the `showSearch`/`detailId` full-screen short-circuits above the main layout, and wraps the list in a `Box` with a `FloatingActionButton`. The `CardListItem` composable (lines 75-93) and all existing imports stay; ADD the imports `androidx.compose.ui.Alignment` (already present) and `androidx.compose.material.icons.filled.Add` (already present). No new import is required beyond what's already in the file (`Box` comes from `androidx.compose.foundation.layout.*`, already imported).

```kotlin
@Composable
fun CollectionScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var detailId by remember { mutableStateOf<String?>(null) }
    var showSearch by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun reload() { cards = CollectionRepository.loadCards(); loading = false }
    LaunchedEffect(Unit) { try { reload() } catch (_: Exception) { loading = false } }

    // Full-screen sub-views take over the whole tab.
    if (showSearch) {
        SearchScreen(onClose = { showSearch = false }, onAdded = { scope.launch { runCatching { reload() } } })
        return
    }
    detailId?.let { id ->
        CardDetailScreen(
            cardId = id,
            initial = cards,
            onClose = { detailId = null },
            onChanged = { scope.launch { runCatching { reload() } } },
        )
        return
    }

    val filtered = cards.filter {
        query.isBlank() || (it.name ?: "").contains(query, true) || it.setCode.contains(query, true)
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(12.dp)) {
            OutlinedTextField(query, { query = it }, label = { Text("Suche") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            errorMsg?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
            }
            if (loading) { CircularProgressIndicator(); return@Column }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(filtered, key = { "${it.id}|${it.setCode}|${it.language}" }) { card ->
                    CardListItem(card,
                        onOpen = { detailId = card.id },
                        onInc = { scope.launch {
                            try { CollectionRepository.setQuantity(card, card.quantity + 1); errorMsg = null; reload() }
                            catch (e: Exception) { errorMsg = e.message ?: "Aktualisieren fehlgeschlagen" }
                        } },
                        onDec = { if (card.quantity > 1) scope.launch {
                            try { CollectionRepository.setQuantity(card, card.quantity - 1); errorMsg = null; reload() }
                            catch (e: Exception) { errorMsg = e.message ?: "Aktualisieren fehlgeschlagen" }
                        } },
                        onDelete = { scope.launch {
                            try { CollectionRepository.softDelete(card); errorMsg = null; reload() }
                            catch (e: Exception) { errorMsg = e.message ?: "Löschen fehlgeschlagen" }
                        } })
                }
            }
        }
        FloatingActionButton(
            onClick = { showSearch = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        ) { Icon(Icons.Default.Add, "Karte suchen") }
    }
}
```

- [ ] **Step 2: Static self-check**

Confirm: `Box`, `FloatingActionButton` come from already-imported `androidx.compose.foundation.layout.*` / `androidx.compose.material3.*`; `Alignment`, `Icons.Default.Add` already imported; `SearchScreen` (same package) resolves; `CardListItem` unchanged; the two `return@Column` early-exits still sit inside the `Column` lambda; scanner flow untouched (this file doesn't touch it). Brace balance holds.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt
git commit -m "feat(android): + FAB opens card search from the collection"
```

---

## Self-Review

**Spec coverage:**
- YGOPRODeck search by name/passcode → Task 2. ✅
- "+" FAB entry on collection → Task 4. ✅
- Search screen: field + results + tap → add view with picker → Task 3. ✅
- Pick a printing, exclude owned, add via existing `addPrinting` → Task 1 (shared `AddPrintingSection`) + Task 3. ✅
- Shared `AddPrintingSection` extracted from `CardDetailScreen` → Task 1. ✅
- Android only, no backend change → confirmed (no `desktop/`/schema edits in any task). ✅
- Collection reloads after add → Task 3 `onAdded` → Task 4 `reload()`. ✅

**Placeholder scan:** none — every step has concrete code.

**Type consistency:** `AddPrintingSection(base, owned, onError, onAdded)` signature identical across Task 1 (definition), Task 3 (call); `CardSearchRepository.search(query): List<CardRow>` used in Task 3; `SearchScreen(onClose, onAdded)` defined in Task 3, called in Task 4; `CardRow` positional construction in Task 2 matches its declared field order.

## Known limitations carried forward (single-user, accepted)

- Search-add can only add a printing not yet owned (owned printings are excluded from the picker; increase quantity in collection/detail). Cross-clock LWW, tombstone accumulation, single-account RLS, and empty-list-on-load-error are unchanged from prior specs.
