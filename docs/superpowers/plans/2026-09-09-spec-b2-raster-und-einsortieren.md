# Spec B2 — Binder-Raster und Einsortier-Modus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Karten in einem Durchgang mit dem Scanner in einen Binder einsortieren, und den Binder als Seitenraster durchblättern.

**Architecture:** Der Einsortier-Modus ist eine eigene, vorübergehende Aufgabe am Handy — kein weiterer Wert der gemerkten Scan-Einstellung. Er läuft immer lokal, auch bei verbundenem PC, weil die Fach-Reservierung zu dem Binder gehört, vor dem der Nutzer steht. Unbekannte Karten gehen ins Staging und tragen die Reservierung mit; das Fach rückt trotzdem sofort vor. Vorbereitend wird die Scan-Logik aus `ScanScreen.kt` herausgelöst, damit der Modus nicht der fünfte Zweig in einer 1.100-Zeilen-Datei wird.

**Tech Stack:** Android Kotlin 2.0 / Jetpack Compose / CameraX, JUnit 4; Electron-Main CommonJS `.cjs` + better-sqlite3, Renderer React 19 / Vite (ESM) mit Tailwind; `node:test` für reine Module.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-spec-b-binder-organisation-design.md` **in der Fassung des Nachtrags** `docs/superpowers/specs/2026-09-09-spec-b-nachtrag-b1-b2-und-einsortieren.md`. Bei Widerspruch gilt der Nachtrag.
- **B1 ist gebaut und gemerged** (`0fab6a1`). Behälter, Standort am Exemplar, Tags, Notiz, Segment „Binder", Exemplar-Sheet, Filter und Sync stehen. Nichts davon wird hier neu gebaut.
- **Unbekannte Karten gehen ins Staging, NICHT direkt in die Sammlung** (Nachtrag §2). Der Staging-Eintrag trägt die Fach-Reservierung; das Fach rückt sofort vor; das Übernehmen setzt die Karte an den reservierten Platz. Wird nie übernommen, bleibt das Fach leer — sichtbar und harmlos.
- **Der Einsortier-Modus stagt IMMER lokal** (Nachtrag §3), auch bei verbundenem PC, und spiegelt nichts. D4s Regel „kein Handy-Staging bei verbundenem PC" gilt weiterhin für den normalen Scan-Ablauf.
- **`SORT` ist kein Wert von `scan_mode`.** Die Pref kennt weiter genau `einzeln` und `stapel`. Der Einsortier-Modus ist eine vorübergehende Aufgabe, die aus einem Binder heraus betreten wird — sonst könnte die App darin starten, ohne dass ein Binder gewählt ist.
- **Regeln wohnen im Helfer, nicht in der Oberfläche.** Das ist die tragende Lehre aus B1 und hat sich dort zweimal bewährt: `setCopyLocation` verwirft Seite und Fach bei Nicht-Bindern selbst, `saveContainer` prüft selbst. Wer eine solche Regel in einer Ansicht noch einmal trifft, baut den Datenverlust aus B1 Task 6 nach.
- **Vier Regeln existieren absichtlich mehrfach** und sind gegenseitig markiert: Tags dreimal (`desktop/src/utils/tags.js`, `desktop/electron/copies.cjs#normalizeTagList`, `android/.../ml/Tags.kt`), Standort-Formatierung zweimal (`copyLocation.js` / `CopyLocation.kt`), Behälter-Prüfungen zweimal. **`SlotMath` kommt als fünfte Doppelung dazu** und folgt demselben Muster: reine Funktionen, beidseitig getestet, gegenseitig im Kopfkommentar genannt.
- Printing-Identität ist der 4-Spalten-Schlüssel `(id, set_code, language, rarity)`. `cards.quantity`/`cards.deleted` sind triggergepflegte Caches und werden **nie** aus Anwendungscode geschrieben. Nur Soft-Delete.
- **Jeder IPC-Kanal muss in `desktop/electron/main.cjs` UND `desktop/electron/preload.cjs` stehen.**
- **Agenten führen kein SQL gegen Supabase aus und verbinden sich nicht dorthin.** `updated_at` und `user_id` werden nie mitgeschickt.
- **Jede benutzersichtbare Zeichenkette ist deutsch, MIT echten Umlauten.** Niemals `ue`/`ae`/`oe` in sichtbarem Text. Yu-Gi-Oh-Begriffe bleiben englisch (Set-Code, Passcode, Rarity). **„Fächer", nicht „Taschen".**
- Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34; Electron-Main CommonJS, Renderer ESM. **Keine neue Abhängigkeit** — insbesondere kein `lifecycle-viewmodel-compose`, das gibt es hier nicht. **Niemals ein nacktes `npm install`.**
- Desktop-Lint-Baseline: **genau 5 Fehler**, ein sechster ist ein Fehlschlag. Die 3 Warnungen sind geprüft und bleiben.
- **Nie committen:** `android/local.properties`. Explizite Pfade stagen, **niemals `git add -A`**.
- Commit-Stil: `feat(android|desktop): …`, ein Commit pro Task, Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Testbefehle

| Was | Befehl (aus dem Repo-Wurzelverzeichnis) |
|---|---|
| Kotlin-Unit-Tests | `cd android && ./gradlew :app:testDebugUnitTest` — Baseline **232**, 0 Fehlschläge |
| Ein einzelner Kotlin-Test | `cd android && ./gradlew :app:testDebugUnitTest --tests '*SlotMathTest*'` |
| Kotlin kompiliert | `cd android && ./gradlew :app:compileDebugKotlin` |
| Reine Renderer-Module | `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs` — Baseline **51** |
| SQLite-Tests | `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/<datei>.test.cjs` |
| Desktop-Bau | `cd desktop && npm run build` |
| Desktop-Lint | `cd desktop && npm run lint` — **genau 5 Fehler** |

Die Verzeichnisform `node --test src/utils/` scheitert auf Node 24; ein blankes `node --test` für die `.cjs`-Dateien scheitert mit `ERR_DLOPEN_FAILED`, weil better-sqlite3 gegen Electron gebaut ist.

## File Structure

| Datei | Verantwortung |
|---|---|
| `android/.../ui/ScanCapture.kt` (neu) | **Task 1:** die aus `ScanScreen.kt` herausgelöste Erfassungslogik — Staging-Liste, Merkliste, die vier Funktionen. Eine schlichte Klasse, per `remember` gehalten; kein ViewModel, die Abhängigkeit fehlt. |
| `android/.../ui/ScanScreen.kt` | **Task 1:** nur noch Kamera, Overlay und Anzeige; die Erfassung kommt aus `ScanCapture`. |
| `android/.../ml/SlotMath.kt` (neu) + `desktop/src/utils/slotMath.js` (neu) | **Task 2:** `next` und `firstFree` als Zwillinge, beidseitig getestet. |
| `android/.../ml/PickCandidate.kt` (neu) | **Task 3:** welches Exemplar ein erkannter Scan meint. Rein, getestet. |
| `android/.../ui/BinderPageScreen.kt` (neu) | **Task 4:** Seitenraster am Handy, Blättern, Verschieben, Aus Fach nehmen. |
| `android/.../ui/ScanStagingScreen.kt` | **Task 5:** `ScanStagingEntry` bekommt die Fach-Reservierung. |
| `android/.../cloud/CollectionRepository.kt` | **Task 5:** das Übernehmen setzt die Reservierung. |
| `android/.../ui/SortIntoBinderScreen.kt` (neu) | **Tasks 6–7:** der Einsortier-Modus. |
| `desktop/src/components/BinderView.jsx` (neu) | **Task 8:** Doppelseite am PC, Pfeile, Tastatur. |
| Tests | `SlotMathTest`, `PickCandidateTest` (Kotlin); `slotMath.test.js` (Node) |

## Aufgabenreihenfolge und ihre Begründung

1. **Task 1** ist der Umbau, der alles Weitere erst erlaubt — und er ist verhaltensgleich, also gut prüfbar, solange nichts anderes daneben passiert.
2. **Tasks 2 und 3** legen die reinen Regeln hin, bevor eine Ansicht sie braucht.
3. **Task 4** baut die Binder-Ansicht am Handy — sie ist der Einstieg in den Einsortier-Modus.
4. **Task 5** schafft die Reservierung, bevor der Modus sie füllt.
5. **Tasks 6 und 7** bauen den Modus, erst den Fluss, dann die Sonderfälle.
6. **Task 8** baut die Desktop-Ansicht, die von nichts davon abhängt.

---

### Task 1: `ScanScreen.kt` verhaltensgleich aufteilen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanCapture.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt`

**Interfaces:**
- Consumes: `ScanResolver.resolve`, `ScanAggregator.target`, `ScanStagingEntry`, `ExtraPrinting`, `Prefs` — alle vorhanden.
- Produces:
  ```kotlin
  class ScanCapture(
      context: Context, scope: CoroutineScope, snackbar: SnackbarHostState,
      flash: Animatable<Float, AnimationVector1D>,
      socket: () -> Socket?, connected: () -> Boolean, mode: () -> String,
  ) {
      val stagingCards: SnapshotStateList<ScanStagingEntry>
      val seen: MutableSet<String>
      val sentCount: Int          // nur lesbar nach aussen
      val lastLight: ScanConfidence.Light?
      fun onCapture(pc: String, evidence: List<String>, frames: List<String>, editionTexts: List<String>)
      fun forget(passcodes: Collection<String>)   // fuer onCommitted und staging_released
  }
  ```
  Tasks 5–7 bauen darauf auf.

**DAS IST EIN UMBAU OHNE VERHALTENSÄNDERUNG.** Nach diesem Task muss sich der Scanner exakt so verhalten wie davor. Jede Zeile deines Diffs muss sich auf „verschoben" oder „Parameter statt Sichtbarkeit" zurückführen lassen. Wenn du unterwegs etwas verbessern willst: nicht tun, es im Bericht notieren.

**Was heute in `ScanScreen.kt` steht und was daran heikel ist.** Vier lokale Funktionen greifen ineinander und tragen Regeln, die in D4 erst nach je zwei Fixrunden richtig waren:
- `stageScan` legt den Eintrag **sofort** mit `loading = true` an — das gefühlte Tempo hängt daran — und befüllt ihn danach aus `ScanResolver`.
- `aggregateRepeat` ermittelt das Ziel und bucht es **zusammen in einem `scope.launch` auf dem Hauptthread**. Das Rückgängig arbeitet **ausschließlich über Objektidentität** (`===`), nie über einen aufgehobenen Index. Fehlt der Eintrag, fällt es auf `stageScan` zurück statt still auszusteigen.
- `sendScan` schickt an den PC und fällt bei abgerissener Verbindung auf `stageScan`/`aggregateRepeat` zurück.
- `onCapture` ist die Weiche: `seen.add` entscheidet über Erst- oder Wiederholscan.

**Eine Beschränkung fällt weg — nutze sie trotzdem nicht.** Als lokale Funktionen konnten sie sich nicht gegenseitig aufrufen; deshalb ruft `sendScan` heute direkt `stageScan`/`aggregateRepeat` statt `onCapture`. Als Methoden einer Klasse wäre der gegenseitige Aufruf erlaubt. **Ändere den Kontrollfluss nicht** — ein verhaltensgleicher Umbau restrukturiert nicht. Schreib stattdessen einen Kommentar, dass die Beschränkung entfallen ist und der direkte Aufruf bewusst bleibt.

- [ ] **Step 1: Die Zustände inventarisieren**

Geh `ScanScreen.kt` durch und schreib in den Bericht, welchen Compose-Zustand die vier Funktionen lesen oder schreiben. Erwartet mindestens: `stagingCards`, `seen`, `sentCount`, `lastLight`, `socket`, `isConnected`, `scanMode`, `scope`, `flash`, `snackbar`, `context`. Trenne dabei sauber:
- **gehört in die Klasse** (die Erfassung besitzt ihn): `stagingCards`, `seen`, `sentCount`, `lastLight`.
- **wird hineingereicht und ändert sich nicht**: `context`, `scope`, `snackbar`, `flash`.
- **wird hineingereicht und ändert sich über die Zeit**: `socket`, `isConnected`, `scanMode` — diese drei als **Lambda**, nicht als Wert, sonst arbeitet die Klasse mit einem veralteten Stand. Genau diese Falle hat in D4 dazu geführt, dass Seite und Fach gelöscht wurden, weil eine Entscheidung auf einem veralteten Ladezustand beruhte.

- [ ] **Step 2: `ScanCapture.kt` anlegen**

Eine schlichte Klasse — **kein ViewModel**, die Abhängigkeit `lifecycle-viewmodel-compose` ist nicht im Projekt und darf nicht dazukommen. Die vier Funktionen werden Methoden; `onCapture` und `forget` sind öffentlich, die drei anderen privat. Rümpfe **wörtlich** übernehmen, nur die Zugriffe auf die hineingereichten Werte anpassen (`socket()` statt `socket`).

`sentCount` und `lastLight` sind nach außen nur lesbar (`private set`), damit die Anzeige sie nicht verstellen kann.

- [ ] **Step 3: `ScanScreen.kt` auf die Klasse umstellen**

```kotlin
    val capture = remember {
        ScanCapture(context, scope, snackbar, flash,
            socket = { socket }, connected = { isConnected }, mode = { scanMode })
    }
```
Die Lambdas lesen bei jedem Aufruf den aktuellen Wert — deshalb sind es Lambdas.

Ersetze die Aufrufstellen: `onConfirmed` und die manuelle Eingabe rufen `capture.onCapture(...)`; die Fußzeile liest `capture.stagingCards`, `capture.sentCount`, `capture.lastLight`; `onCommitted` und der `staging_released`-Empfänger rufen `capture.forget(...)`. Die stille Verbesserung (D3) liest weiterhin `capture.stagingCards` und `capture.seen`.

Die vier alten lokalen Funktionen entfallen ersatzlos.

- [ ] **Step 4: Kompilieren und Testsuite**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides erfolgreich, **232 Tests**, 0 Fehlschläge.

Prüfe zusätzlich mit `grep`, dass die drei Eigenschaften aus D4 im neuen Code stehen: Zielermittlung und Buchung in **einem** `scope.launch`; `===` im Rückgängig; der `stageScan`-Rückfall bei fehlendem Eintrag. Halte die Fundstellen im Bericht fest.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanCapture.kt android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt
git commit -m "refactor(android): Erfassungslogik aus ScanScreen herausloesen"
```

---

### Task 2: `SlotMath` als Zwillinge, plus die drei offenen Kleinigkeiten aus B1

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/SlotMath.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SlotMathTest.kt`
- Create: `desktop/src/utils/slotMath.js`, `desktop/src/utils/slotMath.test.js`
- Modify: `android/.../cloud/ContainersRepository.kt` (Kommentar), `desktop/electron/sync.cjs` (Kommentar)

**Interfaces:**
- Produces:
  ```kotlin
  SlotMath.next(page: Int, slot: Int, pockets: Int): Pair<Int, Int>
  SlotMath.firstFree(occupied: Set<Pair<Int, Int>>, pockets: Int): Pair<Int, Int>
  ```
  ```js
  next(page, slot, pockets) -> { page, slot }
  firstFree(occupied, pockets) -> { page, slot }   // occupied: Array<{page, slot}>
  ```
  Tasks 5–7 rufen `next` auf, Task 4 und das Exemplar-Sheet `firstFree`.

**Die Regeln, für beide Fassungen identisch:**
- `next`: `slot + 1`; ist `slot` gleich `pockets`, dann `page + 1` und `slot = 1`.
- `firstFree`: das erste Fach in Lesereihenfolge (Seite 1 Fach 1, Fach 2, …), das nicht belegt ist. Ist alles bis zur höchsten belegten Seite voll, das erste Fach der nächsten Seite.
- Seiten und Fächer sind **1-basiert**. `pockets` ist 4, 9 oder 12.
- Ungültige Eingaben (`pockets <= 0`, `slot < 1`, `page < 1`) werfen **nicht**, sondern werden auf den nächstsinnvollen Wert gezogen — diese Funktionen werden aus Ansichten heraus gerufen, und ein Absturz beim Blättern wäre schlimmer als eine schiefe Zahl. Beschreib in beiden Kopfkommentaren, welche Zurechtrückung du wählst.

**Beide Dateien nennen einander im Kopfkommentar mit Pfad und dem Satz, dass wer die eine ändert, die andere mitändert.** Vorbild: `ScanAggregator.kt` / `scanAggregate.js` und `Tags.kt` / `tags.js`.

- [ ] **Step 1: Den fehlschlagenden Kotlin-Test schreiben**

Datei `android/app/src/test/java/com/example/yugiohscanner/SlotMathTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SlotMath
import org.junit.Assert.assertEquals
import org.junit.Test

class SlotMathTest {

    @Test fun `next rueckt innerhalb der Seite vor`() {
        assertEquals(3 to 5, SlotMath.next(3, 4, 9))
    }

    @Test fun `next blaettert am Seitenende um`() {
        assertEquals(4 to 1, SlotMath.next(3, 9, 9))
        assertEquals(4 to 1, SlotMath.next(3, 4, 4))
        assertEquals(4 to 1, SlotMath.next(3, 12, 12))
    }

    @Test fun `firstFree bei leerem Binder ist Seite 1 Fach 1`() {
        assertEquals(1 to 1, SlotMath.firstFree(emptySet(), 9))
    }

    @Test fun `firstFree findet die Luecke, nicht das Ende`() {
        // Fach 2 auf Seite 1 ist frei -- der Vorschlag muss dorthin, nicht hinter das letzte.
        val belegt = setOf(1 to 1, 1 to 3, 1 to 4)
        assertEquals(1 to 2, SlotMath.firstFree(belegt, 9))
    }

    @Test fun `firstFree geht bei voller Seite auf die naechste`() {
        val volleSeite = (1..4).map { 1 to it }.toSet()
        assertEquals(2 to 1, SlotMath.firstFree(volleSeite, 4))
    }

    @Test fun `firstFree ueberspringt eine ganz volle Seite und findet die Luecke dahinter`() {
        val belegt = (1..4).map { 1 to it }.toSet() + setOf(2 to 1, 2 to 3)
        assertEquals(2 to 2, SlotMath.firstFree(belegt, 4))
    }

    @Test fun `firstFree ignoriert Faecher jenseits der Seitengroesse`() {
        // Ein Datensatz aus einer frueheren, groesseren Seitengroesse darf nicht dazu fuehren,
        // dass ein gueltiges Fach als belegt gilt.
        val belegt = setOf(1 to 1, 1 to 7)
        assertEquals(1 to 2, SlotMath.firstFree(belegt, 4))
    }

    @Test fun `unsinnige Eingaben werfen nicht`() {
        SlotMath.next(0, 0, 0)
        SlotMath.next(-3, -1, 9)
        SlotMath.firstFree(setOf(0 to 0), 0)
    }
}
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*SlotMathTest*'`
Expected: FAIL — `Unresolved reference: SlotMath`.

- [ ] **Step 3: Beide Fassungen schreiben**

Erst Kotlin, dann das JavaScript-Gegenstück mit denselben Regeln und einem `node:test`-Test, der **dieselben Fälle mit denselben Eingaben** prüft. Die Tests sind das, was die Zwillinge zusammenhält.

- [ ] **Step 4: Die drei offenen Kleinigkeiten aus B1 abräumen**

Sie stehen im Ledger `docs/superpowers/ledgers/2026-09-09-spec-b1-behaelter-und-standort/progress.md` und sind hier billiger als je wieder:

1. **`android/.../cloud/ContainersRepository.kt`**, der Kommentar zur Reihenfolge beim Speichern: Er beschreibt den Fehlerfall **falsch herum**. Wahr ist: Schlägt der Upsert nach erfolgreichem Räumen fehl, bleibt der Behälter ein **Ordner**, und seine Exemplare haben Seite und Fach verloren. Schreib hin, was stimmt.
2. **`desktop/electron/sync.cjs`**: `CONTAINER_LOCAL_COLS` und `CONTAINER_PUSH_COLS` sind heute identisch definiert und können still auseinanderlaufen. Setz einen Kommentar an beide, der sagt, warum sie getrennt sind und was der Unterschied sein soll (die Zeitstempel gehören nicht in den Push, und die Cloud-Zeitstempel nicht in die lokalen Spalten).
3. **`android/.../ui/BindersScreen.kt`**, `maxPageFor()`: ohne Test. Zieh sie — falls sie rein ist — dorthin, wo sie testbar ist, und schreib einen Test. Ist sie nicht sinnvoll herauszulösen, sag das im Bericht und lass sie.

- [ ] **Step 5: Alle Suiten**

Run: `cd android && ./gradlew :app:testDebugUnitTest` → mehr als 232, 0 Fehlschläge.
Run: `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs` → mehr als 51.
Run: `cd desktop && npm run lint` → **genau 5 Fehler**.

- [ ] **Step 6: Commit**

---

### Task 3: `pickCandidate` — welches Exemplar ein Scan meint

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/PickCandidate.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/PickCandidateTest.kt`

**Interfaces:**
- Produces:
  ```kotlin
  sealed interface Pick {
      data class One(val copyId: String) : Pick          // genau ein Kandidat
      data class Many(val copyIds: List<String>) : Pick   // Auswahl-Sheet
      data object AllPlaced : Pick                        // alle Exemplare schon einsortiert
      data object NotOwned : Pick                         // Karte nicht in der Sammlung
  }
  PickCandidate.pick(copies: List<CopyRow>, passcode: String, setCodes: List<String>): Pick
  ```
  Tasks 6 und 7 rufen das auf.

**Die Regel (Spec §6.3), Schritt für Schritt.** Kandidaten sind die lebenden, **nicht einsortierten** Exemplare dieses Passcodes. Liegt ein Set-Code-Treffer vor, wird auf dieses Printing eingegrenzt — aber nur, wenn danach noch ein Kandidat übrig bleibt; sonst gilt der ungefilterte Stand, denn ein Lesefehler beim Set-Code darf nicht dazu führen, dass eine Karte gar nicht zugeordnet werden kann.
- Genau ein Kandidat → `One`.
- Mehrere → `Many`, **Standard-Exemplare zuerst** (Edition und Zustand gleich den Voreinstellungen).
- Keiner, aber der Passcode kommt in der Sammlung vor → `AllPlaced`.
- Der Passcode kommt gar nicht vor → `NotOwned`.

Die Funktion ist **rein**: sie bekommt die Exemplare übergeben, fragt nichts ab und kennt keine Voreinstellungen — die Sortierung „Standard zuerst" braucht Edition und Zustand als Parameter. Entscheide die genaue Signatur und begründe sie im Bericht.

- [ ] **Step 1: Den fehlschlagenden Test schreiben** — mindestens die vier Ausgänge, die Eingrenzung per Set-Code, der Fall „Eingrenzung würde alles wegfiltern", und die Reihenfolge bei `Many`.
- [ ] **Step 2: Fehlschlag bestätigen.**
- [ ] **Step 3: Schreiben.**
- [ ] **Step 4: Testsuite.**
- [ ] **Step 5: Commit.**

---

### Task 4: Binder-Ansicht am Handy

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/BinderPageScreen.kt`
- Modify: `android/.../ui/BindersScreen.kt` (Einstieg), `AppNav.kt` (Route)

**Interfaces:**
- Consumes: `SlotMath.firstFree` (Task 2), `ContainersRepository`, `CollectionRepository`, `CopyLocation.format` (aus B1).
- Produces: die Route auf die Binder-Seite, aus der Task 6 den Einsortier-Modus betritt.

**Was gebaut wird (Spec §7.2).** Kopf mit Name, „Seite p von P", Wert dieser Seite und dem Knopf **Einsortieren**. Raster je Seite nach `pockets_per_page`: 2×2, 3×3 oder 3×4. Kartenbild im Fach, Mengen-Abzeichen bei mehreren Exemplaren im selben Fach, leeres Fach gestrichelt. Horizontales Wischen blättert (`HorizontalPager`). Tipp auf eine Karte → Kartendetail. Langdruck → Sheet mit **Verschieben nach…** und **Aus Fach nehmen**. Tipp auf ein leeres Fach → Suche über die nicht einsortierten Exemplare, Auswahl legt hinein.

**Box und Deckbox haben kein Raster**, sondern eine Liste der Exemplare mit Standort-Chip.

**Zwei Fehler aus B1, die hier genauso möglich sind** — vermeide sie:
1. Ein Ladefehler darf nicht aussehen wie „leerer Binder". Beides muss unterscheidbar sein.
2. Doppelt ausgelöste Schreibvorgänge: sperre so, dass es **sofort** greift. `BindersScreen.kt` hat dafür eine erprobte Bauart — übernimm sie.

**Die Seitenzahl kommt aus der höchsten belegten Seite**, nicht aus `ceil(Anzahl / Fächer)` — das war eine Spec-Abweichung in B1 und ist dort behoben; `BindersScreen.kt` zeigt, wie.

- [ ] **Step 1: Route und Einstieg.**
- [ ] **Step 2: Raster und Blättern.**
- [ ] **Step 3: Verschieben, Aus Fach nehmen, leeres Fach füllen.**
- [ ] **Step 4: Kompilieren und Testsuite.**
- [ ] **Step 5: Commit.**

---

### Task 5: Die Fach-Reservierung am Staging-Eintrag

**Files:**
- Modify: `android/.../ui/ScanStagingScreen.kt` (`ScanStagingEntry`), `android/.../cloud/CollectionRepository.kt` (Übernehmen)

**Interfaces:**
- Produces: `ScanStagingEntry.reservedContainerId`, `.reservedPage`, `.reservedSlot` (alle nullbar), und ein Übernehmen, das sie beim Anlegen setzt.

**Warum es das gibt (Nachtrag §2).** Eine im Einsortier-Modus erkannte Karte, die nicht in der Sammlung ist, geht ins Staging statt direkt in die Sammlung. Der Eintrag muss sich merken, für welches Fach er gedacht war; das Übernehmen setzt die Karte dorthin. Das Fach rückt beim Scannen trotzdem sofort vor — die Karte liegt physisch schon drin.

**Bindend:** Die Reservierung wird beim Übernehmen über **denselben** Weg gesetzt wie jede andere Standortzuweisung — `setCopyLocation`, das Seite und Fach bei Nicht-Bindern selbst verwirft. Baue keinen zweiten Schreibweg und keine zweite Prüfung. Wer hier die Regel noch einmal selbst trifft, baut den Datenverlust aus B1 Task 6 nach.

**Was passiert, wenn der reservierte Behälter beim Übernehmen nicht mehr existiert?** `setCopyLocation` wirft dann („Behälter nicht gefunden"). Entscheide, ob das Übernehmen deshalb ganz fehlschlägt oder die Karte ohne Standort anlegt, und **begründe es im Bericht**. Meine Neigung: anlegen ohne Standort und den Nutzer darauf hinweisen — die Karte ist wichtiger als ihr Platz.

- [ ] **Step 1: Felder ergänzen.**
- [ ] **Step 2: Das Übernehmen setzt sie.**
- [ ] **Step 3: Kompilieren und Testsuite.**
- [ ] **Step 4: Commit.**

---

### Task 6: Einsortier-Modus — der Fluss

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SortIntoBinderScreen.kt`
- Modify: `android/.../ui/ScanCapture.kt` oder `ScanScreen.kt` je nach gewählter Bauart

**Interfaces:**
- Consumes: `SlotMath.next` (Task 2), `PickCandidate.pick` (Task 3), `ScanCapture` (Task 1), die Reservierung (Task 5).

**Was gebaut wird (Spec §6, Punkte 1, 2, 4, 5, 6).** Start-Sheet mit dem Vorschlag „erstes freies Fach" (`SlotMath.firstFree`), editierbar; Bestätigen öffnet die Kamera. Der Kopf zeigt groß **„<Binder> · Seite p · Fach s"**, der Fuß die zuletzt eingelegte Karte mit Bild, Name und Fach sowie **Rückgängig**. Kein Staging-Zähler, kein Prüfen-Knopf, kein Desktop-Spiegel. Pro erkannter Karte rückt das Fach mit `SlotMath.next` vor. Rückgängig setzt den Standort des letzten Exemplars zurück und das Fach zurück; die Tiefe ist die ganze Sitzung. **Fertig** führt zur Binder-Ansicht auf der zuletzt bearbeiteten Seite.

**Die Sonderfälle (Punkt 3) sind Task 7.** Hier reicht der einfache Fall: genau ein Kandidat → zuweisen, vorrücken, kurze Rückmeldung.

**Bindend:**
- **Der Modus stagt immer lokal**, auch bei verbundenem PC, und spiegelt nichts.
- **Das Rückgängig arbeitet über Objektidentität, nicht über Positionen.** Dieselbe Regel wie in D4 — dort hat ein aufgehobener Index die falsche Karte heruntergezählt.
- **Die Dedup-Mechanik bleibt, wie sie ist:** `BoxTracker` vergisst einen Passcode, wenn die Karte aus dem Bild ist; eine wiederkommende Karte ist ein neues Ereignis. Bau keine zweite.
- **Jede Zuweisung wird sofort geschrieben.** Bei einem Netzfehler bleibt sie in einer lokalen Warteschlange und wird beim nächsten Erfolg nachgeholt; der Modus läuft weiter. Beim Verlassen wird die Warteschlange geleert oder mit einer Meldung verworfen (Spec §11) — entscheide, welches, und begründe es.

- [ ] **Step 1: Start-Sheet mit dem Vorschlag.**
- [ ] **Step 2: Kamera-Shell mit Kopf und Fuß.**
- [ ] **Step 3: Zuweisen, Vorrücken, Rückgängig.**
- [ ] **Step 4: Warteschlange bei Netzfehler.**
- [ ] **Step 5: Kompilieren und Testsuite.**
- [ ] **Step 6: Commit.**

---

### Task 7: Einsortier-Modus — die drei Sonderfälle

**Files:**
- Modify: `android/.../ui/SortIntoBinderScreen.kt`

**Was gebaut wird (Spec §6.3), auf `PickCandidate` aufsetzend:**
- **Mehrere Kandidaten** → Auswahl-Sheet mit den Gruppen, Standard-Exemplare oben. Auswahl weist zu.
- **Keiner, aber alle Exemplare sind schon einsortiert** → Sheet „Alle Exemplare sind einsortiert: <Standorte>. Eines hierher verschieben?" → verschieben oder abbrechen.
- **Karte nicht in der Sammlung** → Sheet „Nicht in der Sammlung. Hinzufügen und einsortieren?" → **ins Staging**, mit der Fach-Reservierung aus Task 5. **Nicht** direkt in die Sammlung (Nachtrag §2). Das Fach rückt trotzdem vor.

Die Standorte im zweiten Sheet werden mit `CopyLocation.format` geschrieben — **importieren, nicht nachbauen**.

- [ ] **Step 1: Auswahl-Sheet.**
- [ ] **Step 2: Verschieben-Sheet.**
- [ ] **Step 3: Nicht-in-der-Sammlung-Sheet mit Reservierung.**
- [ ] **Step 4: Kompilieren und Testsuite.**
- [ ] **Step 5: Commit.**

---

### Task 8: Binder-Ansicht am Desktop

**Files:**
- Create: `desktop/src/components/BinderView.jsx`
- Modify: `desktop/src/utils/routes.js`, `desktop/src/App.jsx`, `desktop/src/components/Binders.jsx` (Einstieg)

**Interfaces:**
- Consumes: `window.api.listContainers()`, `listAllCopies()`, `setCopyLocation()` — alle aus B1 vorhanden; `formatCopyLocation` aus `desktop/src/utils/copyLocation.js`; `next`/`firstFree` aus `desktop/src/utils/slotMath.js` (Task 2).

**Was gebaut wird (Spec §7.2, Desktop-Hälfte).** **Doppelseite nebeneinander**, Pfeile links und rechts, Tastatur ← und →. Kopf mit Name, „Seite p von P" und dem Wert dieser Seite. Raster nach `pockets_per_page`. Rechtsklick auf eine Karte → **Verschieben nach…** und **Aus Fach nehmen**. Klick auf ein leeres Fach → Suche über die nicht einsortierten Exemplare. **Kein „Einsortieren"-Knopf** — der Modus ist Handy-only (Spec §3, Nicht-Ziele).

**Kein neuer IPC-Kanal nötig:** `listAllCopies()` liefert bereits `container_id`, `page`, `slot` für alle lebenden Exemplare; die Seite wird im Renderer gefiltert. Falls sich das als untragbar erweist, sag es im Bericht, statt still einen Kanal zu bauen.

**Drei Fehler aus B1, die hier genauso möglich sind:**
1. Fehlermeldungen dürfen **nicht** hinter einem zugeklappten Bereich liegen — das war ein kritischer Befund in Task 7.
2. Ein Ladefehler darf nicht aussehen wie „leerer Binder".
3. Nichts darf die Seite seitlich scrollen lassen; die Doppelseite muss bei schmalem Fenster umbrechen oder in einem eigenen Bereich scrollen.

- [ ] **Step 1: Route und Einstieg aus der Behälterliste.**
- [ ] **Step 2: Doppelseite, Blättern per Pfeil und Tastatur.**
- [ ] **Step 3: Rechtsklick-Sheet und leeres Fach.**
- [ ] **Step 4: Bau, Lint, von Hand nachsehen.**
- [ ] **Step 5: Commit.**

---

## Abschluss

**Abnahme (Spec §10, für B2):**

1. Binder mit 9 Fächern anlegen, öffnen: leeres Raster 3×3, „Seite 1 von 1".
2. **Einsortieren** starten: Vorschlag ist Seite 1 Fach 1. Zehn Karten nacheinander unter das Handy schieben — das Fach rückt jedes Mal vor, am Seitenende auf Seite 2 Fach 1.
3. Darunter eine Karte, die **mehrfach** in der Sammlung liegt → Auswahl-Sheet, Standard oben.
4. Eine Karte, die **nicht** in der Sammlung ist → landet im Staging mit Reservierung; das Fach rückt vor. Staging übernehmen → die Karte sitzt im reservierten Fach.
5. Eine Karte, deren Exemplare **alle schon einsortiert** sind → Verschieben-Sheet.
6. **Rückgängig** nach einer Zuweisung: Standort weg, Fach zurück.
7. **Fertig** → Binder-Ansicht auf der zuletzt bearbeiteten Seite; die Karten sitzen in den richtigen Fächern.
8. Am Handy blättern, eine Karte per Langdruck **verschieben** und eine **aus dem Fach nehmen**.
9. Am **PC** denselben Binder öffnen: **dieselben Fächer**, Doppelseite, Blättern per Pfeil und Tastatur.
10. Flugmodus einschalten, zwei Karten einsortieren, Flugmodus aus → die Zuweisungen kommen nach.

Danach `superpowers:finishing-a-development-branch`.
