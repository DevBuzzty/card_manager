package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.SetOption
import java.util.Locale

// Kotlin counterpart of the desktop's `findBestDefaultSet` (desktop/electron/main.cjs:123):
// when one set code exists at several rarities (e.g. an Ultra Rare and a Secret Rare printing
// sharing the same prefix+number, just in different languages/prints), this picks the preselect
// -- the LOWEST rarity by the fixed rank below -- while also telling the caller that the choice
// was made among several candidates. Spec D3's traffic light (Task 5) turns that into a yellow
// reason ("Rarity mehrdeutig: Ultra/Secret"); this object only ranks and reports, it does not
// decide what ambiguity means for the UI.
object RarityRank {

    // Verbatim port of desktop's getRank(r): same six named rarities at the same ranks, same
    // fallback of 10 for anything else. The GAP between 6 (Secret Rare) and 10 (null/unknown) is
    // inherited from the desktop original, not meaningful on its own -- kept as-is (rather than
    // e.g. renumbered to 7) so the two implementations stay comparable line by line.
    fun rank(rarity: String?): Int {
        if (rarity.isNullOrEmpty()) return 10
        return when (rarity.lowercase(Locale.ROOT)) {
            "common" -> 1
            "short print" -> 2
            "rare" -> 3
            "super rare" -> 4
            "ultra rare" -> 5
            "secret rare" -> 6
            else -> 10
        }
    }

    /**
     * [lowest] is the preselection (rank-1 == best); [isAmbiguous] is true when [options]
     * actually carried more than one distinct rarity (case-insensitive), i.e. this was a real
     * choice among rarities, not just several rows that happen to agree; [distinctRarities] lists
     * those distinct rarity strings (first-seen casing, input order) for Task 5 to build its
     * "Rarity mehrdeutig: X/Y" wording from -- this object deliberately does not compose that
     * text itself, the same division of labour [com.example.yugiohscanner.cloud.SetCodeMatch]
     * uses for its own MatchReason.
     */
    data class Result(
        val lowest: SetOption,
        val isAmbiguous: Boolean,
        val distinctRarities: List<String>,
    )

    /**
     * Ranks [options] (all assumed to share one set code) and returns the lowest-rarity one, or
     * `null` for an empty list.
     *
     * Tie-break: the desktop breaks a rank tie by cheaper `set_price` (a price of 0 sorts last,
     * as "unknown"). [SetOption.price] is NOT reliably populated on this path -- it's a real price
     * only for the YGOPRODeck EN source; the offline catalog, Fandom and Konami sources (see
     * PrintingRepository) all construct their SetOptions with `price = 0.0`, which is exactly the
     * desktop's "unknown" sentinel and would make every catalog-only tie collapse to "all last,
     * order undefined". Reusing the desktop's price tie-break here would therefore not reproduce
     * its behaviour, just look like it does. So instead of inventing a substitute ordering, the
     * tie-break is stable by INPUT ORDER: [List.sortedBy] is a stable sort, so options already
     * tied on rank keep their relative order from [options] (caller decides that order, e.g.
     * "verified beats derived" like SetCodeMatch already sorts).
     */
    fun lowest(options: List<SetOption>): Result? {
        if (options.isEmpty()) return null
        val sorted = options.sortedBy { rank(it.rarity) }

        val distinct = LinkedHashMap<String, String>()
        for (o in options) {
            distinct.putIfAbsent(o.rarity.lowercase(Locale.ROOT), o.rarity)
        }

        return Result(
            lowest = sorted.first(),
            isAmbiguous = distinct.size > 1,
            distinctRarities = distinct.values.toList(),
        )
    }
}
