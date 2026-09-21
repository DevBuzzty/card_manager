package com.example.yugiohscanner.ml

import java.util.Locale
import java.util.regex.Pattern

/**
 * Set-code extraction from already-recognised OCR text. Identification now reads each card's
 * bottom band once per frame (see HybridPipeline) and pools the raw text for voting, so this no
 * longer does its own ML Kit pass — it just pulls set-code-shaped tokens out of that text.
 */
object SetCodeOcr {
    // PREFIX-REGION[VARIANT]NUMBER, e.g. LOB-EN001, DOOD-DE038, LOB-G005 (single-letter region --
    // German used just "G" before the "DE" era), SGX3-DEA10 (Speed Duel: a variant letter sits
    // between the region and the number). PREFIX stays a generic 2-5 char alnum run because real
    // prefixes legitimately end in digits (RA01, SGX3), so grammar alone can't tell those apart
    // from a misread letter -- see the correction note on VARIANT_AS_DIGIT below for the one place
    // this pattern DOES resolve that ambiguity. REGION is 1-2 letters (accepts single-letter "G");
    // an optional single VARIANT letter follows; NUMBER is 2-4 digits. This still requires the
    // hyphen plus a trailing digit run, so ordinary prose (no hyphen, no digits) never matches.
    private val SET_CODE: Pattern = Pattern.compile(
        "\\b([A-Z0-9]{2,5})-([A-Z]{1,2})([A-Z])?(\\d{2,4})\\b"
    )

    // The single letter between region and number is structurally ambiguous: it's either a real
    // variant letter (the "A" in SGX3-DEA10) or a misread leading digit of the number. Evidenced
    // on real device captures: 'O' for '0' and 'Y' for '1'. Deliberately narrow -- reusing
    // OcrText's full digit-confusion table here would also fold 'A' into '4' and corrupt genuine
    // variant letters like SGX3-DEA10's.
    private val VARIANT_AS_DIGIT = mapOf('O' to '0', 'Y' to '1')

    /** Every set-code-shaped token in [text], grammar-corrected (first-seen order, deduped). */
    fun extract(text: String): List<String> {
        val codes = LinkedHashSet<String>()
        val m = SET_CODE.matcher(text.uppercase(Locale.ROOT))
        while (m.find()) {
            val prefix = m.group(1)
            val region = m.group(2)
            val variant = m.group(3)
            val digits = m.group(4)
            val numberPart = if (variant != null) {
                (VARIANT_AS_DIGIT[variant[0]]?.toString() ?: variant) + digits
            } else digits
            codes.add("$prefix-$region$numberPart")
        }
        return codes.toList()
    }

    // --- NUR fuers Zaehlen der Ampel (21.09.2026) -------------------------------------------------
    //
    // Die OCR verwechselt in der Kartennummer mehr als nur das O an erster Stelle: gemessen an 39
    // Rohlesungen eines Fotomodus-Laufs (MAMO, 3072x4096) standen dort "MAMO-DEOS7", "MAMO-DE0S0",
    // "MAMO-DEl18". Mit dieser Karte gelesen bestaetigen 31 statt 26 Lesungen den Code, und keine
    // ergibt einen ANDEREN existierenden Code.
    //
    // Bewusst NICHT in [extract]: dessen Ergebnis geht als gelesener Set-Code an den PC, und der
    // tauscht damit notfalls die ganze Karte aus ("der Set-Code schlaegt das Bild"). Eine falsch
    // korrigierte Nummer koennte dort eine andere Karte einsetzen. Beim Zaehlen kann eine Lesart
    // dagegen hoechstens einen Code BESTAETIGEN, den der Abgleich schon gewaehlt hat.
    //
    // Die Nummer muss mindestens eine echte Ziffer enthalten: "MAMO-DEIIS" (gemeint DE118) waere
    // sonst zu DE115 geworden -- S steht mal fuer 5, mal fuer 8, und eine Nummer ganz aus
    // Buchstaben ist keine Lesung, sondern Rauschen. T bleibt aussen vor: es stand fuer 7 UND fuer 1.
    private val ZAEHL_CODE: Pattern = Pattern.compile("\\b([A-Z0-9]{2,5})\\s*-\\s*([A-Z]{1,2})([A-Z0-9]{2,4})\\b")
    private val ZIFFER_FUER = mapOf(
        'O' to '0', 'Q' to '0', 'D' to '0', 'I' to '1', 'L' to '1', 'Y' to '1',
        'S' to '5', 'B' to '8', 'Z' to '2', 'G' to '6',
    )

    /** Lesarten fuer den Ampel-Abgleich (siehe oben) -- NICHT fuer die Weitergabe an den PC. */
    fun zaehlLesarten(text: String): List<String> {
        val out = LinkedHashSet<String>()
        val m = ZAEHL_CODE.matcher(text.uppercase(Locale.ROOT))
        while (m.find()) {
            val nummer = m.group(3)
            if (nummer.none { it.isDigit() }) continue
            val ziffern = nummer.map { ZIFFER_FUER[it] ?: it }.joinToString("")
            if (ziffern.all { it.isDigit() }) out.add("${m.group(1)}-${m.group(2)}$ziffern")
        }
        return out.toList()
    }
}
