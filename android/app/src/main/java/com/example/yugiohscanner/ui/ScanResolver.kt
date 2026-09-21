package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.RarityQuellen
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.ScanConfidence
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    private const val NETZ_WARTEN_MS = 1_500L
    private val hintergrund = kotlinx.coroutines.CoroutineScope(Dispatchers.IO + kotlinx.coroutines.SupervisorJob())

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
            // Durch RarityQuellen, wie jeder andere Weg auch. Dieser Pfad liest den Katalog DIREKT
            // und ging bisher an der Korrektur in PrintingRepository vorbei -- im Lauf vom 21.09.
            // kam deshalb YGOPRODecks Platzhalter "New" als Rarity durch ("Grand Master Rare/New/...").
            knownSets = RarityQuellen.ohneErfundeneRarity(catalogSets.map { it.toSetOption() })
        } else {
            base = catalogCard?.toCardRow()
                ?: CardSearchRepository.search(pc).firstOrNull()
                ?: return null
            // Netz hoechstens NETZ_WARTEN_MS (Scan-Protokoll 19.09.: bis 10 s bis zum PC). Sonst die Drucke aus
            // dem Katalog nehmen und im Hintergrund weiterladen -- der ScanCache macht die naechste Karte sofort.
            knownSets = kotlinx.coroutines.withTimeoutOrNull(NETZ_WARTEN_MS) {
                runCatching { PrintingRepository.fetchAllSets(pc) }.getOrDefault(emptyList())
            } ?: run {
                com.example.yugiohscanner.ml.ScanLog.line("Drucke", "pc=$pc Netz > ${NETZ_WARTEN_MS}ms, Katalog-Drucke genutzt")
                hintergrund.launch { runCatching { PrintingRepository.fetchAllSets(pc) } }
                RarityQuellen.ohneErfundeneRarity(catalogCard?.printings?.map { it.toSetOption() } ?: emptyList())
            }
        }

        // Abseits des UI-Threads: der Abstandsvergleich waechst mit den gesammelten OCR-Texten und
        // hielt im Stapel-Modus beim Buchen Oberflaeche UND Kamera 1-3 s an (Thread-Stacks,
        // docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/performance-2-roh.log).
        val (match, confidence) = withContext(Dispatchers.Default) {
            val m = SetCodeMatch.best(evidence, knownSets, framesEvidence)
            m to ScanConfidence.fromEvidence(m, knownSets, editionTexts, defaultEdition)
        }
        val readSetCode = com.example.yugiohscanner.ml.ReadSetCode.aus(framesEvidence)
        logScanDecision("erst", pc, match, confidence, knownSets)
        com.example.yugiohscanner.ml.ScanLog.line("Gelesen", "pc=$pc code=${readSetCode ?: "-"} gewaehlt=${match.selected?.setCode ?: "-"}")
        com.example.yugiohscanner.ml.ScanLog.line("Sprache", "pc=$pc hinweis=${com.example.yugiohscanner.ml.SprachHinweis.aus(framesEvidence)}")
        // Ohne diese Zeile laesst sich am Protokoll NICHT unterscheiden, ob eine Auflage GELESEN
        // oder nur aus der Voreinstellung uebernommen wurde: resolveEdition nimmt die Erkennung nur
        // bei HIGH, sonst den Standard -- und beide Wege schreiben am Ende dieselbe "first"-Buchung.
        // Genau diese Frage war am 20.09.2026 nicht zu beantworten (193x "first" an einem Tag, ohne
        // Beleg, woher). `texte` leer heisst: die EDITION-Zone gab nichts her, es war der Standard.
        val lesbar = editionTexts.count { it.isNotBlank() }
        com.example.yugiohscanner.ml.ScanLog.line(
            "Auflage",
            "pc=$pc bilder=${editionTexts.size} lesbar=$lesbar ergebnis=${confidence.effectiveEdition} " +
                "sicher=${confidence.editionConfidence} standard=$defaultEdition " +
                "texte='${editionTexts.filter { it.isNotBlank() }.joinToString(" | ") { it.take(40).replace('\n', ' ') }}'",
        )
        return ResolvedScan(base, knownSets, match, confidence, readSetCode)
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
