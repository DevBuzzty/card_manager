package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
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
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SaleSheet(copyIds: List<String>, initialGrossCents: Long? = null, onDismiss: () -> Unit, onBooked: (saleId: String, count: Int) -> Unit) {
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val sales by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val offline = sales.value == null || sales.error != null

    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val values = remember(ready, copyIds) { ready?.let { saleValues(it, copyIds) } }
    val missing = ready != null && values == null
    val marketCents = values?.sumOf { it.second }

    val channels = sales.value?.channels ?: emptyList()
    var channelId by remember { mutableStateOf<String?>(null) }
    val channel = channels.find { it.channelId == channelId } ?: channels.find { it.channelId == "cardmarket" } ?: channels.firstOrNull()
    var channelOpen by remember { mutableStateOf(false) }

    val today = remember { LocalDate.now().toString() }
    var date by remember { mutableStateOf(today) }
    var gross by remember { mutableStateOf("") }
    var grossTouched by remember { mutableStateOf(false) }
    var fees by remember { mutableStateOf("") }
    var feesTouched by remember { mutableStateOf(false) }
    var shipping by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun grossCents() = SalesMath.toCents(SaleInput.parseMoney(gross)) ?: 0L
    fun followFees(ch: SaleChannel?) {
        if (!feesTouched) fees = SaleInput.centsInput(SalesMath.feeDefaultCents(grossCents(), ch?.feePercent ?: 0.0))
    }

    // Vorbelegung wie am PC: Gesamtpreis = initialGrossCents oder Marktwert, Gebuehren = Preis x Kanalgebuehr --
    // je bis der Nutzer das Feld anfasst. Laeuft erneut, sobald Marktwert oder Kanal (nach dem Laden) da sind.
    LaunchedEffect(marketCents, channel?.channelId, channel?.feePercent) {
        if (!grossTouched) {
            val g = initialGrossCents ?: marketCents
            gross = if (g == null) "" else SaleInput.centsInput(g)
        }
        followFees(channel)
    }

    val net = SalesMath.netCents(SaleInput.parseMoney(gross) ?: 0.0, SaleInput.parseMoney(fees), SaleInput.parseMoney(shipping))
    val dateOk = SaleInput.dateOk(date)
    val grossOk = SaleInput.moneyOk(gross, required = true)
    val feesOk = SaleInput.moneyOk(fees, required = false)
    val shippingOk = SaleInput.moneyOk(shipping, required = false)
    val canBook = !busy && !offline && ready != null && !missing && channel != null && copyIds.isNotEmpty() &&
        dateOk && grossOk && feesOk && shippingOk

    fun book() {
        val chosen = channel?.channelId ?: return
        if (!inFlight.tryStart()) return
        busy = true
        error = null
        scope.launch {
            try {
                val saleId: String
                val count: Int
                try {
                    // Frischer Stand, nicht der Kompositions-Schnappschuss.
                    val fresh = CollectionStore.state.value as? StoreState.Ready ?: throw IllegalStateException("Sammlung ist nicht geladen.")
                    val items = saleValues(fresh, copyIds) ?: throw IllegalStateException("Karte nicht mehr in der Sammlung.")
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
                onBooked(saleId, count)
            } finally {
                inFlight.finish()
                busy = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Verkauft buchen", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
            val n = copyIds.size
            Text(
                "$n ${if (n == 1) "Karte" else "Karten"} · Marktwert ${marketCents?.let { SalesMath.euroCentsText(it) } ?: "…"}",
                color = Muted, style = MaterialTheme.typography.bodyMedium,
            )

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
            if (missing) Text("Karte nicht mehr in der Sammlung", color = ErrorColor, style = MaterialTheme.typography.bodySmall)

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
                Text("Netto ${SalesMath.euroCentsText(net)}", color = OnSurface, fontFamily = MonoFontFamily)
                if (marketCents != null) {
                    Text("${SalesMath.diffText(net, marketCents)} gegenüber Marktwert",
                        color = if (net >= marketCents) Good else ErrorColor, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                }
                if (net < 0) Text("Verlust: Gebühren und Versand übersteigen den Preis.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
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
