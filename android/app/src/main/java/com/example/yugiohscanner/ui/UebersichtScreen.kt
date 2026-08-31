package com.example.yugiohscanner.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.DealAlert
import com.example.yugiohscanner.cloud.DealsRepository
import com.example.yugiohscanner.cloud.SetsRepository
import com.example.yugiohscanner.cloud.Snapshot
import com.example.yugiohscanner.cloud.SnapshotsRepository
import com.example.yugiohscanner.cloud.WishlistRepository
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.launch

// A couple of sets closest to (but not yet at) 100% completion — owned/total.
private data class SetProgressRow(val name: String, val owned: Int, val total: Int)

// App landing page: aggregates value, deals, wishlist and set progress from the cloud
// repositories into one scrollable overview, with quick-action shortcuts. Every source
// loads in its own try/catch so a missing table or network error just hides that section.
@Composable
fun UebersichtScreen(
    onOpenWert: () -> Unit,
    onOpenScan: () -> Unit,
    onOpenDeals: () -> Unit,
    onOpenSammlung: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var snapshots by remember { mutableStateOf<List<Snapshot>>(emptyList()) }
    var dealAlertCount by remember { mutableStateOf(0) }
    var topDeals by remember { mutableStateOf<List<DealAlert>>(emptyList()) }
    var wishlistCount by remember { mutableStateOf(0) }
    var setProgress by remember { mutableStateOf<List<SetProgressRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val c = CollectionRepository.loadCards()
                cards = c
                try {
                    val sets = SetsRepository.loadSets()
                    val ownedByPrefix = HashMap<String, MutableSet<String>>()
                    for (card in c) {
                        if (card.setCode.equals("Unknown", ignoreCase = true)) continue
                        val prefix = card.setCode.substringBefore("-").uppercase()
                        if (prefix.isBlank()) continue
                        ownedByPrefix.getOrPut(prefix) { HashSet() }.add(card.setCode)
                    }
                    setProgress = ownedByPrefix.mapNotNull { (prefix, codes) ->
                        val info = sets[prefix] ?: return@mapNotNull null
                        val owned = codes.size.coerceAtMost(info.total)
                        SetProgressRow(info.name, owned, info.total)
                    }
                        .filter { it.owned < it.total }            // not yet complete
                        .sortedByDescending { it.owned.toFloat() / it.total }
                        .take(3)
                } catch (_: Exception) {}
            } catch (_: Exception) {}

            try {
                snapshots = SnapshotsRepository.loadSnapshots()
            } catch (_: Exception) {}

            try {
                val alerts = DealsRepository.loadAlerts()
                dealAlertCount = alerts.size
                topDeals = alerts.take(2)
            } catch (_: Exception) {}

            try {
                wishlistCount = WishlistRepository.loadWishlist().size
            } catch (_: Exception) {}

            loading = false
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Primary)
            }
            return@Surface
        }

        val d = computeDashboard(cards)

        Column(
            Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Übersicht", style = MaterialTheme.typography.headlineSmall, color = OnSurface)

            // Value hero.
            SpaceCard(Modifier.fillMaxWidth().clickable { onOpenWert() }) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    SectionHeader("Gesamtwert")
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "%.2f €".format(d.totalValue),
                        style = MaterialTheme.typography.displaySmall,
                        fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = Gold,
                    )
                    Text(
                        "${d.totalCards} Karten · ${d.entries} Einträge",
                        style = MaterialTheme.typography.bodySmall, color = Muted,
                    )
                    if (snapshots.size >= 2) {
                        Spacer(Modifier.height(12.dp))
                        ValueMiniChart(
                            snapshots.map { it.totalValue },
                            Modifier.fillMaxWidth().height(48.dp),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Wert ansehen ›",
                        style = MaterialTheme.typography.labelSmall, color = Primary,
                    )
                }
            }

            // Quick actions.
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                QuickAction("Scannen", Icons.Default.CameraAlt, Modifier.weight(1f), onOpenScan)
                QuickAction("Deals", Icons.Default.Sell, Modifier.weight(1f), onOpenDeals)
                QuickAction("Sammlung", Icons.Default.Style, Modifier.weight(1f), onOpenSammlung)
            }

            // Deals.
            SpaceCard(Modifier.fillMaxWidth().clickable { onOpenDeals() }) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    SectionHeader("Aktive Deals ($dealAlertCount)")
                    Spacer(Modifier.height(8.dp))
                    if (topDeals.isEmpty()) {
                        Text("Keine aktiven Deals", style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        topDeals.forEach { deal ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    deal.title, Modifier.weight(1f), maxLines = 1,
                                    style = MaterialTheme.typography.bodySmall, color = OnSurface,
                                )
                                Text(
                                    deal.price?.let { "${it.toInt()} €" } ?: "—", color = Gold,
                                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = MonoFontFamily),
                                )
                            }
                        }
                    }
                }
            }

            // Wishlist.
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    SectionHeader("Wishlist")
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (wishlistCount == 0) "Keine Wunschkarten" else "$wishlistCount Wunschkarten",
                        style = MaterialTheme.typography.bodyMedium, color = OnSurface,
                    )
                }
            }

            // Set progress.
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    SectionHeader("Set-Fortschritt")
                    Spacer(Modifier.height(8.dp))
                    if (setProgress.isEmpty()) {
                        Text("—", style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        setProgress.forEachIndexed { i, s ->
                            if (i > 0) Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    s.name, Modifier.weight(1f), maxLines = 1,
                                    style = MaterialTheme.typography.bodySmall, color = OnSurface,
                                )
                                Text(
                                    "${s.owned} / ${s.total}", color = Gold,
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = MonoFontFamily),
                                )
                            }
                            Spacer(Modifier.height(6.dp))
                            Box(Modifier.fillMaxWidth().height(6.dp).background(Line, RoundedCornerShape(3.dp))) {
                                Box(
                                    Modifier.fillMaxWidth((s.owned.toFloat() / s.total).coerceIn(0f, 1f))
                                        .height(6.dp).background(Primary, RoundedCornerShape(3.dp)),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickAction(label: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    SpaceCard(modifier.clickable { onClick() }) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, label, tint = Primary)
            Spacer(Modifier.height(6.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, color = OnSurface)
        }
    }
}

// Minimal value-over-time line chart (no chart library) — same approach as PortfolioScreen.
@Composable
private fun ValueMiniChart(values: List<Double>, modifier: Modifier) {
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
