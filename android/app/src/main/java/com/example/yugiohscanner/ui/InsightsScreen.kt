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
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.OnSurface

/** Spec G1 §4.7 -- Insights, Unterseite von Start (Route "start/insights"). */
@Composable
fun InsightsScreen(onBack: () -> Unit) {
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var days by rememberSaveable { mutableStateOf(7) }
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }
    Surface(Modifier.fillMaxSize(), color = Background) {
        RefreshableBox(onRefresh = { CollectionStore.awaitSync(); SideStores.reference(days).refreshAndWait() }) {
            Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                    Text("Insights", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(7, 30).forEach { d ->
                        FilterChip(selected = days == d, onClick = { days = d }, label = { Text("$d Tage") })
                    }
                }
                MoversSection(days = days, top = 10, full = true, onOpenCard = { detailId = it }, onOpenAll = null)
            }
        }
    }
}
