package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
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

    val total = cards.sumOf { (it.price ?: 0.0) * it.quantity }
    val totalCards = cards.sumOf { it.quantity }
    val top = cards.sortedByDescending { (it.price ?: 0.0) * it.quantity }.take(20)

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Gesamtwert", style = MaterialTheme.typography.titleMedium)
        Text("%.2f €".format(total), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("$totalCards Karten · ${cards.size} Einträge", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))
        Text("Teuerste Karten", style = MaterialTheme.typography.titleMedium)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(top, key = { "${it.id}|${it.setCode}|${it.language}" }) { c ->
                Row(Modifier.fillMaxWidth()) {
                    Text(c.name ?: c.id, Modifier.weight(1f))
                    Text("%.2f €".format((c.price ?: 0.0) * c.quantity))
                }
            }
        }
    }
}
