# Spec D4 — Zwei Scan-Modi und kein Handy-Staging bei verbundenem PC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein zweiter Scan-Modus, in dem ein erneutes Erkennen derselben Karte die Menge erhöht statt verworfen zu werden — und bei verbundenem PC kein Staging mehr am Handy.

**Architecture:** Die Zusammenfassungsregel wohnt dort, wo das Staging steht: offline am Handy (`ScanAggregator.kt`), bei verbundenem PC am Desktop (`scanAggregate.js`). Beide Fassungen sind reine, getestete Module ohne UI. Damit das Handy ohne Staging-Eintrag auflösen kann, zieht die Auflösung aus `stageScan` in ein eigenes `ScanResolver` um. Ein neuer Rückkanal (`staging_released`) gibt eine am PC übernommene Karte am Handy wieder frei.

**Tech Stack:** Kotlin 2.0.0 / Jetpack Compose / AGP 8.2.2 / compileSdk 34, JUnit 4 (JVM-Unit-Tests); Electron-Main CommonJS `.cjs`, Renderer React 19 / Vite ESM, `node:test` für reine Renderer-Module; Socket.io 4 zwischen beiden.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-08-scan-modi-und-pc-staging-design.md`. Sie **ersetzt Spec D §7a**. Nichts aus §7a bauen: kein Schreiben an der Sammlung vorbei, keine Nachprüfen-Liste, kein `SpeedScanController`.
- **Modus-Werte sind wörtlich `einzeln` und `stapel`**, Pref-Schlüssel wörtlich `scan_mode` in `scanner_prefs`. Unbekannte oder fehlende Werte lesen als `einzeln`.
- **Socket-Ereignis heißt wörtlich `staging_released`**, Nutzdaten `{ passcodes: string[] }`. Über die Leitung geht **kein Modus-Feld** (Spec §5).
- **Keine Änderung an Erkennung, Zonen, Ampel oder Editionslesung.** D1–D3 sind gebaut, gemerged und abgenommen; dieser Plan konsumiert sie und rechnet nichts davon neu.
- **Jede benutzersichtbare Zeichenkette ist deutsch.** Yu-Gi-Oh-Begriffe bleiben englisch (Set-Code, Passcode, Rarity, Common, Secret Rare). Verbindliches Vokabular aus Spec C §4.
- Printing-Identität bleibt der 4-Spalten-Schlüssel `(id, set_code, language, rarity)`. `cards.quantity`/`deleted` sind triggergepflegte Caches und werden nie aus Anwendungscode geschrieben. Nur Soft-Delete.
- **Keine neue Abhängigkeit**, weder Gradle noch npm. Electron-Main bleibt CommonJS `.cjs`, der Renderer ESM.
- **Jeder neue IPC-Kanal muss in `main.cjs` UND `preload.cjs`** stehen, sonst kommt der Renderer nicht dran (CLAUDE.md).
- Desktop-Lint-Baseline: **5 vorbestehende Fehler**, ein sechster ist ein Fehlschlag (`cd desktop && npm run lint`). **Nie ein nacktes `npm install`** — `desktop/node_modules` und `better-sqlite3` sind ABI-gebunden.
- **Nie committen:** `android/local.properties`. Explizite Pfade stagen, **niemals `git add -A`**.
- Commit-Stil: `feat(android|desktop): …`, ein Commit pro Task, Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Testbefehle

| Was | Befehl (aus dem Repo-Wurzelverzeichnis) |
|---|---|
| Kotlin-Unit-Tests | `cd android && ./gradlew :app:testDebugUnitTest` |
| Ein einzelner Kotlin-Test | `cd android && ./gradlew :app:testDebugUnitTest --tests '*ScanAggregatorTest*'` |
| Kotlin kompiliert | `cd android && ./gradlew :app:compileDebugKotlin` |
| Desktop-Modultests | `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs` |
| Desktop-Lint | `cd desktop && npm run lint` |

## File Structure

| Datei | Verantwortung |
|---|---|
| `android/.../ui/ScanAggregator.kt` (neu) | **Rein.** Spec §4: entscheidet, wohin ein Wiederhol-`+1` gebucht wird — Hauptdruck, vorhandener Zusatzdruck oder neuer Zusatzdruck. Kennt weder Compose noch Netz. |
| `android/app/src/test/.../ScanAggregatorTest.kt` (neu) | JVM-Test der Regel, alle fünf Zeilen der Spec-Tabelle plus Randfälle. |
| `android/.../ui/ScanResolver.kt` (neu) | Die aus `stageScan` herausgezogene Auflösung: Passcode + Belege → `ResolvedScan` (Basiskarte, bekannte Drucke, Code-Treffer, Ampel). Gibt zurück statt Felder zu setzen, damit sie ohne Staging-Eintrag läuft. Trägt auch `logScanDecision`. |
| `android/.../Prefs.kt` | `scanMode` / `setScanMode` neben den vorhandenen Voreinstellungen. |
| `android/.../ui/ScanScreen.kt` | Modus-Schalter im Overlay, ein gemeinsamer Einstiegspunkt für jede Erfassung, Wiederhol-Buchung mit Rückgängig, Fußzeile bei verbundenem PC, `staging_released`-Empfänger. |
| `desktop/src/utils/scanAggregate.js` (neu) | **Rein.** Dieselbe Regel in JavaScript, für die PC-seitige Staging-Liste. |
| `desktop/src/utils/scanAggregate.test.js` (neu) | `node:test`-Gegenstück, dieselben Fälle. |
| `desktop/src/App.jsx` | `onCardScanned` fasst zusammen statt zu verwerfen. |
| `desktop/src/components/StagingArea.jsx` | Meldet Übernehmen / Verwerfen / Alles-Verwerfen als Freigabe zurück. |
| `desktop/electron/main.cjs` | IPC `release-staged` → `io.emit('staging_released', …)`. |
| `desktop/electron/preload.cjs` | `releaseStaged(passcodes)`. |

## Aufgabenreihenfolge und ihre Begründung

1. **Task 1** legt die Regel rein und getestet hin — sie ist der Kern und hängt von nichts ab.
2. **Task 2** ist ein reiner Umbau ohne Verhaltensänderung. Er muss vor Task 4 stehen, weil es ohne ihn nichts gibt, das ohne Staging-Eintrag auflösen kann.
3. **Task 3** macht Modus `stapel` offline benutzbar.
4. **Task 4** schaltet das Handy-Staging bei verbundenem PC ab.
5. **Task 5** liefert den Rückkanal. Ohne ihn wächst `seen` nach Task 4 unbegrenzt — Task 4 ist bis dahin unvollständig, aber für sich prüfbar.
6. **Task 6** bringt die Regel auf die PC-Seite, damit Modus `stapel` auch bei verbundenem PC wirkt.

---

### Task 1: Die Zusammenfassungsregel (rein, Handy)

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanAggregator.kt`
- Test: `android/app/src/test/java/com/example/yugiohscanner/ScanAggregatorTest.kt`

**Interfaces:**
- Consumes: `com.example.yugiohscanner.cloud.SetOption` (vorhanden, `PrintingRepository.kt:19`) — `data class SetOption(val setCode: String, val rarity: String, val price: Double, val language: String = "EN", val verified: Boolean = false)`.
- Produces: `ScanAggregator.target(primary: SetOption?, extras: List<SetOption?>, scanned: SetOption?): ScanAggregator.Target` mit `Target.Primary`, `Target.Extra(index: Int)`, `Target.NewExtra(set: SetOption)`. Task 3 ruft das auf.

**Hintergrund für den Umsetzenden.** Das Handy hält gescannte, noch nicht übernommene Karten in `ScanStagingEntry` (`ui/ScanStagingScreen.kt:41`). Ein Eintrag hat einen **Hauptdruck** (`selectedSet: SetOption?`, `quantity: Int`) und beliebig viele **Zusatzdrucke** (`extraPrintings: List<ExtraPrinting>`, jeder mit eigenem `selectedSet` und `quantity`). Ein Zusatzdruck ist derselbe Karten-Passcode in einer anderen Druckvariante — z. B. dieselbe Karte einmal deutsch und einmal englisch. Diese Aufgabe entscheidet **nur**, wohin ein weiteres Exemplar gebucht wird; das Buchen selbst macht Task 3.

**Warum verglichen wird und nicht nur der Set-Code.** Die Spec sagt „gleicher Setcode". Verglichen wird hier trotzdem die volle Druck-Identität `Set-Code | Rarity | Sprache`, denn genau die ist der Primärschlüssel der Sammlung: ein Common und ein Secret Rare desselben Set-Codes sind zwei Zeilen mit eigenem Preis. Beobachtbar unterscheidet sich das nicht — zwei Scans derselben Karte laufen durch denselben `SetCodeMatch`, liefern dieselbe `SetOption` und damit dieselbe Identität. Es ist der sicherere von zwei gleichwertigen Vergleichen.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Datei `android/app/src/test/java/com/example/yugiohscanner/ScanAggregatorTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.ScanAggregator
import org.junit.Assert.assertEquals
import org.junit.Test

class ScanAggregatorTest {

    private fun set(code: String, rarity: String = "Common", lang: String = "DE") =
        SetOption(setCode = code, rarity = rarity, price = 0.0, language = lang)

    private val lob = set("LOB-DE005")
    private val sdy = set("SDY-G005")

    @Test
    fun `ohne gelesenen Setcode zaehlt der Hauptdruck`() {
        // Spec-Tabelle, letzte Zeile: eine Karte, deren Code nicht gelesen wurde, ist
        // wahrscheinlich dieselbe wie eben -- nicht eine neue unbekannte.
        assertEquals(
            ScanAggregator.Target.Primary,
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = null),
        )
    }

    @Test
    fun `gleicher Druck wie der Hauptdruck zaehlt den Hauptdruck`() {
        assertEquals(
            ScanAggregator.Target.Primary,
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = set("LOB-DE005")),
        )
    }

    @Test
    fun `bekannter Zusatzdruck wird getroffen`() {
        val result = ScanAggregator.target(
            primary = lob, extras = listOf(sdy), scanned = set("SDY-G005"),
        )
        assertEquals(ScanAggregator.Target.Extra(0), result)
    }

    @Test
    fun `der richtige unter mehreren Zusatzdrucken wird getroffen`() {
        val en = set("LOB-EN005", lang = "EN")
        val result = ScanAggregator.target(
            primary = lob, extras = listOf(sdy, en), scanned = set("LOB-EN005", lang = "EN"),
        )
        assertEquals(ScanAggregator.Target.Extra(1), result)
    }

    @Test
    fun `unbekannter Druck wird ein neuer Zusatzdruck`() {
        val neu = set("SYE-DE001")
        assertEquals(
            ScanAggregator.Target.NewExtra(neu),
            ScanAggregator.target(primary = lob, extras = listOf(sdy), scanned = neu),
        )
    }

    @Test
    fun `noch nicht aufgeloester Hauptdruck zaehlt den Hauptdruck`() {
        // Wettlauf aus Spec Paragraf 4: die Wiederholung trifft ein, waehrend der erste Scan
        // derselben Karte noch auflöst. Es gibt nichts, wogegen verglichen werden koennte.
        assertEquals(
            ScanAggregator.Target.Primary,
            ScanAggregator.target(primary = null, extras = emptyList(), scanned = lob),
        )
    }

    @Test
    fun `gleicher Setcode mit anderer Rarity ist ein anderer Druck`() {
        // Die Sammlung schluesselt auf (id, set_code, language, rarity) -- ein Secret Rare in
        // einen Common zu falten schriebe den falschen Preis fort.
        val secret = set("LOB-DE005", rarity = "Secret Rare")
        assertEquals(
            ScanAggregator.Target.NewExtra(secret),
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = secret),
        )
    }

    @Test
    fun `gleicher Setcode in anderer Sprache ist ein anderer Druck`() {
        val en = set("LOB-DE005", lang = "EN")
        assertEquals(
            ScanAggregator.Target.NewExtra(en),
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = en),
        )
    }

    @Test
    fun `ein noch leerer Zusatzdruck wird uebersprungen statt getroffen`() {
        // extraPrintings.selectedSet ist nullbar (der Nutzer kann eine Zeile aufmachen, ohne
        // schon zu waehlen). Eine leere Zeile darf kein Ziel sein.
        assertEquals(
            ScanAggregator.Target.NewExtra(sdy),
            ScanAggregator.target(primary = lob, extras = listOf(null), scanned = sdy),
        )
    }
}
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*ScanAggregatorTest*'`
Expected: FAIL — Kompilierfehler, `Unresolved reference: ScanAggregator`.

- [ ] **Step 3: Die Regel schreiben**

Datei `android/app/src/main/java/com/example/yugiohscanner/ui/ScanAggregator.kt`:

```kotlin
package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.SetOption

/**
 * Spec D4 §4: wohin ein WIEDERHOLTER Scan derselben Karte sein "+1" bucht.
 *
 * Rein und ohne Zustand -- diese Datei entscheidet, [ScanScreen] fuehrt aus. Dasselbe Muster wie
 * [ScanStagingLogic] und `CardZones`: eine Regel, die nur in einem `@Composable` steht, ist in
 * diesem Projekt ungeprueft (es gibt keine Compose-Tests).
 *
 * Die JavaScript-Fassung derselben Regel steht in `desktop/src/utils/scanAggregate.js`. Dass es
 * sie zweimal gibt, ist Absicht (Spec §5): die Zusammenfassung wohnt dort, wo das Staging steht --
 * offline am Handy, bei verbundenem PC am PC. Wer hier etwas aendert, aendert dort mit.
 */
object ScanAggregator {

    sealed interface Target {
        /** Die Menge des Hauptdrucks erhoehen. */
        data object Primary : Target
        /** Die Menge des Zusatzdrucks an [index] in `extraPrintings` erhoehen. */
        data class Extra(val index: Int) : Target
        /** Einen neuen Zusatzdruck fuer [set] anlegen, Menge 1. */
        data class NewExtra(val set: SetOption) : Target
    }

    /**
     * Verglichen wird die volle Druck-Identitaet, nicht nur der Set-Code: die Sammlung
     * schluesselt auf `(id, set_code, language, rarity)`, ein Common und ein Secret Rare desselben
     * Codes sind zwei Zeilen mit eigenem Preis. Beobachtbar macht das keinen Unterschied -- zwei
     * Scans derselben Karte laufen durch denselben `SetCodeMatch` und liefern dieselbe
     * [SetOption] -- es ist nur der sicherere von zwei gleichwertigen Vergleichen.
     */
    private fun key(s: SetOption?): String? =
        s?.let { "${it.setCode}|${it.rarity}|${it.language}" }

    /**
     * @param primary der Hauptdruck des vorhandenen Eintrags, `null` solange er noch aufloest
     * @param extras die Drucke der vorhandenen Zusatzzeilen, in ihrer Reihenfolge; ein Element ist
     *        `null`, wenn die Zeile noch keine Wahl traegt
     * @param scanned der eben aufgeloeste Druck, `null` wenn der Set-Code nicht gelesen wurde
     *
     * Zwei Faelle enden bewusst beide auf [Target.Primary]: kein gelesener Code und ein noch nicht
     * aufgeloester Hauptdruck. In beiden gibt es nichts, wogegen sich vergleichen liesse, und
     * "dieselbe Karte nochmal" ist die richtige Annahme -- der Fehler waere im Staging sichtbar
     * und dort mit einem Klick zu korrigieren, ein faelschlich angelegter Zusatzdruck dagegen
     * schriebe stillschweigend einen zweiten Druck fort.
     */
    fun target(primary: SetOption?, extras: List<SetOption?>, scanned: SetOption?): Target {
        val wanted = key(scanned) ?: return Target.Primary
        val primaryKey = key(primary) ?: return Target.Primary
        if (wanted == primaryKey) return Target.Primary
        val i = extras.indexOfFirst { it != null && key(it) == wanted }
        if (i >= 0) return Target.Extra(i)
        // key(scanned) war oben nicht null, also ist scanned selbst hier nicht null; der Compiler
        // sieht das durch den Funktionsaufruf hindurch nicht, daher die Zusicherung.
        return Target.NewExtra(scanned!!)
    }
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*ScanAggregatorTest*'`
Expected: PASS, 9 Tests.

- [ ] **Step 5: Gesamte Kotlin-Testsuite laufen lassen**

Run: `cd android && ./gradlew :app:testDebugUnitTest`
Expected: PASS — die vorhandenen 16 Testklassen bleiben grün.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanAggregator.kt android/app/src/test/java/com/example/yugiohscanner/ScanAggregatorTest.kt
git commit -m "feat(android): Regel, wohin ein Wiederhol-Scan sein Plus-Eins bucht"
```

---

### Task 2: Auflösung aus dem Staging-Eintrag herauslösen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanResolver.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt` (`stageScan`, ca. Zeile 205–312; `logScanDecision`, ca. Zeile 911 bis Dateiende)

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces:
  ```kotlin
  class ResolvedScan(
      val base: CardRow,
      val knownSets: List<SetOption>,
      val match: SetCodeMatch.MatchResult,
      val confidence: ScanConfidence.Result,
  )
  suspend fun ScanResolver.resolve(
      pc: String,
      evidence: List<String>,
      framesEvidence: List<String>,
      editionTexts: List<String>,
      defaultEdition: String,
  ): ResolvedScan?     // null = Karte nicht gefunden
  internal fun logScanDecision(
      stage: String, passcode: String, match: SetCodeMatch.MatchResult,
      confidence: ScanConfidence.Result, knownSets: List<SetOption>,
  )
  ```
  Task 4 ruft `resolve` auf.

**Das ist ein Umbau ohne Verhaltensänderung.** Nach diesem Task muss das Scannen sich exakt so verhalten wie davor. Der einzige Zweck: die Auflösung läuft danach auch dann, wenn es gar keinen Staging-Eintrag gibt — die Voraussetzung für Task 4.

**Was heute passiert.** `stageScan` legt einen `ScanStagingEntry` an, hängt ihn in die Liste und startet eine Koroutine, die vier Dinge tut und ihre Zwischenstände **direkt in die Felder des Eintrags schreibt**:
1. Katalog lesen (`CatalogRepository.card(pc)`, auf `Dispatchers.IO`).
2. Druckliste bestimmen: die Katalog-Drucke **nur**, wenn mindestens einer `verified` ist (unverifizierte Zeilen sind der englische Abzug; sie als vollständig zu nehmen, wählte für eine deutsche Sammlung einen EN-Code vor). Sonst `PrintingRepository.fetchAllSets(pc)` über das Netz.
3. `SetCodeMatch.best(evidence, knownSets, framesEvidence)`.
4. `ScanConfidence.fromEvidence(match, knownSets, editionTexts, defaultEdition)` und die Protokollzeile `logScanDecision("erst", …)`.

- [ ] **Step 1: `ScanResolver.kt` anlegen**

Der Rumpf ist **wörtlich** die Logik aus `stageScan`, nur mit lokalen Variablen statt Eintragsfeldern und mit einem Rückgabewert. Datei `android/app/src/main/java/com/example/yugiohscanner/ui/ScanResolver.kt`:

```kotlin
package com.example.yugiohscanner.ui

import android.util.Log
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.ScanConfidence
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Das fertige Urteil ueber einen Scan -- alles, was ein Abnehmer braucht, und nichts davon
 *  an einen Staging-Eintrag gebunden. */
class ResolvedScan(
    val base: CardRow,
    val knownSets: List<SetOption>,
    val match: SetCodeMatch.MatchResult,
    val confidence: ScanConfidence.Result,
)

/**
 * Spec D4 §6.2: die Aufloesung eines Scans, herausgeloest aus dem Erzeugen des Staging-Eintrags.
 *
 * Vorher steckte dieser Ablauf in `ScanScreen.stageScan` und schrieb seine Zwischenstaende direkt
 * in die Felder eines [ScanStagingEntry]. Bei verbundenem PC gibt es diesen Eintrag nicht mehr --
 * also gibt diese Fassung ein Ergebnis ZURUECK, statt Felder zu setzen. Zwei Abnehmer, ein
 * Aufloeser: offline befuellt `ScanScreen` damit seinen Eintrag, verbunden geht es direkt auf die
 * Leitung.
 *
 * Inhaltlich unveraendert gegenueber D3 -- Katalog zuerst, verifizierte Drucke sonst Netz-Union,
 * [SetCodeMatch.best], [ScanConfidence.fromEvidence], Protokollzeile. Nur der Ort aendert sich.
 */
object ScanResolver {

    /** @return `null`, wenn zu [pc] ueberhaupt keine Karte gefunden wurde. Netz- und
     *  Katalogfehler fliegen als Ausnahme zum Aufrufer hoch, genau wie vorher. */
    suspend fun resolve(
        pc: String,
        evidence: List<String>,
        framesEvidence: List<String>,
        editionTexts: List<String>,
        defaultEdition: String,
    ): ResolvedScan? {
        // Katalog zuerst (D1 Task 9): ein lokaler Treffer loest die Basiskarte sofort auf,
        // offline, ohne Netz. Abseits des UI-Threads -- das ist ein SQLite-Lesevorgang.
        val catalogCard = withContext(Dispatchers.IO) {
            runCatching { CatalogRepository.card(pc) }.getOrNull()
        }
        // Die Basiskarte (Name, Werte, Bild) kommt immer aus dem Katalog, wenn sie dort steht --
        // reiner Gewinn. Die DRUCKLISTE nur dann, wenn der Katalog verifizierte (deutsche) Drucke
        // fuer diesen Passcode fuehrt; unverifizierte Zeilen sind der englische Abzug, und sie
        // als vollstaendig zu nehmen, waehlte fuer eine deutsche Sammlung einen EN-Code vor.
        val catalogSets = catalogCard?.printings?.takeIf { p -> p.any { it.verified } }

        val base: CardRow
        val knownSets: List<SetOption>
        if (catalogCard != null && catalogSets != null) {
            base = catalogCard.toCardRow()
            knownSets = catalogSets.map { it.toSetOption() }
        } else {
            base = catalogCard?.toCardRow()
                ?: CardSearchRepository.search(pc).firstOrNull()
                ?: return null
            knownSets = runCatching { PrintingRepository.fetchAllSets(pc) }.getOrDefault(emptyList())
        }

        val match = SetCodeMatch.best(evidence, knownSets, framesEvidence)
        val confidence = ScanConfidence.fromEvidence(match, knownSets, editionTexts, defaultEdition)
        logScanDecision("erst", pc, match, confidence, knownSets)
        return ResolvedScan(base, knownSets, match, confidence)
    }
}
```

**Wichtig:** `toCardRow()` und `toSetOption()` sind private Erweiterungsfunktionen am Anfang von `ScanScreen.kt` (ca. Zeile 90–95). Damit `ScanResolver.kt` sie sieht, ihre Sichtbarkeit von `private` auf `internal` heben — **nicht** kopieren.

- [ ] **Step 2: `logScanDecision` mitziehen**

`logScanDecision` steht heute als `private fun` am Dateiende von `ScanScreen.kt` (ca. Zeile 911) und hat **zwei** Aufrufer: `stageScan` (Zeile 233, Stufe `"erst"`) und die stille Verbesserung (Zeile 454, Stufe `"verbessert"`). Die Funktion **unverändert** ans Ende von `ScanResolver.kt` verschieben — als Datei-Ebenen-Funktion, `private` → `internal`, Rumpf und Ausgabeformat Zeichen für Zeichen gleich. Der Aufrufer in `ScanScreen.kt` Zeile 454 bleibt wie er ist (gleiches Paket).

Das Ausgabeformat ist Nutzlast für `ml/ocr_bench.py` und für das Auszählen einer Abnahme per `grep` — **keine Umbenennung, kein zusätzliches Feld, keine geänderte Reihenfolge**.

- [ ] **Step 3: `stageScan` auf den Aufrufer umbauen**

In `ScanScreen.kt` den Rumpf der Koroutine in `stageScan` (ca. Zeile 264–311) ersetzen. Der Eintrag wird weiterhin **sofort** mit `loading = true` angelegt und angehängt — das gefühlte Tempo bleibt —, nur das Befüllen kommt jetzt aus einer Stelle:

```kotlin
scope.launch {
    try {
        val r = ScanResolver.resolve(
            pc, evidence, framesEvidence, editionTexts,
            com.example.yugiohscanner.Prefs.defaultEdition(context),
        )
        if (r == null) {
            stagingCards.remove(entry); seen.remove(pc)   // eine spaetere Wiederholung erlauben
            snackbar.showSnackbar("Karte $pc nicht gefunden")
            return@launch
        }
        entry.base = r.base
        entry.knownSets = r.knownSets
        // .codeMatch bleibt liegen, damit eine spaetere, besser belegte Aufnahme sich damit
        // vergleichen kann (D3 Task 6, SetCodeEvidence.shouldSilentlyImprove) -- gegen die
        // SetOption allein ginge das nicht, sie traegt weder Distanz noch Frameanzahl.
        entry.codeMatch = r.match
        entry.selectedSet = r.match.selected
        entry.confidence = r.confidence
        entry.edition = r.confidence.effectiveEdition
        entry.loading = false
        mirrorToDesktop(r.match)
    } catch (e: Exception) {
        entry.loading = false
        snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
    }
}
```

Die lokale Hilfsfunktion `applyConfidence` in `stageScan` wird dadurch überflüssig und **entfällt** — ihre drei Zeilen stehen jetzt oben. `mirrorToDesktop` bleibt vorerst unverändert; Task 4 baut sie um.

- [ ] **Step 4: Kompilieren und Testsuite laufen lassen**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides PASS, keine neuen Warnungen über ungenutzte Symbole.

- [ ] **Step 5: Auf dem Gerät nachweisen, dass sich nichts geändert hat**

Bauen und installieren: `cd android && ./gradlew :app:installDebug` (Handy angesteckt und entsperrt).
Fünf Karten scannen, davon mindestens eine mit einem Passcode, den der Katalog nicht kennt.
Erwartet, jeweils gleich wie vor diesem Task:
- Der Eintrag erscheint **sofort** mit Ladeanzeige, nicht erst nach der Auflösung.
- Ampel, Set-Code-Vorauswahl und Edition stehen danach wie gewohnt.
- `adb logcat -s ScanDecision` zeigt je Karte **eine** Zeile mit `stage=erst` und unverändertem Feldsatz.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanResolver.kt android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt
git commit -m "refactor(android): Aufloesung aus dem Staging-Eintrag herausloesen"
```

---

### Task 3: Modus-Schalter und Wiederhol-Buchung am Handy

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/Prefs.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt` (Overlay-Zeile ca. 655–692; `onConfirmed` ca. 318–321; manuelle Eingabe ca. 773)

**Interfaces:**
- Consumes: `ScanAggregator.target(primary, extras, scanned): ScanAggregator.Target` aus Task 1.
- Produces: `Prefs.scanMode(ctx): String` (`"einzeln"` | `"stapel"`), `Prefs.setScanMode(ctx, v)`; in `ScanScreen` die gemeinsame Erfassungsweiche `onCapture(pc, evidence, frames, editionTexts)`, die Task 4 erweitert.

- [ ] **Step 1: Den Pref anlegen**

In `android/app/src/main/java/com/example/yugiohscanner/Prefs.kt`, hinter `setDefaultCondition`:

```kotlin
    /** Spec D4 §3. Der Schluessel `scan_mode` stammt aus Spec D §7a und wird hier weiterverwendet.
     *  Alles ausser dem wortwoertlichen "stapel" liest als "einzeln" -- ein unbekannter oder
     *  fehlender Wert darf niemals stillschweigend Mengen erhoehen. */
    fun scanMode(ctx: Context): String =
        if (p(ctx).getString("scan_mode", null) == "stapel") "stapel" else "einzeln"
    fun setScanMode(ctx: Context, v: String) =
        p(ctx).edit().putString("scan_mode", if (v == "stapel") "stapel" else "einzeln").apply()
```

- [ ] **Step 2: Den Schalter ins Overlay setzen**

In `ScanScreen.kt` bei den übrigen Zustandsvariablen (neben `isFlashOn`, ca. Zeile 166):

```kotlin
    var scanMode by remember { mutableStateOf(com.example.yugiohscanner.Prefs.scanMode(context)) }
```

In der Overlay-Zeile **vor** dem Fokus-Knopf (ca. Zeile 655) einfügen:

```kotlin
            // Spec D4 §3: Einzeln = jede Karte einmal pro Stapel. Stapel = ein erneutes Erkennen
            // erhoeht die Menge. Gemerkt in scanner_prefs, damit der Modus einen Neustart ueberlebt.
            IconButton(
                onClick = {
                    scanMode = if (scanMode == "stapel") "einzeln" else "stapel"
                    com.example.yugiohscanner.Prefs.setScanMode(context, scanMode)
                    Toast.makeText(
                        context,
                        if (scanMode == "stapel") "Stapel: Wiederholungen zaehlen"
                        else "Einzeln: jede Karte einmal",
                        Toast.LENGTH_SHORT,
                    ).show()
                },
                modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)),
            ) {
                Icon(
                    imageVector = if (scanMode == "stapel") Icons.Default.Layers else Icons.Default.LooksOne,
                    contentDescription = "Scan-Modus",
                    tint = if (scanMode == "stapel") Color.Yellow else Color.White,
                )
            }
```

Dafür die zwei Symbole importieren (zu den vorhandenen `androidx.compose.material.icons.filled.*`-Importen):

```kotlin
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.LooksOne
```

- [ ] **Step 3: Die Wiederhol-Buchung schreiben**

In `ScanScreen.kt` direkt hinter `stageScan` einfügen. Sie löst **ohne Netz** auf: die bekannten Drucke liegen am vorhandenen Eintrag schon vor.

```kotlin
    // Spec D4 §4: ein WIEDERHOLTES Erkennen derselben Karte im Modus "stapel". Kein Netz, kein
    // Katalog -- `entry.knownSets` steht bereits, `SetCodeMatch.best` laeuft direkt dagegen.
    // Wohin gebucht wird, entscheidet ScanAggregator (rein und getestet); hier wird nur gebucht.
    fun aggregateRepeat(pc: String, evidence: List<String>, framesEvidence: List<String>) {
        val entry = stagingCards.lastOrNull { it.passcode == pc } ?: return
        // Anderes Aufblitzen als bei einer Neuaufnahme (die blitzt mit 0.8f), damit ein "+1"
        // im Sucher nicht wie eine neue Karte aussieht.
        scope.launch { flash.snapTo(0.45f); flash.animateTo(0f, animationSpec = tween(300)) }

        val match = SetCodeMatch.best(evidence, entry.knownSets, framesEvidence)
        val target = ScanAggregator.target(
            primary = entry.selectedSet,
            extras = entry.extraPrintings.map { it.selectedSet },
            scanned = match.selected,
        )
        // Was rueckgaengig gemacht werden muesste, wird hier festgehalten -- nach dem Buchen ist
        // aus dem Zustand nicht mehr ablesbar, WELCHE Zeile dieses eine "+1" bekommen hat.
        val added: ExtraPrinting? = when (target) {
            is ScanAggregator.Target.Primary -> { entry.quantity++; null }
            is ScanAggregator.Target.Extra -> { entry.extraPrintings[target.index].quantity++; null }
            is ScanAggregator.Target.NewExtra -> ExtraPrinting().apply {
                selectedSet = target.set
                edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
                condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
            }.also { entry.extraPrintings.add(it) }
        }
        val menge = when (target) {
            is ScanAggregator.Target.Primary -> entry.quantity
            is ScanAggregator.Target.Extra -> entry.extraPrintings[target.index].quantity
            is ScanAggregator.Target.NewExtra -> 1
        }
        val name = entry.base?.name ?: pc
        scope.launch {
            val r = snackbar.showSnackbar(
                message = "$name ×$menge", actionLabel = "rueckgaengig",
                duration = SnackbarDuration.Short,
            )
            if (r != SnackbarResult.ActionPerformed) return@launch
            when (target) {
                is ScanAggregator.Target.Primary -> entry.quantity--
                is ScanAggregator.Target.Extra -> entry.extraPrintings[target.index].quantity--
                is ScanAggregator.Target.NewExtra -> added?.let { entry.extraPrintings.remove(it) }
            }
        }
    }
```

Dafür importieren:

```kotlin
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarResult
```

**Zum Rückgängig bei `Extra`:** Der Index bleibt gültig, weil zwischen Buchen und Rückgängig nur *angehängt* werden kann (`extraPrintings.add`) — die Staging-Liste entfernt Zusatzzeilen nur durch eine Nutzeraktion im Sheet, und das Sheet ist beim Scannen geschlossen. Sinkt die Menge dabei auf 0, bleibt die Zeile stehen; sie stand vor diesem Scan schon da und ist nicht diese Buchung.

- [ ] **Step 4: Die Erfassungsweiche einziehen**

`onConfirmed` (ca. Zeile 318) und die manuelle Eingabe (ca. Zeile 773) treffen heute beide getrennt die `seen`-Entscheidung. Beide auf **eine** Weiche legen. Direkt hinter `aggregateRepeat` einfügen:

```kotlin
    // Der einzige Einstieg fuer eine erfasste Karte -- autonome Erkennung wie manuelle Eingabe.
    // Spec D4 §3: im Modus "einzeln" faengt `seen` jede Wiederholung ab (heutiges Verhalten);
    // im Modus "stapel" wird sie zusammengefasst.
    fun onCapture(pc: String, evidence: List<String>, frames: List<String>, editionTexts: List<String>) {
        val isRepeat = !seen.add(pc)
        if (isRepeat && scanMode != "stapel") return
        if (isRepeat) aggregateRepeat(pc, evidence, frames)
        else stageScan(pc, evidence, frames, editionTexts)
    }
```

`onConfirmed` wird damit zu:

```kotlin
    val onConfirmed = rememberUpdatedState<(Int, List<String>, List<String>, List<String>) -> Unit> { passcode, evidence, frames, editionTexts ->
        if (passcode > 0) onCapture(passcode.toString(), evidence, frames, editionTexts)
    }
```

und die manuelle Eingabe (Zeile 773) zu:

```kotlin
                                    onCapture(manualCode, emptyList(), emptyList(), emptyList())
```

- [ ] **Step 5: Kompilieren und Testsuite laufen lassen**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides PASS.

- [ ] **Step 6: Auf dem Gerät abnehmen**

`cd android && ./gradlew :app:installDebug`, Handy angesteckt, **PC-App aus** (dieser Task betrifft nur den Offline-Fall).

1. Modus **Einzeln** (Symbol weiß): dieselbe Karte zweimal über die Kamera ziehen → **ein** Eintrag, Menge 1. Unverändertes heutiges Verhalten.
2. Modus **Stapel** (Symbol gelb): dieselbe Karte zweimal → **ein** Eintrag, Menge **2**, dazwischen die Meldung „«Name» ×2".
3. Modus **Stapel**: zwei verschiedene Drucke derselben Karte (z. B. eine deutsche und eine englische) → **ein** Eintrag mit Hauptdruck **und** einer Zusatzzeile, jede Menge 1.
4. Modus **Stapel**: nach einem „+1" auf „rueckgaengig" tippen → die Menge steht wieder auf 1.
5. App beenden und neu starten → der Modus steht noch so, wie er zuletzt war.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/Prefs.kt android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt
git commit -m "feat(android): zweiter Scan-Modus, Wiederholung zaehlt statt zu verfallen"
```

---

### Task 4: Kein Handy-Staging bei verbundenem PC

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt` (`mirrorToDesktop` ca. 244–263; `onCapture` aus Task 3; Fußzeile ca. 694–706)

**Interfaces:**
- Consumes: `ScanResolver.resolve(...)` und `ResolvedScan` aus Task 2; `onCapture` aus Task 3.
- Produces: nichts, was ein späterer Task aufruft.

- [ ] **Step 1: Das Senden vom Staging-Eintrag lösen**

`mirrorToDesktop` liest heute `entry.confidence` und `entry.edition`, hängt also am Eintrag. Sie durch eine Fassung ersetzen, die aus einem `ResolvedScan` sendet. Als Funktion auf **Datei-Ebene** ans Ende von `ScanScreen.kt` (Task 2 hat `logScanDecision` von dort weggezogen, die Stelle ist frei), damit sie keinen Compose-Zustand einfängt:

```kotlin
// Spec D3 Task 8, jetzt aus ResolvedScan statt aus einem Staging-Eintrag (Spec D4 §6.2): spiegelt
// die auf dem Handy BEREITS GEFAELLTE Entscheidung an den PC -- Set-Code, Rarity, Sprache, Edition,
// Ampel und deutscher Grund woertlich -- damit der PC dieselbe Vorauswahl zeigt, statt die
// Kandidaten selbst gegen eine Karte zu matchen, deren Bandtext er nie gesehen hat.
// Ein aelterer PC-Stand ignoriert die Felder, die er nicht kennt.
private fun sendScanToDesktop(socket: Socket, pc: String, r: ResolvedScan) {
    val data = JSONObject().put("passcode", pc)
    r.match.selected?.let {
        data.put("setCode", it.setCode)
        data.put("rarity", it.rarity)
        data.put("language", it.language)
    }
    if (r.match.candidates.isNotEmpty()) {
        data.put("setCodeCandidates", JSONArray(r.match.candidates.map { it.setCode }))
    }
    data.put("edition", r.confidence.effectiveEdition)
    data.put("editionConfidence", r.confidence.editionConfidence.name.lowercase(Locale.ROOT))
    data.put("confidence", r.confidence.light.name.lowercase(Locale.ROOT))
    data.put("reason", r.confidence.reason ?: JSONObject.NULL)
    socket.emit("card_scanned", data)
}
```

**Die alte lokale `mirrorToDesktop` in `stageScan` entfällt ersatzlos**, mitsamt ihrem Aufruf am Ende der Koroutine (Task 2, Step 3). Sie wäre ab hier toter Code: `stageScan` wird nach Step 3 nur noch erreicht, wenn der PC **nicht** verbunden ist — `onCapture` schickt jeden verbundenen Fall zu `sendScan`, und dessen Rückfall greift ausschließlich bei abgerissener Verbindung. Ein Spiegelaufruf, der nie feuern kann, ist schlimmer als keiner: er behauptet ein Verhalten, das es nicht gibt.

- [ ] **Step 2: Den Sendeweg ohne Eintrag schreiben**

Direkt hinter `stageScan` einfügen. Zwei Zustandsvariablen dazu, bei `isFlashOn` (ca. Zeile 166):

```kotlin
    // Spec D4 §6.3: Fortschrittsanzeige bei verbundenem PC. `sentCount` zaehlt gesendete Karten
    // seit Scannerstart und wird von der Freigabe NICHT verringert -- es ist eine Fortschritts-,
    // keine Bestandsanzeige. `lastLight` ist die Ampel des zuletzt gesendeten Scans.
    var sentCount by remember { mutableIntStateOf(0) }
    var lastLight by remember { mutableStateOf<ScanConfidence.Light?>(null) }
```

```kotlin
    // Spec D4 §6: fuehrt der PC das Staging, legt das Handy KEINEN Eintrag an -- es loest auf und
    // sendet. Erste Sichtung wie Wiederholung gehen denselben Weg; zusammengefasst wird am PC (§5).
    //
    // [isRepeat] dient nur der Rueckmeldung (§7) und dem Rueckfall, wenn die Verbindung waehrend
    // der Aufloesung wegbricht. Es geht NICHT auf die Leitung -- der PC braucht kein Modus-Feld.
    //
    // Diese Funktion muss VOR `onCapture` und NACH `stageScan`/`aggregateRepeat` stehen: lokale
    // Funktionen in Kotlin sehen nur, was vor ihnen deklariert ist, und `onCapture` ruft diese
    // hier auf. Deshalb faellt der Verbindungsabbruch unten direkt auf die beiden anderen zurueck
    // statt ueber `onCapture` zu gehen -- das waere ein gegenseitiger Aufruf und damit unmoeglich.
    fun sendScan(
        pc: String, evidence: List<String>, framesEvidence: List<String>,
        editionTexts: List<String>, isRepeat: Boolean,
    ) {
        scope.launch {
            flash.snapTo(if (isRepeat) 0.45f else 0.8f)
            flash.animateTo(0f, animationSpec = tween(300))
        }
        scope.launch {
            try {
                val r = ScanResolver.resolve(
                    pc, evidence, framesEvidence, editionTexts,
                    com.example.yugiohscanner.Prefs.defaultEdition(context),
                )
                if (r == null) {
                    seen.remove(pc)   // eine spaetere Wiederholung erlauben
                    snackbar.showSnackbar("Karte $pc nicht gefunden")
                    return@launch
                }
                val s = socket
                if (s == null || !isConnected) {
                    // Die Verbindung ist waehrend der Aufloesung weggebrochen. Die Karte darf
                    // nicht verschwinden: sie kommt ins Handy-Staging, wohin sie ohne PC gehoert.
                    // Eine Wiederholung wird nur dann gebucht, wenn es ueberhaupt einen Eintrag
                    // gibt -- die frueheren Kopien liegen ja beim PC. Sonst wird sie ein eigener
                    // Eintrag, damit diese eine Karte nicht still verlorengeht.
                    if (isRepeat && stagingCards.any { it.passcode == pc }) {
                        aggregateRepeat(pc, evidence, framesEvidence)
                    } else {
                        stageScan(pc, evidence, framesEvidence, editionTexts)
                    }
                    return@launch
                }
                sendScanToDesktop(s, pc, r)
                sentCount++
                lastLight = r.confidence.light
                if (isRepeat) {
                    // §7: bei verbundenem PC ist die Meldung NUR informativ -- kein Knopf.
                    // Korrigiert wird am PC, wo der Eintrag mit seinen +/--Knoepfen sichtbar in
                    // der Liste steht. Die neue Menge steht bewusst NICHT hier: sie zaehlt am PC,
                    // das Handy kennt sie nicht und darf sie nicht erfinden.
                    snackbar.showSnackbar("${r.base.name} nochmal an den PC")
                }
            } catch (e: Exception) {
                seen.remove(pc)
                snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
            }
        }
    }
```

- [ ] **Step 3: Die Weiche erweitern**

`onCapture` aus Task 3 bekommt den verbundenen Fall vorangestellt. Sie muss **hinter** `sendScan` stehen (siehe dessen Kommentar zur Reihenfolge):

```kotlin
    fun onCapture(pc: String, evidence: List<String>, frames: List<String>, editionTexts: List<String>) {
        val isRepeat = !seen.add(pc)
        if (isRepeat && scanMode != "stapel") return
        if (isConnected) {
            // §6: kein Handy-Staging. Erste Sichtung wie gewollte Wiederholung gehen an den PC,
            // der sie nach derselben Regel zusammenfasst (§5). Deshalb braucht die Leitung auch
            // kein Modus-Feld: im Modus "einzeln" kommt hier nie eine Wiederholung an.
            sendScan(pc, evidence, frames, editionTexts, isRepeat)
        } else if (isRepeat) {
            aggregateRepeat(pc, evidence, frames)
        } else {
            stageScan(pc, evidence, frames, editionTexts)
        }
    }
```

Die endgültige Reihenfolge der lokalen Funktionen in `ScanScreen` lautet damit: `stageScan` → `aggregateRepeat` → `sendScan` → `onCapture`.

- [ ] **Step 4: Die Fußzeile umbauen**

Die Fußzeile (ca. Zeile 694) zeigt heute nur bei nicht-leerer Staging-Liste. Bei verbundenem PC bleibt die Liste leer, also braucht es einen zweiten Zweig:

```kotlin
        // Fusszeile: bei verbundenem PC eine Fortschrittsanzeige (Spec D4 §6.3), sonst wie bisher
        // der Zaehler mit dem Pruefen-Knopf.
        if (isConnected && sentCount > 0) {
            Row(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .background(Color.Black.copy(alpha = 0.55f)).navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("$sentCount an den PC gesendet", color = Color.White, modifier = Modifier.weight(1f))
                // Dieselben drei Ampelfarben wie im Staging-Sheet -- keine neuen Farben.
                Box(Modifier.size(10.dp).clip(CircleShape).background(ScanStagingLogic.dotColor(lastLight)))
            }
        } else if (stagingCards.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .background(Color.Black.copy(alpha = 0.55f)).navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${stagingCards.size} Karten erkannt", color = Color.White, modifier = Modifier.weight(1f))
                Button(onClick = { showSheet = true }) { Text("Prüfen (${stagingCards.size})") }
            }
        }
```

`ScanConfidence.Light` importieren, falls noch nicht geschehen.

**Bewusste Folge, hier festgehalten statt später als Fehler gemeldet:** die stille Verbesserung aus D3 (ca. Zeile 429–455) sucht ihren Eintrag über `stagingCards.find { it.passcode == pc }`. Bei verbundenem PC ist diese Liste leer, die Schleife findet nichts, und die stille Verbesserung ruht. Das ist kein Rückschritt — sie hat auch vorher nie an den PC nachgemeldet (D3-Review-Befund I3, bewusst zurückgestellt). **Nicht** in diesem Task reparieren.

- [ ] **Step 5: Kompilieren und Testsuite laufen lassen**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides PASS.

- [ ] **Step 6: Auf dem Gerät abnehmen**

`cd android && ./gradlew :app:installDebug`, Handy angesteckt, **PC-App an und verbunden** (grüner Punkt oben im Scanner).

1. Fünf Karten scannen → am Handy erscheint **keine** Staging-Liste, die Fußzeile zählt auf „5 an den PC gesendet", die Karten stehen im Staging der PC-App.
2. Der Ampelpunkt in der Fußzeile wechselt die Farbe passend zur zuletzt gescannten Karte (eine bewusst schräg gehaltene Karte für Gelb/Rot).
3. PC-App schließen, weiterscannen → ab der nächsten Karte erscheint wieder die Handy-Liste mit dem Prüfen-Knopf.
4. Modus **Stapel**, PC verbunden, dieselbe Karte zweimal → am PC steht **eine** Karte; dass ihre Menge noch nicht auf 2 springt, ist erwartet und kommt in Task 6.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt
git commit -m "feat(android): kein Handy-Staging, wenn der PC verbunden ist"
```

---

### Task 5: Rückkanal — der PC gibt eine übernommene Karte frei

**Files:**
- Modify: `desktop/electron/main.cjs` (`startSocketServer` ca. 66–85; IPC-Handler bei den übrigen `ipcMain.handle`)
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/src/components/StagingArea.jsx` (`handleAdd` ca. 191–252, `handleDiscard` ca. 269, `handleClearAll` ca. 273)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt` (`connectSocket` ca. 125–139; Deklaration von `seen` ca. 187)

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces: Socket-Ereignis `staging_released` mit `{ passcodes: string[] }`, PC → Handy. Kein späterer Task baut darauf auf.

**Warum es das braucht.** Nach Task 4 merkt sich das Handy jeden gesendeten Passcode in `seen`, damit ein Schwenk über dieselbe Karte sie nicht mehrfach schickt. Geleert wurde `seen` bisher, wenn **am Handy** übernommen wurde (`onCommitted`). Diesen Moment gibt es bei verbundenem PC nicht mehr — ohne Rückkanal wächst `seen` unbegrenzt und dieselbe Karte wäre in einem späteren Stapel nie wieder scannbar.

Weil der PC **pro Karte** übernimmt (`handleAdd(tempId)`), ist das Signal feiner als ein Stapelende: „diese Karte ist durch."

- [ ] **Step 1: Sender im Main-Prozess**

In `desktop/electron/main.cjs` bei den übrigen `ipcMain.handle`-Aufrufen:

```js
// Spec D4 §6.4: der PC meldet dem Handy, dass es eine Karte wieder freigeben darf -- nach dem
// Uebernehmen, dem Verwerfen und dem Alles-Verwerfen. Ohne das waechst die Merkliste des Handys
// unbegrenzt, sobald der PC das Staging fuehrt, und dieselbe Karte waere in einem spaeteren
// Stapel nie wieder scannbar. Ist kein Handy verbunden, ist das emit wirkungslos -- kein Sonderfall.
ipcMain.handle('release-staged', (_e, passcodes) => {
  if (!io || !Array.isArray(passcodes) || passcodes.length === 0) return { success: true };
  io.emit('staging_released', { passcodes: passcodes.map(String) });
  return { success: true };
});
```

- [ ] **Step 2: Brücke im Preload**

In `desktop/electron/preload.cjs` bei den übrigen `invoke`-Zeilen:

```js
  releaseStaged: (passcodes) => ipcRenderer.invoke('release-staged', passcodes),
```

Ohne diese Zeile kommt der Renderer nicht an den Handler (CLAUDE.md).

- [ ] **Step 3: Auslöser in der Staging-Liste**

In `desktop/src/components/StagingArea.jsx`, in `handleAdd` **unmittelbar vor** `setScannedCards(prev => prev.filter(...))` (ca. Zeile 248), also erst nachdem alle Drucke erfolgreich geschrieben wurden:

```js
           // Spec D4 §6.4: die Karte ist durch -- das Handy darf sie wieder scannen.
           window.api?.releaseStaged?.([card.passcode]);
```

In `handleDiscard`:

```js
  const handleDiscard = (tempId) => {
      const card = scannedCards.find(c => c.tempId === tempId);
      if (card) window.api?.releaseStaged?.([card.passcode]);
      setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
  };
```

In `handleClearAll`, innerhalb des bestätigten Zweigs, vor `setScannedCards([])`:

```js
          window.api?.releaseStaged?.(scannedCards.map(c => c.passcode));
```

Das `?.` an beiden Stellen ist kein Zieren: `window.api` fehlt im reinen Browser-Modus (`npm run dev`), und die Staging-Liste soll dort weiter bedienbar bleiben.

- [ ] **Step 4: `seen` im Handy nach oben ziehen**

In `ScanScreen.kt` steht `connectSocket` (ca. Zeile 125) **vor** der Deklaration von `seen` (ca. Zeile 187). Kotlin verlangt die Deklaration vor der Verwendung im selben Gültigkeitsbereich, also muss die `seen`-Zeile samt ihres Kommentars **über** `connectSocket` wandern — unverändert, nur verschoben:

```kotlin
    val seen = remember { ConcurrentHashMap.newKeySet<String>() }
```

- [ ] **Step 5: Empfänger im Handy**

In `connectSocket`, hinter dem `EVENT_DISCONNECT`-Empfänger:

```kotlin
            // Spec D4 §6.4: der PC hat diese Karten uebernommen oder verworfen -- sie duerfen
            // wieder gescannt werden. Laeuft auf dem Socket-Thread; `seen` ist ein
            // ConcurrentHashMap-Set und genau dafuer da.
            newSocket.on("staging_released") { args ->
                val obj = args.firstOrNull() as? JSONObject ?: return@on
                val arr = obj.optJSONArray("passcodes") ?: return@on
                for (i in 0 until arr.length()) seen.remove(arr.optString(i))
            }
```

- [ ] **Step 6: Beide Seiten bauen**

Run: `cd android && ./gradlew :app:compileDebugKotlin`
Expected: PASS.

Run: `cd desktop && npm run lint`
Expected: **genau 5** Fehler — die bekannte Baseline. Ein sechster ist ein Fehlschlag.

- [ ] **Step 7: Zusammen abnehmen**

PC-App starten (`cd desktop && npm run electron:dev`), Handy verbinden, Modus **Einzeln**.

1. Eine Karte scannen → sie steht am PC. Dieselbe Karte nochmal über die Kamera ziehen → **nichts** passiert (`seen` greift).
2. Am PC **Übernehmen** drücken. Dieselbe Karte erneut scannen → sie erscheint am PC als **neuer** Eintrag. Das ist richtig: es ist eine weitere physische Kopie.
3. Eine Karte scannen, am PC **verwerfen**, erneut scannen → sie erscheint wieder.
4. Mehrere Karten scannen, am PC **alles verwerfen**, eine davon erneut scannen → sie erscheint wieder.
5. Handy-App **ohne** PC starten und scannen → keine Fehlermeldung, Handy-Staging wie gewohnt.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/src/components/StagingArea.jsx android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt
git commit -m "feat(desktop,android): uebernommene Karte am Handy wieder freigeben"
```

---

### Task 6: Dieselbe Regel auf der PC-Seite

**Files:**
- Create: `desktop/src/utils/scanAggregate.js`
- Test: `desktop/src/utils/scanAggregate.test.js`
- Modify: `desktop/src/App.jsx` (`onCardScanned` ca. 36–68)

**Interfaces:**
- Consumes: `phoneSelectedSet(setCode, rarity, language, printings)` aus `desktop/src/utils/setCodeMatch.js` (vorhanden) — löst die vom Handy gemeldete Druckangabe gegen die Druckliste einer Karte auf und setzt notfalls einen Platzhalter mit Preis 0 zusammen.
- Produces: `aggregateTarget(card, scanned)` und `applyScan(cards, scanned)` aus `scanAggregate.js`. Kein späterer Task baut darauf auf.

**Kontext für den Umsetzenden.** Die Staging-Liste des PCs ist `scannedCards` in `desktop/src/App.jsx`; `StagingArea.jsx` zeigt und bearbeitet sie. Ein Eintrag hat `passcode`, `status` (`'pending'` → `'loaded'`), `selectedSet` (der gewählte Druck, aufgelöst gegen `allPrintings`), `quantity` und `extraPrintings` (je mit eigenem `selectedSet`, `quantity`, `edition`, `condition`). `handleAdd` schreibt Hauptdruck plus alle Zusatzdrucke in die Sammlung.

Heute **verwirft** `onCardScanned` einen Passcode, der schon in der Liste steht (`if (prev.some(c => c.passcode === data.passcode)) return prev;`). Genau diese Zeile wird durch die Regel ersetzt.

**Warum es nur drei Ausgänge gibt.** Ist die Karte noch `'pending'`, gibt es weder `allPrintings` noch `selectedSet`, gegen die verglichen werden könnte — dann `+1` am Hauptdruck, dieselbe Antwort wie das Handy im Wettlauf gibt (Spec §4). Lässt sich der gemeldete Druck nicht auflösen, ebenso. Ein Zusatzdruck ohne auflösbaren Druck wäre schlimmer als ein `+1`: `handleAdd` überspringt ihn wortlos („an extra line with nothing picked — skip it rather than guess a wrong code"), die Kopie wäre also still verloren.

**Neue Zusatzdrucke tragen `edition: null` und `condition: null`.** Das ist kein Versäumnis: `handleAdd` setzt beim Übernehmen `p.edition || defaults.edition` ein. Die Voreinstellungen liegen in `StagingArea`, nicht in `App.jsx`, und werden so an genau der Stelle gelesen, an der sie stehen.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Datei `desktop/src/utils/scanAggregate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTarget, applyScan } from './scanAggregate.js';

const lob = { set_code: 'LOB-DE005', set_rarity: 'Common', language: 'DE' };
const sdy = { set_code: 'SDY-G005', set_rarity: 'Common', language: 'DE' };
const lobEn = { set_code: 'LOB-EN005', set_rarity: 'Ultra Rare', language: 'EN' };

const loaded = (over = {}) => ({
  tempId: 1, passcode: '46986414', status: 'loaded',
  allPrintings: [lob, sdy, lobEn], selectedSet: lob, quantity: 1, extraPrintings: [],
  ...over,
});

const scan = (over = {}) => ({ passcode: '46986414', setCode: 'LOB-DE005', rarity: 'Common', language: 'DE', ...over });

test('ohne gelesenen Setcode zaehlt der Hauptdruck', () => {
  assert.deepEqual(aggregateTarget(loaded(), scan({ setCode: undefined })), { kind: 'primary' });
});

test('eine noch ladende Karte zaehlt den Hauptdruck', () => {
  // Wettlauf: es gibt noch keine Druckliste, gegen die verglichen werden koennte.
  const pending = { tempId: 1, passcode: '46986414', status: 'pending', quantity: 1 };
  assert.deepEqual(aggregateTarget(pending, scan()), { kind: 'primary' });
});

test('gleicher Druck wie der Hauptdruck zaehlt den Hauptdruck', () => {
  assert.deepEqual(aggregateTarget(loaded(), scan()), { kind: 'primary' });
});

test('bekannter Zusatzdruck wird getroffen', () => {
  const card = loaded({ extraPrintings: [{ selectedSet: sdy, quantity: 1 }] });
  assert.deepEqual(aggregateTarget(card, scan({ setCode: 'SDY-G005' })), { kind: 'extra', index: 0 });
});

test('der richtige unter mehreren Zusatzdrucken wird getroffen', () => {
  const card = loaded({ extraPrintings: [
    { selectedSet: sdy, quantity: 1 },
    { selectedSet: lobEn, quantity: 1 },
  ] });
  const t = aggregateTarget(card, scan({ setCode: 'LOB-EN005', rarity: 'Ultra Rare', language: 'EN' }));
  assert.deepEqual(t, { kind: 'extra', index: 1 });
});

test('unbekannter Druck wird ein neuer Zusatzdruck', () => {
  const t = aggregateTarget(loaded(), scan({ setCode: 'SDY-G005' }));
  assert.equal(t.kind, 'newExtra');
  assert.equal(t.set.set_code, 'SDY-G005');
});

test('gleicher Setcode mit anderer Rarity ist ein anderer Druck', () => {
  const t = aggregateTarget(loaded(), scan({ rarity: 'Secret Rare' }));
  assert.equal(t.kind, 'newExtra');
});

test('applyScan haengt eine unbekannte Karte hinten an', () => {
  const out = applyScan([], scan());
  assert.equal(out.length, 1);
  assert.equal(out[0].passcode, '46986414');
  assert.equal(out[0].status, 'pending');
  assert.equal(out[0].scannedSetCode, 'LOB-DE005');
});

test('applyScan erhoeht die Menge des Hauptdrucks', () => {
  const out = applyScan([loaded()], scan());
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 2);
});

test('applyScan legt einen neuen Zusatzdruck mit Menge 1 an', () => {
  const out = applyScan([loaded()], scan({ setCode: 'SDY-G005' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 1);
  assert.equal(out[0].extraPrintings.length, 1);
  assert.equal(out[0].extraPrintings[0].quantity, 1);
  assert.equal(out[0].extraPrintings[0].selectedSet.set_code, 'SDY-G005');
  // Edition und Zustand bleiben leer -- handleAdd setzt beim Uebernehmen die Voreinstellungen ein.
  assert.equal(out[0].extraPrintings[0].edition, null);
});

test('applyScan fasst nur den passenden Eintrag an', () => {
  const other = loaded({ tempId: 9, passcode: '11111111' });
  const out = applyScan([other, loaded()], scan());
  assert.equal(out[0].quantity, 1);
  assert.equal(out[1].quantity, 2);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd desktop && node --test src/utils/scanAggregate.test.js`
Expected: FAIL — `Cannot find module` für `./scanAggregate.js`.

- [ ] **Step 3: Das Modul schreiben**

Datei `desktop/src/utils/scanAggregate.js`:

```js
import { phoneSelectedSet } from './setCodeMatch.js';

// Spec D4 §4/§5: wohin ein WIEDERHOLTER Scan derselben Karte sein "+1" bucht, solange der PC das
// Staging fuehrt.
//
// Die Kotlin-Fassung derselben Regel steht in
// `android/.../ui/ScanAggregator.kt`. Dass es sie zweimal gibt, ist Absicht: die Zusammenfassung
// wohnt dort, wo das Staging steht -- offline am Handy, verbunden am PC. Wer hier etwas aendert,
// aendert dort mit.
//
// Ueber die Leitung kommt KEIN Modus-Feld. Im Modus "einzeln" faengt das Handy jede Wiederholung
// selbst ab; erreicht uns eine, war sie gewollt. Deshalb darf hier bedingungslos zusammengefasst
// werden.

// Verglichen wird die volle Druck-Identitaet, nicht nur der Set-Code: die Sammlung schluesselt auf
// (id, set_code, language, rarity) -- ein Secret Rare in einen Common zu falten schriebe den
// falschen Preis fort.
const keyOf = (s) => (s ? `${s.set_code}|${s.set_rarity}|${s.language}` : null);

/**
 * @param {object} card ein Eintrag der Staging-Liste
 * @param {object} scanned die Meldung des Handys ({ passcode, setCode, rarity, language })
 * @returns {{kind:'primary'} | {kind:'extra', index:number} | {kind:'newExtra', set:object}}
 *
 * Drei Faelle enden bewusst auf `primary`: kein gemeldeter Set-Code, eine noch ladende Karte
 * (keine Druckliste, gegen die verglichen werden koennte -- dieselbe Antwort, die das Handy im
 * Wettlauf gibt) und ein Druck, der sich nicht aufloesen laesst. Ein Zusatzdruck ohne
 * auflösbaren Druck waere schlimmer als ein "+1": `handleAdd` ueberspringt ihn wortlos, die
 * Kopie waere still verloren.
 */
export function aggregateTarget(card, scanned) {
  if (!scanned || !scanned.setCode) return { kind: 'primary' };
  if (card.status !== 'loaded' || !card.allPrintings) return { kind: 'primary' };
  const set = phoneSelectedSet(scanned.setCode, scanned.rarity, scanned.language, card.allPrintings);
  if (!set) return { kind: 'primary' };
  const wanted = keyOf(set);
  if (wanted === keyOf(card.selectedSet)) return { kind: 'primary' };
  const i = (card.extraPrintings || []).findIndex(p => keyOf(p.selectedSet) === wanted);
  if (i >= 0) return { kind: 'extra', index: i };
  return { kind: 'newExtra', set };
}

/**
 * Die Staging-Liste nach einer Handy-Meldung. Gibt immer ein NEUES Array zurueck (React-Zustand)
 * und fasst nur den Eintrag mit demselben Passcode an.
 *
 * Ein neuer Eintrag wird hinten angehaengt, damit die zuerst gescannte Karte oben stehen bleibt --
 * eine neu hinzukommende Karte laesst die Liste nach unten wachsen, ihre aufgeklappten Zeilen
 * koennen also nicht unten abgeschnitten werden.
 */
export function applyScan(cards, scanned) {
  const idx = cards.findIndex(c => c.passcode === scanned.passcode);
  if (idx < 0) {
    return [...cards, newEntry(scanned)];
  }
  const card = cards[idx];
  const target = aggregateTarget(card, scanned);
  let updated;
  if (target.kind === 'primary') {
    updated = { ...card, quantity: (card.quantity || 1) + 1 };
  } else if (target.kind === 'extra') {
    const extras = card.extraPrintings.map((p, i) =>
      i === target.index ? { ...p, quantity: (p.quantity || 1) + 1 } : p);
    updated = { ...card, extraPrintings: extras };
  } else {
    // edition/condition bleiben leer -- handleAdd setzt beim Uebernehmen die Voreinstellungen ein.
    const extra = { selectedSet: target.set, quantity: 1, edition: null, condition: null };
    updated = { ...card, extraPrintings: [...(card.extraPrintings || []), extra] };
  }
  return cards.map((c, i) => (i === idx ? updated : c));
}

// Spec D3 Task 8: die Felder, die ein aktuelles Handy mitschickt -- Set-Code, Rarity, Sprache,
// Edition, Ampel und Grund. Ein aelterer Handy-Stand sendet sie nicht; sie landen dann `undefined`
// und StagingArea faellt auf sein eigenes lokales Matching zurueck.
function newEntry(d) {
  return {
    tempId: Date.now() + Math.random(),
    passcode: d.passcode,
    scannedSetCandidates: d.setCodeCandidates || (d.setCode ? [d.setCode] : []),
    scannedSetCode: d.setCode,
    scannedRarity: d.rarity,
    scannedLanguage: d.language,
    scannedEdition: d.edition,
    scannedEditionConfidence: d.editionConfidence,
    scannedConfidence: d.confidence,
    scannedReason: d.reason,
    status: 'pending',
    data: null,
  };
}
```

**`tempId` benutzt `Date.now()`** — genau wie der vorhandene Code in `App.jsx`, aus dem diese Funktion stammt. Im Test wird `tempId` nicht geprüft.

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd desktop && node --test src/utils/scanAggregate.test.js`
Expected: PASS, 11 Tests.

- [ ] **Step 5: `App.jsx` auf das Modul umstellen**

Den Import ergänzen:

```js
import { applyScan } from './utils/scanAggregate.js';
```

Und den Rumpf von `onCardScanned` (ca. Zeile 36–68) ersetzen:

```js
      const removeScanListener = window.api.onCardScanned((data) => {
        console.log('Received scan:', data);
        // Spec D4 §5: eine Wiederholung wird zusammengefasst, statt verworfen zu werden --
        // gleicher Druck erhoeht die Menge, ein anderer macht eine Zusatzzeile auf. Die Regel
        // steht in utils/scanAggregate.js, ihr Kotlin-Zwilling in ScanAggregator.kt.
        setScannedCards(prev => applyScan(prev, data));
      });
```

- [ ] **Step 6: Alle Desktop-Tests und Lint**

Run: `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs`
Expected: PASS — **28 Tests**: die 17 vorhandenen (13 davon in `setCodeMatch.test.js`) bleiben grün, plus die 11 neuen.

Run: `cd desktop && npm run lint`
Expected: **genau 5** Fehler — die bekannte Baseline.

- [ ] **Step 7: Zusammen abnehmen**

PC-App starten, Handy verbinden, Modus **Stapel**.

1. Dieselbe Karte zweimal scannen → am PC **ein** Eintrag mit Menge **2**.
2. Zwei verschiedene Drucke derselben Karte scannen (deutsch und englisch) → **ein** Eintrag mit Hauptdruck und einer Zusatzzeile, jede Menge 1.
3. Übernehmen → beide Drucke stehen in der Sammlung, jeder mit seiner Menge.
4. Modus auf **Einzeln** stellen, dieselbe Karte zweimal scannen → Menge bleibt 1.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/utils/scanAggregate.js desktop/src/utils/scanAggregate.test.js desktop/src/App.jsx
git commit -m "feat(desktop): Wiederhol-Scan zusammenfassen statt verwerfen"
```

---

## Abschluss

Nach Task 6 die Abnahmeliste aus Spec §10 vollständig durchgehen — sie prüft die Zusammenspiele, die kein einzelner Task allein abdeckt, besonders Punkt 8 (Verbindung während des Scannens trennen).

Danach `superpowers:finishing-a-development-branch`.
