package com.example.yugiohscanner.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SaleHeadInput
import com.example.yugiohscanner.cloud.SalesRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SaleInput
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ml.SalesOverview
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

// Spec H2 §7 -- Handy-Gegenstueck zu desktop/src/components/SalesPanel.jsx, SaleDetail.jsx und dem
// „Verkauft"-Abschnitt in CardDetailPanel.jsx. Gerechnet wird ueber SalesMath/SalesOverview.

private val PERIODS = listOf("monat" to "Monat", "jahr" to "Jahr", "gesamt" to "Gesamt")
private val MONTHS = listOf("Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez")

private fun signed(c: Long) = if (c > 0) "+" + SalesMath.euroCentsText(c) else SalesMath.euroCentsText(c)

/** Spec H2 §7 -- Insights-Reiter „Verkäufe": Zeitraum, Kacheln, Kanäle, 12 Monatsbalken, Liste. */
@Composable
fun SalesSection(onOpenCard: (String) -> Unit) {
    val state by SideStores.sales.state.collectAsState()
    val data = state.value
    var period by rememberSaveable { mutableStateOf("monat") }
    val today = remember { LocalDate.now().toString() }
    val overview = remember(data, period, today) { data?.let { SalesOverview.overview(it, period, today) } }
    var openId by remember { mutableStateOf<String?>(null) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PERIODS.forEach { (id, label) ->
                FilterChip(selected = period == id, onClick = { period = id }, label = { Text(label) })
            }
        }
        if (state.error != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Verkäufe konnten nicht geladen werden.", color = ErrorColor, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f))
                TextButton(onClick = { SideStores.sales.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
            }
        }
        val o = overview
        if (o == null) {
            Text("…", color = Muted)
            return@Column
        }
        val t = o.totals
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile("Netto", SalesMath.euroCentsText(t.netCents), Modifier.weight(1f))
            Tile("Marktwert beim Verkauf", SalesMath.euroCentsText(t.marketCents), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile("Differenz", SalesMath.diffText(t.netCents, t.marketCents), Modifier.weight(1f),
                color = if (t.netCents >= t.marketCents) Good else ErrorColor)
            Tile("Verkäufe", "${t.sales} · ${t.cards} Karten", Modifier.weight(1f))
        }

        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (o.byChannel.isEmpty()) {
                    Text("Keine Verkäufe im Zeitraum.", color = Muted, style = MaterialTheme.typography.bodySmall)
                } else {
                    ChannelRowView("Kanal", "Verk.", "Netto", "Gebühren", "Differenz", header = true)
                    o.byChannel.forEach { c ->
                        ChannelRowView(c.channelName, c.sales.toString(), SalesMath.euroCentsText(c.netCents),
                            SalesMath.euroCentsText(c.feesCents), signed(c.diffCents),
                            diffColor = if (c.diffCents >= 0) Good else ErrorColor)
                    }
                }
            }
        }

        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text("NETTO JE MONAT", style = MaterialTheme.typography.labelSmall, color = Muted)
                Spacer(Modifier.height(8.dp))
                MonthBars(o.byMonth)
            }
        }

        SpaceCard(Modifier.fillMaxWidth()) {
            Column {
                if (o.rows.isEmpty()) {
                    Text("Keine Verkäufe im Zeitraum.", color = Muted, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(12.dp))
                }
                o.rows.forEachIndexed { i, r ->
                    if (i > 0) HorizontalDivider(color = Line)
                    SaleRowView(r) { openId = r.sale.saleId }
                }
            }
        }
    }

    openId?.let { id -> SaleDetailSheet(saleId = id, onDismiss = { openId = null }, onOpenCard = { openId = null; onOpenCard(it) }) }
}

@Composable
private fun Tile(label: String, value: String, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color = OnSurface) {
    SpaceCard(modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = Muted, maxLines = 1)
            Text(value, color = color, fontFamily = MonoFontFamily, style = MaterialTheme.typography.titleSmall)
        }
    }
}

@Composable
private fun ChannelRowView(name: String, sales: String, net: String, fees: String, diff: String, header: Boolean = false,
                           diffColor: androidx.compose.ui.graphics.Color = OnSurface) {
    val style = if (header) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall
    val c = if (header) Muted else OnSurface
    val mono = if (header) null else MonoFontFamily
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(name, style = style, color = c, modifier = Modifier.weight(1.3f), maxLines = 1)
        Text(sales, style = style, color = c, fontFamily = mono, textAlign = TextAlign.End, modifier = Modifier.weight(0.6f))
        Text(net, style = style, color = c, fontFamily = mono, textAlign = TextAlign.End, modifier = Modifier.weight(1.1f))
        Text(fees, style = style, color = c, fontFamily = mono, textAlign = TextAlign.End, modifier = Modifier.weight(1.1f))
        Text(diff, style = style, color = if (header) Muted else diffColor, fontFamily = mono, textAlign = TextAlign.End,
            modifier = Modifier.weight(1.2f))
    }
}

/** 12 Balken, Hoehe proportional zu netCents; ist ein Wert negativ, liegt die Nulllinie in der Mitte. */
@Composable
private fun MonthBars(months: List<SalesMath.MonthRow>) {
    val maxAbs = months.maxOfOrNull { Math.abs(it.netCents) } ?: 0L
    val hasNeg = months.any { it.netCents < 0 }
    Canvas(Modifier.fillMaxWidth().height(120.dp)) {
        val n = months.size.coerceAtLeast(1)
        val slot = size.width / n
        val barW = slot * 0.6f
        val zeroY = if (hasNeg) size.height / 2 else size.height
        val room = if (hasNeg) size.height / 2 else size.height
        drawLine(Muted.copy(alpha = 0.5f), Offset(0f, zeroY), Offset(size.width, zeroY), strokeWidth = 1.dp.toPx())
        if (maxAbs > 0) months.forEachIndexed { i, m ->
            val h = room * Math.abs(m.netCents) / maxAbs
            val x = i * slot + (slot - barW) / 2
            if (m.netCents >= 0) drawRect(Primary, Offset(x, zeroY - h), Size(barW, h))
            else drawRect(ErrorColor, Offset(x, zeroY), Size(barW, h))
        }
    }
    Row(Modifier.fillMaxWidth()) {
        months.forEach { m ->
            Text(MONTHS[m.month.substring(5, 7).toInt() - 1], fontSize = 9.sp, color = Muted, textAlign = TextAlign.Center,
                maxLines = 1, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun SaleRowView(r: SalesOverview.ListRow, onClick: () -> Unit) {
    val cancelled = r.sale.status == "storniert"
    val deco = if (cancelled) TextDecoration.LineThrough else null
    val color = if (cancelled) Muted else OnSurface
    Column(Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(SalesOverview.dateText(r.sale.soldOn), fontFamily = MonoFontFamily, color = color, textDecoration = deco,
                style = MaterialTheme.typography.bodySmall)
            Text(r.sale.channelName, color = color, textDecoration = deco, style = MaterialTheme.typography.bodySmall,
                maxLines = 1, modifier = Modifier.weight(1f))
            Text(SalesMath.euroCentsText(r.netCents), fontFamily = MonoFontFamily, color = color, textDecoration = deco,
                style = MaterialTheme.typography.bodySmall)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${r.cards} ${if (r.cards == 1) "Karte" else "Karten"}", color = Muted, textDecoration = deco,
                style = MaterialTheme.typography.labelSmall)
            if (cancelled) Text("storniert", color = Muted, style = MaterialTheme.typography.labelSmall)
            if (r.doubleSold) DoubleBadge()
            Spacer(Modifier.weight(1f))
            Text(SalesMath.diffText(r.netCents, r.marketCents), fontFamily = MonoFontFamily, textDecoration = deco,
                color = if (cancelled) Muted else if (r.netCents >= r.marketCents) Good else ErrorColor,
                style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun DoubleBadge() {
    Text("Karte doppelt verkauft", color = ErrorColor, style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(ErrorColor.copy(alpha = 0.2f)).padding(horizontal = 6.dp, vertical = 1.dp))
}

@Composable
private fun SumRow(label: String, value: String, color: androidx.compose.ui.graphics.Color = OnSurface) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        Text(value, color = color, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
    }
}

private class EditForm(
    val channelId: String, val soldOn: String, val gross: String, val fees: String, val shipping: String, val note: String,
    val returned: Set<String>,
) {
    fun copy(channelId: String = this.channelId, soldOn: String = this.soldOn, gross: String = this.gross, fees: String = this.fees,
             shipping: String = this.shipping, note: String = this.note, returned: Set<String> = this.returned) =
        EditForm(channelId, soldOn, gross, fees, shipping, note, returned)
}

private fun moneyInput(v: Double?): String = SalesMath.toCents(v)?.let { SaleInput.centsInput(it) } ?: ""

/**
 * Spec H2 §6/§7 -- ein Verkauf mit Positionen; Bearbeiten (inkl. Teil-Rueckgabe) und Storno nur fuer
 * aktive Verkaeufe und nur, solange die Verkaeufe geladen sind (Plan-Abweichung 4, wie SaleSheet).
 * Schreibvorgaenge laufen durch [InFlight] und lesen den frischen Speicherstand innerhalb der Mutation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SaleDetailSheet(saleId: String, onDismiss: () -> Unit, onOpenCard: ((String) -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !busy })
    val state by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val data = state.value
    val offline = data == null || state.error != null

    val sale = remember(data, saleId) { data?.sales?.find { it.saleId == saleId } }
    val items = remember(data, saleId) { data?.let { SalesOverview.detailItems(it, saleId) } ?: emptyList() }
    val doubleSold = remember(data, saleId) { data?.let { SalesOverview.isDoubleSold(it, saleId) } == true }
    val active = sale?.status == "aktiv"

    var form by remember { mutableStateOf<EditForm?>(null) }
    var channelOpen by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun startEdit() {
        val s = sale ?: return
        error = null
        form = EditForm(s.channelId, s.soldOn, moneyInput(s.gross), moneyInput(s.fees), moneyInput(s.shipping),
            data?.notes?.get(s.saleId) ?: "", emptySet())
    }

    fun save() {
        val f = form ?: return
        if (!inFlight.tryStart()) return
        busy = true
        error = null
        scope.launch {
            try {
                try {
                    // Frischer Stand, nicht der Kompositions-Schnappschuss.
                    val s = SideStores.sales.state.value
                    val d = s.value
                    if (d == null || s.error != null) throw IllegalStateException("Keine Verbindung – Verkäufe nicht geladen.")
                    val cur = d.sales.find { it.saleId == saleId } ?: throw IllegalStateException("Verkauf nicht gefunden.")
                    if (cur.status != "aktiv") throw IllegalStateException("Ein stornierter Verkauf lässt sich nicht ändern.")
                    val fresh = SalesOverview.detailItems(d, saleId)
                    val live = fresh.filter { !it.deleted }.map { it.copyId }.toSet()
                    val returned = f.returned.filter { it in live }
                    val remaining = SalesOverview.remaining(fresh, returned.toSet())
                    if (remaining.isEmpty()) throw IllegalStateException("Mindestens eine Karte muss im Verkauf bleiben – sonst stornieren.")
                    val name = SalesOverview.channelNameFor(cur, f.channelId, d.channels)
                        ?: throw IllegalStateException("Kanal nicht mehr vorhanden.")
                    val head = SaleHeadInput(
                        soldOn = f.soldOn.trim(), channelId = f.channelId, channelName = name,
                        gross = SaleInput.parseMoney(f.gross) ?: throw IllegalStateException("Gesamtpreis fehlt."),
                        fees = SaleInput.parseMoney(f.fees), shipping = SaleInput.parseMoney(f.shipping),
                        note = f.note.trim().ifEmpty { null },
                    )
                    SalesRepository.update(saleId, head, remaining, returned)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    error = "Nicht gespeichert: ${e.message ?: "Unbekannter Fehler"}"
                    return@launch
                }
                // Gespeichert ist gespeichert -- ein Fehler beim Nachladen darf nicht als "Nicht gespeichert" erscheinen.
                try { CollectionStore.awaitSync(); SideStores.sales.refreshAndWait() }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { }
                form = null
            } finally {
                inFlight.finish()
                busy = false
            }
        }
    }

    fun cancelSale() {
        if (!inFlight.tryStart()) return
        busy = true
        error = null
        scope.launch {
            try {
                try {
                    val s = SideStores.sales.state.value
                    val d = s.value
                    if (d == null || s.error != null) throw IllegalStateException("Keine Verbindung – Verkäufe nicht geladen.")
                    val cur = d.sales.find { it.saleId == saleId } ?: throw IllegalStateException("Verkauf nicht gefunden.")
                    if (cur.status != "aktiv") throw IllegalStateException("Der Verkauf ist bereits storniert.")
                    SalesRepository.cancel(saleId)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    error = "Nicht storniert: ${e.message ?: "Unbekannter Fehler"}"
                    return@launch
                }
                try { CollectionStore.awaitSync(); SideStores.sales.refreshAndWait() }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { }
                onDismiss()
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
            Text("Verkauf", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
            if (sale == null) {
                Text(if (data == null) (if (state.error != null) "Keine Verbindung – Verkäufe nicht geladen" else "…") else "Verkauf nicht gefunden.",
                    color = if (data == null && state.error == null) Muted else ErrorColor)
                return@Column
            }

            if (offline && active) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Keine Verbindung – Verkäufe nicht geladen", color = ErrorColor, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f))
                    TextButton(onClick = { SideStores.sales.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
                }
            }

            val f = form
            if (f == null) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("${SalesOverview.dateText(sale.soldOn)} · ${sale.channelName} · ${if (active) "aktiv" else "storniert"}",
                        color = if (active) OnSurface else Muted, style = MaterialTheme.typography.bodyMedium)
                    data?.notes?.get(sale.saleId)?.takeIf { it.isNotBlank() }?.let {
                        Text(it, color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (doubleSold) {
                    Text("Karte doppelt verkauft – eine Position zählt beim anderen Verkauf.", color = ErrorColor,
                        style = MaterialTheme.typography.bodySmall)
                }
                val net = SalesMath.netCents(sale.gross, sale.fees, sale.shipping)
                val market = SalesOverview.marketCents(items)
                SpaceCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        SumRow("Preis", SalesMath.euroCentsText(SalesMath.toCents(sale.gross) ?: 0))
                        SumRow("Gebühren", SalesMath.euroCentsText(SalesMath.toCents(sale.fees) ?: 0))
                        SumRow("Versand", if (sale.shipping == null) "nicht erfasst" else SalesMath.euroCentsText(SalesMath.toCents(sale.shipping) ?: 0))
                        SumRow("Netto", SalesMath.euroCentsText(net))
                        SumRow("Marktwert", SalesMath.euroCentsText(market))
                        SumRow("Differenz", SalesMath.diffText(net, market), if (net >= market) Good else ErrorColor)
                    }
                }
            } else {
                val options = remember(data?.channels, sale) { SalesOverview.editChannels(data?.channels ?: emptyList(), sale) }
                val chosen = options.find { it.channelId == f.channelId }
                ExposedDropdownMenuBox(expanded = channelOpen, onExpandedChange = { channelOpen = it }) {
                    OutlinedTextField(
                        value = chosen?.name ?: sale.channelName, onValueChange = {}, readOnly = true,
                        label = { Text("Kanal") }, singleLine = true,
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = channelOpen) },
                        modifier = Modifier.menuAnchor().fillMaxWidth(),
                    )
                    ExposedDropdownMenu(expanded = channelOpen, onDismissRequest = { channelOpen = false }) {
                        options.forEach { c ->
                            DropdownMenuItem(text = { Text(c.name) }, onClick = { form = f.copy(channelId = c.channelId); channelOpen = false })
                        }
                    }
                }
                OutlinedTextField(value = f.soldOn, onValueChange = { form = f.copy(soldOn = it) }, label = { Text("Datum (JJJJ-MM-TT)") },
                    singleLine = true, isError = !SaleInput.dateOk(f.soldOn), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = f.gross, onValueChange = { form = f.copy(gross = it) }, label = { Text("Gesamtpreis (€)") },
                    singleLine = true, isError = !SaleInput.moneyOk(f.gross, required = true),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = f.fees, onValueChange = { form = f.copy(fees = it) }, label = { Text("Gebühren (€)") },
                        singleLine = true, isError = !SaleInput.moneyOk(f.fees, required = false),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                    OutlinedTextField(value = f.shipping, onValueChange = { form = f.copy(shipping = it) }, label = { Text("Versand (€)") },
                        placeholder = { Text("nicht erfasst") }, singleLine = true, isError = !SaleInput.moneyOk(f.shipping, required = false),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                }
                OutlinedTextField(value = f.note, onValueChange = { form = f.copy(note = it) }, label = { Text("Notiz") }, modifier = Modifier.fillMaxWidth())

                val inputsOk = SaleInput.moneyOk(f.gross, true) && SaleInput.moneyOk(f.fees, false) && SaleInput.moneyOk(f.shipping, false)
                val formNet = SalesMath.netCents(SaleInput.parseMoney(f.gross) ?: 0.0, SaleInput.parseMoney(f.fees), SaleInput.parseMoney(f.shipping))
                val formMarket = SalesOverview.marketCents(items, f.returned)
                Column {
                    Text("Netto ${if (inputsOk) SalesMath.euroCentsText(formNet) else "…"}", color = OnSurface, fontFamily = MonoFontFamily)
                    if (inputsOk) {
                        Text("${SalesMath.diffText(formNet, formMarket)} gegenüber Marktwert",
                            color = if (formNet >= formMarket) Good else ErrorColor, fontFamily = MonoFontFamily,
                            style = MaterialTheme.typography.bodySmall)
                    } else {
                        Text("… gegenüber Marktwert", color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items.forEach {
                    val gone = it.deleted
                    Row(
                        Modifier.fillMaxWidth().alpha(if (gone) 0.5f else 1f).clip(RoundedCornerShape(8.dp))
                            .background(Muted.copy(alpha = 0.08f))
                            .then(if (onOpenCard != null && form == null && !busy) Modifier.clickable { onOpenCard(it.cardId) } else Modifier)
                            .padding(6.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (it.imageUrl != null) {
                            AsyncImage(model = it.imageUrl, contentDescription = null,
                                modifier = Modifier.width(40.dp).height(56.dp).clip(RoundedCornerShape(4.dp)))
                        } else {
                            Box(Modifier.width(40.dp).height(56.dp).clip(RoundedCornerShape(4.dp)).background(Muted.copy(alpha = 0.15f)))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(it.name ?: it.cardId, color = OnSurface, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                            Text("${it.setCode} · ${it.rarity} · ${it.language}", color = Muted, fontFamily = MonoFontFamily, fontSize = 11.sp)
                            Text("${it.condition} · ${it.edition}", color = Muted, fontFamily = MonoFontFamily, fontSize = 11.sp)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("Marktwert ${SalesMath.euroCentsText(SalesMath.toCents(it.valueAtSale) ?: 0)}", color = Muted,
                                fontFamily = MonoFontFamily, fontSize = 11.sp)
                            if (gone) Text("zurückgenommen", color = Muted, fontSize = 11.sp)
                            else Text("Anteil ${SalesMath.euroCentsText(SalesMath.toCents(it.share) ?: 0)}", color = Gold,
                                fontFamily = MonoFontFamily, fontSize = 11.sp)
                        }
                    }
                    val f2 = form
                    if (f2 != null && !gone) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = it.copyId in f2.returned, enabled = !busy, onCheckedChange = { on ->
                                form = f2.copy(returned = if (on) f2.returned + it.copyId else f2.returned - it.copyId)
                            })
                            Text("zurücknehmen", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }

            if (active) {
                val f3 = form
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    if (f3 != null) {
                        val allReturned = items.none { !it.deleted && it.copyId !in f3.returned }
                        val canSave = !busy && !offline && !allReturned && SaleInput.dateOk(f3.soldOn) &&
                            SaleInput.moneyOk(f3.gross, true) && SaleInput.moneyOk(f3.fees, false) && SaleInput.moneyOk(f3.shipping, false)
                        if (allReturned) {
                            Text("Mindestens eine Karte muss im Verkauf bleiben – sonst stornieren.", color = ErrorColor,
                                style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f).align(Alignment.CenterVertically))
                        }
                        TextButton(onClick = { form = null; error = null }, enabled = !busy) { Text("Abbrechen") }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = { save() }, enabled = canSave) { Text(if (busy) "Wird gespeichert…" else "Speichern") }
                    } else {
                        TextButton(onClick = { confirmCancel = true }, enabled = !busy && !offline) {
                            Text(if (busy) "Wird storniert…" else "Stornieren", color = if (!busy && !offline) ErrorColor else Muted)
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = { startEdit() }, enabled = !busy && !offline) { Text("Bearbeiten") }
                    }
                }
            }
        }
    }

    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text("Verkauf stornieren?") },
            text = { Text("Alle Karten kommen in die Sammlung zurück.") },
            confirmButton = { TextButton(onClick = { confirmCancel = false; cancelSale() }) { Text("Stornieren", color = ErrorColor) } },
            dismissButton = { TextButton(onClick = { confirmCancel = false }) { Text("Abbrechen") } },
        )
    }
}

/**
 * Spec H2 §7 -- „Verkauft" in der Kartenansicht: verkaufte Exemplare dieser Karte (Datum, Kanal, Druck,
 * Anteil), stornierte durchgestrichen. Ohne Positionen (oder solange nicht geladen) erscheint nichts.
 */
@Composable
fun CardSoldSection(cardId: String) {
    val state by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val data = state.value
    val rows = remember(data, cardId) { data?.let { SalesOverview.cardSold(it, cardId) } ?: emptyList() }
    if (rows.isEmpty()) return
    Column {
        Spacer(Modifier.height(16.dp))
        SectionHeader("Verkauft")
        Spacer(Modifier.height(8.dp))
        rows.forEach { r ->
            val cancelled = r.sale.status == "storniert"
            val deco = if (cancelled) TextDecoration.LineThrough else null
            val color = if (cancelled) Muted.copy(alpha = 0.6f) else Muted
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(SalesOverview.dateText(r.sale.soldOn), fontFamily = MonoFontFamily, fontSize = 11.sp, color = color, textDecoration = deco)
                Text(r.sale.channelName, fontSize = 11.sp, color = color, textDecoration = deco, maxLines = 1)
                Text("${r.item.setCode} · ${r.item.rarity} · ${r.item.condition}", fontFamily = MonoFontFamily, fontSize = 11.sp,
                    color = color, textDecoration = deco, maxLines = 1, modifier = Modifier.weight(1f))
                Text(SalesMath.euroCentsText(SalesMath.toCents(r.item.share) ?: 0), fontFamily = MonoFontFamily, fontSize = 11.sp,
                    color = if (cancelled) color else Gold, textDecoration = deco)
            }
        }
    }
}
