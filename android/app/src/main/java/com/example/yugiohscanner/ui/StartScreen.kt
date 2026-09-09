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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogState
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.DealAlert
import com.example.yugiohscanner.cloud.DealsRepository
import com.example.yugiohscanner.cloud.SetsRepository
import com.example.yugiohscanner.cloud.Snapshot
import com.example.yugiohscanner.cloud.SnapshotsRepository
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.TypeSpell
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// A couple of sets closest to (but not yet at) 100% completion — owned/total.
private data class SetProgressRow(val name: String, val owned: Int, val total: Int)

// App landing page: merges the old Übersicht (quick actions, deal preview, set progress) and
// Wert (value chart + breakdowns) tabs into one scrollable Start page, plus the profile entry
// point into Einstellungen. Every source loads in its own try/catch so a missing table or
// network error just hides that section — but the first failure is surfaced, so "offline" never
// looks like "empty collection".
@Composable
fun StartScreen(
    onOpenSammlung: () -> Unit,
    onOpenScan: () -> Unit,
    onOpenDeals: () -> Unit,
    onOpenEinstellungen: () -> Unit,
    onOpenBinder: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var copies by remember { mutableStateOf<List<CopyRow>>(emptyList()) }
    var snapshots by remember { mutableStateOf<List<Snapshot>>(emptyList()) }
    var dealAlertCount by remember { mutableStateOf(0) }
    var topDeals by remember { mutableStateOf<List<DealAlert>>(emptyList()) }
    var setProgress by remember { mutableStateOf<List<SetProgressRow>>(emptyList()) }
    var timeframe by remember { mutableStateOf(30) } // days; Int.MAX_VALUE = all
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    // Spec B1 §10.5: Zähler „Nicht einsortiert" (Gegenstück zu Start.jsx). Eigener Fehlerzustand
    // -- listUnsortedCopies() wirft bei einem Ladefehler, ein leerer Fangzweig würde sonst "0
    // nicht einsortiert" zeigen, wo in Wahrheit einfach nichts geladen werden konnte.
    var unsortedCount by remember { mutableStateOf(0) }
    var unsortedError by remember { mutableStateOf(false) }
    val catalogState by CatalogSync.state.collectAsState()
    // Catalog readiness is a SQLite read, so it is hoisted into state instead of being called
    // from composition: this screen recomposes on every Downloading percent tick, and reading
    // the DB there would mean dozens of main-thread disk reads per second — and an exception
    // (the importer holds a write transaction on the same file) thrown straight out of
    // composition. Re-read only when the sync moves to a new phase.
    var catalogReady by remember { mutableStateOf(false) }
    LaunchedEffect(catalogState::class) {
        val ready = withContext(Dispatchers.IO) {
            runCatching { CatalogRepository.isReady() }.getOrDefault(false)
        }
        catalogReady = ready
    }

    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val c = CollectionRepository.loadCards()
                cards = c
                copies = CollectionRepository.loadCopies()
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
                } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }

            try {
                val dash = computeDashboard(cards, copies)
                // Record today's value + read the history for the chart. Non-fatal if the
                // portfolio_snapshots table isn't set up yet.
                SnapshotsRepository.upsertToday(dash.totalValue, dash.totalCards)
                snapshots = SnapshotsRepository.loadSnapshots()
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }

            try {
                val alerts = DealsRepository.loadAlerts()
                dealAlertCount = alerts.size
                topDeals = alerts.take(2)
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }

            try {
                unsortedCount = CollectionRepository.listUnsortedCopies().size
                unsortedError = false
            } catch (e: Exception) { unsortedError = true }

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

        val d = computeDashboard(cards, copies)
        val byKey = copies.groupBy { it.printingKey() }

        // Window the history by the selected timeframe, spacing points by their real date.
        val nowOrd = System.currentTimeMillis() / 86_400_000L
        val cutoff = if (timeframe == Int.MAX_VALUE) 0L else nowOrd - timeframe
        val windowSnaps = snapshots.filter { dayOrdinal(it.day) >= cutoff }
        val points = windowSnaps.map { dayOrdinal(it.day) to it.totalValue }
        val startVal = windowSnaps.firstOrNull()?.totalValue ?: d.totalValue
        val change = d.totalValue - startVal
        val changePct = if (startVal > 0) change / startVal * 100 else 0.0

        Column(
            Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Start", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                IconButton(onClick = onOpenEinstellungen) {
                    Icon(Icons.Default.AccountCircle, "Einstellungen", tint = Primary)
                }
            }

            // First-run/offline banner: only while the catalog has never been imported yet AND a
            // sync is actively in progress. Disappears the moment CatalogSync reaches Ready (or
            // Idle/Failed, which aren't "in progress"). Independent of `error` above, which is
            // reserved for collection-load failures.
            val catalogPercent = when (val s = catalogState) {
                is CatalogState.Downloading -> s.percent
                is CatalogState.Importing -> 100
                else -> 0
            }
            if (!catalogReady &&
                (catalogState is CatalogState.Checking || catalogState is CatalogState.Downloading || catalogState is CatalogState.Importing)
            ) {
                SpaceCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            "Katalog wird geladen … $catalogPercent %",
                            style = MaterialTheme.typography.bodySmall, color = OnSurface,
                        )
                        Text(
                            "Scannen geht schon — es dauert nur länger.",
                            style = MaterialTheme.typography.labelSmall, color = Muted,
                        )
                    }
                }
            }

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            // Value hero: total, Δ, timeframe chips, chart.
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

            // Quick actions.
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                QuickAction("Scannen", Icons.Default.CameraAlt, Modifier.weight(1f), onOpenScan)
                QuickAction("Sammlung", Icons.Default.Style, Modifier.weight(1f), onOpenSammlung)
                QuickAction("Deals", Icons.Default.Sell, Modifier.weight(1f), onOpenDeals)
            }

            // Spec B1 §10.5: Zähler „Nicht einsortiert", springt in den Binder-Reiter der
            // Sammlung. TypeSpell (bereits Teil der Theme-Palette, u.a. in BindersScreen.kt
            // als Farbvoreinstellung) statt einer neuen Farbe -- hebt sich von Primary (Scannen/
            // Sammlung) und Gold (Gesamtwert) ab, genau wie "frame-spell" es am Desktop tut.
            SpaceCard(Modifier.fillMaxWidth().clickable { onOpenBinder() }) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Inbox, null, tint = TypeSpell)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (unsortedError) "—" else "$unsortedCount",
                            style = MaterialTheme.typography.titleLarge, fontFamily = MonoFontFamily,
                            fontWeight = FontWeight.Bold, color = TypeSpell,
                        )
                        Text(
                            "Nicht einsortiert" + if (unsortedError) " (Ladefehler)" else "",
                            style = MaterialTheme.typography.labelSmall, color = Muted,
                        )
                    }
                }
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

            // Teuerste Karten.
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    SectionHeader("Teuerste Karten")
                    Spacer(Modifier.height(8.dp))
                    if (d.top.isEmpty()) {
                        Text("Keine Daten", style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        d.top.forEach { c ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    c.name ?: c.id, Modifier.weight(1f), maxLines = 1,
                                    style = MaterialTheme.typography.bodySmall, color = OnSurface,
                                )
                                ValueText(printingValue(c, byKey), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }

            StatSection("Nach Rarität", d.byRarity)
            StatSection("Nach Typ", d.byType)
            StatSection("Nach Set", d.bySet)
            StatSection("Nach Attribut", d.byAttribute)
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
