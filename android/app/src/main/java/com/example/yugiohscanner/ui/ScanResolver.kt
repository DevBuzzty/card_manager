package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.RarityQuellen
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.ScanConfidence
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Das fertige Urteil ueber einen Scan -- alles, was ein Abnehmer braucht, und nichts davon
 *  an einen Staging-Eintrag gebunden. */
class ResolvedScan(
    val base: CardRow,
    val knownSets: List<SetOption>,
    val match: SetCodeMatch.MatchResult,
    val confidence: ScanConfidence.Result,
    /** Der roh gelesene Set-Code (siehe [com.example.yugiohscanner.ml.ReadSetCode]) -- ungefiltert,
     *  auch wenn er zu keinem Druck von [base] gehoert. Genau dann ist er wertvoll: dann hat die
     *  Bilderkennung die falsche Karte gegriffen, und der PC kann es am Code merken. */
    val readSetCode: String? = null,
    /** Spec 2026-11-03 §4.2: nur bei `nachrechnen` und nach dem Rueckfall auf Katalogdrucke gesetzt. Liefert das
     *  Ergebnis mit den nachgekommenen Netzdrucken, oder `null`, wenn das Netz nichts Neues brachte. */
    val verbessert: Deferred<ResolvedScan?>? = null,
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

    // Spec 2026-11-03 §4.2: Einzelmodus wartet laenger (Preis vor Tempo), Stapel bleibt bei 1,5 s.
    const val NETZ_WARTEN_STAPEL_MS = 1_500L
    const val NETZ_WARTEN_EINZEL_MS = 4_000L

    // Naehte fuer Tests (Vorgaben = Verhalten auf dem Geraet), Spec 2026-11-03 §4.2.
    internal var katalogKarte: (String) -> CatalogCard? = { CatalogRepository.card(it) }
    internal var sucheKarte: suspend (String) -> CardRow? = { CardSearchRepository.search(it).firstOrNull() }
    internal var geteilt: (String) -> Deferred<List<SetOption>> = { PrintingRepository.fetchAllSetsGeteilt(it) }
    internal var krAusCache: (String) -> List<SetOption> = { PrintingRepository.cachedKoreanSets(it) }
    internal var protokoll: (String, String) -> Unit = { t, m -> com.example.yugiohscanner.ml.ScanLog.line(t, m) }
    internal var io: CoroutineDispatcher = Dispatchers.IO
    internal var rechnen: CoroutineDispatcher = Dispatchers.Default
    internal var hintergrund: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    internal var jetztMs: () -> Long = { System.nanoTime() / 1_000_000 }

    /** @return `null`, wenn zu [pc] ueberhaupt keine Karte gefunden wurde. Netz- und
     *  Katalogfehler fliegen als Ausnahme zum Aufrufer hoch, genau wie vorher.
     *  [netzWartenMs]: Frist fuer den Netzabruf der Drucke; [nachrechnen]: nach einem Rueckfall
     *  [ResolvedScan.verbessert] liefern (nur Einzelmodus, Spec 2026-11-03 §4.2). */
    suspend fun resolve(
        pc: String,
        evidence: List<String>,
        framesEvidence: List<String>,
        editionTexts: List<String>,
        defaultEdition: String,
        netzWartenMs: Long = NETZ_WARTEN_STAPEL_MS,
        nachrechnen: Boolean = false,
    ): ResolvedScan? {
        // Katalog zuerst (D1 Task 9): ein lokaler Treffer loest die Basiskarte sofort auf,
        // offline, ohne Netz. Abseits des UI-Threads -- das ist ein SQLite-Lesevorgang.
        val catalogCard = withContext(io) {
            runCatching { katalogKarte(pc) }.getOrNull()
        }
        // Die Basiskarte (Name, Werte, Bild) kommt immer aus dem Katalog, wenn sie dort steht --
        // reiner Gewinn. Die DRUCKLISTE nur dann, wenn der Katalog verifizierte (deutsche) Drucke
        // fuer diesen Passcode fuehrt; unverifizierte Zeilen sind der englische Abzug, und sie
        // als vollstaendig zu nehmen, waehlte fuer eine deutsche Sammlung einen EN-Code vor.
        val catalogSets = catalogCard?.printings?.takeIf { p -> p.any { it.verified } }

        val base: CardRow
        val knownSets: List<SetOption>
        var netzAbruf: Deferred<List<SetOption>>? = null   // nur gesetzt, wenn der Rueckfall griff
        if (catalogCard != null && catalogSets != null) {
            base = catalogCard.toCardRow()
            // Durch RarityQuellen, wie jeder andere Weg auch. Dieser Pfad liest den Katalog DIREKT
            // und ging bisher an der Korrektur in PrintingRepository vorbei -- im Lauf vom 21.09.
            // kam deshalb YGOPRODecks Platzhalter "New" als Rarity durch ("Grand Master Rare/New/...").
            // KR-Drucke stehen nicht im Katalog: aus dem Zwischenspeicher, sonst im Hintergrund
            // nachgeladen (beim ersten Scan einer Karte wird der KR-Code also noch zusammengesetzt).
            knownSets = RarityQuellen.ohneErfundeneRarity(
                catalogSets.map { it.toSetOption() } + krAusCache(pc)
            )
        } else {
            base = catalogCard?.toCardRow()
                ?: sucheKarte(pc)
                ?: return null
            // Spec 2026-11-03 §4.2: EIN geteilter Abruf (§4.1), hoechstens netzWartenMs warten. Kein runCatching um
            // await: es wuerde den Timeout und den Abbruch des Aufrufers (Nutzer verlaesst die Kamera) schlucken. Nach
            // der Frist laeuft der Abruf weiter und fuellt den ScanCache; einen zweiten Abruf gibt es nicht mehr.
            val d = geteilt(pc)
            val t0 = jetztMs()
            val netz = withTimeoutOrNull(netzWartenMs) {
                try { d.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
            }
            val dauer = jetztMs() - t0
            if (!netz.isNullOrEmpty()) {
                protokoll("Drucke", "pc=$pc Netz ok n=${netz.size} dauer=${dauer}ms")
                knownSets = netz
            } else {
                protokoll("Drucke", if (netz == null) "pc=$pc Netz > ${netzWartenMs}ms dauer=${dauer}ms, Katalog-Drucke genutzt"
                    else "pc=$pc Netz leer dauer=${dauer}ms, Katalog-Drucke genutzt")
                // Rueckfall auch bei leerer Antwort (vorher: leere Liste ganz ohne Katalogdrucke).
                knownSets = RarityQuellen.ohneErfundeneRarity(
                    (catalogCard?.printings?.map { it.toSetOption() } ?: emptyList()) + krAusCache(pc)
                )
                netzAbruf = d
            }
        }

        // Abseits des UI-Threads: der Abstandsvergleich waechst mit den gesammelten OCR-Texten und
        // hielt im Stapel-Modus beim Buchen Oberflaeche UND Kamera 1-3 s an (Thread-Stacks,
        // docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/performance-2-roh.log).
        val (match, confidence) = withContext(rechnen) { urteil(evidence, knownSets, framesEvidence, editionTexts, defaultEdition) }
        val readSetCode = com.example.yugiohscanner.ml.ReadSetCode.aus(framesEvidence)
        logScanDecision("erst", pc, match, confidence, knownSets, protokoll)
        protokoll("Gelesen", "pc=$pc code=${readSetCode ?: "-"} gewaehlt=${match.selected?.setCode ?: "-"} fest=${com.example.yugiohscanner.ml.ScanSprache.fest ?: "auto"}")
        protokoll("Sprache", "pc=$pc hinweis=${com.example.yugiohscanner.ml.SprachHinweis.aus(framesEvidence)}")
        // Ohne diese Zeile laesst sich am Protokoll NICHT unterscheiden, ob eine Auflage GELESEN
        // oder nur aus der Voreinstellung uebernommen wurde: resolveEdition nimmt die Erkennung nur
        // bei HIGH, sonst den Standard -- und beide Wege schreiben am Ende dieselbe "first"-Buchung.
        // Genau diese Frage war am 20.09.2026 nicht zu beantworten (193x "first" an einem Tag, ohne
        // Beleg, woher). `texte` leer heisst: die EDITION-Zone gab nichts her, es war der Standard.
        // Das ENDE jedes Zonentexts, nicht der Anfang (21.09.): der Auflagen-Marker steht in der
        // untersten Zeile, darueber liegt Kartentext -- mit den ersten 40 Zeichen war er abgeschnitten.
        val lesbar = editionTexts.count { it.isNotBlank() }
        protokoll(
            "Auflage",
            "pc=$pc bilder=${editionTexts.size} lesbar=$lesbar ergebnis=${confidence.effectiveEdition} " +
                "sicher=${confidence.editionConfidence} standard=$defaultEdition " +
                "texte='${editionTexts.filter { it.isNotBlank() }.joinToString(" | ") { it.takeLast(60).replace('\n', ' ') }}'",
        )
        // Spec 2026-11-03 §4.2: nach dem Rueckfall im Einzelmodus mit den nachkommenden Netzdrucken neu rechnen.
        // Leere Antwort oder gleiche Schluesselmenge -> null (die Seite laesst dann alles, wie es ist).
        val verbessert = netzAbruf?.takeIf { nachrechnen }?.let { d ->
            hintergrund.async {
                val neu = try { d.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
                fun schluessel(l: List<SetOption>) = l.map { ScanErgebnis.key(it.setCode, it.rarity, it.language) }.toSet()
                if (neu.isEmpty() || schluessel(neu) == schluessel(knownSets)) return@async null
                val (m2, c2) = withContext(rechnen) { urteil(evidence, neu, framesEvidence, editionTexts, defaultEdition) }
                logScanDecision("nach", pc, m2, c2, neu, protokoll)
                ResolvedScan(base, neu, m2, c2, readSetCode)
            }
        }
        return ResolvedScan(base, knownSets, match, confidence, readSetCode, verbessert)
    }

    private fun urteil(evidence: List<String>, known: List<SetOption>, framesEvidence: List<String>, editionTexts: List<String>,
                       defaultEdition: String): Pair<SetCodeMatch.MatchResult, ScanConfidence.Result> {
        val m = SetCodeMatch.best(evidence, known, framesEvidence, com.example.yugiohscanner.ml.ScanSprache.fest)
        return m to ScanConfidence.fromEvidence(m, known, editionTexts, defaultEdition)
    }
}

/**
 * Eine Zeile je Ampel-Entscheidung, im key=value-Format, das `ml/ocr_bench.py` ohnehin liest.
 *
 * Warum das noetig ist, und zwar dringend: die Geraeteabnahme zu D3 ergab 31 von 31 gruen, und das
 * Abschlussreview fand danach ZWEI kritische Fehler, die genau diese Abnahme ueberlebt hatten --
 * eine Rarity-Pruefung, die bei komponierten Codes leer erfuellt war, und ein `unlimited`, das aus
 * dreimal leerem Ausschnitt entstand. Beide erzeugten GRUEN, und Gruen zeigt keinen Grund an. Eine
 * leer-gruene Karte war vom Bildschirm aus nicht von einer echt-gruenen zu unterscheiden.
 *
 * Das entscheidende Feld ist `composed`: es sagt, ob der Set-Code in der Printing-Liste GEFUNDEN
 * oder aus Praefix + gelesener Region + Nummer ZUSAMMENGESETZT wurde. Allein dieses Feld haette
 * den Rarity-Fehler sichtbar gemacht, denn er trat ausschliesslich im komponierten Fall auf.
 *
 * `stage` unterscheidet die erste Aufloesung von der stillen Verbesserung. Ohne das sind eine
 * Verbesserung und eine Nicht-Verbesserung im Protokoll identisch -- und die Verbesserung ersetzt
 * einen Druck, NACHDEM der Nutzer den alten bereits gesehen hat.
 */
internal fun logScanDecision(
    stage: String,
    passcode: String,
    match: com.example.yugiohscanner.cloud.SetCodeMatch.MatchResult,
    confidence: com.example.yugiohscanner.ml.ScanConfidence.Result,
    knownSets: List<com.example.yugiohscanner.cloud.SetOption>,
    protokoll: (String, String) -> Unit = com.example.yugiohscanner.ml.ScanLog::line,   // Spec 2026-11-03 §4.2: Log.i wirft im JVM-Test
) {
    val sel = match.selected
    val composed = sel != null && knownSets.none { it.setCode.equals(sel.setCode, ignoreCase = true) }
    protokoll(
        "ScanDecision",
        "stage=$stage pc=$passcode " +
            "code=${sel?.setCode ?: "-"} rarity=${sel?.rarity ?: "-"} lang=${sel?.language ?: "-"} " +
            "composed=$composed match=${match.reason.name} " +
            "exact=${match.codeExactMatch} frames=${match.codeFrameCount} " +
            "known=${knownSets.size} " +
            "light=${confidence.light.name} grund='${confidence.reason ?: ""}' " +
            "edition=${confidence.effectiveEdition} editionConf=${confidence.editionConfidence.name}"
    )
}
