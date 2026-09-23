package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogState
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.SnapshotsRepository
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SealedSnapshot
import com.example.yugiohscanner.ml.SealedValue
import com.example.yugiohscanner.ml.SnapshotSeries
import com.example.yugiohscanner.ml.UnsortedCopies
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Warn
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
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
    onOpenInsights: () -> Unit,
    onOpenAlerts: () -> Unit,
    onOpenForSale: () -> Unit,
    onOpenDuplicates: () -> Unit,
    onOpenListings: () -> Unit,
    onOpenDecks: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    // Spec H1 §5.3: Zaehler und "davon zum Verkauf"; null = wird gerechnet ("…").
    val sale = rememberSaleData()
    val saleSummary = remember(sale) { sale?.let { Duplicates.forSaleSummary(it.sale) } }
    val duplicateSummary = remember(sale) { sale?.let { Duplicates.summary(it.duplicates) } }
    // Spec H3a §6: "Angebote: N aktiv"; "…" solange geladen wird, "—" nach einem Fehler ohne Wert.
    val listingsState by SideStores.listings.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.listings.ensureLoaded() }
    val listingsText = remember(listingsState) {
        listingsState.value?.let { ListingText.startText(ListingText.listingsSummary(it.heads(), it.lineItems()).listings) }
            ?: if (listingsState.error != null) "Angebote: —" else "Angebote: …"
    }
    // Spec §5: Karten und Exemplare aus dem Speicher; der Ladebildschirm garantiert Ready.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    val snapshotsCache by SideStores.snapshots.state.collectAsState()
    val snapshots = snapshotsCache.value ?: emptyList()
    // Spec G3 §8: Sealed-Anteil des Gesamtwerts; die Summe nur neu, wenn sich die Liste aendert.
    val sealedCache by SideStores.sealedItems.state.collectAsState()
    val sealedTotal = remember(sealedCache.value) { sealedCache.value?.let { SealedValue.sealedValue(it) } }
    // Spec G1 §4.7: Kartendetail aus Start heraus, wie in CollectionScreen (Detail bleibt verschachtelt).
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    val setsCache by SideStores.sets.state.collectAsState()
    val alertsCache by SideStores.dealAlerts.state.collectAsState()
    val dealAlertCount = alertsCache.value?.size ?: 0
    val topDeals = alertsCache.value?.take(2) ?: emptyList()
    val setProgress = remember(ready?.cards, setsCache.value) {
        val sets = setsCache.value ?: return@remember emptyList<SetProgressRow>()
        val ownedByPrefix = HashMap<String, MutableSet<String>>()
        for (card in cards) {
            if (card.setCode.equals("Unknown", ignoreCase = true)) continue
            val prefix = card.setCode.substringBefore("-").uppercase()
            if (prefix.isBlank()) continue
            ownedByPrefix.getOrPut(prefix) { HashSet() }.add(card.setCode)
        }
        ownedByPrefix.mapNotNull { (prefix, codes) ->
            val info = sets[prefix] ?: return@mapNotNull null
            SetProgressRow(info.name, codes.size.coerceAtMost(info.total), info.total)
        }
            .filter { it.owned < it.total }
            .sortedByDescending { it.owned.toFloat() / it.total }
            .take(3)
    }
    var timeframe by remember { mutableStateOf(30) } // days; Int.MAX_VALUE = all
    var error by remember { mutableStateOf<String?>(null) }
    // Spec B1 §10.5: Zaehler "Nicht einsortiert", abgeleitet aus den Exemplaren im Speicher.
    val unsortedCount = remember(ready?.copies) { UnsortedCopies.from(copies).size }
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
            SideStores.sets.ensureLoaded()
            SideStores.dealAlerts.refresh()

            // Ohne Ready wird nichts gerechnet und KEIN Tageswert gespeichert -- sonst stuende ein
            // 0-€-Tag im Verlauf (Spec §7.3). Der Ladebildschirm macht das zum Nicht-Fall.
            val r = CollectionStore.state.value as? StoreState.Ready ?: return@launch
            try {
                // Review-Fund 1: nicht auf dem Haupt-Dispatcher rechnen -- ein kalter Merker
                // braucht hier genauso die vollen ~210-406 ms wie in der Anzeige unten.
                val dash = withContext(Dispatchers.Default) { DashboardMemo.get(r.cards, r.copies) }
                // Spec G3 §8: Tageswert = Karten + Sealed, erst mit an diesem Start geladener Sealed-Liste;
                // bei Ladefehler kein Tageswert. Den Verlauf fuer das Diagramm trotzdem laden.
                // Non-fatal if the portfolio_snapshots table isn't set up yet.
                SideStores.sealedItems.refreshAndWait()
                val values = SealedSnapshot.decide(dash.totalValue, SideStores.sealedItems.state.value)
                val snaps = SideStores.snapshots
                if (values != null) {
                    SnapshotsRepository.upsertToday(values.total, dash.totalCards, values.sealed)
                    if (snaps.state.value.value == null) snaps.refreshAndWait()
                    else snaps.update { SnapshotSeries.withToday(it, UtcDay.today(), values.total) }
                } else if (snaps.state.value.value == null) {
                    snaps.refreshAndWait()
                }
            } catch (e: Exception) { if (error == null) error = e.message ?: "Laden fehlgeschlagen" }
        }
    }

    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }
    Surface(Modifier.fillMaxSize(), color = Background) {
        RefreshableBox(onRefresh = {
            CollectionStore.awaitSync()
            SideStores.dealAlerts.refreshAndWait()
            SideStores.snapshots.refreshAndWait()
            SideStores.reference7.refreshAndWait()
            SideStores.priceAlertEvents.refreshAndWait()
            SideStores.priceAlertTargets.refreshAndWait()
            SideStores.sealedItems.refreshAndWait()
            SideStores.listings.refreshAndWait()
        }) {
        // Befund A, Punkt 3: Anfangswert ist ein Merker-Treffer (falls die Referenzen schon
        // passen) oder null; solange null, bleibt `d` null und die betroffenen Stellen unten
        // zeigen einen echten Ladehinweis statt Nullwerten -- kein Hauptthread-Block durch die
        // Berechnung. Review-Fund 2: 0 €/"Keine Daten" sah wie eine leere Sammlung aus, darum
        // kein EmptyDashboard-Platzhalter mehr; die Stellen unten pruefen `d`/`dash` selbst.
        val d by produceState<Dashboard?>(DashboardMemo.peek(cards, copies), cards, copies) {
            value = withContext(Dispatchers.Default) { DashboardMemo.get(cards, copies) }
        }
        val byKey = remember(copies) { copies.groupBy { it.printingKey() } }

        // Window the history by the selected timeframe, spacing points by their real date.
        val nowOrd = System.currentTimeMillis() / 86_400_000L
        val cutoff = if (timeframe == Int.MAX_VALUE) 0L else nowOrd - timeframe
        val windowSnaps = snapshots.filter { dayOrdinal(it.day) >= cutoff }
        val points = windowSnaps.map { dayOrdinal(it.day) to it.totalValue }

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

            SyncHint()

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

            (error ?: setsCache.error ?: alertsCache.error ?: snapshotsCache.error)?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            // Value hero: total, Δ, timeframe chips, chart.
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    SectionHeader("Gesamtwert")
                    Spacer(Modifier.height(4.dp))
                    val dash = d
                    // Spec G3 §8: solange die Sealed-Liste noch nie geladen wurde, zeigt die Karte den Ladezustand.
                    val sealedLoading = sealedCache.value == null && sealedCache.error == null
                    if (dash != null && !sealedLoading) {
                        val total = dash.totalValue + (sealedTotal ?: 0.0)
                        Text("%.2f €".format(total), style = MaterialTheme.typography.displaySmall,
                            fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = OnSurface)
                        Text("${dash.totalCards} Karten · ${dash.entries} Einträge",
                            style = MaterialTheme.typography.bodySmall, color = Muted)
                        if (sealedTotal == null) {
                            // Ladefehler ohne frueheren Stand: nur der Kartenwert, mit Hinweis (kein Tageswert, Task 10).
                            Text("Sealed-Wert nicht geladen — zum Aktualisieren ziehen",
                                style = MaterialTheme.typography.labelSmall, color = ErrorColor)
                        } else if (sealedCache.value?.isNotEmpty() == true) {
                            Text("Karten %.2f € · Sealed %.2f €".format(dash.totalValue, sealedTotal),
                                style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        // Spec H1 §5.3: markierte Exemplare zaehlen weiter zum Wert.
                        if (saleSummary != null && saleSummary.copies > 0) {
                            Text(Duplicates.saleShareText(saleSummary), style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        // Fix M2 (final-review-report.md): ohne bekannten Sealed-Wert waere die Basis-Momentaufnahme
                        // (die Sealed einschliesst) nicht mit `total` (nur Karten) vergleichbar -- die Delta-Zeile
                        // bliebe irrefuehrend, bis der Sealed-Wert bekannt ist.
                        if (sealedTotal != null && windowSnaps.size >= 2) {
                            val startVal = windowSnaps.firstOrNull()?.totalValue ?: total
                            val change = total - startVal
                            val changePct = if (startVal > 0) change / startVal * 100 else 0.0
                            val up = change >= 0
                            Text(
                                "${if (up) "+" else ""}%.2f € (%.1f%%)".format(change, changePct),
                                style = MaterialTheme.typography.bodyMedium,
                                fontFamily = MonoFontFamily, color = if (up) Good else ErrorColor,
                            )
                        }
                    } else {
                        // Review-Fund 2: kein Nullwert-Platzhalter, der wie eine leere Sammlung
                        // aussieht -- echter Ladehinweis im selben Textslot wie der Wert, damit
                        // die Karte in etwa ihre Hoehe behaelt.
                        Text("Wert wird berechnet …", style = MaterialTheme.typography.displaySmall,
                            fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = Muted)
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

            // Spec G2 §7: Preis-Alarme direkt über den Bewegungen, nur bei offenen Treffern.
            PriceAlertsSection(full = false, onOpenCard = { detailId = it }, onOpenAll = onOpenAlerts)

            MoversSection(days = 7, top = 3, full = false, onOpenCard = { detailId = it }, onOpenAll = onOpenInsights)

            // Quick actions.
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                QuickAction("Scannen", Icons.Default.CameraAlt, Modifier.weight(1f), onOpenScan)
                QuickAction("Sammlung", Icons.Default.Style, Modifier.weight(1f), onOpenSammlung)
                QuickAction("Decks", Icons.Default.Layers, Modifier.weight(1f), onOpenDecks)
                QuickAction("Deals", Icons.Default.Sell, Modifier.weight(1f), onOpenDeals)
            }

            // Spec B1 §10.5: Zähler „Nicht einsortiert", springt in den Binder-Reiter der
            // Sammlung. Warn statt einer Spielfarbe (Fixrunde 1, Punkt 9) -- der Zähler verlangt
            // eine Handlung (einsortieren), genau wie "Fehlende Daten" an anderer Stelle.
            SpaceCard(Modifier.fillMaxWidth().clickable { onOpenBinder() }) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Inbox, null, tint = Warn)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "$unsortedCount",
                            style = MaterialTheme.typography.titleLarge, fontFamily = MonoFontFamily,
                            fontWeight = FontWeight.Bold, color = Warn,
                        )
                        Text(
                            "Nicht einsortiert",
                            style = MaterialTheme.typography.labelSmall, color = Muted,
                        )
                    }
                }
            }

            // Spec H1 §5.3: "Zum Verkauf" und "Duplikate", Tipp oeffnet den Chip der Sammlung.
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().clickable { onOpenForSale() }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Sell, null, tint = Warn)
                        Spacer(Modifier.width(12.dp))
                        Text(saleSummary?.let { Duplicates.startSaleText(it) } ?: "Zum Verkauf: ${Duplicates.LOADING}",
                            style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                    }
                    Row(Modifier.fillMaxWidth().clickable { onOpenDuplicates() }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Style, null, tint = Primary)
                        Spacer(Modifier.width(12.dp))
                        Text(duplicateSummary?.let { Duplicates.startDuplicatesText(it) } ?: "Duplikate: ${Duplicates.LOADING}",
                            style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                    }
                    Row(Modifier.fillMaxWidth().clickable { onOpenListings() }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Storefront, null, tint = Warn)
                        Spacer(Modifier.width(12.dp))
                        Text(listingsText, style = MaterialTheme.typography.bodyMedium, color = OnSurface)
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
                                    deal.price?.let { "${it.toInt()} €" } ?: "—", color = OnSurface,
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
                                    "${s.owned} / ${s.total}", color = OnSurface,
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

            // Review-Fund 2: Auswertungen haengen am Merker-Ergebnis -- solange das noch nicht
            // da ist, werden sie ganz ausgelassen statt mit einem Nullwert-/"Keine Daten"-Stand
            // zu erscheinen, der wie eine leere Sammlung aussieht.
            d?.let { dash ->
                // Teuerste Karten.
                SpaceCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        SectionHeader("Teuerste Karten")
                        Spacer(Modifier.height(8.dp))
                        if (dash.top.isEmpty()) {
                            Text("Keine Daten", style = MaterialTheme.typography.bodySmall, color = Muted)
                        } else {
                            dash.top.forEach { c ->
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

                SpaceCard(Modifier.fillMaxWidth().clickable { onOpenInsights() }) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Aufteilung ansehen", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                        Text("→", style = MaterialTheme.typography.bodyMedium, color = Primary)
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

// Minimal value-over-time line chart (no chart library): a violet polyline with a soft fill.
// Points are (day-ordinal, value) so the x-axis reflects real elapsed time, not just index.
@Composable
private fun ValueChart(points: List<Pair<Long, Double>>, modifier: Modifier) {
    // Primary hier lesen -- der Canvas-Zeichenblock unten ist kein @Composable-Kontext.
    val primaryColor = Primary
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
        drawPath(fill, primaryColor.copy(alpha = 0.12f))
        drawPath(line, primaryColor, style = Stroke(width = 3f))
    }
}

private val dayFmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
private fun dayOrdinal(day: String): Long = try {
    (dayFmt.parse(day)?.time ?: 0L) / 86_400_000L
} catch (_: Exception) { 0L }
