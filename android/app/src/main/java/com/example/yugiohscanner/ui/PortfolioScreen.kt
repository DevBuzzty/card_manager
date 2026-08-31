package com.example.yugiohscanner.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.FilterChip
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
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary

@Composable
fun PortfolioScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var snapshots by remember { mutableStateOf<List<Snapshot>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var timeframe by remember { mutableStateOf(30) } // days; Int.MAX_VALUE = all
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
        // Window the history by the selected timeframe, spacing points by their real date.
        val nowOrd = System.currentTimeMillis() / 86_400_000L
        val cutoff = if (timeframe == Int.MAX_VALUE) 0L else nowOrd - timeframe
        val windowSnaps = snapshots.filter { dayOrdinal(it.day) >= cutoff }
        val points = windowSnaps.map { dayOrdinal(it.day) to it.totalValue }
        val startVal = windowSnaps.firstOrNull()?.totalValue ?: d.totalValue
        val change = d.totalValue - startVal
        val changePct = if (startVal > 0) change / startVal * 100 else 0.0

        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                SectionHeader("Gesamtwert")
                Spacer(Modifier.height(4.dp))
                Text("%.2f €".format(d.totalValue), style = MaterialTheme.typography.displaySmall,
                    fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = Gold)
                Text("${d.totalCards} Karten · ${d.entries} Einträge",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
                if (windowSnaps.size >= 2) {
                    val up = change >= 0
                    Text(
                        "${if (up) "+" else ""}%.2f € (%.1f%%)".format(change, changePct),
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = MonoFontFamily, color = if (up) Good else ErrorColor,
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(7 to "1W", 30 to "1M", 90 to "3M", 365 to "1J", Int.MAX_VALUE to "Alles")
                        .forEach { (days, label) ->
                            FilterChip(
                                selected = timeframe == days,
                                onClick = { timeframe = days },
                                label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                            )
                        }
                }
                if (points.size >= 2) {
                    Spacer(Modifier.height(12.dp))
                    ValueChart(points, Modifier.fillMaxWidth().height(64.dp))
                } else {
                    Spacer(Modifier.height(8.dp))
                    Text("Noch zu wenig Verlauf für diesen Zeitraum.",
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
// Points are (day-ordinal, value) so the x-axis reflects real elapsed time, not just index.
@Composable
private fun ValueChart(points: List<Pair<Long, Double>>, modifier: Modifier) {
    Canvas(modifier) {
        if (points.size < 2) return@Canvas
        val values = points.map { it.second }
        val min = values.min()
        val max = values.max()
        val range = (max - min).coerceAtLeast(1e-6)
        val minOrd = points.first().first
        val ordRange = (points.last().first - minOrd).coerceAtLeast(1L).toFloat()
        val pad = size.height * 0.12f
        fun y(v: Double): Float = (size.height - pad - ((v - min) / range).toFloat() * (size.height - 2 * pad))
        fun x(ord: Long): Float = (ord - minOrd).toFloat() / ordRange * size.width
        val line = Path()
        points.forEachIndexed { i, (ord, v) ->
            val xx = x(ord); val yy = y(v)
            if (i == 0) line.moveTo(xx, yy) else line.lineTo(xx, yy)
        }
        val fill = Path().apply {
            addPath(line); lineTo(size.width, size.height); lineTo(0f, size.height); close()
        }
        drawPath(fill, Primary.copy(alpha = 0.12f))
        drawPath(line, Primary, style = Stroke(width = 3f))
    }
}

private val dayFmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
private fun dayOrdinal(day: String): Long = try {
    (dayFmt.parse(day)?.time ?: 0L) / 86_400_000L
} catch (_: Exception) { 0L }
