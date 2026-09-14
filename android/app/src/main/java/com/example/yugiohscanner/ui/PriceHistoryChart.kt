package com.example.yugiohscanner.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.PriceFamily
import com.example.yugiohscanner.ml.PriceSteps
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import java.time.LocalDate

/**
 * Spec G1 §4.7 -- Stufenlinie pro Printing. Gemerkter Stand aus SideStores sofort, beim Oeffnen
 * Abgleich im Hintergrund. Leertexte wie desktop/src/components/PriceHistoryChart.jsx.
 */
@Composable
fun PriceHistoryChart(card: CardRow) {
    val key = card.printingKey()
    val cache = remember(key) { SideStores.history(card) }
    val state by cache.state.collectAsState()
    LaunchedEffect(key) { cache.refresh() }
    var window by rememberSaveable(key) { mutableStateOf(30) }
    val today = remember { UtcDay.today() }
    val rows = state.value
    val steps = remember(rows, window, today) { rows?.let { PriceSteps.compute(it, today, window) } }

    if (steps == null) {
        Text(if (state.error != null && !state.loading) "Verlauf nicht verfügbar" else "Verlauf lädt …",
            style = MaterialTheme.typography.labelSmall, color = Muted)
        return
    }
    when (steps.kind) {
        "none" -> Text("Noch kein Verlauf", style = MaterialTheme.typography.labelSmall, color = Muted)
        "flat" -> Text("Seit ${UtcDay.formatDe(steps.flatDay!!)} unverändert %.2f €".format(steps.flatPrice),
            style = MaterialTheme.typography.labelSmall, color = Muted)
        else -> Column(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(30, 90, 365).forEach { w ->
                    FilterChip(selected = window == w, onClick = { window = w },
                        label = { Text("$w T", style = MaterialTheme.typography.labelSmall) })
                }
            }
            val pts = steps.points
            val ords = pts.map { LocalDate.parse(it.day).toEpochDay() }
            val markerOrds = steps.markers.map { LocalDate.parse(it.day).toEpochDay() }
            Canvas(Modifier.fillMaxWidth().height(90.dp).padding(vertical = 6.dp)) {
                val min = pts.minOf { it.price }
                val max = pts.maxOf { it.price }
                val range = (max - min).coerceAtLeast(1e-6)
                val minOrd = ords.first()
                val ordRange = (ords.last() - minOrd).coerceAtLeast(1L).toFloat()
                fun x(o: Long) = (o - minOrd).toFloat() / ordRange * size.width
                fun y(v: Double) = (size.height - ((v - min) / range).toFloat() * size.height)
                val path = Path()
                pts.forEachIndexed { i, p ->
                    if (i == 0) path.moveTo(x(ords[0]), y(p.price))
                    else { path.lineTo(x(ords[i]), y(pts[i - 1].price)); path.lineTo(x(ords[i]), y(p.price)) }
                }
                drawPath(path, Primary, style = Stroke(width = 3f))
                markerOrds.forEach { o ->
                    drawLine(Gold, Offset(x(o), 0f), Offset(x(o), size.height), strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f)))
                }
            }
            Text("%.2f € – %.2f €".format(pts.minOf { it.price }, pts.maxOf { it.price }),
                style = MaterialTheme.typography.labelSmall, color = Muted)
            steps.markers.forEach { m ->
                Text("Quelle: ${PriceFamily.LABELS[m.family]} ab ${UtcDay.formatDe(m.day)}",
                    style = MaterialTheme.typography.labelSmall, color = Gold)
            }
        }
    }
}
