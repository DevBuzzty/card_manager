package com.example.yugiohscanner.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.Snapshot
import com.example.yugiohscanner.cloud.SnapshotsRepository
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary

@Composable
fun PortfolioScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var snapshots by remember { mutableStateOf<List<Snapshot>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try {
            val c = CollectionRepository.loadCards()
            cards = c
            val dash = computeDashboard(c)
            // Record today's value + read the history for the chart. Non-fatal if the
            // portfolio_snapshots table isn't set up yet.
            try {
                SnapshotsRepository.upsertToday(dash.totalValue, dash.totalCards)
                snapshots = SnapshotsRepository.loadSnapshots()
            } catch (_: Exception) {}
        } catch (e: Exception) { error = e.message ?: "Laden fehlgeschlagen" }
        loading = false
    }
    if (loading) { CircularProgressIndicator(); return }

    val d = computeDashboard(cards)

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
        }
        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                SectionHeader("Gesamtwert")
                Spacer(Modifier.height(4.dp))
                Text("%.2f €".format(d.totalValue), style = MaterialTheme.typography.displaySmall,
                    fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = Gold)
                Text("${d.totalCards} Karten · ${d.entries} Einträge",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
                if (snapshots.size >= 2) {
                    Spacer(Modifier.height(14.dp))
                    ValueChart(snapshots.map { it.totalValue },
                        Modifier.fillMaxWidth().height(56.dp))
                    Text("Verlauf (${snapshots.size} Tage)",
                        style = MaterialTheme.typography.labelSmall, color = Muted)
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        SectionHeader("Teuerste Karten")
        Spacer(Modifier.height(4.dp))
        d.top.forEach { c ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text(c.name ?: c.id, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface)
                ValueText((c.price ?: 0.0) * c.quantity, style = MaterialTheme.typography.bodySmall)
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
    SectionHeader(title)
    Spacer(Modifier.height(4.dp))
    if (groups.isEmpty()) {
        Text("Keine Daten", style = MaterialTheme.typography.bodySmall, color = Muted)
        return
    }
    val maxCount = groups.maxOf { it.count }.coerceAtLeast(1)
    groups.forEach { g -> StatBar(g.label, g.count, g.value, g.count.toFloat() / maxCount) }
}

// Minimal value-over-time line chart (no chart library): a violet polyline with a soft fill.
@Composable
private fun ValueChart(values: List<Double>, modifier: Modifier) {
    Canvas(modifier) {
        if (values.size < 2) return@Canvas
        val min = values.min()
        val max = values.max()
        val range = (max - min).coerceAtLeast(1e-6)
        val dx = size.width / (values.size - 1)
        val pad = size.height * 0.12f
        fun y(v: Double): Float = (size.height - pad - ((v - min) / range).toFloat() * (size.height - 2 * pad))
        val line = Path()
        values.forEachIndexed { i, v ->
            val x = i * dx; val yy = y(v)
            if (i == 0) line.moveTo(x, yy) else line.lineTo(x, yy)
        }
        val fill = Path().apply {
            addPath(line); lineTo(size.width, size.height); lineTo(0f, size.height); close()
        }
        drawPath(fill, Primary.copy(alpha = 0.12f))
        drawPath(line, Primary, style = Stroke(width = 3f))
    }
}
