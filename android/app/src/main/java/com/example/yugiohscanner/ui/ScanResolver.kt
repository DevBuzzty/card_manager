package com.example.yugiohscanner.ui

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

        // Abseits des UI-Threads: der Abstandsvergleich waechst mit den gesammelten OCR-Texten und
        // hielt im Stapel-Modus beim Buchen Oberflaeche UND Kamera 1-3 s an (Thread-Stacks,
        // docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/performance-2-roh.log).
        val (match, confidence) = withContext(Dispatchers.Default) {
            val m = SetCodeMatch.best(evidence, knownSets, framesEvidence)
            m to ScanConfidence.fromEvidence(m, knownSets, editionTexts, defaultEdition)
        }
        logScanDecision("erst", pc, match, confidence, knownSets)
        return ResolvedScan(base, knownSets, match, confidence)
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
) {
    val sel = match.selected
    val composed = sel != null && knownSets.none { it.setCode.equals(sel.setCode, ignoreCase = true) }
    com.example.yugiohscanner.ml.ScanLog.line(
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
