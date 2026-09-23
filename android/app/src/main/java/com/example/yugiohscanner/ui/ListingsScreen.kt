package com.example.yugiohscanner.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CacheState
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.EbayRepository
import com.example.yugiohscanner.cloud.ListingRow
import com.example.yugiohscanner.cloud.ListingsData
import com.example.yugiohscanner.cloud.ListingsRepository
import com.example.yugiohscanner.cloud.SalesData
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.EbayMarks
import com.example.yugiohscanner.ml.ListingOverview
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.PhotoScale
import com.example.yugiohscanner.ml.SaleInput
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ml.SalesOverview
import com.example.yugiohscanner.ml.openWebLink
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Warn
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

private const val ENDED_NOTICE = "Angebot beendet – keine Karte mehr übrig."
private const val OFFLINE = "Keine Verbindung – Angebote nicht geladen"

/** Übersicht (Zeilen) und lebende Positionen zu einem Stand; Marktwert/Vorschlag aus dem Speicher, Storno aus den Verkäufen. */
private class Overview(val rows: List<ListingOverview.Row>, val items: List<ListingText.Item>)

private fun overviewOf(ctx: Context, data: ListingsData, ready: StoreState.Ready, sales: SalesData?, today: String): Overview {
    val heads = data.heads()
    val items = data.lineItems()
    val ids = items.map { it.copyId }.toSet()
    val copies = ready.copies.filter { !it.deleted && it.copyId in ids }.associateBy { it.copyId }
    val cards = ready.cards.associateBy { it.printingKey() }
    val values = HashMap<String, Long>()
    for ((id, c) in copies) cards[c.printingKey()]?.let { values[id] = SalesMath.marketValueCents(it, c) }
    // Ungeladene Verkäufe: keine Storno-Marke (null), nie eine falsche.
    val saleStatus = sales?.sales?.associate { it.saleId to it.status }
    val marks = ListingText.listingMarks(heads, items, { it in copies }, { saleStatus?.get(it) },
        { id -> values[id]?.let { Prefs.saleSuggestion(ctx, it) } })
    return Overview(ListingOverview.rows(heads, items, { values[it] }, marks, today), items)
}

@Composable
private fun MarksRow(marks: ListingText.Marks?) {
    val m = marks ?: return
    val list = buildList {
        if (m.alsoOn.isNotEmpty()) add("auch auf ${m.alsoOn.joinToString(", ")}" to Warn)
        if (m.missing) add("Karte fehlt" to ErrorColor)
        if (m.underSuggestion) add("Preis unter Vorschlag" to Warn)
        if (m.saleCancelled) add("Verkauf storniert" to ErrorColor)
    }
    if (list.isEmpty()) return
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        list.forEach { (t, c) -> MarkChip(t, c) }
    }
}

@Composable
private fun MarkChip(text: String, color: Color) {
    Text(text, color = color, style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = 0.15f)).padding(horizontal = 6.dp, vertical = 2.dp))
}

/** Spec H3b1 §4.3 -- Stand von SideStores.ebayStatus als EbayMarks.StatusState (Loading/None/Known). */
private fun ebayState(s: CacheState<List<Pair<EbayMarks.Status, EbayRepository.RunInfo>>>): EbayMarks.StatusState = when {
    s.value == null && s.error == null -> EbayMarks.StatusState.Loading
    s.value?.firstOrNull() == null -> EbayMarks.StatusState.None
    else -> EbayMarks.StatusState.Known(s.value!!.first().first)
}

/** Spec H3b1 §4.3/§5.4 -- eBay-Marke unter MarksRow: Farbe je Art, „Erneut versuchen“ bei mark.retry. */
@Composable
private fun EbayMarkRow(mark: EbayMarks.Mark?, onRetry: (() -> Unit)?) {
    if (mark == null) return
    val color = when (mark.kind) {
        "online" -> Good
        "fehler" -> ErrorColor
        else -> Warn
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        MarkChip(mark.text, color)
        if (mark.retry && onRetry != null) {
            TextButton(onClick = onRetry, contentPadding = PaddingValues(horizontal = 6.dp)) { Text("Erneut versuchen") }
        }
    }
}

/**
 * Spec H3a §6 -- Sammlung › Angebote am Handy (Gegenstück zu desktop/src/components/ListingsList.jsx). Enthält die
 * EINZIGEN Aufrufstellen von SaleSheet/ListingSheet/Detail dieses Bereichs, vor jedem frühen return (Muster
 * SaleLists.kt#ForSaleList), damit ein Flackern des Stands ein laufendes Buchen/Speichern nie abbricht.
 */
@Composable
fun ListingsSection(onOpenCard: (String) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var editRequested by remember { mutableStateOf(false) }
    var selling by remember { mutableStateOf<Pair<List<String>, ListingSale>?>(null) }
    var relist by remember { mutableStateOf<Pair<List<String>, ListingPrefill>?>(null) }

    selling?.let { (ids, l) ->
        SaleSheet(ids, initialGrossCents = l.priceCents, listing = l, onAdjustListing = { openId = l.listingId; editRequested = true },
            onDismiss = { selling = null }, onBooked = { _, _ -> selling = null })
    }
    relist?.let { (ids, p) -> ListingSheet(ids, prefill = p, onDismiss = { relist = null }, onSaved = { relist = null }) }
    openId?.let { id ->
        ListingDetailSheet(id, startEditing = editRequested, onDismiss = { openId = null; editRequested = false },
            onOpenCard = { cardId -> openId = null; editRequested = false; onOpenCard(cardId) },
            onSell = { ids, l -> openId = null; editRequested = false; selling = ids to l },
            onRelist = { ids, p -> openId = null; editRequested = false; relist = ids to p })
    }

    val state by SideStores.listings.state.collectAsState()
    // Frischer Stand beim Öffnen (H2-Fix I2), nicht nur ensureLoaded.
    LaunchedEffect(Unit) { SideStores.listings.refresh() }
    val salesState by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val ebayStatusState by SideStores.ebayStatus.state.collectAsState()
    val ebayRowsState by SideStores.ebayRows.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.ebayStatus.refresh(); SideStores.ebayRows.refresh() }
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    var status by rememberSaveable { mutableStateOf("aktiv") }
    var channelId by rememberSaveable { mutableStateOf<String?>(null) }
    var channelOpen by remember { mutableStateOf(false) }
    val today = remember { LocalDate.now().toString() }

    val data = state.value
    if (data == null || ready == null) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (data == null && state.error != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(OFFLINE, color = ErrorColor, style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { SideStores.listings.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
                }
            } else Text(Duplicates.LOADING, color = Muted)
        }
        return
    }
    val salesData = salesState.value
    val overview = remember(data, ready, salesData, today) { overviewOf(ctx, data, ready, salesData, today) }
    val rows = remember(overview, status, channelId) { ListingOverview.filter(overview.rows, status, channelId) }
    val channels = remember(overview) { ListingOverview.channels(overview.rows) }

    Column(modifier) {
        if (state.error != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(OFFLINE, color = ErrorColor, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { SideStores.listings.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            ListingOverview.STATUSES.forEach { (id, label) -> FilterChip(status == id, { status = id }, label = { Text(label) }) }
            Box {
                FilterChip(channelId != null, { channelOpen = true },
                    label = { Text(channels.find { it.first == channelId }?.second ?: "Alle Kanäle") },
                    trailingIcon = { Icon(Icons.Default.ArrowDropDown, null) })
                DropdownMenu(expanded = channelOpen, onDismissRequest = { channelOpen = false }) {
                    DropdownMenuItem(text = { Text("Alle Kanäle") }, onClick = { channelId = null; channelOpen = false })
                    channels.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { channelId = id; channelOpen = false }) }
                }
            }
        }
        if (status == "aktiv" || status == ListingOverview.ALL) {
            Spacer(Modifier.height(8.dp))
            Text(ListingText.summaryText(ListingText.listingsSummary(rows.map { it.head }, overview.items)),
                color = OnSurface, style = MaterialTheme.typography.bodyMedium)
        }
        if (rows.isEmpty()) {
            Text("Keine Angebote.", color = Muted, modifier = Modifier.padding(top = 16.dp))
        } else {
            val ebayStat = ebayState(ebayStatusState)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(top = 8.dp, bottom = 88.dp)) {
                items(rows, key = { it.head.listingId }) { r ->
                    val mark = EbayMarks.mark(
                        EbayMarks.ListingHead(r.head.channelId, r.head.status, r.head.deleted),
                        ebayRowsState.value?.get(r.head.listingId)?.row(), ebayStat,
                    )
                    ListingRowView(r, mark) { openId = r.head.listingId }
                }
            }
        }
    }
}

@Composable
private fun ListingRowView(r: ListingOverview.Row, ebayMark: EbayMarks.Mark?, onOpen: () -> Unit) {
    val active = r.head.status == "aktiv"
    val color = if (active) OnSurface else Muted
    val price = r.head.priceCents
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().clickable { onOpen() }.padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.head.channelName, color = color, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(SalesMath.euroCentsText(price), color = if (active) OnSurface else Muted, fontFamily = MonoFontFamily)
            }
            Text(r.title, color = color, fontWeight = FontWeight.Bold, maxLines = 2)
            Text(
                "${r.cards} ${if (r.cards == 1) "Karte" else "Karten"} · ${ListingText.sinceText(r.days)}${if (active) "" else " · ${r.head.status}"}",
                color = Muted, style = MaterialTheme.typography.bodySmall,
            )
            if (active) {
                Text("${SalesMath.diffText(price, r.marketCents)} gegenüber Marktwert", color = if (price >= r.marketCents) Good else ErrorColor,
                    fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
            }
            MarksRow(r.marks)
            EbayMarkRow(ebayMark, onRetry = null)
        }
    }
}

private fun centsOf(raw: String): Long? = SalesMath.toCents(SaleInput.parseMoney(raw))

/**
 * Spec H3a §6/§7/§8 -- ein Angebot am Handy (Gegenstück zu ListingDetail.jsx). Jede Schreibaktion läuft durch das
 * InFlight-Gatter und lädt darin zuerst frisch; ist das Angebot nicht mehr aktiv, erscheint CHANGED ohne Schreibaufruf.
 * ListingsRepository.update ersetzt alle editierbaren Felder -- es wird immer der volle Satz geschickt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ListingDetailSheet(
    listingId: String, startEditing: Boolean, onDismiss: () -> Unit, onOpenCard: (String) -> Unit,
    onSell: (List<String>, ListingSale) -> Unit, onRelist: (List<String>, ListingPrefill) -> Unit,
) {
    val ctx = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    // Abschluss-Fix C2: auch während eines Foto-Uploads/-Umsortierens (ListingPhotos) nicht schließen.
    var photosBusy by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || (!busy && !photosBusy) })

    val state by SideStores.listings.state.collectAsState()
    LaunchedEffect(listingId) { SideStores.listings.refresh() }
    val salesState by SideStores.sales.state.collectAsState()
    val ebayStatusState by SideStores.ebayStatus.state.collectAsState()
    val ebayRowsState by SideStores.ebayRows.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.ebayStatus.refresh(); SideStores.ebayRows.refresh() }
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val offline = state.value == null || state.error != null
    val today = remember { LocalDate.now().toString() }

    val data = state.value
    val listing = data?.listings?.find { it.listingId == listingId }
    val items = remember(data, listingId) { data?.liveItemsOf(listingId)?.sortedBy { it.copyId } ?: emptyList() }
    val salesData = salesState.value
    val overviewRow = remember(data, ready, salesData, today) {
        if (data == null || ready == null) null else overviewOf(ctx, data, ready, salesData, today).rows.find { it.head.listingId == listingId }
    }
    val copies = remember(ready) { ready?.copies?.filter { !it.deleted }?.associateBy { it.copyId } ?: emptyMap() }
    val cards = remember(ready) { ready?.cards?.associateBy { it.printingKey() } ?: emptyMap() }
    val sellable = items.filter { it.copyId in copies }
    val ebayMark = remember(listing, ebayRowsState, ebayStatusState) {
        listing?.let { l ->
            EbayMarks.mark(
                EbayMarks.ListingHead(l.channelId, l.status, l.deleted),
                ebayRowsState.value?.get(l.listingId)?.row(), ebayState(ebayStatusState),
            )
        }
    }

    var editing by remember { mutableStateOf(false) }
    var fPrice by remember { mutableStateOf("") }
    var fTitle by remember { mutableStateOf("") }
    var fDescription by remember { mutableStateOf("") }
    var fLink by remember { mutableStateOf("") }
    var fNote by remember { mutableStateOf("") }
    var fRemove by remember { mutableStateOf(setOf<String>()) }
    var linkInput by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var confirmEnd by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }

    fun startEdit(l: ListingRow) {
        error = null; notice = null
        fPrice = SaleInput.centsInput(l.priceCents); fTitle = l.title ?: ""; fDescription = l.description ?: ""
        fLink = l.externalUrl ?: ""; fNote = l.note ?: ""; fRemove = emptySet()
        editing = true
    }
    // „Preis für die übrigen Karten anpassen?“ -> Bearbeiten sofort offen (einmal, sobald das Angebot da ist).
    var autoEdit by remember { mutableStateOf(startEditing) }
    LaunchedEffect(listing, autoEdit) {
        val l = listing ?: return@LaunchedEffect
        if (autoEdit) { autoEdit = false; if (l.status == "aktiv") startEdit(l) }
    }

    /** Frisch laden, dann [block] mit dem frischen Stand; ohne aktives Angebot ([requireActive]) nur CHANGED. */
    fun write(requireActive: Boolean = true, block: suspend (fresh: ListingsData, l: ListingRow) -> Unit) {
        if (!inFlight.tryStart()) return
        busy = true; error = null; notice = null
        scope.launch {
            try {
                SideStores.listings.refreshAndWait()
                val ls = SideStores.listings.state.value
                val fresh = ls.value
                if (fresh == null || ls.error != null) throw IllegalStateException("$OFFLINE.")
                val l = fresh.listings.find { it.listingId == listingId && !it.deleted && (!requireActive || it.status == "aktiv") }
                if (l == null) { error = ListingsRepository.CHANGED; return@launch }
                block(fresh, l)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Speichern fehlgeschlagen." }
            finally { inFlight.finish(); busy = false }
        }
    }
    suspend fun afterWrite(ended: Boolean) {
        SideStores.listings.refreshAndWait()
        if (ended) notice = ENDED_NOTICE
    }
    fun liveCopyIdsFresh(fresh: ListingsData): List<String> {
        val r = CollectionStore.state.value as? StoreState.Ready ?: throw IllegalStateException("Sammlung ist nicht geladen.")
        val live = r.copies.filter { !it.deleted }.map { it.copyId }.toSet()
        return ListingOverview.liveCopyIds(fresh.lineItems(), listingId) { it in live }
    }

    ModalBottomSheet(onDismissRequest = { if (!busy && !photosBusy) onDismiss() }, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Angebot", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
            if (offline) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val loadingOnly = state.value == null && state.error == null
                    Text(if (loadingOnly) "Angebote werden geladen…" else OFFLINE, color = if (loadingOnly) Muted else ErrorColor,
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = { SideStores.listings.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
                }
            }
            if (listing == null) {
                Text(if (data == null) Duplicates.LOADING else "Angebot nicht mehr vorhanden.", color = Muted)
                return@Column
            }
            val active = listing.status == "aktiv" && !listing.deleted
            val cm = listing.channelId == "cardmarket"
            val canWrite = active && !offline && !busy

            if (!editing) {
                Text("${listing.channelName} · ${listing.status} · ${SalesOverview.dateText(listing.listedOn)} · " +
                    ListingText.sinceText(ListingText.daysSince(listing.listedOn, today)),
                    color = if (active) OnSurface else Muted, style = MaterialTheme.typography.bodySmall)
                Text(overviewRow?.title ?: ListingText.rowTitle(listing.head(), items.map { it.item() }), color = OnSurface, fontWeight = FontWeight.Bold)
                Text(SalesMath.euroCentsText(listing.priceCents), color = OnSurface, fontFamily = MonoFontFamily)
                MarksRow(overviewRow?.marks)
                EbayMarkRow(ebayMark, onRetry = {
                    write(requireActive = true) { _, l ->
                        val r = EbayRepository.syncNow(l.listingId)
                        // Abschluss-Fix C6: leere Fehlermeldung nie als leere Zeile zeigen.
                        if (!r.optBoolean("ok")) error = r.optString("error").ifEmpty { "eBay-Abgleich fehlgeschlagen." }
                        else notice = if (r.optBoolean("busy")) "Abgleich läuft schon – gleich noch einmal versuchen." else "eBay-Abgleich angestoßen."
                    }
                })
                if (ebayMark?.url != null) {
                    OutlinedButton(onClick = { if (!openWebLink(ctx, ebayMark.url)) error = "Link konnte nicht geöffnet werden." }) {
                        Text("Auf eBay ansehen")
                    }
                }
                listing.note?.let { Text(it, color = Muted, style = MaterialTheme.typography.bodySmall) }
            } else {
                OutlinedTextField(value = fPrice, onValueChange = { fPrice = it }, label = { Text("Preis (€)") }, singleLine = true,
                    isError = !SaleInput.moneyOk(fPrice, required = true),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                if (!cm) {
                    OutlinedTextField(value = fTitle, onValueChange = { fTitle = it }, label = { Text("Titel") },
                        supportingText = { Text("${fTitle.length}/${ListingText.TITLE_MAX}", color = if (fTitle.length > ListingText.TITLE_MAX) ErrorColor else Muted) },
                        isError = fTitle.length > ListingText.TITLE_MAX, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = fDescription, onValueChange = { fDescription = it }, label = { Text("Beschreibung") },
                        minLines = 4, modifier = Modifier.fillMaxWidth())
                }
                val linkError = ListingsRepository.checkEdit(null, fLink)
                OutlinedTextField(value = fLink, onValueChange = { fLink = it }, label = { Text("Link der Anzeige") }, singleLine = true,
                    isError = linkError != null, supportingText = linkError?.let { { Text(it, color = ErrorColor) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = fNote, onValueChange = { fNote = it }, label = { Text("Notiz") }, modifier = Modifier.fillMaxWidth())
            }

            if (items.isEmpty()) Text("Keine Karten.", color = Muted, style = MaterialTheme.typography.bodySmall)
            items.forEach { it0 ->
                val copy = copies[it0.copyId]
                val card = copy?.let { cards[it.printingKey()] }
                val market = if (copy != null && card != null) SalesMath.marketValueCents(card, copy) else null
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f).clickable { onOpenCard(it0.cardId) }, verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(model = it0.imageUrl, contentDescription = it0.name,
                            modifier = Modifier.width(40.dp).height(58.dp).clip(RoundedCornerShape(6.dp)))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(it0.name ?: it0.cardId, color = OnSurface, maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                            Text("${it0.setCode} · ${it0.rarity} · ${it0.language}", color = Muted, fontFamily = MonoFontFamily,
                                style = MaterialTheme.typography.labelSmall)
                            Text("${it0.condition} · ${Valuation.EDITION_LABELS[it0.edition] ?: it0.edition}", color = Muted,
                                fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                            // Wie ListingDetail.jsx: verkaufte Exemplare verlassen den Speicher -- bei verkauften/beendeten
                            // Angeboten weder „Marktwert –“ noch „Karte fehlt“.
                            if (active || market != null) {
                                Text("Marktwert ${market?.let { SalesMath.euroCentsText(it) } ?: "–"}", color = Muted,
                                    fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                            }
                            if (copy == null && active) MarkChip("Karte fehlt", ErrorColor)
                        }
                    }
                    if (editing) {
                        Checkbox(checked = it0.copyId in fRemove, enabled = !busy,
                            onCheckedChange = { on -> fRemove = if (on) fRemove + it0.copyId else fRemove - it0.copyId })
                        Text("herausnehmen", color = Muted, style = MaterialTheme.typography.labelSmall)
                    } else if (copy == null && active) {
                        // Spec §8 „Karte fehlt“: Herausnehmen; ein leeres Angebot endet.
                        TextButton(enabled = canWrite, onClick = {
                            write { fresh, l -> afterWrite(ListingsRepository.removeItems(fresh, l.listingId, listOf(it0.copyId))) }
                        }) { Text("Herausnehmen") }
                    }
                }
            }

            ListingPhotos(listingId, enabled = active && !offline, onBusyChange = { photosBusy = it })

            if (!editing) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!cm) {
                        OutlinedButton(onClick = { listing.title?.let { clipboard.setText(AnnotatedString(it)); notice = "Kopiert." } },
                            enabled = !listing.title.isNullOrEmpty()) { Text("Titel kopieren") }
                        OutlinedButton(onClick = { listing.description?.let { clipboard.setText(AnnotatedString(it)); notice = "Kopiert." } },
                            enabled = !listing.description.isNullOrEmpty()) { Text("Beschreibung kopieren") }
                    }
                    OutlinedButton(
                        onClick = {
                            sharing = true; notice = null
                            val title = overviewRow?.title ?: "Angebot"
                            val ownUrls = EbayRepository.photosOf(SideStores.listingPhotos.state.value.value.orEmpty(), listingId)
                                .map { PhotoScale.publicUrl(SupabaseCloud.base(), it.path) }
                            scope.launch {
                                try {
                                    val (s, t) = ListingShare.shareImages(ctx, title, ownUrls + ListingText.imageUrls(items.map { it.item() }))
                                    notice = ListingText.imagesText(s, t)
                                } catch (e: CancellationException) { throw e }
                                catch (e: Exception) { notice = "Teilen fehlgeschlagen: ${e.message ?: "Unbekannter Fehler"}" }
                                finally { sharing = false }
                            }
                        },
                        enabled = !sharing && items.isNotEmpty(),
                    ) { Text(if (sharing) "Bilder werden geladen…" else "Bilder") }
                    listing.externalUrl?.let { url ->
                        OutlinedButton(onClick = {
                            if (!openWebLink(ctx, url)) error = "Link konnte nicht geöffnet werden."
                        }) {
                            Text("Anzeige öffnen")
                        }
                    }
                }
                Text("Käufer erwarten oft eigene Fotos.", color = Muted, style = MaterialTheme.typography.bodySmall)
                if (listing.externalUrl == null && active) {
                    val linkError = ListingsRepository.checkEdit(null, linkInput)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(value = linkInput, onValueChange = { linkInput = it }, label = { Text("Link der Anzeige") },
                            singleLine = true, isError = linkError != null, supportingText = linkError?.let { { Text(it, color = ErrorColor) } },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        TextButton(enabled = canWrite && linkInput.isNotBlank() && linkError == null, onClick = {
                            // Voller Satz (update ersetzt alle Felder): alles aus dem frischen Stand, nur der Link neu.
                            write { fresh, l ->
                                val ended = ListingsRepository.update(fresh, l.listingId, l.priceCents, l.title, l.description, linkInput, l.note, emptyList())
                                linkInput = ""
                                afterWrite(ended)
                            }
                        }) { Text("Link speichern") }
                    }
                }
            }

            if (active && !editing && sellable.isEmpty() && ready != null) {
                Text("Keine verkaufbare Karte – bitte herausnehmen oder beenden.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }
            notice?.let { Text(it, color = Good, style = MaterialTheme.typography.bodySmall) }
            error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }

            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                if (active && editing) {
                    TextButton(onClick = { editing = false; error = null }, enabled = !busy) { Text("Abbrechen") }
                    Button(
                        enabled = canWrite && SaleInput.moneyOk(fPrice, required = true) && ListingsRepository.checkEdit(null, fLink) == null,
                        onClick = {
                            val cents = centsOf(fPrice) ?: return@Button
                            // Voller Satz aus dem Formular (update ersetzt alle editierbaren Felder).
                            val title = fTitle; val description = fDescription; val link = fLink; val note = fNote; val remove = fRemove.toList()
                            write { fresh, l ->
                                val ended = ListingsRepository.update(fresh, l.listingId, cents, title, description, link, note, remove)
                                editing = false
                                afterWrite(ended)
                            }
                        },
                    ) { Text(if (busy) "Wird gespeichert…" else "Speichern") }
                }
                if (active && !editing) {
                    OutlinedButton(onClick = { confirmEnd = true }, enabled = canWrite) { Text("Beenden", color = ErrorColor) }
                    OutlinedButton(onClick = { startEdit(listing) }, enabled = canWrite) { Text("Bearbeiten") }
                    Button(enabled = canWrite && sellable.isNotEmpty(), onClick = {
                        write { fresh, l ->
                            val ids = liveCopyIdsFresh(fresh)
                            if (ids.isEmpty()) { error = "Keine verkaufbare Karte – bitte herausnehmen oder beenden."; return@write }
                            onSell(ids, ListingSale(l.listingId, l.channelId, l.priceCents))
                        }
                    }) { Text("Verkauft") }
                }
                if (!active) {
                    Button(enabled = !busy && !offline, onClick = {
                        write(requireActive = false) { fresh, l ->
                            val ids = liveCopyIdsFresh(fresh)
                            if (ids.isEmpty()) { notice = "Keine Karte mehr verfügbar."; return@write }
                            onRelist(ids, ListingPrefill(l.channelId, l.title, l.description, l.priceCents))
                        }
                    }) { Text("Erneut anbieten") }
                }
            }
        }
    }

    if (confirmEnd) {
        AlertDialog(
            onDismissRequest = { confirmEnd = false },
            title = { Text("Angebot beenden?") },
            text = { Text("Die Karten bleiben auf der Verkaufsliste.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmEnd = false
                    write { _, l -> ListingsRepository.end(l.listingId); afterWrite(false) }
                }) { Text("Beenden") }
            },
            dismissButton = { TextButton(onClick = { confirmEnd = false }) { Text("Abbrechen") } },
        )
    }
}
