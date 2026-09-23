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
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.theme.Background
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
                Tab(selected = i == gewaehlt, onClick = { onSegment(id) }, text = { Text(label) })
            }
        }
        when (segment) {
            "zum-verkauf" -> ForSaleList(sale, onOpenCard = { detailId = it }, listState = forSaleListState,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp))
            "angebote" -> ListingsSection(onOpenCard = { detailId = it }, modifier = Modifier.weight(1f).padding(horizontal = 12.dp))
            "verkaeufe" -> Column(Modifier.weight(1f).padding(horizontal = 12.dp).verticalScroll(rememberScrollState())) {
                SalesSection(onOpenCard = { detailId = it })
            }
            else -> DuplicatesList(sale, onOpenCard = { detailId = it }, history = duplicatesHistory, listState = duplicatesListState,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp))
        }
    }
}
