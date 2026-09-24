package com.example.yugiohscanner.ui

import android.content.Context
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ListCache
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Performance: alles, was die Reiter brauchen, einmal beim App-Start -- danach zeigt jeder Reiter
 * sofort den gemerkten Stand, Nachladen passiert nur noch still im Hintergrund.
 */
object Preload {
    /** Wie lange der Ladebildschirm hoechstens auf die kleinen Netzlisten wartet (die Sammlung selbst ist schon da). */
    private const val SIDE_WAIT_MS = 3_000L

    // Was Start, Verkaufen und Deals beim ersten Oeffnen zeigen; die uebrigen laden nur vor, ohne zu warten.
    private val shownOnFirstScreens: List<ListCache<*>>
        get() = listOf(
            SideStores.listings, SideStores.sales, SideStores.dealAlerts,
            SideStores.sealedItems, SideStores.snapshots, SideStores.sets,
        )

    /** Nebenlisten parallel zur Sammlung anstossen. ensureLoaded laedt nichts doppelt. */
    fun startSideStores() {
        shownOnFirstScreens.forEach { it.ensureLoaded() }
        SideStores.dealWatches.ensureLoaded()
        SideStores.wishlist.ensureLoaded()
        SideStores.decks.ensureLoaded()
        SideStores.allDeckCards.ensureLoaded()
        SideStores.ebayStatus.ensureLoaded()
        SideStores.ebayRows.ensureLoaded()
        SideStores.saleNotices.ensureLoaded()
        SideStores.ebayOrders.ensureLoaded()
        SideStores.priceAlertMoveRule.ensureLoaded()
        SideStores.reference7.ensureFresh()
    }

    /**
     * Rechnet die Anzeigen fuer den geladenen Speicherstand vor (Start, Sammlung, Verkaufen) und wartet
     * kurz auf die Listen der ersten Bildschirme. Wirft nie (ausser bei Abbruch): ein Fehler hier heisst
     * nur, dass der Reiter beim ersten Oeffnen selbst rechnet -- wie bisher.
     */
    suspend fun warmUp(ctx: Context) {
        val r = CollectionStore.state.value as? StoreState.Ready ?: return
        try {
            coroutineScope {
                launch(Dispatchers.Default) { DashboardMemo.get(r.cards, r.copies) }
                launch(Dispatchers.Default) { StartMemo.get(r.cards, r.copies) }
                launch(Dispatchers.Default) { CollectionGroupsMemo.get(r.cards, r.copies, r.containers, GroupFilter()) }
                launch { preloadSaleData(ctx) }
                launch {
                    withTimeoutOrNull(SIDE_WAIT_MS) {
                        shownOnFirstScreens.forEach { cache -> cache.state.first { it.value != null || it.error != null } }
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // bewusst still, siehe oben
        }
    }
}
