package com.example.yugiohscanner.ml

data class WishCandidate(val cardId: String, val maxPrice: Double?)

data class WishPlan(val candidates: List<WishCandidate>, val alreadyListed: Int, val withoutPrice: Int)

/** added = angelegte Eintraege, watches = angelegte Deal-Watches, failed = Passcodes ohne Eintrag. */
data class WishResult(val total: Int, val added: Int, val watches: Int, val failed: List<String>)

/**
 * Spec E1 §6 -- "Fehlende auf die Wunschliste": Auswahl, Hoechstpreis und Texte.
 * ZWILLING: desktop/src/utils/deckWishlist.js (Regeln/Texte) und desktop/electron/decks.cjs#addMissingToWishlist
 * (eine Cloud-Suche am Ende, F3: hasDealWatchName -- Deal-Watch nur mit echtem Namen). Fixture
 * docs/fixtures/decks/wishlist.json. Wer eine Seite aendert, aendert beide.
 */
object DeckWishlist {
    /** max_price = 1,2 x Katalogpreis, auf Cent gerundet; ohne Preis null (dann kein Deal-Watch). */
    fun wishlistMaxPrice(cmPrice: Double?): Double? =
        if (cmPrice == null || !(cmPrice > 0.0)) null else Math.round(cmPrice * 1.2 * 100.0) / 100.0

    /** F3: ein Deal-Watch mit dem Passcode als Suchbegriff faende nichts -- also nur mit einem echten Namen
     *  (nicht leer, nicht der Passcode-Rueckfall selbst). ZWILLING: decks.cjs#hasDealWatchName. */
    fun hasDealWatchName(name: String, cardId: String): Boolean = name.trim().isNotEmpty() && name != cardId

    fun missingForWishlist(coverage: Coverage, wishlistCardIds: Collection<String>): WishPlan {
        val listed = wishlistCardIds.toHashSet()
        val candidates = ArrayList<WishCandidate>()
        var alreadyListed = 0
        var withoutPrice = 0
        for (c in coverage.cards) {
            if (c.missing <= 0) continue
            if (c.cardId in listed) { alreadyListed++; continue }
            val mp = wishlistMaxPrice(c.price)
            if (mp == null) withoutPrice++
            candidates.add(WishCandidate(c.cardId, mp))
        }
        return WishPlan(candidates, alreadyListed, withoutPrice)
    }

    private fun karten(n: Int) = if (n == 1) "Karte" else "Karten"

    fun confirmText(plan: WishPlan): String {
        val n = plan.candidates.size
        if (n == 0) return "Alle fehlenden Karten stehen schon auf der Wunschliste."
        val parts = ArrayList<String>()
        if (plan.alreadyListed > 0) parts.add("${plan.alreadyListed} ${if (plan.alreadyListed == 1) "steht" else "stehen"} schon drauf")
        if (plan.withoutPrice > 0) {
            parts.add(
                if (plan.withoutPrice == 1) "1 hat keinen Preis und bekommt keine Deal-Suche"
                else "${plan.withoutPrice} haben keinen Preis und bekommen keine Deal-Suche"
            )
        }
        val tail = if (parts.isEmpty()) "" else " ${parts.joinToString(", ")}."
        return "$n fehlende ${karten(n)} auf die Wunschliste setzen?$tail"
    }

    fun resultText(total: Int, added: Int, watches: Int): String {
        val failed = total - added
        if (failed > 0) return "$added von $total hinzugefügt, $failed fehlgeschlagen"
        return "$added ${karten(added)} auf der Wunschliste${if (watches > 0) ", Deal-Suche läuft." else "."}"
    }

    /**
     * Legt Eintrag fuer Eintrag an. [add] liefert true, wenn zusaetzlich ein Deal-Watch entstand, und wirft, wenn der
     * Eintrag scheitert. Die Cloud-Suche [triggerScrape] laeuft hoechstens EINMAL am Ende, nur wenn ein Watch entstand.
     */
    suspend fun addAll(
        candidates: List<WishCandidate>,
        add: suspend (WishCandidate) -> Boolean,
        triggerScrape: suspend () -> Unit,
    ): WishResult {
        var added = 0
        var watches = 0
        val failed = ArrayList<String>()
        for (c in candidates) {
            val watch = try { add(c) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { failed.add(c.cardId); continue }
            added++
            if (watch) watches++
        }
        if (watches > 0) triggerScrape()
        return WishResult(candidates.size, added, watches, failed)
    }
}
