# Android Dashboard / Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the phone's "Wert" (Portfolio) tab into a dashboard: keep the value headline + most-valuable cards and add four distribution breakdowns (rarity, type, set, attribute) as simple Compose bars.

**Architecture:** Pure Android. A side-effect-free `computeDashboard(cards)` derives all metrics and breakdowns from the already-loaded `CardRow` list; `PortfolioScreen` renders them in one scrolling column with a reusable `StatBar`. No desktop, sync, schema, or dependency change.

**Tech Stack:** Android Kotlin/Compose (material3, foundation), existing `CollectionRepository`.

## Global Constraints

- **Android only.** Do NOT touch `desktop/`, the Supabase schema, `sync.cjs`, or Gradle. No new dependency; no `io.github.jan.supabase.*`.
- Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34 — no newer APIs.
- **No automated test harness for Android in the implementer environment (no SDK).** Verification is a STATIC self-check (imports resolve, brace balance, referenced members exist) plus the user compiling in Android Studio. Do not fabricate a test run.
- No charting library — bars are a `Box(Modifier.fillMaxWidth(fraction))` over a track.
- Bar length = card **count** within a section (relative to the section max); text beside shows "count · value €". Guard the fraction against divide-by-zero.
- `CardRow` fields available: `id, setCode, language, name, imageUrl, rarity, quantity, price, type, desc, atk, def, level, race, attribute`.

---

### Task 1: Dashboard stats + screen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/Dashboard.kt`
- Modify (rewrite the function): `android/app/src/main/java/com/example/yugiohscanner/ui/PortfolioScreen.kt`

**Interfaces:**
- Produces: `data class StatGroup(label, count, value)`, `data class Dashboard(...)`, `fun computeDashboard(cards: List<CardRow>): Dashboard`, and `@Composable fun StatBar(label, count, value, fraction)` — all in package `com.example.yugiohscanner.ui`. `PortfolioScreen` consumes them.

- [ ] **Step 1: Create `ui/Dashboard.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow

// One row of a breakdown: a label with its card count and summed value.
data class StatGroup(val label: String, val count: Int, val value: Double)

data class Dashboard(
    val totalValue: Double,
    val totalCards: Int,
    val entries: Int,
    val top: List<CardRow>,
    val byRarity: List<StatGroup>,
    val byType: List<StatGroup>,
    val bySet: List<StatGroup>,
    val byAttribute: List<StatGroup>,
)

private fun rarityRank(r: String?): Int = when (r?.lowercase()) {
    "common" -> 1
    "short print" -> 2
    "rare" -> 3
    "super rare" -> 4
    "ultra rare" -> 5
    "secret rare" -> 6
    else -> 10
}

private fun typeGroup(type: String?): String = when {
    type?.contains("Spell", ignoreCase = true) == true -> "Zauber"
    type?.contains("Trap", ignoreCase = true) == true -> "Falle"
    else -> "Monster"
}

// Groups cards by a key (skipping null keys and cards failing `include`), summing
// quantity and price*quantity. Returns label -> (count, value), insertion-ordered.
private fun groupCards(
    cards: List<CardRow>,
    include: (CardRow) -> Boolean = { true },
    keyOf: (CardRow) -> String?,
): List<StatGroup> {
    val m = LinkedHashMap<String, Pair<Int, Double>>()
    for (c in cards) {
        if (!include(c)) continue
        val k = keyOf(c) ?: continue
        val cur = m[k] ?: (0 to 0.0)
        m[k] = (cur.first + c.quantity) to (cur.second + (c.price ?: 0.0) * c.quantity)
    }
    return m.map { StatGroup(it.key, it.value.first, it.value.second) }
}

// Pure: derive all dashboard metrics + breakdowns from the loaded collection.
fun computeDashboard(cards: List<CardRow>): Dashboard {
    val totalValue = cards.sumOf { (it.price ?: 0.0) * it.quantity }
    val totalCards = cards.sumOf { it.quantity }
    val top = cards.sortedByDescending { (it.price ?: 0.0) * it.quantity }.take(10)

    val byRarity = groupCards(cards) { it.rarity ?: "Unbekannt" }
        .sortedBy { rarityRank(if (it.label == "Unbekannt") null else it.label) }

    val typeOrder = listOf("Monster", "Zauber", "Falle")
    val typeMap = groupCards(cards) { typeGroup(it.type) }.associateBy { it.label }
    val byType = typeOrder.mapNotNull { typeMap[it] }

    val bySet = groupCards(cards) { it.setCode }
        .sortedByDescending { it.count }.take(10)

    val byAttribute = groupCards(cards, include = { !it.attribute.isNullOrBlank() }) { it.attribute }
        .sortedByDescending { it.count }

    return Dashboard(totalValue, totalCards, cards.size, top, byRarity, byType, bySet, byAttribute)
}

// A labelled horizontal bar: label + "count · value €" on top, a proportional bar below.
@Composable
fun StatBar(label: String, count: Int, value: Double, fraction: Float) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Text("$count · %.2f €".format(value), style = MaterialTheme.typography.bodySmall)
        }
        Box(Modifier.fillMaxWidth().height(6.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(
                Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(6.dp)
                    .background(MaterialTheme.colorScheme.primary)
            )
        }
    }
}
```

- [ ] **Step 2: Rewrite `PortfolioScreen.kt`**

Replace the whole file with:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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

    val d = computeDashboard(cards)

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Text("Gesamtwert", style = MaterialTheme.typography.titleMedium)
        Text("%.2f €".format(d.totalValue), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("${d.totalCards} Karten · ${d.entries} Einträge", style = MaterialTheme.typography.bodySmall)

        Spacer(Modifier.height(16.dp))
        Text("Teuerste Karten", style = MaterialTheme.typography.titleMedium)
        d.top.forEach { c ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text(c.name ?: c.id, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                Text("%.2f €".format((c.price ?: 0.0) * c.quantity), style = MaterialTheme.typography.bodySmall)
            }
        }

        StatSection("Nach Rarität", d.byRarity)
        StatSection("Nach Typ", d.byType)
        StatSection("Nach Set", d.bySet)
        StatSection("Nach Attribut", d.byAttribute)
    }
}

@Composable
private fun StatSection(title: String, groups: List<StatGroup>) {
    Spacer(Modifier.height(16.dp))
    Text(title, style = MaterialTheme.typography.titleMedium)
    if (groups.isEmpty()) {
        Text("Keine Daten", style = MaterialTheme.typography.bodySmall)
        return
    }
    val maxCount = groups.maxOf { it.count }.coerceAtLeast(1)
    groups.forEach { g -> StatBar(g.label, g.count, g.value, g.count.toFloat() / maxCount) }
}
```

- [ ] **Step 3: Static self-check**

Confirm: `computeDashboard`, `Dashboard`, `StatGroup`, `StatBar` are declared in `Dashboard.kt` (same package `ui`) and used by `PortfolioScreen`/`StatSection` with matching signatures; all imports resolve and none are unused; `CollectionRepository.loadCards()` is the existing suspend fn called in `LaunchedEffect`; `Arrangement` import is used (it is not — remove it if the final file doesn't reference `Arrangement`); no nested `LazyColumn` inside the `verticalScroll` column (top-10 and sections use `forEach`); brace balance holds. The tab wiring in `MainActivity` is unchanged (same `PortfolioScreen` name).

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/Dashboard.kt android/app/src/main/java/com/example/yugiohscanner/ui/PortfolioScreen.kt
git commit -m "feat(android): dashboard stats on the Wert tab (rarity/type/set/attribute breakdowns)"
```

---

## Self-Review

**Spec coverage:**
- Extend the "Wert" tab (not a new tab) → `PortfolioScreen` rewritten, `MainActivity` untouched. ✅
- No charting lib; Compose bars → `StatBar` with `fillMaxWidth(fraction)`. ✅
- Headline metrics + top 10 → `computeDashboard` (`totalValue/totalCards/entries/top`). ✅
- Breakdowns by rarity (ranked), type (Monster/Zauber/Falle), set (top 10 by count), attribute (monsters, by count) → `computeDashboard` + four `StatSection`s. ✅
- Bar length = count, text = "count · value €" → `StatBar`; fraction guarded via `coerceIn` + `maxCount.coerceAtLeast(1)`. ✅
- Android only, no dependency → confirmed (no gradle/desktop/schema edits). ✅
- Empty/error handling → load caught (empty list), sections show "Keine Daten", no divide-by-zero. ✅

**Placeholder scan:** none — full code for both files.

**Type consistency:** `StatGroup(label, count, value)` and `Dashboard(totalValue, totalCards, entries, top, byRarity, byType, bySet, byAttribute)` and `computeDashboard(cards): Dashboard` and `StatBar(label, count, value, fraction)` are defined in Task 1 Step 1 and used identically in Step 2. `d.top` is `List<CardRow>`; `StatSection(title, List<StatGroup>)` matches the four call sites.

## Known limitations carried forward (single-user, accepted)

- Value uses the synced per-row `price` (desktop-driven); the phone never recomputes prices. Load errors show an empty view. Unchanged from prior specs. No drill-down from a breakdown (out of scope).
