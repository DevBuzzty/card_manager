package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ListingSavedPartially
import com.example.yugiohscanner.cloud.ListingsRepository
import com.example.yugiohscanner.cloud.NewListing
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.EbayMarks
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SaleInput
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ml.SaleFlow
import com.example.yugiohscanner.ml.openWebLink
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Warn
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

/** Vorbelegung (Spec H3a §7.4 „Erneut anbieten“): Kanal, Titel, Beschreibung, Preis. */
data class ListingPrefill(val channelId: String, val title: String?, val description: String?, val priceCents: Long?)

/**
 * Positionen (Momentaufnahme) aus einem Speicherstand; null, sobald ein Exemplar oder sein Druck fehlt.
 * Name = deutscher Katalogname, Rückfall cards.name; nameEn = englischer Katalogname, Rückfall cards.name (Abweichung 3).
 * Immer mit dem FRISCHEN Stand aufrufen, wenn gespeichert wird.
 */
private fun listingItems(ready: StoreState.Ready, copyIds: List<String>, names: Map<String, Pair<String?, String?>>): List<ListingText.Item>? {
    val copies = ready.copies.associateBy { it.copyId }
    val cards = ready.cards.associateBy { it.printingKey() }
    return copyIds.sorted().map { id ->
        val copy = copies[id] ?: return null
        val card = cards[copy.printingKey()] ?: return null
        val (de, en) = names[copy.cardId] ?: (null to null)
        ListingText.Item(copy.copyId, copy.cardId, de ?: card.name, copy.setCode, copy.language, copy.rarity, copy.edition, copy.condition,
            nameEn = en ?: card.name, imageUrl = card.imageUrl)
    }
}

/** Preisvorschlag je Exemplar (copyId -> Cent oder null) nach H2 §9. */
private fun listingSuggestions(ctx: android.content.Context, ready: StoreState.Ready, copyIds: List<String>): Map<String, Long?> {
    val copies = ready.copies.associateBy { it.copyId }
    val cards = ready.cards.associateBy { it.printingKey() }
    return copyIds.associateWith { id ->
        val copy = copies[id] ?: return@associateWith null
        val card = cards[copy.printingKey()] ?: return@associateWith null
        Prefs.saleSuggestion(ctx, SalesMath.marketValueCents(card, copy))
    }
}

private fun groupKey(g: ListingText.Group) = g.copyIds.joinToString(",")
private fun centsOf(raw: String): Long? = SalesMath.toCents(SaleInput.parseMoney(raw))

/**
 * Spec H3a §5.2–§5.7/§8 -- Angebot erstellen am Handy (Gegenstück zum PC-Dialog). Gesperrt, solange Angebote oder
 * Verkäufe (Kanäle) nicht geladen sind oder das letzte Laden scheiterte (wie H2-Abweichung 4). Cardmarket teilt die
 * Auswahl vor dem Speichern in ein Angebot je Gruppe (§5.4). Gespeichert wird innerhalb des InFlight-Gatters aus dem
 * frischen Speicherstand. Aufrufer setzen das Sheet genau einmal außerhalb von Verzweigungen (vor jedem frühen return).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListingSheet(copyIds: List<String>, prefill: ListingPrefill? = null, onDismiss: () -> Unit, onSaved: (List<String>) -> Unit) {
    val busyState = remember { mutableStateOf(false) }
    // Solange gespeichert wird, lässt sich das Sheet auch per Wischen nicht schließen.
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !busyState.value })
    ModalBottomSheet(onDismissRequest = { if (!busyState.value) onDismiss() }, sheetState = sheetState) {
        ListingSheetContent(copyIds, prefill, onBack = onDismiss, onSaved = onSaved, busyState = busyState)
    }
}

/**
 * Spec I §5.1/§5.2 -- der Inhalt von [ListingSheet] ohne eigenes Blatt: im Exemplar-Blatt eingebettet ([embedded],
 * kein Fensterstapel, kein eigenes Scrollen -- das umgebende Blatt scrollt).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ListingSheetContent(
    copyIds: List<String>, prefill: ListingPrefill? = null, onBack: () -> Unit, onSaved: (List<String>) -> Unit,
    busyState: MutableState<Boolean> = remember { mutableStateOf(false) }, embedded: Boolean = false,
) {
    val ctx = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by busyState

    val listingsState by SideStores.listings.state.collectAsState()
    val salesState by SideStores.sales.state.collectAsState()
    val ebayStatusState by SideStores.ebayStatus.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.listings.ensureLoaded(); SideStores.sales.ensureLoaded(); SideStores.ebayStatus.ensureLoaded() }
    val offline = listingsState.value == null || listingsState.error != null || salesState.value == null || salesState.error != null
    val loadingSide = (listingsState.value == null && listingsState.error == null) || (salesState.value == null && salesState.error == null)

    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    // Katalognamen (Abweichung 3): SQLite-Lesen abseits des Hauptthreads, einmal je Passcode-Menge.
    val cardIds = remember(ready?.copies, copyIds) {
        ready?.copies?.filter { it.copyId in copyIds }?.map { it.cardId }?.distinct()?.sorted()
    }
    val names by produceState<Map<String, Pair<String?, String?>>?>(null, cardIds) {
        val ids = cardIds ?: return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val main = CatalogRepository.aliases(ids)
                val rows = CatalogRepository.importRows(ids.map { main[it] ?: it }).associateBy { it.id }
                ids.associateWith { id ->
                    rows[main[id] ?: id]?.let { it.nameDe?.takeIf { s -> s.isNotEmpty() } to it.nameEn?.takeIf { s -> s.isNotEmpty() } } ?: (null to null)
                }
            }.getOrDefault(emptyMap())
        }
    }
    val items = remember(ready, copyIds, names) { val n = names; if (ready == null || n == null) null else listingItems(ready, copyIds, n) }
    val missing = ready != null && names != null && items == null
    val suggestions = remember(ready, copyIds, ctx) { ready?.let { listingSuggestions(ctx, it, copyIds) } }
    val suggestionSum = suggestions?.let { s -> ListingText.suggestionSum(copyIds.map { s[it] }) }
    val groups = remember(items) { items?.let { ListingText.groupItems(it) } ?: emptyList() }

    val channels = salesState.value?.channels ?: emptyList()
    var channelId by remember { mutableStateOf(prefill?.channelId) }
    // Vorbelegung: Kanal der Vorlage, sonst Cardmarket; ist er ausgeblendet, der erste lebende (Spec §8).
    val channel = channels.find { it.channelId == (channelId ?: "cardmarket") } ?: channels.firstOrNull()
    var channelOpen by remember { mutableStateOf(false) }
    val isCm = channel?.channelId == "cardmarket"

    val today = remember { LocalDate.now().toString() }
    var date by remember { mutableStateOf(today) }
    var price by remember { mutableStateOf("") }
    var priceTouched by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var titleTouched by remember { mutableStateOf(false) }
    var description by remember { mutableStateOf("") }
    var descriptionTouched by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    // Cardmarket: eigener Preis je Gruppe (Schlüssel = copyIds der Gruppe).
    val groupPrices = remember { mutableStateMapOf<String, String>() }
    val groupTouched = remember { mutableStateMapOf<String, Boolean>() }

    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var sharing by remember { mutableStateOf(false) }
    // Nach einem teilweise gelungenen Speichern (Angebot steht, for_sale nicht) kein zweites Anlegen.
    var created by remember { mutableStateOf(false) }

    val priceCents = centsOf(price)

    // Vorbelegungen bis zur ersten Eingabe. Nur mit bekanntem Wert, damit ein kurzes Flackern des Speichers
    // eine Vorbelegung nicht leert.
    LaunchedEffect(suggestionSum) {
        val p = prefill?.priceCents ?: suggestionSum
        if (!priceTouched && p != null) price = SaleInput.centsInput(p)
    }
    LaunchedEffect(items) {
        val its = items ?: return@LaunchedEffect
        if (!titleTouched) title = prefill?.title?.takeIf { it.isNotEmpty() } ?: ListingText.listingTitle(its)
    }
    LaunchedEffect(items, priceCents) {
        val its = items ?: return@LaunchedEffect
        if (!descriptionTouched) description = prefill?.description?.takeIf { it.isNotEmpty() } ?: ListingText.listingDescription(its, priceCents)
    }
    LaunchedEffect(groups, suggestions) {
        val s = suggestions ?: return@LaunchedEffect
        groups.forEach { g ->
            val k = groupKey(g)
            if (groupTouched[k] == true) return@forEach
            val p = (if (groups.size == 1) prefill?.priceCents else null) ?: ListingText.suggestionSum(g.copyIds.map { s[it] })
            if (p != null) groupPrices[k] = SaleInput.centsInput(p)
        }
    }

    fun groupCents(g: ListingText.Group): Long? = groupPrices[groupKey(g)]?.let { centsOf(it) }

    // Spec §5.7: Exemplar schon in einem anderen aktiven Angebot -> Hinweis, kein Fehler.
    val alsoOn = remember(listingsState.value, copyIds) {
        val byCopy = listingsState.value?.byCopy() ?: emptyMap()
        copyIds.flatMap { id -> byCopy[id]?.map { it.channelName } ?: emptyList() }.distinct().sorted()
    }

    val dateOk = SaleInput.dateOk(date)
    val priceOk = if (isCm) groups.isNotEmpty() && groups.all { SaleInput.moneyOk(groupPrices[groupKey(it)], required = true) }
        else SaleInput.moneyOk(price, required = true)
    val linkError = ListingsRepository.checkEdit(null, link)
    val canSave = !busy && !created && !offline && ready != null && items != null && channel != null && copyIds.isNotEmpty() &&
        dateOk && (!isCm || (priceOk && linkError == null))
    // Spec I §5.2 Punkt 6: Meldung am Feld mit Abhilfe (ohne Cardmarket; dort hat jede Gruppe ihren eigenen Preis).
    var fieldErrors by remember { mutableStateOf<List<SaleFlow.FieldError>>(emptyList()) }
    fun applyFix(fix: SaleFlow.Fix) {
        when (fix.field) {
            "price" -> { price = fix.cents?.let { SaleInput.centsInput(it) } ?: price; priceTouched = true }
            "url" -> link = fix.value.orEmpty()
        }
        fieldErrors = fieldErrors.filter { it.field != fix.field }
    }

    val first = groups.firstOrNull()
    val openUrl = channel?.let { ch -> if (ch.channelId == "cardmarket" && first == null) null else ListingText.listingLink(ch.channelId, null, first?.nameEn, first?.setCode) }
    val shareTitle = if (isCm) first?.let { ListingText.cardmarketProduct(it) } ?: "Angebot" else title.ifBlank { "Angebot" }

    fun save() {
        val chosen = channel?.channelId ?: return
        if (!isCm) {
            val errs = SaleFlow.validateListing(price, link, prefill?.priceCents ?: suggestionSum)
            fieldErrors = errs
            if (errs.isNotEmpty()) return
        }
        if (!inFlight.tryStart()) return
        busy = true; error = null; notice = null
        scope.launch {
            try {
                SideStores.listings.refreshAndWait()
                val ls = SideStores.listings.state.value
                if (ls.value == null || ls.error != null) throw IllegalStateException("Keine Verbindung – Angebote nicht geladen.")
                val fresh = CollectionStore.state.value as? StoreState.Ready ?: throw IllegalStateException("Sammlung ist nicht geladen.")
                val its = listingItems(fresh, copyIds, names ?: emptyMap()) ?: throw IllegalStateException("Karte bereits verkauft oder gelöscht.")
                val chList = SideStores.sales.state.value.value?.channels ?: throw IllegalStateException("Keine Verbindung – Verkäufe nicht geladen.")
                val ch = chList.find { it.channelId == chosen } ?: throw IllegalStateException("Kanal nicht gefunden.")
                val linkV = link.trim().ifEmpty { null }
                val noteV = note.trim().ifEmpty { null }
                val list = if (ch.channelId == "cardmarket") ListingText.groupItems(its).map { g ->
                    NewListing(ch.channelId, ch.name, date.trim(), groupCents(g) ?: 0L, null, null, linkV, noteV, its.filter { it.copyId in g.copyIds })
                } else listOf(NewListing(ch.channelId, ch.name, date.trim(), centsOf(price) ?: 0L, title.trim().ifEmpty { null },
                    description.trim().ifEmpty { null }, linkV, noteV, its))
                val liveIds = fresh.copies.map { it.copyId }.toSet()
                val chIds = chList.map { it.channelId }.toSet()
                list.firstNotNullOfOrNull { ListingsRepository.checkNew(it, liveIds, chIds) }?.let { throw IllegalStateException(it) }
                val ids = try {
                    ListingsRepository.create(list)
                } catch (e: ListingSavedPartially) {
                    // Angebot steht, nur for_sale scheiterte -- kein „Nicht gespeichert“, kein zweites Anlegen.
                    created = true
                    error = e.message
                    try { SideStores.listings.refreshAndWait() } catch (c: CancellationException) { throw c } catch (_: Exception) { }
                    return@launch
                }
                created = true
                // Gespeichert ist gespeichert -- ein Fehler beim Nachladen darf nicht als „Nicht gespeichert“ erscheinen.
                try { CollectionStore.awaitSync(); SideStores.listings.refreshAndWait() } catch (e: CancellationException) { throw e } catch (_: Exception) { }
                onSaved(ids)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = "Nicht gespeichert: ${e.message ?: "Unbekannter Fehler"}" }
            finally { inFlight.finish(); busy = false }
        }
    }

    Column(
        if (embedded) Modifier.fillMaxWidth()
        else Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (!embedded) Text("Angebot erstellen", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
        val n = copyIds.size
        Text(
            "$n ${if (n == 1) "Karte" else "Karten"} · Vorschlag ${if (suggestions == null) "…" else suggestionSum?.let { SalesMath.euroCentsText(it) } ?: "–"}",
            color = Muted, style = MaterialTheme.typography.bodyMedium,
        )

        if (offline) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val loadingOnly = loadingSide && listingsState.error == null && salesState.error == null
                Text(
                    if (loadingOnly) "Angebote werden geladen…" else "Keine Verbindung – Angebote nicht geladen",
                    color = if (loadingOnly) Muted else ErrorColor, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { SideStores.listings.refresh(); SideStores.sales.refresh() },
                    enabled = !listingsState.loading && !salesState.loading) { Text("Erneut versuchen") }
            }
        }
        if (ready == null) Text("Sammlung ist nicht geladen.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
        if (missing && !busy) Text("Karte nicht mehr in der Sammlung", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
        if (alsoOn.isNotEmpty()) Text("auch auf ${alsoOn.joinToString(", ")} eingestellt", color = Muted, style = MaterialTheme.typography.bodySmall)

        ExposedDropdownMenuBox(expanded = channelOpen, onExpandedChange = { if (channels.isNotEmpty() && !busy) channelOpen = it }) {
            OutlinedTextField(
                value = channel?.name ?: "…", onValueChange = {}, readOnly = true,
                label = { Text("Kanal") }, singleLine = true,
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = channelOpen) },
                modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = channelOpen, onDismissRequest = { channelOpen = false }) {
                channels.forEach { c ->
                    DropdownMenuItem(text = { Text(c.name) }, onClick = { channelId = c.channelId; channelOpen = false })
                }
            }
        }
        OutlinedTextField(
            value = date, onValueChange = { date = it }, label = { Text("Datum (JJJJ-MM-TT)") }, singleLine = true,
            isError = !dateOk, modifier = Modifier.fillMaxWidth(),
        )

        if (isCm) {
            if (groups.size > 1) Text("wird zu ${groups.size} Cardmarket-Angeboten", color = OnSurface, style = MaterialTheme.typography.bodyMedium)
            if (items == null) Text("…", color = Muted)
            groups.forEach { g ->
                val k = groupKey(g)
                val raw = groupPrices[k] ?: ""
                val e = ListingText.cardmarketEntry(g, centsOf(raw))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(e.product, color = OnSurface, fontWeight = FontWeight.Bold)
                    Text("Menge ${e.quantity} · Sprache ${e.language} · Zustand ${e.condition} · 1. Auflage ${if (e.firstEdition) "ja" else "nein"}",
                        color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                    OutlinedTextField(
                        value = raw, onValueChange = { groupPrices[k] = it; groupTouched[k] = true },
                        label = { Text("Preis gesamt (€)") }, singleLine = true, isError = !SaleInput.moneyOk(raw, required = true),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
                    )
                    Text("Preis je Stück ${e.pieceCents?.let { SalesMath.euroCentsText(it) } ?: "…"}",
                        color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                }
            }
        } else {
            OutlinedTextField(
                value = price, onValueChange = { price = it; priceTouched = true },
                label = { Text("Preis (€)") }, singleLine = true, isError = !SaleInput.moneyOk(price, required = true),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )
            FieldErrors(fieldErrors.filter { it.field == "price" }, ::applyFix)
            OutlinedTextField(
                value = title, onValueChange = { title = it; titleTouched = true }, label = { Text("Titel") },
                supportingText = {
                    Text("${title.length}/${ListingText.TITLE_MAX}", color = if (title.length > ListingText.TITLE_MAX) ErrorColor else Muted)
                },
                isError = title.length > ListingText.TITLE_MAX, modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = description, onValueChange = { description = it; descriptionTouched = true }, label = { Text("Beschreibung") },
                minLines = 4, modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(title)); notice = "Kopiert." }, enabled = title.isNotEmpty()) {
                    Text("Titel kopieren")
                }
                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(description)); notice = "Kopiert." }, enabled = description.isNotEmpty()) {
                    Text("Beschreibung kopieren")
                }
            }
        }

        OutlinedTextField(
            value = link, onValueChange = { link = it }, label = { Text("Link der Anzeige") }, singleLine = true,
            isError = linkError != null, supportingText = linkError?.let { { Text(it, color = ErrorColor) } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth(),
        )
        FieldErrors(fieldErrors.filter { it.field == "url" }, ::applyFix)
        OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("Notiz") }, modifier = Modifier.fillMaxWidth())

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Am Handy nie cm_url (Befund 2): Cardmarket öffnet die Suche.
            openUrl?.let { url ->
                OutlinedButton(onClick = { if (!openWebLink(ctx, url)) error = "Link konnte nicht geöffnet werden." }) {
                    Text("Zum Einstellen öffnen")
                }
            }
            OutlinedButton(
                onClick = {
                    val its = items ?: return@OutlinedButton
                    sharing = true
                    notice = null
                    scope.launch {
                        try {
                            val (s, t) = ListingShare.shareImages(ctx, shareTitle, ListingText.imageUrls(its))
                            notice = ListingText.imagesText(s, t)
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { notice = "Teilen fehlgeschlagen: ${e.message ?: "Unbekannter Fehler"}" }
                        finally { sharing = false }
                    }
                },
                enabled = items != null && !sharing,
            ) { Text(if (sharing) "Bilder werden geladen…" else "Bilder") }
        }
        Text("Käufer erwarten oft eigene Fotos.", color = Muted, style = MaterialTheme.typography.bodySmall)
        Text("Eigene Fotos fügst du nach dem Speichern im Angebot hinzu.", color = Muted, style = MaterialTheme.typography.bodySmall)
        if (channel?.channelId == "ebay" && ebayStatusState.value != null &&
            !EbayMarks.setupOk(ebayStatusState.value?.firstOrNull()?.first)
        ) {
            Text(
                "eBay ist noch nicht eingerichtet – das Angebot wartet, bis der Check in den Einstellungen vollständig ist.",
                color = Warn, style = MaterialTheme.typography.bodySmall,
            )
        }
        notice?.let { Text(it, color = OnSurface, style = MaterialTheme.typography.bodySmall) }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onBack, enabled = !busy) { Text(if (created) "Schließen" else if (embedded) "Zurück" else "Abbrechen") }
            Spacer(Modifier.width(8.dp))
            Button(onClick = { save() }, enabled = canSave) { Text(if (busy) "Wird gespeichert…" else "Angebot speichern") }
        }
    }
}
