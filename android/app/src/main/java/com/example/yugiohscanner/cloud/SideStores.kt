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
