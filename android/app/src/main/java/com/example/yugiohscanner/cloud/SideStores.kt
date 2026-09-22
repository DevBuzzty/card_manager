package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.BoundedMap
import com.example.yugiohscanner.ml.PriceRef
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
    // Spec E1 §8: alle Deckkarten fuer die Zahlen der Deck-Liste. Klein, voll neu laden wie decks.
    val allDeckCards = ListCache(scope) { DecksRepository.loadAllCards() }
    val dealWatches = ListCache(scope) { DealsRepository.loadWatches() }
    val dealAlerts = ListCache(scope) { DealsRepository.loadAlerts() }
    val sets = ListCache(scope) { SetsRepository.loadSets() }

    // Spec G1 §4.3/§4.4: Referenzpreise einmal pro UTC-Tag, Wertverlauf, Preisverlauf je Printing (max. 20).
    val reference7 = DailyListCache(scope) { PriceHistoryRepository.reference(7) }
    val reference30 = DailyListCache(scope) { PriceHistoryRepository.reference(30) }
    val snapshots = ListCache(scope) { SnapshotsRepository.loadSnapshots() }

    // Spec G2 §7: Preis-Alarme. Treffer laden beim Eintritt in den Vordergrund (AppNav) und per Ziehen,
    // Regeln einmal und nach eigenem Speichern. Ziele werden zusammen mit den Treffern neu geladen
    // (Vordergrund und Ziehen), weil die Cloud dort "armed" aendert. Die Bewegungsregel als Liste mit
    // 0 oder 1 Element, weil ListCache "null" fuer "noch nie geladen" braucht.
    val priceAlertEvents = ListCache(scope) { PriceAlertsRepository.loadEvents() }
    val priceAlertMoveRule = ListCache(scope) { listOfNotNull(PriceAlertsRepository.loadMoveRule()) }
    val priceAlertTargets = ListCache(scope) { PriceAlertsRepository.loadTargets() }

    // Spec G3 §8: Sealed-Bestand. Kleine Liste, voll neu laden: beim Start, beim Vordergrund (AppNav, mit den
    // Preis-Alarmen), per Ziehen und nach eigenem Speichern (refreshAndWait).
    val sealedItems = ListCache(scope) { SealedRepository.loadLive() }

    // Spec H2 §8: Verkaeufe. Kleine Liste, voll neu laden wie sealedItems.
    val sales = ListCache(scope) { SalesRepository.load() }

    // Spec H3a §4.3: Angebote. Voll neu laden (geblättert), wie sales.
    val listings = ListCache(scope) { ListingsRepository.load() }

    private val historyCaches = BoundedMap<String, ListCache<List<PriceRef>>>(20)

    fun history(card: CardRow): ListCache<List<PriceRef>> =
        historyCaches.getOrPut(card.printingKey()) { ListCache(scope) { PriceHistoryRepository.history(card) } }

    fun reference(days: Int): DailyListCache<List<PriceRef>> = if (days == 30) reference30 else reference7

    private val deckCardCaches = HashMap<Long, ListCache<List<DeckCard>>>()

    fun deckCards(deckId: Long): ListCache<List<DeckCard>> = synchronized(deckCardCaches) {
        deckCardCaches.getOrPut(deckId) { ListCache(scope) { DecksRepository.loadCards(deckId) } }
    }

    /** Beim Abmelden und Kontowechsel (Spec §4.4). */
    fun clearAll() {
        wishlist.clear(); decks.clear(); allDeckCards.clear(); dealWatches.clear(); dealAlerts.clear(); sets.clear()
        reference7.clear(); reference30.clear(); snapshots.clear()
        priceAlertEvents.clear(); priceAlertMoveRule.clear(); priceAlertTargets.clear()
        sealedItems.clear()
        sales.clear()
        listings.clear()
        historyCaches.values().forEach { it.clear() }
        historyCaches.clear()
        synchronized(deckCardCaches) {
            deckCardCaches.values.forEach { it.clear() }
            deckCardCaches.clear()
        }
    }
}
