# Zwischenspeicher Android — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Handy-App lädt Karten, Exemplare und Behälter einmal beim Start (Ladebildschirm) und hält sie danach in einem Speicher, den ein Delta-Abgleich über `updated_at` aktuell hält — Seitenwechsel brauchen keine Netzabfrage mehr.

**Architecture:** Reine, getestete Regeln unter `ml/` (Blättern nach Schlüssel, Stichtag, Einarbeiten). Ein `CollectionStoreCore` mit austauschbarer Netzquelle hält zwei `StateFlow`s (Daten, Abgleichstatus); ein `Coalescer` verschmilzt Abgleich-Anforderungen. Die Bildschirme lesen nur noch aus dem Speicher und fordern nach eigenen Schreibvorgängen einen Abgleich an. Phase 2 legt Wunschliste, Decks, Deals und Sets in `ListCache`s und ergänzt Nach-unten-Ziehen.

**Tech Stack:** Kotlin 2.0.0, Jetpack Compose (BOM 2024.02.02, Material3 1.2.1), kotlinx-coroutines 1.8.1, OkHttp 4.12 gegen Supabase PostgREST, JUnit 4.

**Spec:** `docs/superpowers/specs/2026-09-13-zwischenspeicher-android-design.md` — lies sie vor deiner Task.

## Global Constraints

- **Keine SQL-Ausführung, keine Verbindung zu Supabase, keine Schemaänderung.** Netzcode wird nur kompiliert und per Unit-Test auf seine Abfrageparameter geprüft; am Server testet ausschließlich der Nutzer.
- `android/local.properties` niemals lesen, ausgeben, ändern oder committen.
- Git: immer explizite Pfade stagen, **nie `git add -A`**, **nie `git stash`**. Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `cards.quantity`/`cards.deleted` sind trigger-gepflegt — nie aus App-Code schreiben. Soft-Delete, nie hart löschen.
- Alle sichtbaren Texte deutsch mit echten Umlauten (nie `ae`/`oe`/`ue` in Oberflächentexten); „Fächer“, nicht „Taschen“. Code-Kommentare dürfen wie im Bestand Umschreibungen nutzen.
- Regeln wohnen in reinen Helfern unter `ml/` bzw. in reinen Klassen, nicht in der Oberfläche.
- Keine neue Laufzeit-Bibliothek. Neu erlaubt ist nur `testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")`.
- Die Schreibwege in `CollectionRepository`/`ContainersRepository` bleiben in Signatur und Serverwirkung unverändert.
- minSdk 26 (`java.time` verfügbar). Material3 1.2.1: `pulltorefresh` ist vorhanden und experimentell.
- Tests: `cd android && ./gradlew testDebugUnitTest` (grün, keine Fehlschläge). Build: `cd android && ./gradlew assembleDebug`. Beides vor jedem Commit einer Task, die `main`-Code ändert.
- Überlappung des Delta-Abgleichs: **60 s**. Takt im Vordergrund: **10 s**. Seitengröße: **1000**. Stichtag ohne Wert: `1970-01-01T00:00:00Z`.
- Zeitstempel werden in Abfragen **immer** in der Form von `Instant.toString()` (mit `Z`) gesendet, nie mit `+00:00` — ein `+` in der URL würde als Leerzeichen gelesen.

---

## Dateiübersicht

**Neu (Phase 1):**
- `android/app/src/main/java/com/example/yugiohscanner/ml/Keyset.kt` — PostgREST-Filter „nach Schlüssel X“.
- `…/ml/SyncCursor.kt` — Stichtag fortschreiben, Untergrenze mit Überlappung.
- `…/ml/KeysetPager.kt` — Seite für Seite nach Schlüssel holen.
- `…/ml/DeltaMerge.kt` — Zeilen einarbeiten, Reihenfolgen der drei Tabellen.
- `…/ml/TagVocabulary.kt` — Tag-Vorschläge aus Exemplaren im Speicher.
- `…/cloud/Coalescer.kt` — ein Lauf gleichzeitig, Anforderungen verschmelzen.
- `…/cloud/CollectionStoreCore.kt` — `StoreState`, `SyncStatus`, `StoreSource`, `CollectionStoreCore`.
- `…/cloud/StoreQueries.kt` — Query-Parameter für Voll- und Delta-Abfragen.
- `…/cloud/CollectionStore.kt` — `CloudStoreSource` und das App-weite `object CollectionStore`.
- `…/ui/StartupLoadingScreen.kt`, `…/ui/SyncHint.kt`.
- Tests: `android/app/src/test/java/com/example/yugiohscanner/{KeysetTest,SyncCursorTest,KeysetPagerTest,DeltaMergeTest,TagVocabularyTest,CoalescerTest,CollectionStoreCoreTest,StoreQueriesTest}.kt`.

**Neu (Phase 2):** `…/cloud/ListCache.kt`, `…/cloud/SideStores.kt`, `…/ui/components/RefreshableBox.kt`, Test `ListCacheTest.kt`.

**Geändert:** `CardRow.kt`, `CopyRow.kt`, `ContainersRepository.kt`, `CollectionRepository.kt`, `UnsortedCopies.kt`, `AppNav.kt`, `SammlungScreen.kt`, `CardDetailScreen.kt`, `CopySheet.kt`, `CollectionScreen.kt`, `BindersScreen.kt`, `BinderPageScreen.kt`, `SortIntoBinderScreen.kt`, `StartScreen.kt`, `SetCompletionScreen.kt`, `SearchScreen.kt`, `ScanScreen.kt`, `WishlistScreen.kt`, `DecksScreen.kt`, `DealsScreen.kt`, `app/build.gradle.kts`.

**Gelöscht:** `ml/ReloadScope.kt`, `test/…/ReloadScopeTest.kt`.

Pfad-Präfix im Folgenden: `M = android/app/src/main/java/com/example/yugiohscanner`, `T = android/app/src/test/java/com/example/yugiohscanner`.

---

# PHASE 1

### Task 1: Blättern nach Schlüssel und Stichtag (reine Regeln)

**Files:**
- Create: `M/ml/Keyset.kt`, `M/ml/SyncCursor.kt`, `M/ml/KeysetPager.kt`
- Create: `T/KeysetTest.kt`, `T/SyncCursorTest.kt`, `T/KeysetPagerTest.kt`
- Modify: `android/app/build.gradle.kts` (Testabhängigkeit)

**Interfaces:**
- Produces:
  - `object Keyset { fun quote(value: String): String; fun after(columns: List<String>, after: List<String>): String }`
  - `object SyncCursor { const val OVERLAP_SECONDS = 60L; const val EPOCH = "1970-01-01T00:00:00Z"; fun parse(s: String): java.time.Instant; fun normalize(s: String): String; fun advance(current: String?, delivered: List<String?>): String?; fun lowerBound(cursor: String?): String }`
  - `object KeysetPager { suspend fun <T> all(pageSize: Int, fetch: suspend (after: T?) -> List<T>): List<T> }`

- [ ] **Step 1: Testabhängigkeit ergänzen**

In `android/app/build.gradle.kts` direkt unter `testImplementation("org.json:json:20240303")`:

```kotlin
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
```

- [ ] **Step 2: Failing Tests schreiben**

`T/KeysetTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Keyset
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * "Alles nach dieser Zeile" als PostgREST-`or`-Filter. Blaettern nach Schluessel statt nach Versatz:
 * verschwindet waehrend des Blaetterns eine fruehere Zeile, rueckt beim Versatz alles vor und eine
 * Zeile wird still uebersprungen -- beim Schluessel nicht (Spec §4.1).
 */
class KeysetTest {

    @Test fun `ein Schluessel`() {
        assertEquals("(copy_id.gt.\"abc\")", Keyset.after(listOf("copy_id"), listOf("abc")))
    }

    @Test fun `zusammengesetzter Kartenschluessel`() {
        val expected = "(id.gt.\"1\"," +
            "and(id.eq.\"1\",set_code.gt.\"LOB-DE001\")," +
            "and(id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.gt.\"DE\")," +
            "and(id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.eq.\"DE\",rarity.gt.\"Secret Rare\"))"
        assertEquals(
            expected,
            Keyset.after(listOf("id", "set_code", "language", "rarity"), listOf("1", "LOB-DE001", "DE", "Secret Rare")),
        )
    }

    @Test fun `Zeitstempel vor dem Schluessel`() {
        assertEquals(
            "(updated_at.gt.\"2026-09-13T12:00:00.500Z\",and(updated_at.eq.\"2026-09-13T12:00:00.500Z\",copy_id.gt.\"u1\"))",
            Keyset.after(listOf("updated_at", "copy_id"), listOf("2026-09-13T12:00:00.500Z", "u1")),
        )
    }

    @Test fun `Komma und Klammern bleiben im Wert`() {
        assertEquals("\"a,b (c)\"", Keyset.quote("a,b (c)"))
    }

    @Test fun `Anfuehrungszeichen und Backslash werden maskiert`() {
        assertEquals("\"x\\\"y\\\\z\"", Keyset.quote("x\"y\\z"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `Spalten und Werte muessen gleich viele sein`() {
        Keyset.after(listOf("a", "b"), listOf("1"))
    }
}
```

`T/SyncCursorTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SyncCursor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** Der Stichtag kommt vom Server, nie von der Uhr des Handys (Spec §4.3). */
class SyncCursorTest {

    @Test fun `Stichtag ist der spaeteste gelieferte Zeitpunkt`() {
        assertEquals(
            "2026-09-13T12:00:02+00:00",
            SyncCursor.advance(null, listOf("2026-09-13T12:00:01+00:00", "2026-09-13T12:00:02+00:00", null)),
        )
    }

    @Test fun `ohne Lieferung bleibt der Stichtag`() {
        assertEquals("2026-09-13T12:00:00+00:00", SyncCursor.advance("2026-09-13T12:00:00+00:00", emptyList()))
        assertNull(SyncCursor.advance(null, listOf(null)))
    }

    @Test fun `aelter Geliefertes schiebt den Stichtag nicht zurueck`() {
        assertEquals(
            "2026-09-13T12:00:00+00:00",
            SyncCursor.advance("2026-09-13T12:00:00+00:00", listOf("2026-09-13T11:00:00+00:00")),
        )
    }

    @Test fun `verglichen wird als Zeitpunkt, nicht als Zeichenkette`() {
        // ".7" ist spaeter als ".07"; "+02:00" ist zwei Stunden frueher als dieselbe Uhrzeit in UTC.
        assertEquals(
            "2026-01-01T00:00:00.7+00:00",
            SyncCursor.advance("2026-01-01T00:00:00.07+00:00", listOf("2026-01-01T00:00:00.7+00:00")),
        )
        assertEquals(
            "2026-01-01T01:30:00+00:00",
            SyncCursor.advance("2026-01-01T02:00:00+02:00", listOf("2026-01-01T01:30:00+00:00")),
        )
    }

    @Test fun `Untergrenze zieht 60 Sekunden ab und schreibt mit Z`() {
        assertEquals("2026-09-13T11:59:30.123456Z", SyncCursor.lowerBound("2026-09-13T12:00:30.123456+00:00"))
    }

    @Test fun `ohne Stichtag ab 1970`() {
        assertEquals("1970-01-01T00:00:00Z", SyncCursor.lowerBound(null))
    }

    @Test fun `normalisierte Form enthaelt kein Plus`() {
        val n = SyncCursor.normalize("2026-09-13T12:00:00.5+00:00")
        assertEquals("2026-09-13T12:00:00.500Z", n)
        assertFalse(n.contains('+'))
    }
}
```

`T/KeysetPagerTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.KeysetPager
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Blaettern gegen eine nachgebaute Server-Tabelle: `fetch(after)` liefert die ersten `page` Zeilen
 * mit Schluessel > after -- genau das, was der `or`-Filter aus Keyset am Server bewirkt.
 */
class KeysetPagerTest {

    private data class Row(val ts: String, val key: String)
    private val order = compareBy<Row>({ it.ts }, { it.key })

    private fun server(rows: MutableList<Row>, page: Int, afterEachPage: (Int) -> Unit = {}): suspend (Row?) -> List<Row> {
        var served = 0
        return { after ->
            val out = rows.sortedWith(order).filter { after == null || order.compare(it, after) > 0 }.take(page)
            afterEachPage(served++)
            out
        }
    }

    @Test fun `alle Zeilen ueber mehrere Seiten, jede genau einmal`() = runBlocking {
        val rows = (1..2500).map { Row("t", "k%05d".format(it)) }.toMutableList()
        val got = KeysetPager.all(1000, server(rows, 1000))
        assertEquals(rows, got)
    }

    @Test fun `genaues Vielfaches der Seitengroesse endet mit leerer Seite`() = runBlocking {
        val rows = (1..2000).map { Row("t", "k%05d".format(it)) }.toMutableList()
        assertEquals(2000, KeysetPager.all(1000, server(rows, 1000)).size)
    }

    @Test fun `verschwindet waehrend des Blaetterns eine fruehere Zeile, fehlt keine spaetere`() = runBlocking {
        val rows = (1..2500).map { Row("t", "k%05d".format(it)) }.toMutableList()
        val later = rows.drop(1000)
        // Nach der ersten Seite wird Zeile 10 geloescht -- beim Versatz-Blaettern fiele jetzt k01001 heraus.
        val got = KeysetPager.all(1000, server(rows, 1000) { served -> if (served == 0) rows.removeAt(9) })
        assertEquals(later, got.drop(1000))
    }

    @Test fun `viele Zeilen mit demselben Zeitstempel`() = runBlocking {
        // Ein Preis-Update stempelt hunderte Zeilen gleich; nur nach dem Zeitstempel zu blaettern hinge fest.
        val rows = (1..2500).map { Row("2026-09-13T05:00:00Z", "k%05d".format(it)) }.toMutableList()
        val got = KeysetPager.all(1000, server(rows, 1000))
        assertEquals(2500, got.size)
        assertEquals(2500, got.toSet().size)
    }
}
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag sehen**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*KeysetTest" --tests "*SyncCursorTest" --tests "*KeysetPagerTest"`
Expected: Kompilierfehler „Unresolved reference: Keyset / SyncCursor / KeysetPager“.

- [ ] **Step 4: Implementierung**

`M/ml/Keyset.kt`:

```kotlin
package com.example.yugiohscanner.ml

/**
 * PostgREST-Filter "Zeile kommt in der Sortierung nach dieser" (Spec §4.1). Grundlage des Blaetterns
 * nach Schluessel: verschwindet waehrend des Blaetterns eine fruehere Zeile (geloescht, Menge auf 0),
 * ueberspringt Versatz-Blaettern still eine spaetere -- Schluessel-Blaettern nicht.
 *
 * Werte stehen immer in doppelten Anfuehrungszeichen; `"` und `\` darin werden mit `\` maskiert.
 * Sonst zerbraechen Seltenheiten wie "Secret Rare", Kommas oder Klammern den Ausdruck.
 */
object Keyset {

    fun quote(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    /**
     * Inhalt des Query-Parameters `or` (mit aeusseren Klammern) fuer eine aufsteigende Sortierung
     * ueber `columns`: (c1 > v1) oder (c1 = v1 und c2 > v2) oder ...
     */
    fun after(columns: List<String>, after: List<String>): String {
        require(columns.isNotEmpty() && columns.size == after.size) { "Spalten und Werte passen nicht zusammen" }
        val parts = columns.indices.map { i ->
            val equal = (0 until i).map { j -> "${columns[j]}.eq.${quote(after[j])}" }
            val greater = "${columns[i]}.gt.${quote(after[i])}"
            if (equal.isEmpty()) greater else "and(${(equal + greater).joinToString(",")})"
        }
        return "(${parts.joinToString(",")})"
    }
}
```

`M/ml/SyncCursor.kt`:

```kotlin
package com.example.yugiohscanner.ml

import java.time.Instant
import java.time.OffsetDateTime

/**
 * Der Stichtag des Delta-Abgleichs (Spec §4.3): der spaeteste `updated_at`, den der SERVER geliefert
 * hat -- nie die Uhr des Handys. Verglichen wird als Zeitpunkt; PostgreSQL kuerzt Sekundenbruchteile
 * (".7" statt ".700000"), und eine Zeichenkette mit anderem Versatz waere falsch geordnet.
 *
 * Die Untergrenze einer Abfrage liegt 60 s vor dem Stichtag: eine Transaktion stempelt mit ihrem
 * BEGINN, wird aber erst beim Ende sichtbar. Ohne Ueberlappung ginge eine solche Zeile verloren --
 * genau an dieser Grenze lag ein frueherer Fehler im PC-Sync. Doppelt gelieferte Zeilen schaden
 * nicht, weil DeltaMerge sie wirkungslos einarbeitet.
 */
object SyncCursor {
    const val OVERLAP_SECONDS = 60L
    const val EPOCH = "1970-01-01T00:00:00Z"

    fun parse(s: String): Instant = OffsetDateTime.parse(s).toInstant()

    /** Form fuer Abfragen: `Instant.toString()`, also mit `Z` -- ein `+` in der URL hiesse Leerzeichen. */
    fun normalize(s: String): String = parse(s).toString()

    fun advance(current: String?, delivered: List<String?>): String? {
        var best = current
        var bestAt = current?.let(::parse)
        for (s in delivered) {
            if (s == null) continue
            val at = parse(s)
            if (bestAt == null || at.isAfter(bestAt)) {
                best = s
                bestAt = at
            }
        }
        return best
    }

    fun lowerBound(cursor: String?): String =
        if (cursor == null) EPOCH else parse(cursor).minusSeconds(OVERLAP_SECONDS).toString()
}
```

`M/ml/KeysetPager.kt`:

```kotlin
package com.example.yugiohscanner.ml

/**
 * Holt Seite fuer Seite, bis eine Seite kuerzer als `pageSize` ist. `fetch(null)` liefert die erste
 * Seite, `fetch(zeile)` die Seite NACH dieser Zeile (Filter aus Keyset). Warum nach Schluessel und
 * nicht nach Versatz: siehe Keyset.
 */
object KeysetPager {
    suspend fun <T> all(pageSize: Int, fetch: suspend (after: T?) -> List<T>): List<T> {
        val out = ArrayList<T>()
        var after: T? = null
        while (true) {
            val page = fetch(after)
            out.addAll(page)
            if (page.size < pageSize) return out
            after = page.last()
        }
    }
}
```

- [ ] **Step 5: Tests grün**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*KeysetTest" --tests "*SyncCursorTest" --tests "*KeysetPagerTest"`
Expected: PASS. Danach die ganze Suite: `cd android && ./gradlew testDebugUnitTest` → grün.

- [ ] **Step 6: Commit**

```bash
git add android/app/build.gradle.kts android/app/src/main/java/com/example/yugiohscanner/ml/Keyset.kt android/app/src/main/java/com/example/yugiohscanner/ml/SyncCursor.kt android/app/src/main/java/com/example/yugiohscanner/ml/KeysetPager.kt android/app/src/test/java/com/example/yugiohscanner/KeysetTest.kt android/app/src/test/java/com/example/yugiohscanner/SyncCursorTest.kt android/app/src/test/java/com/example/yugiohscanner/KeysetPagerTest.kt
git commit -m "feat(android): Blaettern nach Schluessel und Delta-Stichtag -- reine Regeln

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Zeilenfelder, Einarbeiten und Tag-Vokabular (reine Regeln)

**Files:**
- Modify: `M/cloud/CardRow.kt`, `M/cloud/CopyRow.kt`, `M/cloud/ContainersRepository.kt:13-16` (nur `data class ContainerRow`), `M/ml/UnsortedCopies.kt:34` (Sichtbarkeit von `ORDER`)
- Create: `M/ml/DeltaMerge.kt`, `M/ml/TagVocabulary.kt`
- Create: `T/DeltaMergeTest.kt`, `T/TagVocabularyTest.kt`

**Interfaces:**
- Produces:
  - `CardRow(…, deleted: Boolean = false, updatedAt: String? = null)` (neue letzte Felder)
  - `CopyRow(…, createdAt: String? = null, updatedAt: String? = null)`
  - `ContainerRow(…, sortOrder: Int, deleted: Boolean = false, updatedAt: String? = null)`
  - `UnsortedCopies.ORDER: Comparator<CopyRow>` (öffentlich)
  - `object DeltaMerge { fun <T> merge(current: List<T>, delivered: List<T>, key: (T) -> String, gone: (T) -> Boolean, order: Comparator<in T>): List<T>; val CARD_ORDER; val COPY_ORDER; val CONTAINER_ORDER; fun cards(current: List<CardRow>, delivered: List<CardRow>): List<CardRow>; fun copies(…): List<CopyRow>; fun containers(…): List<ContainerRow> }`
  - `object TagVocabulary { fun from(copies: List<CopyRow>): List<String> }`

- [ ] **Step 1: Felder ergänzen**

`M/cloud/CardRow.kt` — nach `val attribute: String? = null,`:

```kotlin
    // Nur fuer den Delta-Abgleich des Speichers (Spec §4.2): eine geloeschte Zeile muss ankommen,
    // damit sie lokal verschwindet. Beide Felder werden NUR gelesen; kein Schreibweg sendet sie.
    val deleted: Boolean = false,
    val updatedAt: String? = null,
```

`M/cloud/CopyRow.kt` — nach `val createdAt: String? = null,`:

```kotlin
    // NUR-LESE-FELD wie createdAt: der Server stempelt es; Stichtag des Delta-Abgleichs (Spec §4.3).
    val updatedAt: String? = null,
```

`M/cloud/ContainersRepository.kt` — `ContainerRow` wird zu:

```kotlin
data class ContainerRow(
    val containerId: String, val name: String, val kind: String,
    val pocketsPerPage: Int?, val color: String?, val sortOrder: Int,
    // Nur gelesen, fuer den Delta-Abgleich (Spec §4.2/§4.3); save() sendet beides nicht.
    val deleted: Boolean = false, val updatedAt: String? = null,
)
```

`M/ml/UnsortedCopies.kt` Zeile 34: `private val ORDER` → `val ORDER` (TagVocabulary nutzt dieselbe Reihenfolge).

- [ ] **Step 2: Failing Tests schreiben**

`T/DeltaMergeTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.DeltaMerge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** Einarbeiten geaenderter Zeilen in den Speicher (Spec §4.2). */
class DeltaMergeTest {

    private fun copy(id: String, deleted: Boolean = false, note: String? = null) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = deleted, containerId = null, page = null,
        slot = null, tags = null, note = note, updatedAt = "2026-09-13T12:00:00Z",
    )

    private fun card(id: String, setCode: String = "LOB-DE001", qty: Int = 1, deleted: Boolean = false, rarity: String = "Common") =
        CardRow(id = id, setCode = setCode, language = "DE", name = "n", imageUrl = null, rarity = rarity,
            quantity = qty, price = 1.0, deleted = deleted)

    private fun container(id: String, sort: Int, deleted: Boolean = false) =
        ContainerRow(containerId = id, name = id, kind = "box", pocketsPerPage = null, color = null, sortOrder = sort, deleted = deleted)

    @Test fun `neue Zeile wird einsortiert`() {
        val out = DeltaMerge.copies(listOf(copy("a"), copy("c")), listOf(copy("b")))
        assertEquals(listOf("a", "b", "c"), out.map { it.copyId })
    }

    @Test fun `geaenderte Zeile ersetzt die alte`() {
        val out = DeltaMerge.copies(listOf(copy("a"), copy("b")), listOf(copy("b", note = "neu")))
        assertEquals("neu", out.first { it.copyId == "b" }.note)
        assertEquals(2, out.size)
    }

    @Test fun `geloeschte Zeile verschwindet`() {
        val out = DeltaMerge.copies(listOf(copy("a"), copy("b")), listOf(copy("a", deleted = true)))
        assertEquals(listOf("b"), out.map { it.copyId })
    }

    @Test fun `geloeschte unbekannte Zeile aendert nichts`() {
        val current = listOf(copy("a"))
        assertSame(current, DeltaMerge.copies(current, listOf(copy("x", deleted = true))))
    }

    @Test fun `Karte mit Menge null verschwindet wie eine geloeschte`() {
        val out = DeltaMerge.cards(listOf(card("1"), card("2")), listOf(card("1", qty = 0), card("2", deleted = true)))
        assertEquals(emptyList<CardRow>(), out)
    }

    @Test fun `unveraenderte Lieferung liefert dieselbe Liste zurueck`() {
        val current = listOf(copy("a"), copy("b"))
        assertSame(current, DeltaMerge.copies(current, listOf(copy("a"), copy("b"))))
    }

    @Test fun `leere Lieferung liefert dieselbe Liste zurueck`() {
        val current = listOf(copy("a"))
        assertSame(current, DeltaMerge.copies(current, emptyList()))
    }

    @Test fun `Karten nach Passcode, Set-Code, Sprache, Seltenheit`() {
        val out = DeltaMerge.cards(emptyList(), listOf(
            card("2"), card("1", setCode = "SDK-DE001"), card("1", rarity = "Ultra Rare"), card("1"),
        ))
        assertEquals(
            listOf("1|LOB-DE001|Common", "1|LOB-DE001|Ultra Rare", "1|SDK-DE001|Common", "2|LOB-DE001|Common"),
            out.map { "${it.id}|${it.setCode}|${it.rarity}" },
        )
    }

    @Test fun `Behaelter nach sort_order, dann container_id`() {
        val out = DeltaMerge.containers(emptyList(), listOf(container("b", 1), container("a", 1), container("z", 0)))
        assertEquals(listOf("z", "a", "b"), out.map { it.containerId })
    }

    @Test fun `vollstaendiges Laden ist Einarbeiten in eine leere Liste`() {
        val out = DeltaMerge.containers(emptyList(), listOf(container("a", 0), container("weg", 0, deleted = true)))
        assertEquals(listOf("a"), out.map { it.containerId })
    }
}
```

`T/TagVocabularyTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.TagVocabulary
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tag-Vorschlaege aus den Exemplaren im Speicher statt aus einem eigenen Netzaufruf. Muss dasselbe
 * liefern wie das abgeloeste CollectionRepository.listTags(): lebende Exemplare in der Reihenfolge
 * created_at, copy_id; ueber Tags.parse/Tags.add zusammengefuehrt; am Ende ohne Gross/klein sortiert.
 */
class TagVocabularyTest {

    private fun copy(id: String, tags: String?, createdAt: String?, deleted: Boolean = false) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = deleted, containerId = null, page = null,
        slot = null, tags = tags, note = null, createdAt = createdAt,
    )

    @Test fun `alle Tags lebender Exemplare, ohne Gross-klein sortiert`() {
        val out = TagVocabulary.from(listOf(
            copy("a", "[\"zeta\",\"Alpha\"]", "2026-01-01T00:00:00+00:00"),
            copy("b", "[\"beta\"]", "2026-01-02T00:00:00+00:00"),
            copy("c", "[\"geloescht\"]", "2026-01-03T00:00:00+00:00", deleted = true),
            copy("d", null, "2026-01-04T00:00:00+00:00"),
        ))
        assertEquals(listOf("Alpha", "beta", "zeta"), out)
    }

    @Test fun `die Schreibweise des aeltesten Exemplars gewinnt`() {
        val out = TagVocabulary.from(listOf(
            copy("neu", "[\"tausch\"]", "2026-02-01T00:00:00+00:00"),
            copy("alt", "[\"Tausch\"]", "2026-01-01T00:00:00+00:00"),
        ))
        assertEquals(listOf("Tausch"), out)
    }

    @Test fun `kaputte Tag-Zelle bedeutet keine Tags`() {
        assertEquals(emptyList<String>(), TagVocabulary.from(listOf(copy("a", "kein json", "2026-01-01T00:00:00+00:00"))))
    }
}
```

- [ ] **Step 3: Fehlschlag sehen**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*DeltaMergeTest" --tests "*TagVocabularyTest"`
Expected: Kompilierfehler „Unresolved reference: DeltaMerge / TagVocabulary“.

- [ ] **Step 4: Implementierung**

`M/ml/DeltaMerge.kt`:

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.printingKey

/**
 * Arbeitet vom Server gelieferte Zeilen in eine Tabelle des Speichers ein (Spec §4.2).
 *
 * - Geloescht (Karte zusaetzlich: Menge <= 0) -> Schluessel entfernen.
 * - Sonst einsetzen oder ersetzen.
 * - Aendert sich nichts, kommt DIESELBE Liste zurueck (`===`). Der Speicher gleicht alle 10 s ab;
 *   eine neue, gleiche Liste liesse jede Seite ohne Grund neu zeichnen.
 * - Eine doppelt gelieferte, unveraenderte Zeile aendert nichts -- Voraussetzung der Ueberlappung
 *   in SyncCursor.
 *
 * Sortiert wird nach Codepunkten der Schluessel, nicht nach der Datenbank-Kollation; keine Seite
 * zeigt diese Listen in Lieferreihenfolge (Spec §4.1, "Reihenfolge im Speicher").
 */
object DeltaMerge {

    fun <T> merge(
        current: List<T>,
        delivered: List<T>,
        key: (T) -> String,
        gone: (T) -> Boolean,
        order: Comparator<in T>,
    ): List<T> {
        if (delivered.isEmpty()) return current
        val byKey = LinkedHashMap<String, T>(current.size + delivered.size)
        for (row in current) byKey[key(row)] = row
        var changed = false
        for (row in delivered) {
            val k = key(row)
            if (gone(row)) {
                if (byKey.remove(k) != null) changed = true
            } else {
                if (byKey.put(k, row) != row) changed = true
            }
        }
        return if (changed) byKey.values.sortedWith(order) else current
    }

    val CARD_ORDER: Comparator<CardRow> =
        compareBy<CardRow>({ it.id }, { it.setCode }, { it.language }, { it.rarity ?: "Unknown" })
    val COPY_ORDER: Comparator<CopyRow> = compareBy { it.copyId }
    val CONTAINER_ORDER: Comparator<ContainerRow> = compareBy<ContainerRow>({ it.sortOrder }, { it.containerId })

    fun cards(current: List<CardRow>, delivered: List<CardRow>): List<CardRow> =
        merge(current, delivered, { it.printingKey() }, { it.deleted || it.quantity <= 0 }, CARD_ORDER)

    fun copies(current: List<CopyRow>, delivered: List<CopyRow>): List<CopyRow> =
        merge(current, delivered, { it.copyId }, { it.deleted }, COPY_ORDER)

    fun containers(current: List<ContainerRow>, delivered: List<ContainerRow>): List<ContainerRow> =
        merge(current, delivered, { it.containerId }, { it.deleted }, CONTAINER_ORDER)
}
```

`M/ml/TagVocabulary.kt`:

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Tag-Vorschlaege ueber alle lebenden Exemplare -- aus dem Speicher statt ueber einen eigenen
 * Netzaufruf durch alle Zeilen. Dieselbe Regel wie das abgeloeste CollectionRepository.listTags():
 * Reihenfolge created_at, copy_id (die Schreibweise des aeltesten Exemplars gewinnt, weil Tags.add
 * Dubletten ohne Gross/klein erkennt), Zerlegen nur ueber Tags.parse, am Ende ohne Gross/klein sortiert.
 */
object TagVocabulary {
    fun from(copies: List<CopyRow>): List<String> {
        var result = emptyList<String>()
        for (c in copies.filter { !it.deleted && it.tags != null }.sortedWith(UnsortedCopies.ORDER)) {
            for (t in Tags.parse(c.tags)) result = Tags.add(result, t)
        }
        return result.sortedWith(String.CASE_INSENSITIVE_ORDER)
    }
}
```

- [ ] **Step 5: Tests grün, ganze Suite grün, Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, keine Testfehler.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/ContainersRepository.kt android/app/src/main/java/com/example/yugiohscanner/ml/UnsortedCopies.kt android/app/src/main/java/com/example/yugiohscanner/ml/DeltaMerge.kt android/app/src/main/java/com/example/yugiohscanner/ml/TagVocabulary.kt android/app/src/test/java/com/example/yugiohscanner/DeltaMergeTest.kt android/app/src/test/java/com/example/yugiohscanner/TagVocabularyTest.kt
git commit -m "feat(android): Delta einarbeiten und Tag-Vokabular aus dem Speicher -- reine Regeln

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Coalescer und CollectionStoreCore

**Files:**
- Create: `M/cloud/Coalescer.kt`, `M/cloud/CollectionStoreCore.kt`
- Create: `T/CoalescerTest.kt`, `T/CollectionStoreCoreTest.kt`

**Interfaces:**
- Consumes: `SyncCursor.advance/lowerBound` (Task 1), `DeltaMerge.cards/copies/containers` (Task 2), Zeilenfelder `updatedAt`/`deleted` (Task 2).
- Produces:
  - `class Coalescer(scope: CoroutineScope, run: suspend () -> Unit) { fun request(); suspend fun requestAndWait() }`
  - `sealed interface StoreState { data object Empty; data object Loading; data class Failed(val message: String); data class Ready(val cards: List<CardRow>, val copies: List<CopyRow>, val containers: List<ContainerRow>) }`
  - `data class SyncStatus(val lastSuccess: Instant? = null, val failing: Boolean = false)`
  - `interface StoreSource { suspend fun loadCards(changedSince: String?): List<CardRow>; suspend fun loadCopies(changedSince: String?): List<CopyRow>; suspend fun loadContainers(changedSince: String?): List<ContainerRow> }`
  - `class CollectionStoreCore(source: StoreSource, scope: CoroutineScope, clock: () -> Instant = Instant::now) { val state: StateFlow<StoreState>; val sync: StateFlow<SyncStatus>; fun startInitialLoad(); suspend fun loadInitial(); fun requestSync(); suspend fun awaitSync(); fun clear() }`

- [ ] **Step 1: Failing Tests schreiben**

`T/CoalescerTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Coalescer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ein Lauf gleichzeitig; Anforderungen waehrend eines Laufs verschmelzen zu genau einem weiteren (Spec §4.3). */
@OptIn(ExperimentalCoroutinesApi::class)
class CoalescerTest {

    @Test fun `ein Auftrag laeuft genau einmal`() = runTest {
        var runs = 0
        val c = Coalescer(backgroundScope) { runs++ }
        c.request()
        advanceUntilIdle()
        assertEquals(1, runs)
    }

    @Test fun `Auftraege waehrend eines Laufs fuehren zu genau einem weiteren`() = runTest {
        var runs = 0
        val gate = CompletableDeferred<Unit>()
        val c = Coalescer(backgroundScope) { runs++; if (runs == 1) gate.await() }
        c.request()
        advanceUntilIdle()
        repeat(3) { c.request() }
        advanceUntilIdle()
        assertEquals(1, runs)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(2, runs)
    }

    @Test fun `nie zwei Laeufe gleichzeitig`() = runTest {
        var active = 0
        var maxActive = 0
        val gates = List(3) { CompletableDeferred<Unit>() }
        var runs = 0
        val c = Coalescer(backgroundScope) {
            active++; maxActive = maxOf(maxActive, active)
            gates[runs++].await()
            active--
        }
        c.request(); advanceUntilIdle()
        c.request(); advanceUntilIdle()
        gates.forEach { it.complete(Unit) }
        advanceUntilIdle()
        assertEquals(1, maxActive)
    }

    @Test fun `requestAndWait wartet auf einen Lauf, der danach begann`() = runTest {
        var runs = 0
        val first = CompletableDeferred<Unit>()
        val second = CompletableDeferred<Unit>()
        val c = Coalescer(backgroundScope) { runs++; if (runs == 1) first.await() else second.await() }
        c.request()
        advanceUntilIdle()
        var done = false
        launch { c.requestAndWait(); done = true }
        advanceUntilIdle()
        first.complete(Unit)
        advanceUntilIdle()
        assertFalse("der erste Lauf begann vor dem Aufruf und zaehlt nicht", done)
        second.complete(Unit)
        advanceUntilIdle()
        assertTrue(done)
        assertEquals(2, runs)
    }

    @Test fun `ein werfender Lauf haelt Wartende nicht fest`() = runTest {
        val c = Coalescer(backgroundScope) { throw IllegalStateException("kaputt") }
        var done = false
        launch { c.requestAndWait(); done = true }
        advanceUntilIdle()
        assertTrue(done)
    }
}
```

`T/CollectionStoreCoreTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionStoreCore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.StoreSource
import com.example.yugiohscanner.cloud.StoreState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class CollectionStoreCoreTest {

    private val t0 = "2026-09-13T12:00:00+00:00"

    private fun card(id: String) = CardRow(id = id, setCode = "LOB-DE001", language = "DE", name = "n",
        imageUrl = null, rarity = "Common", quantity = 1, price = 1.0, updatedAt = t0)

    private fun copy(id: String, deleted: Boolean = false, updatedAt: String = t0) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = deleted, containerId = null, page = null,
        slot = null, tags = null, note = null, updatedAt = updatedAt,
    )

    private fun container(id: String) = ContainerRow(containerId = id, name = id, kind = "box",
        pocketsPerPage = null, color = null, sortOrder = 0, updatedAt = t0)

    /** Nachgebaute Netzquelle: Antworten je Aufruf austauschbar, jeder Aufruf mitgeschrieben. */
    private class FakeSource : StoreSource {
        var cards: suspend (String?) -> List<CardRow> = { emptyList() }
        var copies: suspend (String?) -> List<CopyRow> = { emptyList() }
        var containers: suspend (String?) -> List<ContainerRow> = { emptyList() }
        val calls = mutableListOf<String>()
        override suspend fun loadCards(changedSince: String?) = cards(changedSince).also { calls += "cards:$changedSince" }
        override suspend fun loadCopies(changedSince: String?) = copies(changedSince).also { calls += "copies:$changedSince" }
        override suspend fun loadContainers(changedSince: String?) = containers(changedSince).also { calls += "containers:$changedSince" }
    }

    private fun ready(store: CollectionStoreCore) = store.state.value as StoreState.Ready

    @Test fun `Ready erst, wenn alle drei Tabellen da sind`() = runTest {
        val src = FakeSource()
        val gate = CompletableDeferred<List<CopyRow>>()
        src.cards = { listOf(card("1")) }
        src.copies = { gate.await() }
        src.containers = { listOf(container("b")) }
        val store = CollectionStoreCore(src, backgroundScope) { Instant.EPOCH }
        launch { store.loadInitial() }
        advanceUntilIdle()
        assertEquals(StoreState.Loading, store.state.value)
        gate.complete(listOf(copy("a")))
        advanceUntilIdle()
        assertEquals(listOf("a"), ready(store).copies.map { it.copyId })
        assertEquals(listOf("1"), ready(store).cards.map { it.id })
        assertEquals(listOf("b"), ready(store).containers.map { it.containerId })
    }

    @Test fun `scheitert eine Tabelle beim ersten Laden, bleibt nichts halb`() = runTest {
        val src = FakeSource()
        src.copies = { throw RuntimeException("kaputt") }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        assertEquals(StoreState.Failed("kaputt"), store.state.value)
    }

    @Test fun `Delta fragt ab Stichtag minus 60 Sekunden, leere Tabelle ab 1970`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        src.calls.clear()
        store.awaitSync()
        assertTrue(src.calls.contains("copies:2026-09-13T11:59:00Z"))
        assertTrue(src.calls.contains("cards:1970-01-01T00:00:00Z"))
    }

    @Test fun `Delta arbeitet Aenderungen und Loeschungen ein`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a"), copy("b")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        src.copies = { listOf(copy("b", deleted = true), copy("c", updatedAt = "2026-09-13T12:05:00+00:00")) }
        store.awaitSync()
        assertEquals(listOf("a", "c"), ready(store).copies.map { it.copyId })
        src.calls.clear()
        store.awaitSync()
        assertTrue("Stichtag rueckt auf den spaetesten gelieferten Zeitpunkt", src.calls.contains("copies:2026-09-13T12:04:00Z"))
    }

    @Test fun `Abgleich ohne Aenderung laesst den Datenzustand unberuehrt`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        val before = store.state.value
        store.awaitSync()
        assertSame(before, store.state.value)
    }

    @Test fun `Abgleich-Fehler behaelt Daten und Stichtag`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope) { Instant.parse("2026-09-13T12:00:00Z") }
        store.loadInitial()
        val before = store.state.value
        src.copies = { throw RuntimeException("offline") }
        store.awaitSync()
        assertSame(before, store.state.value)
        assertTrue(store.sync.value.failing)
        assertEquals(Instant.parse("2026-09-13T12:00:00Z"), store.sync.value.lastSuccess)
        src.copies = { emptyList() }
        src.calls.clear()
        store.awaitSync()
        assertTrue("Stichtag unveraendert", src.calls.contains("copies:2026-09-13T11:59:00Z"))
        assertFalse(store.sync.value.failing)
    }

    @Test fun `clear waehrend eines Abgleichs verwirft dessen Ergebnis`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        val gate = CompletableDeferred<Unit>()
        src.copies = { gate.await(); listOf(copy("b")) }
        store.requestSync()
        advanceUntilIdle()
        store.clear()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(StoreState.Empty, store.state.value)
    }

    @Test fun `clear waehrend des ersten Ladens verwirft es`() = runTest {
        val src = FakeSource()
        val gate = CompletableDeferred<Unit>()
        src.copies = { gate.await(); listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        launch { store.loadInitial() }
        advanceUntilIdle()
        store.clear()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(StoreState.Empty, store.state.value)
    }

    @Test fun `ohne Ready fragt der Abgleich nichts ab`() = runTest {
        val src = FakeSource()
        val store = CollectionStoreCore(src, backgroundScope)
        store.awaitSync()
        assertEquals(emptyList<String>(), src.calls)
    }

    @Test fun `zweites loadInitial waehrend Ready laedt nicht erneut`() = runTest {
        val src = FakeSource()
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        src.calls.clear()
        store.loadInitial()
        assertEquals(emptyList<String>(), src.calls)
    }
}
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*CoalescerTest" --tests "*CollectionStoreCoreTest"`
Expected: Kompilierfehler „Unresolved reference: Coalescer / CollectionStoreCore“.

- [ ] **Step 3: Implementierung**

`M/cloud/Coalescer.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.atomic.AtomicLong

/**
 * Laesst `run` nie zweimal gleichzeitig laufen und verschmilzt Anforderungen (Spec §4.3): kommen
 * waehrend eines Laufs beliebig viele an, folgt GENAU EIN weiterer Lauf. So kommt eine eigene
 * Aenderung garantiert an (ihr Lauf beginnt nach dem Schreiben), ohne dass sich Anfragen stapeln.
 *
 * `run` behandelt seine Fehler selbst. Wirft es trotzdem, wird der Fehler hier geschluckt -- ein
 * Wartender, der nie zurueckkehrt, waere schlimmer als ein verschluckter Fehler.
 */
class Coalescer(private val scope: CoroutineScope, private val run: suspend () -> Unit) {
    private val mutex = Mutex()
    private val requested = AtomicLong(0)
    private val covered = MutableStateFlow(0L)

    fun request() {
        requested.incrementAndGet()
        scope.launch { drain() }
    }

    /** Wie request(), kehrt aber erst zurueck, wenn ein Lauf fertig ist, der NACH diesem Aufruf begann. */
    suspend fun requestAndWait() {
        val mine = requested.incrementAndGet()
        scope.launch { drain() }
        covered.first { it >= mine }
    }

    private suspend fun drain() {
        // Aeussere Schleife: eine Anforderung, die kam, nachdem der Laufende seine innere Schleife
        // verlassen, aber das Schloss noch nicht freigegeben hatte, wird hier nachgeholt.
        while (requested.get() > covered.value) {
            if (!mutex.tryLock()) return
            try {
                while (true) {
                    val target = requested.get()
                    if (covered.value >= target) break
                    try {
                        run()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        // siehe Klassenkommentar
                    }
                    covered.value = target
                }
            } finally {
                mutex.unlock()
            }
        }
    }
}
```

`M/cloud/CollectionStoreCore.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.DeltaMerge
import com.example.yugiohscanner.ml.SyncCursor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

/** Datenzustand des Speichers (Spec §3.1). */
sealed interface StoreState {
    data object Empty : StoreState
    data object Loading : StoreState
    data class Failed(val message: String) : StoreState
    data class Ready(
        val cards: List<CardRow>,
        val copies: List<CopyRow>,
        val containers: List<ContainerRow>,
    ) : StoreState
}

/**
 * Abgleichstatus, GETRENNT vom Datenzustand: ein erfolgreicher Abgleich ohne Aenderung setzt
 * `lastSuccess` neu, darf aber den Datenfluss nicht beruehren -- sonst zeichnete jede Seite alle 10 s neu.
 */
data class SyncStatus(val lastSuccess: Instant? = null, val failing: Boolean = false)

/**
 * Netzseite des Speichers. `changedSince == null`: vollstaendig, nur lebende Zeilen (Karten mit
 * Menge > 0). Sonst: alle Zeilen mit `updated_at >= changedSince`, AUCH geloeschte -- nur so
 * verschwinden sie lokal.
 */
interface StoreSource {
    suspend fun loadCards(changedSince: String?): List<CardRow>
    suspend fun loadCopies(changedSince: String?): List<CopyRow>
    suspend fun loadContainers(changedSince: String?): List<ContainerRow>
}

/**
 * Der Speicher selbst, ohne Bindung an das Netz -- testbar mit einer nachgebauten Quelle. Das
 * App-weite Exemplar ist `CollectionStore`.
 *
 * Generation: `clear()` erhoeht sie. Jeder Lade- oder Abgleichlauf merkt sich die Generation beim
 * Start und uebernimmt sein Ergebnis nur, wenn sie noch gilt (Spec §4.4) -- ein Lauf aus der Zeit
 * vor dem Abmelden kann nichts zurueckschreiben.
 */
class CollectionStoreCore(
    private val source: StoreSource,
    private val scope: CoroutineScope,
    private val clock: () -> Instant = Instant::now,
) {
    private val _state = MutableStateFlow<StoreState>(StoreState.Empty)
    val state: StateFlow<StoreState> = _state.asStateFlow()

    private val _sync = MutableStateFlow(SyncStatus())
    val sync: StateFlow<SyncStatus> = _sync.asStateFlow()

    private data class Cursors(val cards: String? = null, val copies: String? = null, val containers: String? = null)

    private val lock = Any()
    private var generation = 0L
    private var cursors = Cursors()

    private val deltas = Coalescer(scope) { runDelta() }

    fun startInitialLoad() {
        scope.launch { loadInitial() }
    }

    /** Vollstaendiges Laden. Tut nichts, solange schon geladen wird oder alles da ist. */
    suspend fun loadInitial() {
        val gen = synchronized(lock) {
            val s = _state.value
            if (s is StoreState.Loading || s is StoreState.Ready) return
            _state.value = StoreState.Loading
            generation
        }
        try {
            val (cards, copies, containers) = coroutineScope {
                val c = async { source.loadCards(null) }
                val cp = async { source.loadCopies(null) }
                val ct = async { source.loadContainers(null) }
                Triple(c.await(), cp.await(), ct.await())
            }
            synchronized(lock) {
                if (gen != generation) return
                cursors = Cursors(
                    cards = SyncCursor.advance(null, cards.map { it.updatedAt }),
                    copies = SyncCursor.advance(null, copies.map { it.updatedAt }),
                    containers = SyncCursor.advance(null, containers.map { it.updatedAt }),
                )
                _state.value = StoreState.Ready(
                    cards = DeltaMerge.cards(emptyList(), cards),
                    copies = DeltaMerge.copies(emptyList(), copies),
                    containers = DeltaMerge.containers(emptyList(), containers),
                )
                _sync.value = SyncStatus(lastSuccess = clock(), failing = false)
            }
        } catch (e: CancellationException) {
            synchronized(lock) {
                if (gen == generation && _state.value is StoreState.Loading) _state.value = StoreState.Empty
            }
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _state.value = StoreState.Failed(e.message ?: "Laden fehlgeschlagen")
            }
        }
    }

    fun requestSync() = deltas.request()

    /** Wartet auf einen Abgleich, der nach dem Aufruf beginnt. Wirft nie (ausser bei Abbruch). */
    suspend fun awaitSync() = deltas.requestAndWait()

    fun clear() {
        synchronized(lock) {
            generation++
            cursors = Cursors()
            _state.value = StoreState.Empty
            _sync.value = SyncStatus()
        }
    }

    private suspend fun runDelta() {
        val (gen, cur) = synchronized(lock) {
            if (_state.value !is StoreState.Ready) return
            generation to cursors
        }
        try {
            val (cards, copies, containers) = coroutineScope {
                val c = async { source.loadCards(SyncCursor.lowerBound(cur.cards)) }
                val cp = async { source.loadCopies(SyncCursor.lowerBound(cur.copies)) }
                val ct = async { source.loadContainers(SyncCursor.lowerBound(cur.containers)) }
                Triple(c.await(), cp.await(), ct.await())
            }
            synchronized(lock) {
                if (gen != generation) return
                val now = _state.value as? StoreState.Ready ?: return
                // Gleiche Listen -> gleiches Ready -> StateFlow gibt nichts aus.
                _state.value = StoreState.Ready(
                    cards = DeltaMerge.cards(now.cards, cards),
                    copies = DeltaMerge.copies(now.copies, copies),
                    containers = DeltaMerge.containers(now.containers, containers),
                )
                cursors = Cursors(
                    cards = SyncCursor.advance(cur.cards, cards.map { it.updatedAt }),
                    copies = SyncCursor.advance(cur.copies, copies.map { it.updatedAt }),
                    containers = SyncCursor.advance(cur.containers, containers.map { it.updatedAt }),
                )
                _sync.value = SyncStatus(lastSuccess = clock(), failing = false)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _sync.value = _sync.value.copy(failing = true)
            }
        }
    }
}
```

- [ ] **Step 4: Tests grün, ganze Suite grün**

Run: `cd android && ./gradlew testDebugUnitTest`
Expected: grün. Scheitert ein Test mit `UncompletedCoroutinesError`, prüfe, dass jeder im Test gestartete `launch` durch `gate.complete` beendet wird — nicht den Test lockern.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/Coalescer.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionStoreCore.kt android/app/src/test/java/com/example/yugiohscanner/CoalescerTest.kt android/app/src/test/java/com/example/yugiohscanner/CollectionStoreCoreTest.kt
git commit -m "feat(android): CollectionStoreCore mit Delta-Abgleich und Coalescer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Netzquelle und App-weiter `CollectionStore`

**Files:**
- Create: `M/cloud/StoreQueries.kt`, `M/cloud/CollectionStore.kt`, `T/StoreQueriesTest.kt`
- Modify: `M/cloud/CollectionRepository.kt` (neue `fetchCards`/`fetchCopies`, `parse`/`parseCopies` lesen `deleted`/`updated_at`, `COPY_COLS` aus `StoreQueries`)
- Modify: `M/cloud/ContainersRepository.kt` (neue `fetchContainers`, `parseContainer` liest `deleted`/`updated_at`)

**Interfaces:**
- Consumes: `Keyset.after`, `SyncCursor.normalize`, `KeysetPager.all` (Task 1); `StoreSource`, `CollectionStoreCore` (Task 3).
- Produces:
  - `object StoreQueries { const val PAGE = 1000; const val COPY_COLS: String; const val CONTAINER_COLS: String; fun cards(changedSince: String?, after: CardRow?): List<Pair<String, String>>; fun copies(changedSince: String?, after: CopyRow?): List<Pair<String, String>>; fun containers(changedSince: String?, after: ContainerRow?): List<Pair<String, String>> }`
  - `CollectionRepository.fetchCards(changedSince: String?): List<CardRow>`, `CollectionRepository.fetchCopies(changedSince: String?): List<CopyRow>`, `ContainersRepository.fetchContainers(changedSince: String?): List<ContainerRow>`
  - `object CollectionStore { val state: StateFlow<StoreState>; val sync: StateFlow<SyncStatus>; fun startInitialLoad(); fun requestSync(); suspend fun awaitSync(); fun clear() }`

- [ ] **Step 1: Failing Test schreiben**

`T/StoreQueriesTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.StoreQueries
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** Die Abfrageparameter des Speichers -- am Server wird nicht getestet, also hier Zeichen fuer Zeichen. */
class StoreQueriesTest {

    private fun copy(id: String, updatedAt: String) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = false, containerId = null, page = null,
        slot = null, tags = null, note = null, updatedAt = updatedAt,
    )

    @Test fun `Exemplare vollstaendig, erste Seite`() {
        assertEquals(
            listOf(
                "select" to StoreQueries.COPY_COLS,
                "deleted" to "eq.false",
                "order" to "copy_id.asc",
                "limit" to "1000",
            ),
            StoreQueries.copies(null, null),
        )
    }

    @Test fun `Exemplare vollstaendig, Folgeseite nach Schluessel`() {
        val p = StoreQueries.copies(null, copy("u7", "2026-09-13T12:00:00+00:00"))
        assertEquals("or" to "(copy_id.gt.\"u7\")", p.last())
    }

    @Test fun `Exemplare Delta enthaelt geloeschte und blaettert nach Zeitstempel und Schluessel`() {
        val p = StoreQueries.copies("2026-09-13T11:59:00Z", copy("u7", "2026-09-13T12:00:00.5+00:00"))
        assertEquals(
            listOf(
                "select" to StoreQueries.COPY_COLS,
                "updated_at" to "gte.2026-09-13T11:59:00Z",
                "order" to "updated_at.asc,copy_id.asc",
                "limit" to "1000",
                "or" to "(updated_at.gt.\"2026-09-13T12:00:00.500Z\",and(updated_at.eq.\"2026-09-13T12:00:00.500Z\",copy_id.gt.\"u7\"))",
            ),
            p,
        )
        assertFalse("kein deleted-Filter im Delta", p.any { it.first == "deleted" })
        assertFalse("kein Plus in der URL", p.any { it.second.contains('+') })
    }

    @Test fun `Karten vollstaendig filtern lebende mit Menge und sortieren nach Schluessel`() {
        val after = CardRow(id = "1", setCode = "LOB-DE001", language = "DE", name = null, imageUrl = null,
            rarity = "Secret Rare", quantity = 1, price = null)
        val p = StoreQueries.cards(null, after)
        assertEquals("select" to "*", p[0])
        assertEquals("deleted" to "eq.false", p[1])
        assertEquals("quantity" to "gt.0", p[2])
        assertEquals("order" to "id.asc,set_code.asc,language.asc,rarity.asc", p[3])
        assertEquals("or", p.last().first)
    }

    @Test fun `Karten Delta ohne Mengen- und Loeschfilter`() {
        val p = StoreQueries.cards("2026-09-13T11:59:00Z", null)
        assertEquals(
            listOf(
                "select" to "*",
                "updated_at" to "gte.2026-09-13T11:59:00Z",
                "order" to "updated_at.asc,id.asc,set_code.asc,language.asc,rarity.asc",
                "limit" to "1000",
            ),
            p,
        )
    }

    @Test fun `Behaelter vollstaendig und Delta`() {
        assertEquals(
            listOf("select" to StoreQueries.CONTAINER_COLS, "deleted" to "eq.false", "order" to "container_id.asc", "limit" to "1000"),
            StoreQueries.containers(null, null),
        )
        assertEquals(
            "order" to "updated_at.asc,container_id.asc",
            StoreQueries.containers("1970-01-01T00:00:00Z", null)[2],
        )
    }

    @Test fun `Spaltenlisten enthalten updated_at`() {
        assertEquals(
            "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,created_at,updated_at",
            StoreQueries.COPY_COLS,
        )
        assertEquals("container_id,name,kind,pockets_per_page,color,sort_order,deleted,updated_at", StoreQueries.CONTAINER_COLS)
    }
}
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*StoreQueriesTest"`
Expected: „Unresolved reference: StoreQueries“.

- [ ] **Step 3: `StoreQueries` implementieren**

`M/cloud/StoreQueries.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.SyncCursor

/**
 * Query-Parameter der Voll- und Delta-Abfragen des Speichers (Spec §4.1, §4.3) -- rein, damit sie
 * ohne Server getestet werden koennen.
 *
 * Vollstaendig (`changedSince == null`): nur lebende Zeilen, sortiert und geblaettert nach Schluessel.
 * Delta: `updated_at >= changedSince` OHNE Loesch-/Mengenfilter, sortiert und geblaettert nach
 * (updated_at, Schluessel). Zeitstempel gehen in der Form `SyncCursor.normalize` hinaus -- mit `Z`,
 * denn ein `+` in der URL hiesse Leerzeichen.
 *
 * `cards` bleibt bei `select=*` (Spec §4.1, "Spalten").
 */
object StoreQueries {
    const val PAGE = 1000

    const val COPY_COLS =
        "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,created_at,updated_at"
    const val CONTAINER_COLS = "container_id,name,kind,pockets_per_page,color,sort_order,deleted,updated_at"

    private val CARD_KEY = listOf("id", "set_code", "language", "rarity")

    fun cards(changedSince: String?, after: CardRow?): List<Pair<String, String>> =
        if (changedSince == null) {
            build("*", listOf("deleted" to "eq.false", "quantity" to "gt.0"), CARD_KEY, after?.let(::cardKey))
        } else {
            build("*", listOf("updated_at" to "gte.$changedSince"), listOf("updated_at") + CARD_KEY,
                after?.let { listOf(stamp(it.updatedAt)) + cardKey(it) })
        }

    fun copies(changedSince: String?, after: CopyRow?): List<Pair<String, String>> =
        if (changedSince == null) {
            build(COPY_COLS, listOf("deleted" to "eq.false"), listOf("copy_id"), after?.let { listOf(it.copyId) })
        } else {
            build(COPY_COLS, listOf("updated_at" to "gte.$changedSince"), listOf("updated_at", "copy_id"),
                after?.let { listOf(stamp(it.updatedAt), it.copyId) })
        }

    fun containers(changedSince: String?, after: ContainerRow?): List<Pair<String, String>> =
        if (changedSince == null) {
            build(CONTAINER_COLS, listOf("deleted" to "eq.false"), listOf("container_id"), after?.let { listOf(it.containerId) })
        } else {
            build(CONTAINER_COLS, listOf("updated_at" to "gte.$changedSince"), listOf("updated_at", "container_id"),
                after?.let { listOf(stamp(it.updatedAt), it.containerId) })
        }

    private fun build(
        select: String,
        filters: List<Pair<String, String>>,
        keyColumns: List<String>,
        after: List<String>?,
    ): List<Pair<String, String>> {
        val p = ArrayList<Pair<String, String>>()
        p += "select" to select
        p += filters
        p += "order" to keyColumns.joinToString(",") { "$it.asc" }
        p += "limit" to PAGE.toString()
        if (after != null) p += "or" to Keyset.after(keyColumns, after)
        return p
    }

    private fun cardKey(c: CardRow) = listOf(c.id, c.setCode, c.language, c.rarity ?: "Unknown")

    private fun stamp(s: String?): String =
        SyncCursor.normalize(s ?: throw IllegalStateException("Delta-Zeile ohne updated_at"))
}
```

- [ ] **Step 4: Test grün**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*StoreQueriesTest"` → PASS.

- [ ] **Step 5: Repository-Abfragen ergänzen**

In `M/cloud/CollectionRepository.kt`:

1. Die Konstante `private const val COPY_COLS = …` (Zeilen 25-31 samt Kommentar) ersetzen durch:

```kotlin
    // Spalten jedes card_copies-Reads -- eine Quelle mit den Speicher-Abfragen (StoreQueries),
    // damit ein Exemplar ueberall dieselben Felder traegt. created_at und updated_at sind NUR
    // gelesen; kein Schreibweg hier sendet sie (siehe CopyRow).
    private const val COPY_COLS = StoreQueries.COPY_COLS
```

2. Import ergänzen: `import com.example.yugiohscanner.ml.KeysetPager`.

3. Nach `private fun auth(…)` einfügen:

```kotlin
    // Voll- und Delta-Abfragen des Speichers (Spec §4). Blaettern nach Schluessel, siehe Keyset.
    suspend fun fetchCards(changedSince: String?): List<CardRow> =
        KeysetPager.all(StoreQueries.PAGE) { after ->
            getPage("cards", StoreQueries.cards(changedSince, after), "Karten laden") { parse(it) }
        }

    suspend fun fetchCopies(changedSince: String?): List<CopyRow> =
        KeysetPager.all(StoreQueries.PAGE) { after ->
            getPage("card_copies", StoreQueries.copies(changedSince, after), "Exemplare laden") { parseCopies(it) }
        }

    private suspend fun <T> getPage(
        table: String,
        params: List<Pair<String, String>>,
        what: String,
        parseRows: (JSONArray) -> List<T>,
    ): List<T> = withContext(Dispatchers.IO) {
        val b = "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
        for ((k, v) in params) b.addQueryParameter(k, v)
        executeWithReauth { auth(Request.Builder().url(b.build())).get().build() }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${resp.code}): $text")
            parseRows(JSONArray(text))
        }
    }
```

4. In `parseCopies` nach `createdAt = …,` ergänzen:

```kotlin
            updatedAt = if (o.isNull("updated_at")) null else o.optString("updated_at"),
```

5. In `parse` nach `attribute = o.strOrNull("attribute"),` ergänzen:

```kotlin
                    deleted = o.optBoolean("deleted", false),
                    updatedAt = o.strOrNull("updated_at"),
```

In `M/cloud/ContainersRepository.kt`:

1. Import ergänzen: `import com.example.yugiohscanner.ml.KeysetPager`.
2. Nach `suspend fun list()` einfügen:

```kotlin
    // Voll- und Delta-Abfrage des Speichers (Spec §4), gleiche Bauart wie CollectionRepository.fetchCopies.
    suspend fun fetchContainers(changedSince: String?): List<ContainerRow> =
        KeysetPager.all(StoreQueries.PAGE) { after ->
            val b = "${SupabaseCloud.base()}/rest/v1/containers".toHttpUrl().newBuilder()
            for ((k, v) in StoreQueries.containers(changedSince, after)) b.addQueryParameter(k, v)
            getArray(b.build()).let { arr -> (0 until arr.length()).map { parseContainer(arr.getJSONObject(it)) } }
        }
```

3. `parseContainer` nach `sortOrder = o.optInt("sort_order", 0),` ergänzen:

```kotlin
        deleted = o.optBoolean("deleted", false),
        updatedAt = if (o.isNull("updated_at")) null else o.optString("updated_at"),
```

- [ ] **Step 6: App-weiten Speicher anlegen**

`M/cloud/CollectionStore.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow

/** Die echte Netzquelle des Speichers: Supabase ueber die Repositories. */
object CloudStoreSource : StoreSource {
    override suspend fun loadCards(changedSince: String?) = CollectionRepository.fetchCards(changedSince)
    override suspend fun loadCopies(changedSince: String?) = CollectionRepository.fetchCopies(changedSince)
    override suspend fun loadContainers(changedSince: String?) = ContainersRepository.fetchContainers(changedSince)
}

/**
 * Der App-weite Speicher fuer Karten, Exemplare und Behaelter (Spec §3). Lebt so lange wie der
 * Prozess. Bildschirme lesen `state`; nach eigenen Schreibvorgaengen `awaitSync()`.
 */
object CollectionStore {
    private val core = CollectionStoreCore(CloudStoreSource, CoroutineScope(SupervisorJob() + Dispatchers.IO))

    val state: StateFlow<StoreState> get() = core.state
    val sync: StateFlow<SyncStatus> get() = core.sync

    fun startInitialLoad() = core.startInitialLoad()
    fun requestSync() = core.requestSync()
    suspend fun awaitSync() = core.awaitSync()
    fun clear() = core.clear()
}
```

- [ ] **Step 7: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/StoreQueries.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionStore.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/ContainersRepository.kt android/app/src/test/java/com/example/yugiohscanner/StoreQueriesTest.kt
git commit -m "feat(android): Netzquelle mit Schluessel-Blaettern und App-weiter CollectionStore

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Ladebildschirm, Takt, An-/Abmelden, Abgleich-Hinweis

**Files:**
- Create: `M/ui/StartupLoadingScreen.kt`, `M/ui/SyncHint.kt`
- Modify: `M/ui/AppNav.kt`, `M/ui/SammlungScreen.kt`

**Interfaces:**
- Consumes: `CollectionStore`, `StoreState`, `SyncStatus` (Tasks 3–4).
- Produces: `@Composable fun StartupLoadingScreen(state: StoreState, onRetry: () -> Unit, onLogout: () -> Unit)`, `@Composable fun SyncHint(modifier: Modifier = Modifier)`.

Hinweis: Nach dieser Task laden die Bildschirme ihre Daten zusätzlich noch selbst — das verschwindet in Tasks 6–9. Die App muss nach jeder Task bauen und funktionieren.

- [ ] **Step 1: `StartupLoadingScreen` anlegen**

`M/ui/StartupLoadingScreen.kt`:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

/**
 * Spec §3.3: steht zwischen Anmeldung und App, bis Karten, Exemplare und Behaelter geladen sind.
 * Eine halb gefuellte App gibt es nicht -- scheitert das Laden, bleibt es bei Meldung und
 * "Erneut versuchen" (und "Abmelden", damit ein falsches Konto nicht festhaelt).
 */
@Composable
fun StartupLoadingScreen(state: StoreState, onRetry: () -> Unit, onLogout: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (state is StoreState.Failed) {
                Text("Sammlung konnte nicht geladen werden", style = MaterialTheme.typography.titleMedium, color = OnSurface)
                Spacer(Modifier.height(8.dp))
                Text(state.message, style = MaterialTheme.typography.bodySmall, color = ErrorColor, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                Button(onClick = onRetry) { Text("Erneut versuchen") }
                TextButton(onClick = onLogout) { Text("Abmelden", color = Muted) }
            } else {
                CircularProgressIndicator(color = Primary)
                Spacer(Modifier.height(16.dp))
                Text("Sammlung wird geladen …", style = MaterialTheme.typography.bodyMedium, color = OnSurface)
            }
        }
    }
}
```

- [ ] **Step 2: `SyncHint` anlegen**

`M/ui/SyncHint.kt`:

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.ui.theme.ErrorColor
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val SYNC_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

/**
 * Spec §6: scheitert der Abgleich im Hintergrund, bleiben die Daten stehen -- dieser Hinweis sagt,
 * seit wann. Verschwindet beim naechsten erfolgreichen Abgleich.
 */
@Composable
fun SyncHint(modifier: Modifier = Modifier) {
    val sync by CollectionStore.sync.collectAsState()
    if (!sync.failing) return
    val seit = sync.lastSuccess?.let { SYNC_TIME.format(it) }
    Text(
        if (seit != null) "Nicht abgeglichen seit $seit – nächster Versuch läuft" else "Nicht abgeglichen – nächster Versuch läuft",
        color = ErrorColor,
        style = MaterialTheme.typography.labelSmall,
        modifier = modifier,
    )
}
```

- [ ] **Step 3: `AppNav` umbauen**

In `M/ui/AppNav.kt`:

1. Imports ergänzen:

```kotlin
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.StoreState
import kotlinx.coroutines.delay
```

2. Direkt nach `var cloudReady by remember { mutableStateOf(false) }`:

```kotlin
    val storeState by CollectionStore.state.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current
```

3. Direkt nach dem zweiten `LaunchedEffect(Unit) { CatalogSync…; ModelStore… }` und VOR `val entry by nav.currentBackStackEntryAsState()`:

```kotlin
    // Spec §3.4: solange die App sichtbar ist, alle 10 s ein Abgleich; im Hintergrund keiner.
    // repeatOnLifecycle startet den Block beim Zurueckkommen neu -- das ist der sofortige Abgleich.
    LaunchedEffect(cloudReady) {
        if (!cloudReady) return@LaunchedEffect
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                CollectionStore.requestSync()
                delay(10_000)
            }
        }
    }
    // Spec §3.3: nach der Anmeldung erst laden. Der Speicher startet das Laden in seinem eigenen
    // Bereich -- ein Wechsel dieses Effekts bricht es nicht ab.
    LaunchedEffect(cloudReady, storeState is StoreState.Empty) {
        if (cloudReady && CollectionStore.state.value is StoreState.Empty) CollectionStore.startInitialLoad()
    }
    if (cloudReady && storeState !is StoreState.Ready) {
        StartupLoadingScreen(
            state = storeState,
            onRetry = { CollectionStore.startInitialLoad() },
            onLogout = {
                prefs.edit().putString("supabase_password", "").apply()
                SupabaseCloud.signOut()
                CollectionStore.clear()
                cloudReady = false
            },
        )
        return
    }
```

4. Direkt nach `val route = entry?.destination?.route`:

```kotlin
    // Spec §3.4: jeder Wechsel der Destination fordert einen Abgleich an; die Seite zeigt sofort den
    // Speicherstand.
    LaunchedEffect(route) { CollectionStore.requestSync() }
```

5. Jedes `CloudLoginScreen(prefs) { cloudReady = true }` (mehrfach in der Datei) ersetzen durch `CloudLoginScreen(prefs) { CollectionStore.clear(); cloudReady = true }` (Kontowechsel, Spec §4.4).

6. Im `composable(Routes.EINSTELLUNGEN)`-Block `SupabaseCloud.signOut(); cloudReady = false; nav.popBackStack()` ersetzen durch `SupabaseCloud.signOut(); CollectionStore.clear(); cloudReady = false; nav.popBackStack()`.

- [ ] **Step 4: Hinweis in der Sammlung**

In `M/ui/SammlungScreen.kt` direkt nach dem `Text("Sammlung", …)`-Aufruf:

```kotlin
        SyncHint(Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
```

- [ ] **Step 5: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/StartupLoadingScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SyncHint.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/ui/SammlungScreen.kt
git commit -m "feat(android): Ladebildschirm, 10-s-Takt und Abgleich-Hinweis

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Kartendetail und Exemplar-Sheet lesen aus dem Speicher

**Files:**
- Modify: `M/ui/CardDetailScreen.kt:52-92, 204, 231`
- Modify: `M/ui/CopySheet.kt:58-64, 87-95`
- Modify (nur Aufrufstellen von `CardDetailScreen`): `M/ui/CollectionScreen.kt:142-150`, `M/ui/BindersScreen.kt:140-148`, `M/ui/BinderPageScreen.kt:193-209`

**Interfaces:**
- Consumes: `CollectionStore.state`, `CollectionStore.awaitSync()`, `StoreState.Ready`, `TagVocabulary.from`.
- Produces: `@Composable fun CardDetailScreen(cardId: String, onClose: () -> Unit)` (Parameter `initial`, `initialCopies`, `onChanged` entfallen).

Hinweis: Nach dieser Task gleichen Sammlung, Binder und Binder-Seite ihre eigenen Listen nach einer Änderung im Kartendetail nicht mehr nach — sie werden in Tasks 7–8 auf den Speicher umgestellt. Das Kartendetail selbst zeigt den neuen Stand sofort.

- [ ] **Step 1: `CardDetailScreen` umstellen**

Kopf der Funktion (Zeilen 52-55) wird zu:

```kotlin
@Composable
fun CardDetailScreen(cardId: String, onClose: () -> Unit) {
    // Spec §5: Drucke, Exemplare und Behaelter aus dem Speicher, nach Karte gefiltert. `remember`
    // haengt an der Listen-Identitaet -- ein Abgleich ohne Aenderung liefert dieselbe Liste.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val printings = remember(ready?.cards, cardId) { ready?.cards?.filter { it.id == cardId } ?: emptyList() }
    val copies = remember(ready?.copies, cardId) { ready?.copies?.filter { it.cardId == cardId } ?: emptyList() }
    val containers = ready?.containers ?: emptyList()
```

Zeilen 66-74 (Kommentar Spec B1 §10.3, `var containers`, `var sheetCopy`, `LaunchedEffect(Unit) { containers = … }`) werden zu:

```kotlin
    var sheetCopy by remember { mutableStateOf<CopyRow?>(null) }
```

Zeilen 85-92 (`refresh()` und `val base = …`) werden zu:

```kotlin
    // Nach jedem Schreibvorgang: abgleichen statt selbst nachladen (Spec §5). awaitSync wirft nie --
    // ein gescheiterter Abgleich zeigt sich im Hinweis, nicht als Absturz (Spec §7.2).
    suspend fun refresh() {
        CollectionStore.awaitSync()
    }

    val base = printings.firstOrNull()
    if (base == null) { onClose(); return }
```

Zeile 204 und 231 bleiben textlich (`scope.launch { refresh() }`) — `refresh()` wirft jetzt nicht mehr.

Imports ergänzen: `androidx.compose.runtime.collectAsState`, `com.example.yugiohscanner.cloud.CollectionStore`, `com.example.yugiohscanner.cloud.StoreState`. Nicht mehr genutzte Imports (`ContainersRepository`, ggf. `ContainerRow`) entfernen.

- [ ] **Step 2: Aufrufstellen anpassen**

In `CollectionScreen.kt`, `BindersScreen.kt` und `BinderPageScreen.kt` wird der jeweilige Aufruf `CardDetailScreen(cardId = id, initial = cards, initialCopies = copies, onClose = { detailId = null }, onChanged = { … })` (in BinderPageScreen samt dem Kommentar über `onChanged`) zu:

```kotlin
        CardDetailScreen(cardId = id, onClose = { detailId = null })
```

- [ ] **Step 3: `CopySheet` umstellen**

Zeilen 58-64 (`var containers`, `var tagSuggestions`, Kommentar, `var loadError`) werden zu:

```kotlin
    // Spec §5: Behaelter und Tag-Vorschlaege aus dem Speicher -- das Sheet oeffnet ohne Netzabfrage.
    // Die Meldung bleibt fuer den Fall, dass der Speicher nicht bereit ist: eine leere Behaelterliste
    // darf nicht wie "kein Behaelter gewaehlt" aussehen, sonst verschwindet ein echter Standort beim
    // Speichern lautlos.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val containers = ready?.containers ?: emptyList()
    val tagSuggestions = remember(ready?.copies) { TagVocabulary.from(ready?.copies ?: emptyList()) }
    val loadError = if (ready == null) "Sammlung ist nicht geladen." else null
```

Zeilen 87-95 (`LaunchedEffect(Unit) { … ContainersRepository.list() … listTags() … }`) ersatzlos löschen.

Imports ergänzen: `androidx.compose.runtime.collectAsState`, `com.example.yugiohscanner.cloud.CollectionStore`, `com.example.yugiohscanner.cloud.StoreState`, `com.example.yugiohscanner.ml.TagVocabulary`; ungenutzte (`ContainersRepository`, `LaunchedEffect`, falls ungenutzt) entfernen.

- [ ] **Step 4: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/BindersScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/BinderPageScreen.kt
git commit -m "refactor(android): Kartendetail und Exemplar-Sheet lesen aus dem Speicher

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Sammlung und Binder-Liste lesen aus dem Speicher; `ReloadScope` entfällt

**Files:**
- Modify: `M/ui/CollectionScreen.kt:85-138, 257-267`
- Modify: `M/ui/BindersScreen.kt:81-136, 171-240, 309-313`
- Delete: `M/ml/ReloadScope.kt`, `T/ReloadScopeTest.kt`

**Interfaces:**
- Consumes: `CollectionStore.state`, `CollectionStore.awaitSync()`, `TagVocabulary.from`.

- [ ] **Step 1: `CollectionScreen` umstellen**

Zeilen 85-86 (`var cards`, `var copies`) und 89-90 (`var loading`, `var errorMsg`) entfernen. Zeilen 107-138 (`var containers`, `var tagOptions`, `vocabError` samt Kommentar, `reload()`, beide `LaunchedEffect(Unit)`) ersetzen durch:

```kotlin
    // Spec §5: alles aus dem Speicher; Tag-Vorschlaege aus den Exemplaren im Speicher statt aus einem
    // zweiten Durchlauf durch alle Zeilen. Der Ladebildschirm garantiert Ready -- keine eigene
    // Ladeanzeige und kein eigener Ladefehler mehr.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    val containers = ready?.containers ?: emptyList()
    val tagOptions = remember(ready?.copies) { TagVocabulary.from(copies) }
```

Zeilen 257-267 (`errorMsg?.let { … }`, Kommentar + `vocabError?.let { … }`, `if (loading) { CircularProgressIndicator(); return@Column }`) ersatzlos löschen.

Nicht mehr genutzte Imports und Variablen entfernen (z. B. `CollectionRepository`, `ContainersRepository`, `async`, `coroutineScope`, `launch`, `scope` — nur was der Compiler als ungenutzt meldet bzw. was keine Referenz mehr hat). Imports ergänzen: `collectAsState`, `CollectionStore`, `StoreState`, `TagVocabulary`.

- [ ] **Step 2: `BindersScreen` umstellen**

Zeilen 81-85 (`val containers = remember { mutableStateListOf… }`, `var cards`, `var copies`, `var loading`, `var error`) werden zu:

```kotlin
    // Spec §5: aus dem Speicher. `error` bleibt -- fuer Schreibfehler.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val containers = ready?.containers ?: emptyList()
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    var error by remember { mutableStateOf<String?>(null) }
```

Zeilen 104-136 (Kommentar, `reload()`, `LaunchedEffect(Unit)`) ersatzlos löschen.

In `submitDialog()` die Zeilen 181-185 (Kommentar zu ReloadScope, `vorherigeArt`, `umfang`) löschen und den `scope.launch`-Block (190-217) ersetzen durch:

```kotlin
        scope.launch {
            try {
                ContainersRepository.save(
                    ContainerRow(
                        containerId = form.containerId ?: UUID.randomUUID().toString(),
                        name = form.name, kind = form.kind, pocketsPerPage = pockets,
                        color = form.color, sortOrder = form.sortOrder,
                    )
                )
                dialog = null
                // Abgleichen statt nachladen (Spec §5). awaitSync wirft nie: scheitert der Abgleich,
                // zeigt das der Hinweis -- nicht der schon geschlossene Dialog.
                CollectionStore.awaitSync()
                error = null
            } catch (e: Exception) {
                dialogError = e.message ?: "Speichern fehlgeschlagen."
            } finally {
                saving = false
                savingRef[0] = false
            }
        }
```

`deleteContainer` (220-240) wird zu:

```kotlin
    fun deleteContainer(c: ContainerRow) {
        pendingDelete = null
        scope.launch {
            try {
                ContainersRepository.delete(c.containerId)
                error = null
            } catch (e: Exception) {
                error = e.message ?: "Löschen fehlgeschlagen"
            }
            // In BEIDEN Faellen abgleichen: delete() raeumt Standorte und Behaelter in zwei getrennten
            // Aufrufen -- bricht der zweite ab, ist der Zwischenzustand echt und muss sichtbar werden.
            CollectionStore.awaitSync()
        }
    }
```

In der Oberfläche Zeilen 309-313: `if (loading) { Box(…) { CircularProgressIndicator(…) } } else if (containers.isEmpty() && error == null) {` wird zu `if (containers.isEmpty() && error == null) {`.

Imports: `collectAsState`, `CollectionStore`, `StoreState` ergänzen; `ReloadScope`, `CollectionRepository`, `async`, `coroutineScope`, `mutableStateListOf`, `LaunchedEffect` entfernen, sofern ungenutzt.

- [ ] **Step 3: `ReloadScope` löschen**

```bash
git rm android/app/src/main/java/com/example/yugiohscanner/ml/ReloadScope.kt android/app/src/test/java/com/example/yugiohscanner/ReloadScopeTest.kt
```

Prüfen, dass es keine Referenz mehr gibt: `grep -rn "ReloadScope" android/app/src` → keine Treffer.

- [ ] **Step 4: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL (7 Tests weniger durch `ReloadScopeTest`).

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/BindersScreen.kt
git commit -m "refactor(android): Sammlung und Binder-Liste aus dem Speicher, ReloadScope entfaellt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(`git rm` hat die Löschungen bereits gestaged.)

---

### Task 8: Binder-Seite und Einsortier-Modus

**Files:**
- Modify: `M/ui/BinderPageScreen.kt:93-99, 138-185, 223-240, 244-274, 399`
- Modify: `M/ui/SortIntoBinderScreen.kt:229-253`
- Modify: `M/ui/AppNav.kt` (Block `composable(Routes.EINSORTIEREN)`, `onDone`)

**Interfaces:**
- Consumes: `CollectionStore.state`, `CollectionStore.awaitSync()`, `CollectionStore.requestSync()`, `SyncHint`.

- [ ] **Step 1: `BinderPageScreen` umstellen**

Zeilen 95-99 (`var container`, `var containers`, `var cards`, `var copies`, `var loading`) werden zu:

```kotlin
    // Spec §5: aus dem Speicher. Ist der Behaelter dort nicht (z. B. am PC geloescht), zeigt die
    // Seite das statt eines leeren Ordners.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val containers = ready?.containers ?: emptyList()
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    val container = containers.find { it.containerId == containerId }
```

Zeilen 138-167 (Kommentar, `reload()`, `LaunchedEffect(containerId)`) ersatzlos löschen.

Der Kommentar + `LaunchedEffect(seiteNachEinsortieren)` (169-185) wird zu:

```kotlin
    // Rueckweg aus dem Einsortier-Modus (Spec §6.6), in ZWEI Schritten -- absichtlich.
    // Erst abgleichen (der Modus hat Standorte geschrieben, die der Speicher noch nicht kennt) und das
    // Ziel merken; aufgeschlagen wird erst im zweiten Effekt, der an `pageCount` haengt und deshalb
    // mit dem frischen Wert laeuft -- eine neu entstandene letzte Seite wuerde sonst weggeklemmt.
    var seitenZiel by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(seiteNachEinsortieren) {
        val ziel = seiteNachEinsortieren ?: return@LaunchedEffect
        CollectionStore.awaitSync()
        seitenZiel = ziel
        // Raeumt den Rueckkanal weg: ohne das schlaegt jede Neuzusammensetzung dieselbe Seite
        // wieder auf und risse ein Blaettern des Nutzers zurueck.
        onSeiteAufgeschlagen()
    }
```

In `write()` (223-240) `reload()` durch `CollectionStore.awaitSync()` ersetzen; Kommentarzeile „Sperre, Schreiben, Neuladen, Fehler zuruecksetzen“ zu „Sperre, Schreiben, Abgleichen, Fehler zuruecksetzen“.

Direkt nach der Kopfzeile (`Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) … }`, endet vor `error?.let`) einfügen:

```kotlin
            SyncHint(Modifier.padding(top = 4.dp))
```

Zeilen 267-273: 

```kotlin
            if (loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
            } else if (container == null) {
                // Nur erreichbar, wenn reload() geworfen hat -- das Banner oben sagt bereits, was war.
                Spacer(Modifier.weight(1f))
            } else if (isBinder) {
```

wird zu:

```kotlin
            if (container == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Behälter nicht gefunden.", color = Muted)
                }
            } else if (isBinder) {
```

(`Muted` ggf. importieren: `com.example.yugiohscanner.ui.theme.Muted`.)

Zeile 399 (`onSaved = { scope.launch { try { reload(); error = null } catch … } }`) wird zu:

```kotlin
            onSaved = { scope.launch { CollectionStore.awaitSync() } },
```

Imports: `collectAsState`, `CollectionStore`, `StoreState` ergänzen; `ContainersRepository`, `CollectionRepository`, `async`, `coroutineScope`, `CircularProgressIndicator`, `Primary` entfernen, sofern ungenutzt.

- [ ] **Step 2: `SortIntoBinderScreen` umstellen**

`LaunchedEffect(containerId)` (229-253) wird zu:

```kotlin
    LaunchedEffect(containerId) {
        try {
            // Arbeitskopie EINMAL beim Betreten (Spec §5). Danach hoert der Modus nicht mehr auf den
            // Speicher -- ein Abgleich ueberschriebe sonst seine sofortigen lokalen Zuweisungen.
            // Beim Verlassen gleicht AppNav ab (onDone).
            val ready = CollectionStore.state.value as? StoreState.Ready
                ?: throw RuntimeException("Sammlung ist nicht geladen.")
            val gefunden = ready.containers.find { it.containerId == containerId }
                ?: throw RuntimeException("Behälter nicht gefunden.")
            containers = ready.containers
            container = gefunden
            cards = ready.cards
            state = SortSession.start(ready.copies, containerId, gefunden.pocketsPerPage ?: 0)
            error = null
        } catch (e: Exception) {
            error = e.message ?: "Laden fehlgeschlagen"
        } finally {
            loading = false
        }
    }
```

Imports: `CollectionStore`, `StoreState` ergänzen; `async`, `coroutineScope`, `ContainersRepository`, `CollectionRepository` entfernen, sofern ungenutzt.

- [ ] **Step 3: Abgleich beim Verlassen**

In `M/ui/AppNav.kt` im `composable(Routes.EINSORTIEREN)`-Block, im `onDone = { page -> … }`-Lambda direkt vor `nav.popBackStack()`:

```kotlin
                        // Der Modus hat Standorte geschrieben; Scan-Uebernahmen darin ebenfalls (Spec §7.4).
                        CollectionStore.requestSync()
```

- [ ] **Step 4: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/BinderPageScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SortIntoBinderScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt
git commit -m "refactor(android): Binder-Seite und Einsortier-Modus aus dem Speicher

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Start, Sets, Suche, Scan; alte Ladefunktionen entfernen

**Files:**
- Modify: `M/ui/StartScreen.kt:89-102, 117-192, 300-315`
- Modify: `M/ui/SetCompletionScreen.kt:53-87`
- Modify: `M/ui/SearchScreen.kt:94`
- Modify: `M/ui/ScanScreen.kt:656`
- Modify: `M/ui/AppNav.kt` (`composable(Routes.SUCHE)`)
- Modify: `M/cloud/CollectionRepository.kt`, `M/cloud/ContainersRepository.kt` (tote Funktionen)

**Interfaces:**
- Consumes: `CollectionStore`, `StoreState`, `SyncHint`, `UnsortedCopies.from`.

- [ ] **Step 1: `StartScreen` umstellen**

Zeilen 89-90 (`var cards`, `var copies`) werden zu:

```kotlin
    // Spec §5: Karten und Exemplare aus dem Speicher; der Ladebildschirm garantiert Ready.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
```

Zeile 96 (`var loading`) und Zeilen 98-102 (Kommentar, `var unsortedCount`, `var unsortedError`) werden zu:

```kotlin
    // Spec B1 §10.5: Zaehler "Nicht einsortiert", abgeleitet aus den Exemplaren im Speicher.
    val unsortedCount = remember(ready?.copies) { UnsortedCopies.from(copies).size }
```

Der gesamte `LaunchedEffect(Unit) { scope.launch { … } }` (117-184) wird zu:

```kotlin
    LaunchedEffect(Unit) {
        scope.launch {
            // Ohne Ready wird nichts gerechnet und KEIN Tageswert gespeichert -- sonst stuende ein
            // 0-€-Tag im Verlauf (Spec §7.3). Der Ladebildschirm macht das zum Nicht-Fall.
            val r = CollectionStore.state.value as? StoreState.Ready ?: return@launch
            try {
                val sets = SetsRepository.loadSets()
                val ownedByPrefix = HashMap<String, MutableSet<String>>()
                for (card in r.cards) {
                    if (card.setCode.equals("Unknown", ignoreCase = true)) continue
                    val prefix = card.setCode.substringBefore("-").uppercase()
                    if (prefix.isBlank()) continue
                    ownedByPrefix.getOrPut(prefix) { HashSet() }.add(card.setCode)
                }
                setProgress = ownedByPrefix.mapNotNull { (prefix, codes) ->
                    val info = sets[prefix] ?: return@mapNotNull null
                    val owned = codes.size.coerceAtMost(info.total)
                    SetProgressRow(info.name, owned, info.total)
                }
                    .filter { it.owned < it.total }            // not yet complete
                    .sortedByDescending { it.owned.toFloat() / it.total }
                    .take(3)
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }

            try {
                val dash = computeDashboard(r.cards, r.copies)
                // Record today's value + read the history for the chart. Non-fatal if the
                // portfolio_snapshots table isn't set up yet.
                SnapshotsRepository.upsertToday(dash.totalValue, dash.totalCards)
                snapshots = SnapshotsRepository.loadSnapshots()
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }

            try {
                val alerts = DealsRepository.loadAlerts()
                dealAlertCount = alerts.size
                topDeals = alerts.take(2)
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }
        }
    }
```

Zeilen 187-192 (`if (loading) { Box … return@Surface }`) ersatzlos löschen.

Nach der Kopfzeile (`Row { Text("Start", …) … IconButton … }`, endet vor dem Katalog-Kommentar) einfügen:

```kotlin
            SyncHint()
```

Im Zähler (um Zeile 307/312): `if (unsortedError) "—" else "$unsortedCount"` → `"$unsortedCount"`, und `"Nicht einsortiert" + if (unsortedError) " (Ladefehler)" else ""` → `"Nicht einsortiert"`.

Imports: `collectAsState`, `CollectionStore`, `StoreState` ergänzen; `CollectionRepository`, `async`, `coroutineScope` entfernen, sofern ungenutzt.

- [ ] **Step 2: `SetCompletionScreen` umstellen**

Zeilen 53-87 (Kopf bis Ende des `LaunchedEffect`) werden zu:

```kotlin
@Composable
fun SetCompletionScreen(onClose: (() -> Unit)? = null) {
    // Spec §5: Karten aus dem Speicher; die Set-Liste laedt weiter pro Aufruf (Phase 2 speichert sie).
    val store by CollectionStore.state.collectAsState()
    val cards = (store as? StoreState.Ready)?.cards ?: emptyList()
    var sets by remember { mutableStateOf<Map<String, SetInfo>?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            sets = SetsRepository.loadSets()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    val rows = remember(cards, sets) {
        val s = sets ?: return@remember emptyList<SetProgress>()
        // Distinct set codes owned, grouped by set prefix (skip the "Unknown" bucket).
        val ownedByPrefix = HashMap<String, MutableSet<String>>()
        for (c in cards) {
            if (c.setCode.equals("Unknown", ignoreCase = true)) continue
            val prefix = c.setCode.substringBefore("-").uppercase()
            if (prefix.isBlank()) continue
            ownedByPrefix.getOrPut(prefix) { HashSet() }.add(c.setCode)
        }
        ownedByPrefix.mapNotNull { (prefix, codes) ->
            val info = s[prefix] ?: return@mapNotNull null
            SetProgress(info.name, prefix, codes.size.coerceAtMost(info.total), info.total)
        }.sortedByDescending { it.owned.toFloat() / it.total }
    }
```

Imports: `androidx.compose.runtime.collectAsState`, `com.example.yugiohscanner.cloud.CollectionStore`, `com.example.yugiohscanner.cloud.StoreState`, `com.example.yugiohscanner.cloud.SetInfo` ergänzen; `CollectionRepository`, `kotlinx.coroutines.async`, `kotlinx.coroutines.coroutineScope` entfernen.

- [ ] **Step 3: Suche und Scan**

`M/ui/SearchScreen.kt` Zeile 94:

```kotlin
                    owned = (CollectionStore.state.value as? StoreState.Ready)?.cards ?: emptyList()
```

(Imports `CollectionStore`, `StoreState` ergänzen; `CollectionRepository` entfernen, sofern ungenutzt.)

`M/ui/AppNav.kt`, Block `composable(Routes.SUCHE)`: `SearchScreen(onClose = { nav.popBackStack() }, onAdded = {})` → `SearchScreen(onClose = { nav.popBackStack() }, onAdded = { CollectionStore.requestSync() })`.

`M/ui/ScanScreen.kt` direkt nach `capture.forget((committed + ohneStandort).map { it.passcode })`:

```kotlin
                        // Angelegte Exemplare in den Speicher holen (Spec §7.4).
                        CollectionStore.requestSync()
```

(Import `com.example.yugiohscanner.cloud.CollectionStore` ergänzen.)

- [ ] **Step 4: Tote Ladefunktionen entfernen**

Prüfen und entfernen, was keinen Aufrufer mehr hat:

```bash
grep -rn "loadCards()\|loadCopies()\|loadCardsFor(\|loadCopiesFor(\|listTags()\|ContainersRepository.list()" android/app/src/main
```

Erwartet: Treffer nur noch in den Definitionen selbst (bzw. `DecksRepository.loadCards(deckId)` — die ist eine andere Funktion und bleibt). Dann in `CollectionRepository.kt` `loadCards()`, `loadCardsFor()`, `loadCopiesFor()`, `loadCopies()`, `listTags()` samt Kommentaren löschen; in `ContainersRepository.kt` `list()`. `getArray` bleibt (von `fetchContainers` genutzt). Kommentare in `UnsortedCopies.kt`, `BinderPageScreen.kt`, `BindersScreen.kt`, die abgelöste Aufrufe als Geschichte erwähnen, bleiben unverändert.

- [ ] **Step 5: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SetCompletionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SearchScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/ContainersRepository.kt
git commit -m "refactor(android): Start, Sets, Suche und Scan aus dem Speicher; alte Ladewege entfernt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# PHASE 2

### Task 10: `ListCache` und `SideStores`

**Files:**
- Create: `M/cloud/ListCache.kt`, `M/cloud/SideStores.kt`, `T/ListCacheTest.kt`

**Interfaces:**
- Consumes: `Coalescer` (Task 3).
- Produces:
  - `data class CacheState<T>(val value: T? = null, val loading: Boolean = false, val error: String? = null)`
  - `class ListCache<T>(scope: CoroutineScope, loader: suspend () -> T) { val state: StateFlow<CacheState<T>>; fun refresh(); suspend fun refreshAndWait(); fun ensureLoaded(); fun update(transform: (T) -> T); fun clear() }`
  - `object SideStores { val wishlist: ListCache<List<WishlistItem>>; val decks: ListCache<List<Deck>>; val dealWatches: ListCache<List<DealWatch>>; val dealAlerts: ListCache<List<DealAlert>>; val sets: ListCache<Map<String, SetInfo>>; fun deckCards(deckId: Long): ListCache<List<DeckCard>>; fun clearAll() }`

- [ ] **Step 1: Failing Test schreiben**

`T/ListCacheTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListCache
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Kleine Listen ohne updated_at: sofort den letzten Stand zeigen, im Hintergrund voll neu laden (Spec §8). */
@OptIn(ExperimentalCoroutinesApi::class)
class ListCacheTest {

    @Test fun `refreshAndWait laedt und setzt den Wert`() = runTest {
        val cache = ListCache(backgroundScope) { listOf("a") }
        cache.refreshAndWait()
        assertEquals(listOf("a"), cache.state.value.value)
        assertFalse(cache.state.value.loading)
    }

    @Test fun `waehrend des Neuladens bleibt der alte Wert sichtbar`() = runTest {
        var n = 0
        val gate = CompletableDeferred<Unit>()
        val cache = ListCache(backgroundScope) { n++; if (n == 2) gate.await(); listOf("v$n") }
        cache.refreshAndWait()
        cache.refresh()
        advanceUntilIdle()
        assertEquals(listOf("v1"), cache.state.value.value)
        assertTrue(cache.state.value.loading)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("v2"), cache.state.value.value)
    }

    @Test fun `Fehler behaelt den alten Wert und meldet sich`() = runTest {
        var fail = false
        val cache = ListCache(backgroundScope) { if (fail) throw RuntimeException("offline") else listOf("a") }
        cache.refreshAndWait()
        fail = true
        cache.refreshAndWait()
        assertEquals(listOf("a"), cache.state.value.value)
        assertEquals("offline", cache.state.value.error)
        fail = false
        cache.refreshAndWait()
        assertNull(cache.state.value.error)
    }

    @Test fun `ensureLoaded laedt nur beim ersten Mal`() = runTest {
        var n = 0
        val cache = ListCache(backgroundScope) { n++; listOf("a") }
        cache.ensureLoaded(); advanceUntilIdle()
        cache.ensureLoaded(); advanceUntilIdle()
        assertEquals(1, n)
    }

    @Test fun `update aendert den Wert ohne zu laden`() = runTest {
        var n = 0
        val cache = ListCache(backgroundScope) { n++; listOf("a", "b") }
        cache.refreshAndWait()
        cache.update { it - "a" }
        assertEquals(listOf("b"), cache.state.value.value)
        assertEquals(1, n)
    }

    @Test fun `clear waehrend des Ladens verwirft das Ergebnis`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val cache = ListCache(backgroundScope) { gate.await(); listOf("alt") }
        cache.refresh()
        advanceUntilIdle()
        cache.clear()
        gate.complete(Unit)
        advanceUntilIdle()
        assertNull(cache.state.value.value)
    }
}
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*ListCacheTest"` → „Unresolved reference: ListCache“.

- [ ] **Step 3: Implementierung**

`M/cloud/ListCache.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class CacheState<T>(val value: T? = null, val loading: Boolean = false, val error: String? = null)

/**
 * Speicher fuer eine kleine Liste ohne `updated_at` (Spec §8): der letzte Stand bleibt sichtbar,
 * neu geladen wird immer vollstaendig im Hintergrund. Anforderungen verschmelzen wie im
 * CollectionStore (Coalescer) -- nach einem eigenen Schreibvorgang kommt `refreshAndWait()`
 * garantiert mit dem neuen Stand zurueck.
 */
class ListCache<T>(scope: CoroutineScope, private val loader: suspend () -> T) {
    private val _state = MutableStateFlow(CacheState<T>())
    val state: StateFlow<CacheState<T>> = _state.asStateFlow()

    private val lock = Any()
    private var generation = 0L
    private val runs = Coalescer(scope) { runOnce() }

    fun refresh() = runs.request()

    /** Wirft nie; ein Fehler steht danach in `state.error`. */
    suspend fun refreshAndWait() = runs.requestAndWait()

    /** Laedt nur, wenn noch nie ein Wert da war und gerade nichts laeuft. */
    fun ensureLoaded() {
        val s = _state.value
        if (s.value == null && !s.loading) refresh()
    }

    /** Aendert den Wert lokal, ohne zu laden (z. B. ein weggetippter Deal-Treffer). */
    fun update(transform: (T) -> T) {
        synchronized(lock) {
            val v = _state.value.value ?: return
            _state.value = _state.value.copy(value = transform(v))
        }
    }

    fun clear() {
        synchronized(lock) {
            generation++
            _state.value = CacheState()
        }
    }

    private suspend fun runOnce() {
        val gen = synchronized(lock) {
            _state.value = _state.value.copy(loading = true)
            generation
        }
        try {
            val v = loader()
            synchronized(lock) { if (gen == generation) _state.value = CacheState(value = v) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            synchronized(lock) { if (gen == generation) _state.value = _state.value.copy(loading = false) }
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _state.value = _state.value.copy(loading = false, error = e.message ?: "Laden fehlgeschlagen")
            }
        }
    }
}
```

`M/cloud/SideStores.kt`:

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Phase 2 (Spec §8): Wunschliste, Decks, Deals und Set-Liste im selben Prozess-Speicher. Diese
 * Listen haben kein updated_at und sind klein -- deshalb voll neu laden statt Delta, und kein Takt.
 */
object SideStores {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val wishlist = ListCache(scope) { WishlistRepository.loadWishlist() }
    val decks = ListCache(scope) { DecksRepository.loadDecks() }
    val dealWatches = ListCache(scope) { DealsRepository.loadWatches() }
    val dealAlerts = ListCache(scope) { DealsRepository.loadAlerts() }
    val sets = ListCache(scope) { SetsRepository.loadSets() }

    private val deckCardCaches = HashMap<Long, ListCache<List<DeckCard>>>()

    fun deckCards(deckId: Long): ListCache<List<DeckCard>> = synchronized(deckCardCaches) {
        deckCardCaches.getOrPut(deckId) { ListCache(scope) { DecksRepository.loadCards(deckId) } }
    }

    /** Beim Abmelden und Kontowechsel (Spec §4.4). */
    fun clearAll() {
        wishlist.clear(); decks.clear(); dealWatches.clear(); dealAlerts.clear(); sets.clear()
        synchronized(deckCardCaches) {
            deckCardCaches.values.forEach { it.clear() }
            deckCardCaches.clear()
        }
    }
}
```

- [ ] **Step 4: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/ListCache.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/test/java/com/example/yugiohscanner/ListCacheTest.kt
git commit -m "feat(android): ListCache und SideStores fuer Wunschliste, Decks, Deals und Sets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Wunschliste, Decks, Deals, Sets aus den `SideStores`

**Files:**
- Modify: `M/ui/WishlistScreen.kt:32-60, 118`
- Modify: `M/ui/DecksScreen.kt:55-76, 124, 177-196`
- Modify: `M/ui/DealsScreen.kt:56-99, 161, 183`
- Modify: `M/ui/CardDetailScreen.kt` (Wunschliste)
- Modify: `M/ui/StartScreen.kt` (Sets, Deal-Treffer)
- Modify: `M/ui/SetCompletionScreen.kt` (Sets)
- Modify: `M/ui/AppNav.kt` (`SideStores.clearAll()` an denselben drei Stellen wie `CollectionStore.clear()`)

**Interfaces:**
- Consumes: `SideStores`, `CacheState`, `ListCache.refresh/refreshAndWait/ensureLoaded/update` (Task 10).

Grundmuster für jeden Bildschirm dieser Task:
- Anzeige aus `val cache by SideStores.x.state.collectAsState()`, Liste `cache.value ?: emptyList()`.
- Beim Öffnen `LaunchedEffect(Unit) { SideStores.x.refresh() }` — zeigt sofort den letzten Stand, lädt leise nach.
- Ladeanzeige nur, solange noch nie ein Wert da war: `cache.value == null && cache.error == null`.
- Fehleranzeige: der bestehende lokale `error` (Schreibfehler) hat Vorrang, sonst `cache.error`.
- Nach eigenen Schreibvorgängen `SideStores.x.refreshAndWait()` statt `reload()`.

- [ ] **Step 1: `WishlistScreen`**

Zeilen 34-45 (`val items = remember { mutableStateListOf… }` bis Ende `LaunchedEffect`) werden zu:

```kotlin
    val cache by SideStores.wishlist.state.collectAsState()
    val items = cache.value ?: emptyList()
    var name by remember { mutableStateOf("") }
    var maxPrice by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = busy || (cache.value == null && cache.error == null)
    val error = writeError ?: cache.error

    // Spec §8: sofort der letzte Stand, im Hintergrund voll neu laden.
    LaunchedEffect(Unit) { SideStores.wishlist.refresh() }
```

Im `add`-Lambda: `loading = true` → `busy = true`, `reload()` → `SideStores.wishlist.refreshAndWait()`, `error = null` → `writeError = null`, `error = e.message` → `writeError = e.message`, `loading = false` → `busy = false`. In Zeile 118: `try { WishlistRepository.removeFromWishlist(item.id); reload() } catch (e: Exception) { error = e.message }` → `try { WishlistRepository.removeFromWishlist(item.id); SideStores.wishlist.refreshAndWait() } catch (e: Exception) { writeError = e.message }`. Alle übrigen Lesezugriffe auf `items`, `loading`, `error` bleiben textlich gleich. Imports: `collectAsState`, `SideStores` ergänzen; `mutableStateListOf`, `LaunchedEffect`-Duplikate/ungenutzte entfernen.

- [ ] **Step 2: `DecksScreen` und `DeckEditor`**

`DecksScreen` Zeilen 55-65 werden zu:

```kotlin
    val cache by SideStores.decks.state.collectAsState()
    val decks = cache.value ?: emptyList()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = busy || (cache.value == null && cache.error == null)
    val error = writeError ?: cache.error

    LaunchedEffect(Unit) { SideStores.decks.refresh() }
```

Im `create`-Lambda und in Zeile 124 dieselben Ersetzungen wie in Step 1 (`reload()` → `SideStores.decks.refreshAndWait()`, `error =` → `writeError =`, `loading =` → `busy =`).

`DeckEditor` Zeilen 177-196 (`val cards = remember { mutableStateListOf<DeckCard>() }`, `loading`, `error`, `reload()`, `LaunchedEffect(deck.id)`, `mutate`) werden zu:

```kotlin
    val deckCache = remember(deck.id) { SideStores.deckCards(deck.id) }
    val cache by deckCache.state.collectAsState()
    val cards = cache.value ?: emptyList()
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = cache.value == null && cache.error == null
    val error = writeError ?: cache.error

    var query by remember { mutableStateOf("") }
    val results = remember { mutableStateListOf<CardRow>() }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(deck.id) { deckCache.refresh() }

    fun mutate(block: suspend () -> Unit) {
        scope.launch {
            try { block(); deckCache.refreshAndWait(); writeError = null } catch (e: Exception) { writeError = e.message }
        }
    }
```

(`query`, `results`, `searching` standen vorher zwischen `error` und `reload()` — sie bleiben unverändert erhalten.) Weitere Stellen im `DeckEditor`, die `error = …` setzen (z. B. in der Suche), werden zu `writeError = …`.

- [ ] **Step 3: `DealsScreen`**

Zeilen 56-81 werden zu:

```kotlin
    val alertsCache by SideStores.dealAlerts.state.collectAsState()
    val watchesCache by SideStores.dealWatches.state.collectAsState()
    val alerts = alertsCache.value ?: emptyList()
    val watches = watchesCache.value ?: emptyList()
    var query by remember { mutableStateOf("") }
    var maxPrice by remember { mutableStateOf("") }
    var condition by remember { mutableStateOf("any") }
    var loading by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    val error = writeError ?: alertsCache.error ?: watchesCache.error

    suspend fun reloadFromCloud() {
        SideStores.dealWatches.refreshAndWait()
        SideStores.dealAlerts.refreshAndWait()
    }

    // Wie bisher: Neu laden stoesst erst den Cloud-Scrape an. Die Listen sind dabei sofort mit dem
    // letzten Stand sichtbar (Spec §8); `loading` zeigt nur den laufenden Scrape an.
    fun refresh(scrapeFirst: Boolean = true) {
        scope.launch {
            loading = true
            try {
                if (scrapeFirst) DealsRepository.triggerScrape()
                reloadFromCloud()
                writeError = null
            } catch (e: Exception) { writeError = e.message }
            loading = false
        }
    }

    LaunchedEffect(Unit) { refresh() }
```

Im `addWatch`-Lambda und in Zeile 161 `error = …` → `writeError = …`. Zeile 183: `try { DealsRepository.dismissAlert(d.id); alerts.remove(d) }` → `try { DealsRepository.dismissAlert(d.id); SideStores.dealAlerts.update { list -> list.filterNot { it.id == d.id } } }`, `error = e.message` → `writeError = e.message`. Imports: `collectAsState`, `SideStores` ergänzen; `mutableStateListOf` entfernen, sofern ungenutzt.

- [ ] **Step 4: Kartendetail — „auf der Wunschliste“**

In `CardDetailScreen.kt` `var inWishlist by remember { mutableStateOf(false) }` und den `LaunchedEffect(cardId) { runCatching { WishlistRepository.loadWishlist() } … }` ersetzen durch:

```kotlin
    // Spec §8: aus dem Wunschlisten-Speicher. `addedHere` sperrt den Knopf sofort nach dem Tippen,
    // bevor der Speicher nachgeladen hat -- der POST ist ein reines Insert, ein zweiter Tipp legte
    // eine Dublette an.
    val wish by SideStores.wishlist.state.collectAsState()
    var addedHere by remember { mutableStateOf(false) }
    val inWishlist = addedHere || wish.value?.any { it.cardId == cardId } == true
    LaunchedEffect(Unit) { SideStores.wishlist.ensureLoaded() }
```

Im Wunschlisten-Knopf `error = null; inWishlist = true; notice = "Zur Wunschliste hinzugefügt"` → `error = null; addedHere = true; notice = "Zur Wunschliste hinzugefügt"; SideStores.wishlist.refresh()`.

- [ ] **Step 5: Start und Set-Vervollständigung — Sets und Deal-Treffer**

`StartScreen.kt`: Die Variablen `dealAlertCount`, `topDeals`, `setProgress` werden abgeleitet statt geladen:

```kotlin
    val setsCache by SideStores.sets.state.collectAsState()
    val alertsCache by SideStores.dealAlerts.state.collectAsState()
    val dealAlertCount = alertsCache.value?.size ?: 0
    val topDeals = alertsCache.value?.take(2) ?: emptyList()
    val setProgress = remember(ready?.cards, setsCache.value) {
        val sets = setsCache.value ?: return@remember emptyList<SetProgressRow>()
        val ownedByPrefix = HashMap<String, MutableSet<String>>()
        for (card in cards) {
            if (card.setCode.equals("Unknown", ignoreCase = true)) continue
            val prefix = card.setCode.substringBefore("-").uppercase()
            if (prefix.isBlank()) continue
            ownedByPrefix.getOrPut(prefix) { HashSet() }.add(card.setCode)
        }
        ownedByPrefix.mapNotNull { (prefix, codes) ->
            val info = sets[prefix] ?: return@mapNotNull null
            SetProgressRow(info.name, codes.size.coerceAtMost(info.total), info.total)
        }
            .filter { it.owned < it.total }
            .sortedByDescending { it.owned.toFloat() / it.total }
            .take(3)
    }
```

Die bisherigen `var dealAlertCount`, `var topDeals`, `var setProgress` entfallen. Im `LaunchedEffect(Unit) { scope.launch { … } }` aus Task 9 entfallen der Sets-`try`-Block und der Deals-`try`-Block; stattdessen am Anfang des `scope.launch`-Blocks:

```kotlin
            SideStores.sets.ensureLoaded()
            SideStores.dealAlerts.refresh()
```

`error` zeigt zusätzlich Cache-Fehler: die Anzeige `error?.let { Text(it, …) }` wird zu `(error ?: setsCache.error ?: alertsCache.error)?.let { Text(it, …) }`.

`SetCompletionScreen.kt` (Stand nach Task 9): `var sets`, `var loading`, `var error` und der `LaunchedEffect(Unit) { … loadSets … }` werden zu:

```kotlin
    val setsCache by SideStores.sets.state.collectAsState()
    val sets = setsCache.value
    val loading = sets == null && setsCache.error == null
    val error = setsCache.error
    LaunchedEffect(Unit) { SideStores.sets.ensureLoaded() }
```

(`error!!` in der Oberfläche bleibt gültig.) Import `SetsRepository` entfernen, `SideStores` ergänzen.

- [ ] **Step 6: Abmelden leert auch die SideStores**

In `AppNav.kt` an allen drei Stellen, an denen Task 5 `CollectionStore.clear()` eingefügt hat (Login-`onReady`, Ladebildschirm-`onLogout`, Einstellungen-`onLoggedOut`), direkt danach `SideStores.clearAll()` ergänzen. Import `com.example.yugiohscanner.cloud.SideStores`.

- [ ] **Step 7: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/WishlistScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/DealsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SetCompletionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt
git commit -m "refactor(android): Wunschliste, Decks, Deals und Sets aus dem Prozess-Speicher

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Nach unten ziehen

**Files:**
- Create: `M/ui/components/RefreshableBox.kt`
- Modify: `M/ui/StartScreen.kt`, `M/ui/SammlungScreen.kt`, `M/ui/BinderPageScreen.kt`, `M/ui/DealsScreen.kt`

**Interfaces:**
- Consumes: `CollectionStore.awaitSync()`, `SideStores.*.refreshAndWait()`.
- Produces: `@Composable fun RefreshableBox(onRefresh: suspend () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit)`

- [ ] **Step 1: `RefreshableBox` anlegen**

`M/ui/components/RefreshableBox.kt`:

```kotlin
package com.example.yugiohscanner.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll

/**
 * Spec §8: Nach unten ziehen loest `onRefresh` aus; der Kreisel bleibt, bis es fertig ist.
 * Material3 1.2.1 bringt dafuer nur Zustand und Behaelter mit (experimentell); `PullToRefreshBox`
 * gibt es erst spaeter -- deshalb dieser eigene Name, damit ein spaeteres Anheben nicht kollidiert.
 * Greift nur ueber scrollbarem Inhalt (verschachteltes Scrollen).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshableBox(onRefresh: suspend () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val state = rememberPullToRefreshState()
    val currentOnRefresh by rememberUpdatedState(onRefresh)
    if (state.isRefreshing) {
        LaunchedEffect(Unit) {
            try { currentOnRefresh() } finally { state.endRefresh() }
        }
    }
    Box(modifier.nestedScroll(state.nestedScrollConnection)) {
        content()
        PullToRefreshContainer(state = state, modifier = Modifier.align(Alignment.TopCenter))
    }
}
```

- [ ] **Step 2: Einbauen**

`SammlungScreen.kt` — `Box(Modifier.weight(1f)) { when (segment) { … } }` wird zu:

```kotlin
        RefreshableBox(
            onRefresh = {
                when (segment) {
                    "wunschliste" -> SideStores.wishlist.refreshAndWait()
                    "decks" -> SideStores.decks.refreshAndWait()
                    "sets" -> { CollectionStore.awaitSync(); SideStores.sets.refreshAndWait() }
                    else -> CollectionStore.awaitSync()
                }
            },
            modifier = Modifier.weight(1f),
        ) {
            when (segment) {
                "binder" -> BindersScreen(onOpenBehaelter)
                "wunschliste" -> WishlistScreen()
                "sets" -> SetCompletionScreen()
                "decks" -> DecksScreen()
                else -> CollectionScreen(onOpenSuche = onOpenSuche)
            }
        }
```

`StartScreen.kt` — der Inhalt von `Surface(Modifier.fillMaxSize(), color = Background) { … }` wird in `RefreshableBox(onRefresh = { CollectionStore.awaitSync(); SideStores.dealAlerts.refreshAndWait() }) { … }` gelegt (die `Column` mit `verticalScroll` bleibt darin unverändert).

`BinderPageScreen.kt` — der Inhalt von `Surface(Modifier.fillMaxSize(), color = Background) { … }` wird in `RefreshableBox(onRefresh = { CollectionStore.awaitSync() }) { … }` gelegt.

`DealsScreen.kt` — der Wurzel-Inhalt des Bildschirms wird in `RefreshableBox(onRefresh = { try { DealsRepository.triggerScrape() } catch (e: Exception) { writeError = e.message }; SideStores.dealWatches.refreshAndWait(); SideStores.dealAlerts.refreshAndWait() }) { … }` gelegt.

Imports jeweils: `com.example.yugiohscanner.ui.components.RefreshableBox`, sowie `CollectionStore`/`SideStores`/`DealsRepository`, soweit neu.

- [ ] **Step 3: Suite und Build grün**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/components/RefreshableBox.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SammlungScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/BinderPageScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/DealsScreen.kt
git commit -m "feat(android): Nach unten ziehen auf Start, Sammlung, Binder-Seite und Deals

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Abnahme am Gerät (Nutzer, nach Task 12)

1. App-Start zeigt „Sammlung wird geladen …“, danach Start.
2. Start ↔ Sammlung ↔ Binder ↔ Binder-Seite ↔ Scan und zurück: sofort, keine Ladeanzeige.
3. Am PC ein Exemplar einem Binder zuweisen: erscheint am Handy ohne Neustart (≤ ~30 s).
4. Am Handy Binder anlegen, Karte einlegen, Exemplar hinzufügen: sofort sichtbar.
5. Scan übernehmen; Druck aus der Suche hinzufügen: in der Sammlung sichtbar ohne Neustart.
6. Flugmodus in der App: nach ≤ 10 s „Nicht abgeglichen seit HH:MM – nächster Versuch läuft“, Daten bleiben; Flugmodus aus → Hinweis weg.
7. Flugmodus beim App-Start: Ladebildschirm mit „Erneut versuchen“ und „Abmelden“.
8. Einsortier-Modus: zurück in der Binder-Seite steht die zuletzt bearbeitete Seite, Karten liegen im richtigen Fach.
9. Wunschliste, Decks, Deals öffnen sofort mit dem letzten Stand; Nach-unten-Ziehen auf Start, Sammlung (alle Segmente), Binder-Seite, Deals aktualisiert.
10. Abmelden und wieder anmelden: Ladebildschirm erscheint erneut, keine Daten des alten Stands.
