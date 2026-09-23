package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

// Everything that is "my collection" lives on one tab; the tabs swap the content below.
// Segments come from NavTabellen.SAMMLUNG (Spec I §3, gemeinsame Tabelle docs/fixtures/design/nav.json;
// Decks zog auf eine eigene Start-Kachel um). Five segments no longer fit un-scrolled (Spec §11 risk)
// -- ScrollableTabRow instead of a plain Row, so nothing gets cut off on narrow screens.
@Composable
fun SammlungScreen(
    segment: String,
    onSegment: (String) -> Unit,
    onOpenSuche: () -> Unit,
    onOpenBehaelter: (String) -> Unit,
    onOpenScan: () -> Unit,
    onOpenSealedSuche: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Text("Sammlung", style = MaterialTheme.typography.headlineSmall, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        SyncHint(Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        val selected = NavTabellen.SAMMLUNG.indexOfFirst { it.first == segment }.coerceAtLeast(0)
        ScrollableTabRow(
            selectedTabIndex = selected,
            containerColor = Background,
            contentColor = Primary,
            edgePadding = 16.dp,
        ) {
            NavTabellen.SAMMLUNG.forEachIndexed { i, (id, label) ->
                Tab(selected = i == selected, onClick = { onSegment(id) }, text = { Text(label) })
            }
        }
        RefreshableBox(
            onRefresh = {
                when (segment) {
                    "wunschliste" -> SideStores.wishlist.refreshAndWait()
                    "sets" -> { CollectionStore.awaitSync(); SideStores.sets.refreshAndWait() }
                    "sealed" -> SideStores.sealedItems.refreshAndWait()
                    else -> CollectionStore.awaitSync()
                }
            },
            modifier = Modifier.weight(1f),
        ) {
            when (segment) {
                "binder" -> BindersScreen(onOpenBehaelter)
                "wunschliste" -> WishlistScreen()
                "sets" -> SetCompletionScreen()
                "sealed" -> SealedScreen(onOpenScan = onOpenScan, onOpenSuche = onOpenSealedSuche)
                else -> CollectionScreen(onOpenSuche = onOpenSuche)
            }
        }
    }
}
