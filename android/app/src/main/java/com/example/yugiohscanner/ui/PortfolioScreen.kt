package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository

@Composable
fun PortfolioScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        try { cards = CollectionRepository.loadCards() } catch (_: Exception) {}
        loading = false
    }
    if (loading) { CircularProgressIndicator(); return }

    val d = computeDashboard(cards)

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Text("Gesamtwert", style = MaterialTheme.typography.titleMedium)
        Text("%.2f €".format(d.totalValue), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("${d.totalCards} Karten · ${d.entries} Einträge", style = MaterialTheme.typography.bodySmall)

        Spacer(Modifier.height(16.dp))
        Text("Teuerste Karten", style = MaterialTheme.typography.titleMedium)
        d.top.forEach { c ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text(c.name ?: c.id, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                Text("%.2f €".format((c.price ?: 0.0) * c.quantity), style = MaterialTheme.typography.bodySmall)
            }
        }

        StatSection("Nach Rarität", d.byRarity)
        StatSection("Nach Typ", d.byType)
        StatSection("Nach Set", d.bySet)
        StatSection("Nach Attribut", d.byAttribute)
    }
}

@Composable
private fun StatSection(title: String, groups: List<StatGroup>) {
    Spacer(Modifier.height(16.dp))
    Text(title, style = MaterialTheme.typography.titleMedium)
    if (groups.isEmpty()) {
        Text("Keine Daten", style = MaterialTheme.typography.bodySmall)
        return
    }
    val maxCount = groups.maxOf { it.count }.coerceAtLeast(1)
    groups.forEach { g -> StatBar(g.label, g.count, g.value, g.count.toFloat() / maxCount) }
}
