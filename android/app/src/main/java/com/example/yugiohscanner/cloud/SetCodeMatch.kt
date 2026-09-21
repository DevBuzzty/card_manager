package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.RegionToken
import java.util.Locale
import java.util.regex.Pattern

// Constrained set-code recognition. The card's identity (passcode) is already known, so its set
// code can ONLY be one of that card's known printings — a small, closed list. Instead of trusting
// a clean `XXX-DE123` token to survive OCR (it often doesn't: the hyphen is dropped, digits are
// confused, the code is split across a line break), we match each KNOWN printing against the raw
// OCR evidence, separators stripped, using a confusion-weighted edit distance, and keep the best.
//
// Spec D3 Task 2 — the structural fix for the D1 defect: matching a whole code cost only ~2 of 8
// characters for an EN/DE region swap, comfortably inside the old length-scaled tolerance, so
// `LOB-EN005` was silently accepted for a German card. As of this task the distance compare runs
// ONLY over `prefix + number` (see [parts]); the region is not part of that comparison at all and
// is instead read independently from the card's own text via [RegionToken] (Task 1). The
// confusable region characters can therefore no longer buy a wrong printing a passing score, no
// matter how the tolerance is tuned later.
object SetCodeMatch {
    // Keep only A-Z0-9 (OCR frequently loses the hyphen and spaces), uppercased.
    private fun norm(s: String) = s.uppercase(Locale.ROOT).filter { it.isLetterOrDigit() }

    // Symmetric OCR confusions cost 0.5 instead of a full substitution.
    private val CONFUSE = hashSetOf(
        "O0", "0O", "I1", "1I", "L1", "1L", "S5", "5S", "B8", "8B", "Z2", "2Z",
        "D0", "0D", "G6", "6G", "T7", "7T", "Q0", "0Q", "A4", "4A"
    )

    private fun subCost(a: Char, b: Char): Float =
        if (a == b) 0f else if ("$a$b" in CONFUSE) 0.5f else 1f

    // Confusion-weighted Levenshtein between two short strings.
    private fun dist(a: String, b: String): Float {
        val m = a.length; val n = b.length
        val prev = FloatArray(n + 1) { it.toFloat() }
        val cur = FloatArray(n + 1)
        for (i in 1..m) {
            cur[0] = i.toFloat()
            for (j in 1..n) {
                cur[j] = minOf(cur[j - 1] + 1f, prev[j] + 1f, prev[j - 1] + subCost(a[i - 1], b[j - 1]))
            }
            System.arraycopy(cur, 0, prev, 0, n + 1)
        }
        return prev[n]
    }

    /** A known code split into its three grammar slots. [region] is `null` when the code has none
     *  (rare regionless OCG codes) or when [code] doesn't parse at all -- see [parts]. */
    data class CodeParts(val prefix: String, val region: String?, val number: String)

    // PREFIX-REGION[VARIANT]NUMBER. Deliberately the same grammar as SetCodeOcr's SET_CODE pattern
    // (region 1-2 letters, an optional single variant letter that sits between region and number,
    // e.g. Speed Duel's "SGX3-DEA10" where the number is "A10" -- see SetCodeOcr's own comment on
    // why that letter belongs to the number, not the region). The one difference: this pattern is
    // anchored (`^...$`) and applied to an already-clean CATALOG code, never to noisy OCR prose, so
    // it doesn't need SetCodeOcr's VARIANT_AS_DIGIT correction (there is no misread to correct --
    // a catalog code's variant letter, if any, is always genuine) and can afford a slightly wider
    // prefix (2-6 instead of 2-5) without risking an accidental match inside ordinary text.
    private val CODE_PATTERN: Pattern =
        Pattern.compile("^([A-Z0-9]{2,6})-([A-Z]{1,2})([A-Z])?(\\d{2,4})$")

    /**
     * Decomposes a known, clean printing code (e.g. from the catalog or a network fetch) into
     * prefix/region/number, or `null` if [code] doesn't have this grammar at all. Agrees with
     * `ml/measure_zones_photos.py`'s `code_key()` on WHERE the split happens (prefix vs. region vs.
     * tail), but keeps the number's original digits (incl. leading zeros and a real variant letter
     * like SGX3-DEA10's "A") rather than stripping leading zeros the way `code_key` does --
     * `code_key` only ever needs an EQUALITY key for measurement, this needs the literal digits
     * back to compose a real code (Case 1 below), so trimming zeros here would corrupt it.
     */
    fun parts(code: String): CodeParts? {
        val m = CODE_PATTERN.matcher(code.trim().uppercase(Locale.ROOT))
        if (!m.matches()) return null
        val prefix = m.group(1)!!
        val region = m.group(2)!!
        val variant = m.group(3)
        val digits = m.group(4)!!
        return CodeParts(prefix, region, (variant ?: "") + digits)
    }

    /** Why [MatchResult.selected] is what it is -- the traffic light (Task 5) reads this instead
     *  of re-deriving it from scratch. [text] is the exact German wording Task 5 shows the user;
     *  `null` for a plain, uncontested match (Task 5 derives ITS OWN green/yellow reasons there
     *  from code distance, frame count, rarity and edition -- this object only ever speaks for the
     *  region decision, which is the one thing only this function has enough information to know). */
    /** Ab so vielen getrennten Bildern mit derselben gelesenen Region schlaegt sie einen verifizierten Druck. */
    const val REGION_TRUST_FRAMES = 2

    enum class MatchReason(val text: String?) {
        MATCHED(null),
        REGION_UNCLEAR("Region unklar"),
        REGION_CONTRADICTS_VERIFIED("Region widerspricht bekanntem Druck"),
        NO_MATCH(null),
    }

    /**
     * [selected] is the preselection; [candidates] is everything the user could reasonably pick
     * from instead (verified printings first), always containing [selected] when it's non-null.
     * [reason] explains why, for the three region cases from the plan's binding rule:
     *  1. Region read confidently, no conflict -> MATCHED, `selected` = the composed code, or a
     *     real known printing at that exact code if the catalog/network already had one (a real
     *     entry always wins over a freshly-composed twin — "verified beats derived").
     *  2. Region not readable -> REGION_UNCLEAR, `candidates` = only the printings that actually
     *     exist for this prefix+number (verified first). Nothing is composed.
     *  3. Region read, but contradicts a VERIFIED printing with the same prefix+number -> that
     *     verified printing is `selected` (evidence beats a misread) and sorts first in
     *     `candidates`; the misread composition is not trusted.
     *
     * [codeExactMatch] and [codeFrameCount] are Spec D3 Task 6's fix for a gap Task 5 found: the
     * traffic light's green condition ("Code-Distanz 0 in >=2 Frames", [ScanConfidence]) needs to
     * know not just THAT a printing matched, but whether that match was clean (distance 0) and in
     * how many SEPARATE frames -- neither of which this function used to expose ([Scored.dist] was
     * private, and [best] only ever saw one pooled haystack, never a per-frame breakdown). Both are
     * computed from [best]'s `framesEvidence` parameter, counting frames whose OWN text -- not the
     * pooled haystack -- lands the winning prefix+number at distance 0 in isolation. That
     * distinction matters: pooling several frames into one haystack can let a single clean
     * substring buried in unrelated noise still win at distance 0 overall, which would make EVERY
     * multi-frame scan look "exact in N frames" even when only one frame ever read anything
     * legible -- see [SetCodeMatchTest]'s pinning test for the worked example. [codeExactMatch] is
     * `true` iff [codeFrameCount] is at least 1; both default to `false`/`0` for the NO_MATCH early
     * returns, where there is no winning printing for a frame to match at all.
     */
    data class MatchResult(
        val selected: SetOption?,
        val candidates: List<SetOption>,
        val reason: MatchReason,
        val codeExactMatch: Boolean = false,
        val codeFrameCount: Int = 0,
    )

    private data class Scored(val option: SetOption, val parts: CodeParts, val dist: Float)

    // Smallest total edit distance for [prefix] and [number] against ANY split of [hay] that
    // places them with 0-3 characters between them (the region's length -- RegionToken's own
    // candidates run 1-3 letters; 0 additionally covers a region that OCR dropped outright). Each
    // side independently tolerates a +/-1 length mismatch, the same insertion/deletion slack the
    // old whole-code matcher gave the full string. The region-length gap costs NOTHING regardless
    // of what characters sit there -- that gap is precisely how the region is excluded from the
    // comparison, per this task's whole point.
    private fun prefixNumberDist(prefix: String, number: String, hay: String): Float {
        var best = Float.MAX_VALUE
        val pLenRange = maxOf(1, prefix.length - 1)..(prefix.length + 1)
        val nLenRange = maxOf(1, number.length - 1)..(number.length + 1)
        for (pStart in 0 until hay.length) {
            for (pLen in pLenRange) {
                val pEnd = pStart + pLen
                if (pEnd > hay.length) continue
                val dP = dist(prefix, hay.substring(pStart, pEnd))
                if (dP >= best) continue // can't possibly beat the current best any more
                for (gap in 0..3) {
                    val nStart = pEnd + gap
                    for (nLen in nLenRange) {
                        val nEnd = nStart + nLen
                        if (nEnd > hay.length) continue
                        val dN = dist(number, hay.substring(nStart, nEnd))
                        val total = dP + dN
                        if (total < best) best = total
                    }
                }
            }
        }
        return best
    }

    /**
     * Best known printing for the raw OCR [evidence] (one string per frame/read; both grammar-
     * corrected candidates and uncorrected raw text, see [com.example.yugiohscanner.ml.SetCodeEvidence.rawTexts]
     * for why both matter), or a NO_MATCH result if nothing is close enough. [known] should be
     * verified-first (the catalog already returns it that way) so a tie prefers a verified entry.
     * [evidence] doubles as the region zone text passed to [RegionToken.read] -- the same pooled
     * text the prefix/number match came from is exactly what should also carry the (separate)
     * region reading.
     *
     * [framesEvidence] is separate from [evidence] specifically for [MatchResult.codeFrameCount]
     * (Task 6): one entry per SEPARATE frame/reading, so each can be checked in isolation against
     * the winning prefix+number, instead of the pooled haystack [evidence] flattens into. Defaults
     * to [evidence] for callers that have no better per-frame breakdown to offer (matches was the
     * pre-Task-6 behaviour, just also now populating the two new fields off whatever was passed).
     */
    fun best(evidence: List<String>, known: List<SetOption>, framesEvidence: List<String> = evidence): MatchResult {
        if (known.isEmpty() || evidence.isEmpty()) return MatchResult(null, emptyList(), MatchReason.NO_MATCH)
        val joined = evidence.joinToString(" ")
        val hay = norm(joined)
        if (hay.length < 4) return MatchResult(null, emptyList(), MatchReason.NO_MATCH)

        val scored = known.mapNotNull { opt ->
            val p = parts(opt.setCode) ?: return@mapNotNull null
            val prefix = norm(p.prefix)
            val number = norm(p.number)
            if (prefix.isEmpty() || number.isEmpty()) return@mapNotNull null
            Scored(opt, p, prefixNumberDist(prefix, number, hay))
        }
        if (scored.isEmpty()) return MatchResult(null, emptyList(), MatchReason.NO_MATCH)

        // Accept only a close-enough match; the tolerance scales with the compared length (prefix
        // + number only -- the region is excluded, so it no longer inflates the length the
        // tolerance is scaled against either).
        val accepted = scored.filter { s ->
            val len = norm(s.parts.prefix).length + norm(s.parts.number).length
            s.dist <= maxOf(1.5f, 0.25f * len)
        }
        if (accepted.isEmpty()) return MatchResult(null, emptyList(), MatchReason.NO_MATCH)

        // Several known printings legitimately share one prefix+number (that's the whole point --
        // it's the same underlying printing in different languages), so they tie at the identical
        // distance. Group on the best distance, not on a single winning SetOption.
        val minDist = accepted.minOf { it.dist }
        val bestGroup = accepted.filter { it.dist <= minDist + 1e-4f }
        val groupPrefix = bestGroup.first().parts.prefix
        val groupNumber = bestGroup.first().parts.number

        // Task 6: how many of the SEPARATE frames in [framesEvidence] independently land this
        // exact prefix+number at distance 0 on their own -- see [MatchResult]'s KDoc on why this
        // must be re-derived per frame rather than read off [minDist], which is measured against
        // the pooled haystack and can be 0 even when only one frame ever read anything legible.
        val normGroupPrefix = norm(groupPrefix)
        val normGroupNumber = norm(groupNumber)
        // Ein Bild zaehlt als fehlerfrei, wenn sein roher Text ODER seine grammatik-korrigierte Lesung
        // den Code exakt traegt. Gemessen am 21.09.2026 an den ersten Fotos des Fotomodus (3072x4096):
        // die OCR liest die Null direkt hinter der Region meist als Buchstabe O -- "DOOD-ENO96",
        // "DOOD-ENO96", "DOOD-EN096". SetCodeOcr.extract biegt genau das zurueck (VARIANT_AS_DIGIT:
        // nur O->0 und Y->1, nur an dieser einen Stelle), und fuer die Abstimmung der Kandidaten gilt
        // diese Korrektur laengst. Nur hier zaehlte der ROHE Text, und dort kostet O/0 einen halben
        // Punkt -- drei gute Fotos ergaben "1 Bild", und die Ampel blieb gelb. Mit der Korrektur
        // haetten alle vier Karten jenes Laufs zwei oder drei Bilder gehabt. Keine Lockerung der
        // Gruen-Regel: der Code muss weiterhin auf zwei Bildern EXAKT stehen.
        val codeFrameCount = framesEvidence.count { frame ->
            val frameHay = norm(frame + " " + com.example.yugiohscanner.ml.SetCodeOcr.extract(frame).joinToString(" "))
            frameHay.length >= 4 && prefixNumberDist(normGroupPrefix, normGroupNumber, frameHay) <= 0f
        }
        val codeExactMatch = codeFrameCount >= 1

        fun byVerifiedFirst(list: List<Scored>) = list.map { it.option }.sortedByDescending { it.verified }

        // Sprache aus dem gelesenen Kartentext (19.09.2026, SprachHinweis): der Text ist gross und steht in
        // jedem Bild, die Region im Set-Code oft nur in einem verstuemmelten. Ist die Sprache eindeutig und
        // gibt es fuer dieses Kuerzel+Nummer einen Druck in ihr, gewinnt er -- vor Region und verifiziertem Druck.
        val sprache = com.example.yugiohscanner.ml.SprachHinweis.aus(framesEvidence)
        if (sprache != null) {
            val passend = byVerifiedFirst(bestGroup.filter { it.option.language.equals(sprache, ignoreCase = true) })
            if (passend.isNotEmpty()) {
                val rest = byVerifiedFirst(bestGroup).filter { it !in passend }
                return MatchResult(passend.first(), passend + rest, MatchReason.MATCHED, codeExactMatch, codeFrameCount)
            }
        }

        // Case 2: region not readable. Offer only printings that actually exist for this
        // prefix+number -- nothing is composed.
        //
        // Pro Bild gelesene Regionen: liefert der gepoolte Text keine eindeutige Region (mehrere
        // Bilder mit unterschiedlichen Lesungen), entscheidet die Mehrheit -- sofern sie in
        // mindestens [REGION_TRUST_FRAMES] Bildern gelesen wurde und allein vorn liegt.
        val regionCounts = framesEvidence
            .mapNotNull { RegionToken.read(it, groupPrefix, groupNumber)?.uppercase(java.util.Locale.ROOT) }
            .groupingBy { it }.eachCount()
        val majority = regionCounts.maxByOrNull { it.value }
            ?.takeIf { top -> top.value >= REGION_TRUST_FRAMES && regionCounts.values.count { it == top.value } == 1 }
            ?.key
        val region = RegionToken.read(joined, groupPrefix, groupNumber) ?: majority ?: return byVerifiedFirst(bestGroup).let {
            MatchResult(it.firstOrNull(), it, MatchReason.REGION_UNCLEAR, codeExactMatch, codeFrameCount)
        }

        // Case 3: the read region contradicts a VERIFIED printing of the same prefix+number (a
        // verified entry whose OWN region differs from what was just read). The verified printing
        // wins the selection and sorts first; the misread composition is not trusted over it.
        //
        // Ausnahme (Nutzerentscheid 17.09., gemischte DE/EN-Stapel): wurde dieselbe Region in
        // mindestens [REGION_TRUST_FRAMES] getrennten Bildern gelesen, ist sie kein einzelner
        // Lesefehler mehr -- dann gilt sie (Fall 1). Sonst blieb eine englische Karte neben einem
        // verifizierten deutschen Druck unbuchbar (geraet-3-roh.log: "BLGG-EN053" gelesen, DE gesendet).
        //
        // Nachtrag 19.09. (Scan-Protokoll: 9x "BLGG-EN135" gelesen, DE gebucht): seit das +1 schneller kommt,
        // bleibt nach dem Einwurf oft nur EIN lesbares Bild. Eine einzige Lesung gilt deshalb auch, wenn
        // (a) kein Bild eine andere Region las und (b) es einen ECHTEN Druck mit dieser Region gibt -- ein
        // Lesefehler, der auf einen nicht existierenden Druck fuehrt (DE statt G), bleibt beim verifizierten.
        val regionUpper = region.uppercase(java.util.Locale.ROOT)
        val regionFrames = regionCounts[regionUpper] ?: 0
        val einzigeRegion = regionFrames >= 1 && regionCounts.keys.all { it == regionUpper }
        val echterDruck = bestGroup.any { it.parts.region?.equals(region, ignoreCase = true) == true }
        val vertrauen = regionFrames >= REGION_TRUST_FRAMES || (einzigeRegion && echterDruck)
        val conflicting = if (vertrauen) null else bestGroup.firstOrNull { s ->
            s.option.verified && s.parts.region != null && !s.parts.region.equals(region, ignoreCase = true)
        }
        if (conflicting != null) {
            val candidates = (listOf(conflicting.option) + bestGroup.map { it.option })
                .distinctBy { it.setCode }
            return MatchResult(conflicting.option, candidates, MatchReason.REGION_CONTRADICTS_VERIFIED, codeExactMatch, codeFrameCount)
        }

        // Case 1: region read confidently, no conflict. A real known printing at that exact code
        // wins over a freshly-composed one ("verified beats derived" also covers "real beats
        // derived" for an unverified-but-real network hit); only compose when nothing already
        // carries this region. Rarity is assumed the same across languages of the same printing
        // (the plan's stated assumption) -- reuse the group's own rarity rather than inventing one;
        // Task 3 (RarityRank) is what resolves an actual rarity disagreement within the group.
        val exact = bestGroup
            .filter { it.parts.region?.equals(region, ignoreCase = true) == true }
            .sortedByDescending { it.option.verified }
            .firstOrNull()
        // Spec D3 fix C1: `region` is the raw infix read off the card (e.g. "G", "F"), not a
        // language code -- RegionToken.language maps it to the DE/EN/JP value `language` actually
        // means everywhere else (the collection's composite primary key included). Writing `region`
        // straight into `language` used to file a "-G005" printing under language="G", invisible to
        // every DE-aware code path and never merging with the user's real DE rows.
        val selected = exact?.option ?: SetOption(
            setCode = "$groupPrefix-$region$groupNumber",
            rarity = bestGroup.first().option.rarity,
            price = 0.0,
            language = RegionToken.language(region),
            verified = false,
        )
        return MatchResult(selected, listOf(selected), MatchReason.MATCHED, codeExactMatch, codeFrameCount)
    }
}
