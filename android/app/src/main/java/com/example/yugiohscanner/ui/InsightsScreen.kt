package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Spec G1 §4.7 -- Insights, Unterseite von Start (Route "start/insights"). */
@Composable
fun InsightsScreen(initialTab: String = "bewegungen", onBack: () -> Unit) {
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var days by rememberSaveable { mutableStateOf(7) }
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    var byValue by rememberSaveable { mutableStateOf(false) }
    BackHandler(detailId != null) { detailId = null }
    LaunchedEffect(tab) { if (tab == "verkaeufe") SideStores.sales.ensureLoaded() }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }
    Surface(Modifier.fillMaxSize(), color = Background) {
        RefreshableBox(onRefresh = {
            CollectionStore.awaitSync()
            SideStores.reference(days).refreshAndWait()
            SideStores.priceAlertEvents.refreshAndWait()
            SideStores.priceAlertTargets.refreshAndWait()
            SideStores.sales.refreshAndWait()
        }) {
            Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                    Text("Insights", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                }
                TabRow(selectedTabIndex = when (tab) { "aufteilung" -> 1; "alarme" -> 2; "verkaeufe" -> 3; else -> 0 }) {
                    Tab(selected = tab == "bewegungen", onClick = { tab = "bewegungen" }, text = { Text("Bewegungen") })
                    Tab(selected = tab == "aufteilung", onClick = { tab = "aufteilung" }, text = { Text("Aufteilung") })
                    Tab(selected = tab == "alarme", onClick = { tab = "alarme" }, text = { Text("Alarme") })
                    Tab(selected = tab == "verkaeufe", onClick = { tab = "verkaeufe" }, text = { Text("Verkäufe") })
                }
                if (tab == "bewegungen") {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(7, 30).forEach { d ->
                            FilterChip(selected = days == d, onClick = { days = d }, label = { Text("$d Tage") })
                        }
                    }
                    MoversSection(days = days, top = 10, full = true, onOpenCard = { detailId = it }, onOpenAll = null)
                }
                if (tab == "aufteilung") {
                    val store by CollectionStore.state.collectAsState()
                    val ready = store as? StoreState.Ready
                    val cards = ready?.cards ?: emptyList()
                    val copies = ready?.copies ?: emptyList()
                    val containers = ready?.containers ?: emptyList()
                    val dash by produceState(DashboardMemo.peek(cards, copies), cards, copies) {
                        value = withContext(Dispatchers.Default) { DashboardMemo.get(cards, copies) }
                    }
                    val binders by produceState(BinderBreakdownMemo.peek(cards, copies, containers), cards, copies, containers) {
                        value = withContext(Dispatchers.Default) { BinderBreakdownMemo.get(cards, copies, containers) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(selected = !byValue, onClick = { byValue = false }, label = { Text("Anzahl") })
                        FilterChip(selected = byValue, onClick = { byValue = true }, label = { Text("Wert") })
                    }
                    val d = dash
                    val b = binders
                    if (d == null || b == null) {
                        Text("Aufteilung wird berechnet …", style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        StatSection("Nach Typ", d.byType, byValue)
                        StatSection("Nach Set", d.bySet, byValue)
                        StatSection("Nach Rarität", d.byRarity, byValue)
                        StatSection("Nach Attribut", d.byAttribute, byValue)
                        StatSection("Nach Binder", b, byValue)
                    }
                }
                if (tab == "alarme") {
                    PriceAlertsSection(full = true, onOpenCard = { detailId = it }, onOpenAll = null)
                }
                if (tab == "verkaeufe") SalesSection(onOpenCard = { detailId = it })
            }
        }
    }
}
