package com.example.yugiohscanner.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ListingsRepository
import com.example.yugiohscanner.cloud.SaleChannel
import com.example.yugiohscanner.cloud.SaleHeadInput
import com.example.yugiohscanner.cloud.SalesRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.SaleInput
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Spec H3a §7.1 -- „Verkauft“ aus einem Angebot: Kanal und Preis vorbelegen, Teilverkauf per Häkchen. */
data class ListingSale(val listingId: String, val channelId: String, val priceCents: Long)

/** Abschluss-Schritt nach dem Buchen (Abweichung 7): Erinnerungen, Preis-Hinweis, Aufräum-Fehler. */
private data class DoneStep(val saleId: String, val count: Int, val after: ListingsRepository.AfterBooking?, val cleanupError: String?)

/**
 * Marktwert je Exemplar (copyId, Cent) aus einem Speicherstand; null, sobald ein Exemplar oder sein
 * Druck fehlt (schon verkauft/geloescht). Immer mit dem FRISCHEN Stand aufrufen, wenn gebucht wird.
 */
private fun saleValues(ready: StoreState.Ready, copyIds: List<String>): List<Pair<String, Long>>? {
    val copies = ready.copies.associateBy { it.copyId }
    val cards = ready.cards.associateBy { it.printingKey() }
    return copyIds.map { id ->
        val copy = copies[id] ?: return null
        val card = cards[copy.printingKey()] ?: return null
        id to SalesMath.marketValueCents(card, copy)
    }
}

private fun feeLabel(c: SaleChannel): String {
    if (c.feePercent == 0.0) return c.name
    val p = if (c.feePercent == Math.floor(c.feePercent)) c.feePercent.toLong().toString() else c.feePercent.toString().replace('.', ',')
    return "${c.name} ($p %)"
}

/**
 * Spec H2 §5.2/§5.5/§8 -- Verkauf buchen am Handy (Gegenstueck zu desktop/src/components/SaleDialog.jsx).
 * Gesperrt, solange die Verkaeufe nicht geladen sind oder das letzte Laden scheiterte (Plan-Abweichung 4).
 * Gebucht wird in einer Transaktion ueber book_sale (SalesRepository.book); die Werte werden innerhalb
 * des InFlight-Gatters aus dem frischen Speicherstand neu berechnet.
 * Spec H3a §7: mit [listing] Kanal/Preis vorbelegt und je Exemplar abwählbar (Teilverkauf); nach JEDEM Buchen werden
 * die Angebote aufgeräumt. Sind Angebote betroffen, zeigt das Sheet einen Abschluss-Schritt, bevor es onBooked meldet;
 * sonst schließt es wie bisher sofort. [onAdjustListing]: Sprung ins Bearbeiten („Preis für die übrigen Karten anpassen?“).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SaleSheet(
    copyIds: List<String>, initialGrossCents: Long? = null, listing: ListingSale? = null, onAdjustListing: (() -> Unit)? = null,
    onDismiss: () -> Unit, onBooked: (saleId: String, count: Int) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    // Waehrend gebucht wird, laesst sich das Sheet auch per Wischen nicht schliessen.
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !busy })
    val sales by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val offline = sales.value == null || sales.error != null

    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    // Spec H3a §7.1: aus einem Angebot sind alle Positionen angehakt und einzeln abwählbar; ohne Angebot alle (wie H2).
    var picked by remember { mutableStateOf(copyIds.toSet()) }
    val chosenIds = if (listing == null) copyIds else copyIds.filter { it in picked }
    var done by remember { mutableStateOf<DoneStep?>(null) }
    val values = remember(ready, chosenIds) { ready?.let { saleValues(it, chosenIds) } }
    val missing = ready != null && values == null
    val marketCents = values?.sumOf { it.second }
    // Spec H2 §9: Vorbelegung mit der Summe der Preisvorschlaege, sofern mindestens ein Exemplar
    // einen hat -- sonst wie bisher der Marktwert (Task-13-Brief).
    val suggestionSum = remember(values, ctx) {
        values?.map { (_, v) -> Prefs.saleSuggestion(ctx, v) }?.let { list -> if (list.any { it != null }) list.sumOf { it ?: 0L } else null }
    }

    val channels = sales.value?.channels ?: emptyList()
    var channelId by remember { mutableStateOf<String?>(listing?.channelId) }
    val channel = channels.find { it.channelId == channelId } ?: channels.find { it.channelId == "cardmarket" } ?: channels.firstOrNull()
    var channelOpen by remember { mutableStateOf(false) }
    // Spec H2 §5.2 "Neuer Kanal…": Mini-Formular unter der Kanal-Auswahl.
    var newChannelOpen by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var newFee by remember { mutableStateOf("") }
    var newError by remember { mutableStateOf<String?>(null) }

    val today = remember { LocalDate.now().toString() }
    var date by remember { mutableStateOf(today) }
    var gross by remember { mutableStateOf("") }
    var grossTouched by remember { mutableStateOf(false) }
    var fees by remember { mutableStateOf("") }
    var feesTouched by remember { mutableStateOf(false) }
    var shipping by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    var error by remember { mutableStateOf<String?>(null) }

    fun grossCents() = SalesMath.toCents(SaleInput.parseMoney(gross)) ?: 0L
    fun followFees(ch: SaleChannel?) {
        if (!feesTouched) fees = SaleInput.centsInput(SalesMath.feeDefaultCents(grossCents(), ch?.feePercent ?: 0.0))
    }

    // Vorbelegung wie am PC: Gesamtpreis = initialGrossCents oder Marktwert, Gebuehren = Preis x Kanalgebuehr --
    // je bis der Nutzer das Feld anfasst. Laeuft erneut, sobald Marktwert oder Kanal (nach dem Laden) da sind.
    LaunchedEffect(marketCents, suggestionSum, channel?.channelId, channel?.feePercent) {
        if (!grossTouched) {
            val g = initialGrossCents ?: suggestionSum ?: marketCents
            gross = if (g == null) "" else SaleInput.centsInput(g)
        }
        followFees(channel)
    }

    val net = SalesMath.netCents(SaleInput.parseMoney(gross) ?: 0.0, SaleInput.parseMoney(fees), SaleInput.parseMoney(shipping))
    val dateOk = SaleInput.dateOk(date)
    val grossOk = SaleInput.moneyOk(gross, required = true)
    val feesOk = SaleInput.moneyOk(fees, required = false)
    val shippingOk = SaleInput.moneyOk(shipping, required = false)
    // Platzhalter statt "0,00 €", solange Marktwert oder Betraege nicht feststehen.
    val netKnown = marketCents != null && grossOk && feesOk && shippingOk
    val canBook = !busy && !offline && ready != null && !missing && channel != null && chosenIds.isNotEmpty() &&
        dateOk && grossOk && feesOk && shippingOk

    fun createChannel() {
        val fee = SaleInput.parsePercent(newFee)
        if (fee == null) { newError = "Die Gebühr muss zwischen 0 und 100 % liegen."; return }
        if (!inFlight.tryStart()) return
        busy = true
        newError = null
        scope.launch {
            try {
                val id = SalesRepository.saveChannel(null, newName, fee)
                SideStores.sales.refreshAndWait()
                channelId = id
                newChannelOpen = false
                newName = ""
                newFee = ""
                // Gebuehren folgen dem neuen Kanal, sofern unberuehrt (der LaunchedEffect oben zieht bei Kanalwechsel ohnehin nach).
                followFees(SideStores.sales.state.value.value?.channels?.find { it.channelId == id })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                newError = e.message ?: "Kanal speichern fehlgeschlagen."
            } finally {
                inFlight.finish()
                busy = false
            }
        }
    }

    fun book() {
        val chosen = channel?.channelId ?: return
        val ids = chosenIds
        if (!inFlight.tryStart()) return
        busy = true
        error = null
        scope.launch {
            try {
                val saleId: String
                val count: Int
                val bookedIds: List<String>
                try {
                    // Frischer Stand, nicht der Kompositions-Schnappschuss.
                    val fresh = CollectionStore.state.value as? StoreState.Ready ?: throw IllegalStateException("Sammlung ist nicht geladen.")
                    val items = saleValues(fresh, ids) ?: throw IllegalStateException("Karte nicht mehr in der Sammlung.")
                    val s = SideStores.sales.state.value
                    val data = s.value
                    if (data == null || s.error != null) throw IllegalStateException("Keine Verbindung – Verkäufe nicht geladen.")
                    val ch = data.channels.find { it.channelId == chosen } ?: throw IllegalStateException("Kanal nicht mehr vorhanden.")
                    val head = SaleHeadInput(
                        soldOn = date.trim(), channelId = ch.channelId, channelName = ch.name,
                        gross = SaleInput.parseMoney(gross) ?: throw IllegalStateException("Gesamtpreis fehlt."),
                        fees = SaleInput.parseMoney(fees), shipping = SaleInput.parseMoney(shipping),
                        note = note.trim().ifEmpty { null },
                    )
                    saleId = SalesRepository.book(head, items)
                    count = items.size
                    bookedIds = items.map { it.first }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    error = "Nicht gebucht: ${e.message ?: "Unbekannter Fehler"}"
                    return@launch
                }
                // Gebucht ist gebucht -- ein Fehler beim Nachladen darf nicht als "Nicht gebucht" erscheinen.
                try { CollectionStore.awaitSync(); SideStores.sales.refreshAndWait() }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { }
                // Spec H3a §7.2: nach JEDEM book_sale aufräumen. Scheitert das, bleibt der Verkauf gültig; die
                // Angebote zeigen dann "Karte fehlt".
                var after: ListingsRepository.AfterBooking? = null
                var cleanupError: String? = null
                try {
                    SideStores.listings.refreshAndWait()
                    val ls = SideStores.listings.state.value
                    val data = ls.value
                    if (data == null || ls.error != null) throw IllegalStateException("Angebote nicht geladen.")
                    after = ListingsRepository.afterBooking(data, saleId, bookedIds, listing?.listingId)
                    SideStores.listings.refreshAndWait()
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { cleanupError = e.message ?: "Unbekannter Fehler" }
                if (cleanupError != null || after?.reminders?.isNotEmpty() == true || after?.askAdjust == true || after?.listingSkipped == true) {
                    done = DoneStep(saleId, count, after, cleanupError)
                } else onBooked(saleId, count)
            } finally {
                inFlight.finish()
                busy = false
            }
        }
    }

    // Im Abschluss-Schritt ist schon gebucht: Schließen meldet onBooked (Rückgängig-Zeile, Auswahl), nie onDismiss.
    ModalBottomSheet(onDismissRequest = { val d = done; if (d != null) onBooked(d.saleId, d.count) else if (!busy) onDismiss() }, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            done?.let { d ->
                DoneContent(d, onAdjust = onAdjustListing?.let { adjust -> { onBooked(d.saleId, d.count); adjust() } },
                    onFinish = { onBooked(d.saleId, d.count) })
                return@Column
            }
            Text("Verkauft buchen", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
            val n = chosenIds.size
            Text(
                "$n ${if (n == 1) "Karte" else "Karten"} · Marktwert ${marketCents?.let { SalesMath.euroCentsText(it) } ?: "…"}",
                color = Muted, style = MaterialTheme.typography.bodyMedium,
            )
            // Spec H3a §7.1 Teilverkauf: je Exemplar ein Häkchen (Name aus dem Speicher, Druck, Zustand).
            if (listing != null) {
                val copiesById = remember(ready) { ready?.copies?.associateBy { it.copyId } ?: emptyMap() }
                val cardsByKey = remember(ready) { ready?.cards?.associateBy { it.printingKey() } ?: emptyMap() }
                copyIds.forEach { id ->
                    val copy = copiesById[id]
                    val card = copy?.let { cardsByKey[it.printingKey()] }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = id in picked, onCheckedChange = { picked = if (it) picked + id else picked - id }, enabled = !busy)
                        Column(Modifier.weight(1f)) {
                            Text(card?.name ?: copy?.cardId ?: id, color = OnSurface, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                            Text(copy?.let { "${it.setCode} · ${it.rarity} · ${it.language} · ${it.condition}" } ?: "Karte nicht mehr in der Sammlung",
                                color = if (copy == null) ErrorColor else Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            if (offline) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (sales.loading && sales.value == null && sales.error == null) "Verkäufe werden geladen…" else "Keine Verbindung – Verkäufe nicht geladen",
                        color = ErrorColor, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { SideStores.sales.refresh() }, enabled = !sales.loading) { Text("Erneut versuchen") }
                }
            }
            if (ready == null) Text("Sammlung ist nicht geladen.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            if (missing && !busy) Text("Karte nicht mehr in der Sammlung", color = ErrorColor, style = MaterialTheme.typography.bodySmall)

            ExposedDropdownMenuBox(expanded = channelOpen, onExpandedChange = { if (channels.isNotEmpty()) channelOpen = it }) {
                OutlinedTextField(
                    value = channel?.let { feeLabel(it) } ?: "…", onValueChange = {}, readOnly = true,
                    label = { Text("Kanal") }, singleLine = true,
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = channelOpen) },
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                )
                ExposedDropdownMenu(expanded = channelOpen, onDismissRequest = { channelOpen = false }) {
                    channels.forEach { c ->
                        DropdownMenuItem(text = { Text(feeLabel(c)) }, onClick = {
                            channelId = c.channelId
                            channelOpen = false
                            followFees(c)
                        })
                    }
                    if (channels.isNotEmpty()) {
                        DropdownMenuItem(text = { Text("Neuer Kanal…") }, onClick = { channelOpen = false; newChannelOpen = true; newError = null })
                    }
                }
            }
            if (newChannelOpen) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = newName, onValueChange = { newName = it }, label = { Text("Name") }, singleLine = true,
                            modifier = Modifier.weight(2f))
                        OutlinedTextField(value = newFee, onValueChange = { newFee = it }, label = { Text("Gebühr %") }, singleLine = true,
                            isError = SaleInput.parsePercent(newFee) == null,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                    }
                    newError?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { newChannelOpen = false; newError = null }, enabled = !busy) { Text("Abbrechen") }
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = { createChannel() }, enabled = !busy && !offline && newName.isNotBlank()) { Text("Anlegen") }
                    }
                }
            }

            OutlinedTextField(
                value = date, onValueChange = { date = it }, label = { Text("Datum (JJJJ-MM-TT)") }, singleLine = true,
                isError = !dateOk, modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = gross, onValueChange = { gross = it; grossTouched = true; followFees(channel) },
                label = { Text("Gesamtpreis (€)") }, singleLine = true, isError = !grossOk,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = fees, onValueChange = { fees = it; feesTouched = true },
                    label = { Text("Gebühren (€)") }, singleLine = true, isError = !feesOk,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = shipping, onValueChange = { shipping = it },
                    label = { Text("Versand (€)") }, placeholder = { Text("nicht erfasst") }, singleLine = true, isError = !shippingOk,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f),
                )
            }
            OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("Notiz") }, modifier = Modifier.fillMaxWidth())

            Column {
                Text("Netto ${if (netKnown) SalesMath.euroCentsText(net) else "…"}", color = OnSurface, fontFamily = MonoFontFamily)
                if (netKnown && marketCents != null) {
                    Text("${SalesMath.diffText(net, marketCents)} gegenüber Marktwert",
                        color = if (net >= marketCents) Good else ErrorColor, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                } else {
                    Text("… gegenüber Marktwert", color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                }
                if (netKnown && net < 0) Text("Verlust: Gebühren und Versand übersteigen den Preis.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }

            error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss, enabled = !busy) { Text("Abbrechen") }
                Spacer(Modifier.width(8.dp))
                Button(onClick = { book() }, enabled = canBook) { Text(if (busy) "Wird gebucht…" else "Buchen") }
            }
        }
    }
}

/** Spec H3a Abweichung 7 -- Abschluss-Schritt: „Auch dort herausnehmen: …“, Preis-Hinweis, Aufräum-Fehler. */
@Composable
private fun DoneContent(d: DoneStep, onAdjust: (() -> Unit)?, onFinish: () -> Unit) {
    val ctx = LocalContext.current
    Text("Gebucht.", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
    d.cleanupError?.let {
        Text("Angebote nicht aufgeräumt: $it – sie zeigen „Karte fehlt“.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
    }
    val after = d.after
    if (after?.listingSkipped == true) {
        Text("Angebot war nicht mehr aktiv – nur der Verkauf wurde gebucht.", color = OnSurface, style = MaterialTheme.typography.bodyMedium)
    }
    if (after != null && after.reminders.isNotEmpty()) {
        Text("Auch dort herausnehmen:", color = OnSurface, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
        after.reminders.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${r.channelName} – ${r.title}", color = OnSurface, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                r.externalUrl?.let { url ->
                    TextButton(onClick = { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }) { Text("Anzeige öffnen") }
                }
            }
        }
    }
    if (after?.askAdjust == true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Preis für die übrigen Karten anpassen?", color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            onAdjust?.let { TextButton(onClick = it) { Text("Bearbeiten") } }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(onClick = onFinish) { Text("Fertig") }
    }
}
