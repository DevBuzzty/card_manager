package com.example.yugiohscanner.ui

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogState
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.SalesRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.DuplicateEntry
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SaleCopy
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Spec H1 §4/§5: Verkaufs-Exemplare und Duplikate zu genau einem Speicherstand ([cards]/[copies] per Identitaet) und keep.
 * Gerechnet abseits des Hauptthreads (Artwork-Zuordnung ist ein SQLite-Lesen).
 */
class SaleData(val cards: List<CardRow>, val copies: List<CopyRow>, val keep: String, val sale: List<SaleCopy>, val duplicates: List<DuplicateEntry>) {
    val byId: Map<String, SaleCopy> = sale.associateBy { it.copy.copyId }
    val forSaleIds: Set<String> = sale.filter { it.copy.forSale }.map { it.copy.copyId }.toSet()
}

private fun keepOf(ctx: Context) = Prefs.keepPerCard(ctx).toString()

private suspend fun computeSaleData(cards: List<CardRow>, copies: List<CopyRow>, keep: String): SaleData = withContext(Dispatchers.Default) {
    val sale = Duplicates.saleCopies(copies, cards)
    val aliases = withContext(Dispatchers.IO) { runCatching { CatalogRepository.aliases(sale.map { it.copy.cardId }) }.getOrDefault(emptyMap()) }
    SaleData(cards, copies, keep, sale, Duplicates.duplicates(sale, keep) { aliases[it] })
}

/** Katalogstand fuer den Merker: die Artwork-Zuordnung aendert sich nur mit einem neu importierten Katalog. */
private fun catalogVersion(): Int? = (CatalogSync.state.value as? CatalogState.Ready)?.version

/**
 * Performance (Seitenwechsel): der letzte berechnete Stand, prozessweit wie DashboardMemo. Start und
 * Verkaufen zeigen beim Wiederkommen sofort Zahlen statt "…"; neu gerechnet wird nur, wenn sich der
 * Speicherstand (per Identitaet), keep_per_card oder der Katalog geaendert haben.
 */
private object SaleDataMemo {
    private val lock = Any()
    private var last: SaleData? = null
    private var lastCatalog: Int? = null

    fun peek(cards: List<CardRow>, copies: List<CopyRow>, keep: String, catalog: Int?): SaleData? = synchronized(lock) {
        last?.takeIf { it.cards === cards && it.copies === copies && it.keep == keep && lastCatalog == catalog }
    }

    suspend fun get(cards: List<CardRow>, copies: List<CopyRow>, keep: String, catalog: Int?): SaleData {
        peek(cards, copies, keep, catalog)?.let { return it }
        val d = computeSaleData(cards, copies, keep)
        synchronized(lock) { last = d; lastCatalog = catalog }
        return d
    }
}

/** Beim Start vorrechnen (AppNav), damit Start und Verkaufen schon beim ersten Oeffnen Zahlen zeigen. */
suspend fun preloadSaleData(ctx: Context) {
    val r = CollectionStore.state.value as? StoreState.Ready ?: return
    SaleDataMemo.get(r.cards, r.copies, keepOf(ctx), catalogVersion())
}

/** Frischer Stand fuer Mutationen (innerhalb des InFlight-Gatters gelesen, nie der Kompositions-Schnappschuss). */
suspend fun freshSaleData(ctx: Context): SaleData? {
    val r = CollectionStore.state.value as? StoreState.Ready ?: return null
    return computeSaleData(r.cards, r.copies, keepOf(ctx))
}

/**
 * Verkaufsdaten zum Speicher; "…" (null) nur, bis das ERSTE Ergebnis da ist. Danach bleibt der zuletzt
 * berechnete Stand sichtbar, auch waehrend nach einer Mutation/einem Sync/keep_per_card-Wechsel neu
 * gerechnet wird (Spec H1 I1) -- sonst verlaesst die LazyColumn die Komposition und die Scrollposition
 * geht verloren. Mutationen lesen ohnehin frisch über freshSaleData(), nie über diesen Schnappschuss.
 */
@Composable
fun rememberSaleData(): SaleData? {
    val ctx = LocalContext.current
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val keep = keepOf(ctx)
    val catalogState by CatalogSync.state.collectAsState()
    val catalog = (catalogState as? CatalogState.Ready)?.version
    val initial = ready?.let { SaleDataMemo.peek(it.cards, it.copies, keep, catalog) }
    val data by produceState(initial, ready?.cards, ready?.copies, keep, catalog) {
        val r = ready ?: return@produceState
        value = SaleDataMemo.get(r.cards, r.copies, keep, catalog)
    }
    return Duplicates.visibleSaleData(ready != null, data)
}

/** Ein-Lauf-Mutation: InFlight-Gatter, danach Abgleich mit dem Speicher, erst dann frei (Spec H1 §7). */
@Composable
private fun rememberMutation(onError: (String?) -> Unit): Pair<Boolean, (suspend () -> Unit) -> Unit> {
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    val mutate: (suspend () -> Unit) -> Unit = { block ->
        if (inFlight.tryStart()) {
            busy = true
            scope.launch {
                try { block(); CollectionStore.awaitSync(); onError(null) }
                catch (e: Exception) { onError(e.message ?: "Speichern fehlgeschlagen.") }
                finally { inFlight.finish(); busy = false }
            }
        }
    }
    return busy to mutate
}

/**
 * Spec H1 §5.2: Duplikate am Handy -- Kopf mit "Alle Vorschläge", je Karte Zeile mit Schalter; Tipp oeffnet das Detail.
 * [history] (§5.4 Vorgeschichte je Haupt-Passcode) und [listState] (Scrollposition) werden vom Aufrufer
 * (CollectionScreen, oberhalb des Karten-Detail-Returns) gehalten, damit beides ein Detail-Öffnen und
 * -Schließen überlebt (Spec H1 M2); der Aufrufer leert [history] beim Verlassen des Duplikate-Chips.
 */
@Composable
fun DuplicatesList(data: SaleData?, onOpenCard: (String) -> Unit, history: HashMap<String, List<String>>, listState: LazyListState, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    var error by remember { mutableStateOf<String?>(null) }
    val (busy, mutate) = rememberMutation { error = it }
    var confirmAll by remember { mutableStateOf(false) }

    if (data == null) {
        // Restrunde 4: scrollbar, damit Herunterziehen (RefreshableBox in VerkaufenScreen) auch hier nachlaedt.
        Box(modifier.fillMaxWidth().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) { Text(Duplicates.LOADING, color = Muted) }
        return
    }
    val summary = remember(data) { Duplicates.summary(data.duplicates) }

    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(Duplicates.headerText(summary), color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        }
        TextButton(onClick = { confirmAll = true }, enabled = !busy && data.duplicates.isNotEmpty(), contentPadding = PaddingValues(0.dp)) {
            Text("Alle Vorschläge auf die Verkaufsliste")
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
        if (data.duplicates.isEmpty()) {
            // Restrunde 4: scrollbarer Leerzustand, damit Herunterziehen nachlaedt.
            Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                Text("Keine Duplikate.", color = Muted, modifier = Modifier.padding(top = 16.dp))
            }
        } else {
            LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 88.dp)) {
                items(data.duplicates, key = { it.mainId }) { e ->
                    val first = data.byId[e.copyIds.first()]
                    SpaceCard(Modifier.fillMaxWidth()) {
                        Row(Modifier.clickable { first?.let { onOpenCard(it.copy.cardId) } }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            AsyncImage(model = first?.card?.imageUrl, contentDescription = first?.card?.name,
                                modifier = Modifier.width(40.dp).height(58.dp).clip(RoundedCornerShape(6.dp)))
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(first?.card?.name ?: e.mainId, color = OnSurface, fontWeight = FontWeight.Bold, maxLines = 2)
                                Text(Duplicates.rowCountText(e), color = Muted, style = MaterialTheme.typography.bodySmall)
                                Duplicates.proposalTexts(e, data.byId).forEach {
                                    Text(it, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                }
                            }
                            Switch(
                                checked = Duplicates.toggleIsOn(e, data.forSaleIds), enabled = !busy,
                                onCheckedChange = {
                                    mutate {
                                        val d = freshSaleData(ctx) ?: return@mutate
                                        val fresh = d.duplicates.firstOrNull { it.mainId == e.mainId } ?: return@mutate
                                        val on = !Duplicates.toggleIsOn(fresh, d.forSaleIds)
                                        if (on) history[fresh.mainId] = Duplicates.premarkedIds(fresh, d.forSaleIds)
                                        val t = Duplicates.toggleTargets(fresh, on, if (on) null else history[fresh.mainId])
                                        if (!on) history.remove(fresh.mainId)
                                        if (t.ids.isNotEmpty()) CollectionRepository.setForSale(t.ids, t.value)
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            title = { Text("Auf die Verkaufsliste") },
            text = { Text(Duplicates.confirmAllText(summary)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmAll = false
                    mutate {
                        val d = freshSaleData(ctx) ?: return@mutate
                        val ids = Duplicates.allProposalIds(d.duplicates, d.forSaleIds)
                        if (ids.isNotEmpty()) CollectionRepository.setForSale(ids, true)
                    }
                }) { Text("Markieren") }
            },
            dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Abbrechen") } },
        )
    }
}

/**
 * Spec H1 §5.2: Zum Verkauf am Handy -- Printings mit markierten Exemplaren, je Exemplar "Zurück in die Sammlung". Kein Export.
 * [listState] wird vom Aufrufer gehalten, damit die Scrollposition ein Karten-Detail-Öffnen/-Schließen überlebt (Spec H1 M2).
 */
@Composable
fun ForSaleList(data: SaleData?, onOpenCard: (String) -> Unit, listState: LazyListState, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    var error by remember { mutableStateOf<String?>(null) }
    val (busy, mutate) = rememberMutation { error = it }
    val store by CollectionStore.state.collectAsState()
    val containers = (store as? StoreState.Ready)?.containers ?: emptyList()
    // Spec H2 §5.1/§5.4: anhaken -> "Verkauft buchen"; danach "Rückgängig" = sofortiges Storno.
    var picked by remember { mutableStateOf(setOf<String>()) }
    var selling by remember { mutableStateOf<List<String>?>(null) }
    var undo by remember { mutableStateOf<Pair<String, Int>?>(null) }
    val sales by SideStores.sales.state.collectAsState()
    // Plan-Abweichung 4: Storno gesperrt, solange die Verkaeufe nicht geladen sind oder das letzte Laden scheiterte.
    val salesOffline = sales.value == null || sales.error != null
    // Spec H3a §5.1/§6: dieselben Häkchen -> "Angebot erstellen"; je Exemplar das Kanal-Kürzel aktiver Angebote.
    var listingFor by remember { mutableStateOf<List<String>?>(null) }
    val listingsState by SideStores.listings.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.listings.ensureLoaded() }
    val byCopy = remember(listingsState.value) { listingsState.value?.byCopy() ?: emptyMap() }

    // VOR dem fruehen Return: ein kurzes Flackern des Speichers (data == null) waehrend des Buchens darf
    // das Sheet nicht aus der Komposition werfen (sein Scope wuerde die laufende Buchung abbrechen).
    selling?.let {
        SaleSheet(it, onDismiss = { selling = null }, onBooked = { id, n -> undo = id to n; selling = null; picked = emptySet() })
    }
    listingFor?.let { ListingSheet(it, onDismiss = { listingFor = null }, onSaved = { listingFor = null; picked = emptySet() }) }

    if (data == null) {
        // Restrunde 4: scrollbar, damit Herunterziehen (RefreshableBox in VerkaufenScreen) auch hier nachlaedt.
        Box(modifier.fillMaxWidth().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) { Text(Duplicates.LOADING, color = Muted) }
        return
    }
    val summary = remember(data) { Duplicates.forSaleSummary(data.sale) }
    val groups = remember(data) { Duplicates.forSaleGroups(data.sale) }
    val livePicked = picked.filter { data.byId.containsKey(it) }
    // Spec H2 §9: Vorschlag je Exemplar, einmal je Speicherstand berechnet (nicht bei jeder Neuzeichnung).
    val suggestions = remember(data) {
        data.sale.associate { s -> s.copy.copyId to Prefs.saleSuggestion(ctx, s.card?.let { SalesMath.marketValueCents(it, s.copy) }) }
    }

    Column(modifier) {
        Text(Duplicates.forSaleHeaderText(summary), color = OnSurface, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { selling = livePicked }, enabled = !busy && livePicked.isNotEmpty()) {
                Text("Verkauft buchen (${livePicked.size})")
            }
            OutlinedButton(onClick = { listingFor = livePicked }, enabled = !busy && livePicked.isNotEmpty()) {
                Text("Angebot erstellen (${livePicked.size})")
            }
        }
        undo?.let { (saleId, n) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("$n ${if (n == 1) "Karte" else "Karten"} als verkauft gebucht", color = OnSurface,
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    mutate {
                        SalesRepository.cancel(saleId)
                        SideStores.sales.refreshAndWait()
                        undo = null
                    }
                }, enabled = !busy && !salesOffline) { Text("Rückgängig") }
            }
            if (salesOffline) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Keine Verbindung – Verkäufe nicht geladen", color = ErrorColor, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f))
                    TextButton(onClick = { SideStores.sales.refresh() }, enabled = !sales.loading) { Text("Erneut versuchen") }
                }
            }
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
        if (groups.isEmpty()) {
            // Restrunde 4: scrollbarer Leerzustand, damit Herunterziehen nachlaedt.
            Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                Text("Keine Exemplare zum Verkauf.", color = Muted, modifier = Modifier.padding(top = 16.dp))
            }
        } else {
            LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(top = 8.dp, bottom = 88.dp)) {
                items(groups, key = { "${it.cardId}|${it.setCode}|${it.language}|${it.rarity}" }) { g ->
                    SpaceCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(10.dp)) {
                            Column(Modifier.fillMaxWidth().clickable { onOpenCard(g.cardId) }) {
                                Text(g.name ?: g.cardId, color = OnSurface, fontWeight = FontWeight.Bold, maxLines = 2)
                                Text("${g.setCode} · ${g.rarity} · ${g.language}", color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                            }
                            g.copyIds.forEach { id ->
                                val s = data.byId[id] ?: return@forEach
                                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(checked = id in picked, onCheckedChange = { picked = if (it) picked + id else picked - id }, enabled = !busy)
                                    Column(Modifier.weight(1f)) {
                                        Text("${s.copy.condition} · ${Valuation.EDITION_LABELS[s.copy.edition] ?: s.copy.edition}", color = OnSurface,
                                            fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                                        Text(CopyLocation.format(s.copy, containers.find { it.containerId == s.copy.containerId }), color = Muted,
                                            fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                        ListingText.copyBadges(byCopy[id] ?: emptyList()).joinToString(" ").takeIf { it.isNotEmpty() }?.let {
                                            Text(it, color = Primary, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                                        }
                                        Text(suggestions[id]?.let { "Vorschlag ${SalesMath.euroCentsText(it)}" } ?: "–", color = Muted,
                                            fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                                    }
                                    Text(Duplicates.copyValueText(s), color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                                    Spacer(Modifier.width(6.dp))
                                    TextButton(onClick = { mutate { CollectionRepository.setForSale(listOf(id), false) } }, enabled = !busy) {
                                        Text("Zurück in die Sammlung", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
