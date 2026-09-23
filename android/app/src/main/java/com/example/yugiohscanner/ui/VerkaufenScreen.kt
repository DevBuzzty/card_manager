package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.VerkaufenZahlen
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

/**
 * Spec I §5.3 -- Bereich "Verkaufen": vier Stationen in der Reihenfolge des Vorgangs
 * (Kandidaten -> Zum Verkauf -> Angebote -> Verkäufe). Die Listen/Uebersichten selbst
 * (DuplicatesList, ForSaleList, ListingsSection, SalesSection) bleiben unveraendert --
 * dieser Bereich ist nur ihr neuer Aufrufort (vorher Sammlung-Chips bzw. Insights-Reiter
 * "Verkäufe"). Der Karten-Detail-Ueberlagerung gehoert deshalb hierher, wie zuvor bei
 * ihrem jeweiligen Aufrufer (Muster CollectionScreen/InsightsScreen).
 */
@Composable
fun VerkaufenScreen(segment: String, onSegment: (String) -> Unit) {
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }

    val sale = rememberSaleData()
    // Wie zuvor in CollectionScreen (Spec H1 M2): Vorgeschichte/Scrollposition oberhalb des
    // Karten-Detail-Returns halten, damit ein Detail-Öffnen/-Schließen als "Liste bleibt offen"
    // zählt; das Verlassen der Kandidaten-Station leert die Vorgeschichte.
    val duplicatesHistory = remember { HashMap<String, List<String>>() }
    val duplicatesListState = rememberLazyListState()
    val forSaleListState = rememberLazyListState()

    // Abschlussreview C1: Anzahl je Reiter (Definition ml/VerkaufenZahlen, Zwilling des PCs).
    val listingsState by SideStores.listings.state.collectAsState()
    val salesState by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.listings.ensureLoaded(); SideStores.sales.ensureLoaded() }
    // Abschlussreview C3: beim Oeffnen des Reiters Verkaeufe frisch laden (wie frueher InsightsScreen).
    LaunchedEffect(segment) { if (segment == "verkaeufe") SideStores.sales.refresh() }
    val zahlen = VerkaufenZahlen.zahlen(sale?.duplicates?.size, sale?.forSaleIds, listingsState.value, salesState.value?.sales)

    val gewaehlt = NavTabellen.VERKAUFEN.indexOfFirst { it.first == segment }.coerceAtLeast(0)
    Column(Modifier.fillMaxSize()) {
        Text("Verkaufen", style = MaterialTheme.typography.headlineSmall, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        ScrollableTabRow(
            selectedTabIndex = gewaehlt,
            containerColor = Background,
            contentColor = Primary,
            edgePadding = 16.dp,
        ) {
            NavTabellen.VERKAUFEN.forEachIndexed { i, (id, label) ->
                Tab(selected = i == gewaehlt, onClick = { onSegment(id) }, text = {
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(label)
                        zahlen[id]?.let { Text("  $it", color = Muted, style = MaterialTheme.typography.labelSmall) }
                    }
                })
            }
        }
        // Abschlussreview C3: Wisch-Aktualisierung fuer alle vier Stationen -- Sammlung (Kandidaten,
        // Zum Verkauf), Angebote und Verkaeufe.
        RefreshableBox(onRefresh = {
            CollectionStore.awaitSync()
            SideStores.listings.refreshAndWait()
            SideStores.sales.refreshAndWait()
        }, modifier = Modifier.weight(1f)) {
        when (segment) {
            "zum-verkauf" -> ForSaleList(sale, onOpenCard = { detailId = it }, listState = forSaleListState,
                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp))
            "angebote" -> ListingsSection(onOpenCard = { detailId = it }, modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp))
            "verkaeufe" -> Column(Modifier.fillMaxSize().padding(horizontal = 12.dp).verticalScroll(rememberScrollState())) {
                SalesSection(onOpenCard = { detailId = it })
            }
            else -> DuplicatesList(sale, onOpenCard = { detailId = it }, history = duplicatesHistory, listState = duplicatesListState,
                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp))
        }
        }
    }
}
