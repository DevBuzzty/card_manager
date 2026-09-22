package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.EbayRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.EbayMarks
import com.example.yugiohscanner.ml.openWebLink
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val KIND_LABEL = mapOf(
    "payment" to "Zahlungsrichtlinie", "fulfillment" to "Versandrichtlinie",
    "return" to "Rücknahmerichtlinie", "location" to "Artikelstandort",
)
private val SELECT_FIELD = mapOf(
    "payment" to "payment_policy_id", "fulfillment" to "fulfillment_policy_id",
    "return" to "return_policy_id", "location" to "location_key",
)
private val KIND_ORDER = listOf("payment", "fulfillment", "return", "location")

private fun localTime(iso: String): String = runCatching {
    val odt = runCatching { OffsetDateTime.parse(iso) }
        .recoverCatching { OffsetDateTime.ofInstant(Instant.parse(iso), ZoneOffset.UTC) }
        .getOrElse { LocalDateTime.parse(iso).atOffset(ZoneOffset.UTC) }
    odt.atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT))
}.getOrDefault(iso)

/**
 * Spec H3b1 §4.4 -- Einstellungen „eBay“ am Handy (Gegenstück zu desktop/src/components/EbaySettings.jsx): Umgebung,
 * Verbinden/Trennen, Check-Liste, Richtlinien-Auswahl, Standort anlegen, „Jetzt abgleichen“, letzter Lauf/Fehler.
 * Alles eBay-Wissen liegt in ebay-auth/ebay-sync (Task 2/4/5) -- hier nur Anzeige und Aufruf. Ein gemeinsames
 * InFlight-Gatter wie SaleChannelSettings; nach jeder erfolgreichen Aktion SideStores.ebayStatus.refreshAndWait().
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EbaySettings() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var check by remember { mutableStateOf<JSONObject?>(null) }
    var postalCode by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var confirmDisconnect by remember { mutableStateOf(false) }
    var confirmEnv by remember { mutableStateOf<String?>(null) }
    var dropdownOpenKind by remember { mutableStateOf<String?>(null) }

    val state by SideStores.ebayStatus.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.ebayStatus.ensureLoaded() }
    val pair = state.value?.firstOrNull()
    val status = pair?.first
    val runInfo = pair?.second
    val today = remember { LocalDate.now().toString() }

    fun run(action: suspend () -> Unit) {
        if (!inFlight.tryStart()) return
        busy = true; error = null; notice = null
        scope.launch {
            try { action() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "eBay-Aufruf fehlgeschlagen." }
            finally { inFlight.finish(); busy = false }
        }
    }
    fun auth(action: String, extra: JSONObject = JSONObject(), after: (JSONObject) -> Unit = {}) = run {
        val r = EbayRepository.auth(action, extra)
        if (!r.optBoolean("ok")) { error = r.optString("error").ifEmpty { "eBay-Aufruf fehlgeschlagen." }; return@run }
        if (r.has("payment")) check = r
        SideStores.ebayStatus.refreshAndWait()
        after(r)
    }
    fun connect() = auth("start", after = { r ->
        if (!openWebLink(ctx, r.optString("url"))) error = "Ungültige Adresse von eBay."
        else notice = "Browser geöffnet – nach dem Bestätigen hier „Prüfen“ tippen."
    })
    fun disconnect() = auth("disconnect", after = { check = null })
    fun switchEnv(env: String) = auth("set_environment", JSONObject().put("environment", env), after = { check = null })
    fun select(kind: String, id: String) = auth("select", JSONObject().put(SELECT_FIELD.getValue(kind), id))
    fun createLocation() = auth(
        "create_location", JSONObject().put("postal_code", postalCode).put("city", city),
        after = { postalCode = ""; city = "" },
    )
    fun syncNow() = run {
        val r = EbayRepository.syncNow()
        if (!r.optBoolean("ok")) { error = r.optString("error").ifEmpty { "eBay-Abgleich fehlgeschlagen." }; return@run }
        notice = if (r.optBoolean("busy")) "Abgleich läuft schon." else "Abgleich fertig: ${r.optString("text")}"
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader("eBay")
        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (state.value == null && state.error == null) {
                    Text("…", color = Muted)
                } else if (status == null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "eBay-Stand nicht geladen", color = ErrorColor, style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { SideStores.ebayStatus.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Umgebung", style = MaterialTheme.typography.labelSmall, color = Muted)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("sandbox" to "Sandbox", "production" to "Produktion").forEach { (env, label) ->
                                FilterChip(
                                    selected = status.environment == env,
                                    onClick = { if (status.environment != env) confirmEnv = env },
                                    enabled = !busy, label = { Text(label) },
                                )
                            }
                        }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Verbindung", style = MaterialTheme.typography.labelSmall, color = Muted)
                        if (status.connected) {
                            TextButton(onClick = { confirmDisconnect = true }, enabled = !busy, contentPadding = PaddingValues(0.dp)) {
                                Text("Trennen", color = ErrorColor)
                            }
                        } else {
                            Button(onClick = { connect() }, enabled = !busy) { Text("Verbinden") }
                        }
                        EbayMarks.expiryText(status, today)?.let { Text(it, color = Gold, style = MaterialTheme.typography.bodySmall) }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Einrichtung", style = MaterialTheme.typography.labelSmall, color = Muted)
                        EbayMarks.setupItems(status).forEach { item ->
                            Text(
                                "${if (item.ok) "✓" else "✗"} ${item.label}", color = if (item.ok) Good else ErrorColor,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        TextButton(onClick = { auth("check") }, enabled = !busy && status.connected, contentPadding = PaddingValues(0.dp)) {
                            Text("Prüfen")
                        }

                        check?.let { c ->
                            if (c.has("programOk") && !c.optBoolean("programOk", true)) {
                                Text("Geschäftsrichtlinien sind im eBay-Konto nicht aktiviert.", color = ErrorColor, style = MaterialTheme.typography.bodySmall)
                            }
                            KIND_ORDER.forEach { kind ->
                                val k = c.optJSONObject(kind) ?: return@forEach
                                val options = k.optJSONArray("options")
                                val n = options?.length() ?: 0
                                if (n > 1) {
                                    val selectedId = if (k.isNull("selected")) null else k.optString("selected")
                                    val selectedName = (0 until n).map { options!!.getJSONObject(it) }
                                        .find { it.optString("id") == selectedId }?.optString("name")
                                    val open = dropdownOpenKind == kind
                                    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { dropdownOpenKind = if (it) kind else null }) {
                                        OutlinedTextField(
                                            value = selectedName ?: "— wählen —", onValueChange = {}, readOnly = true,
                                            label = { Text(KIND_LABEL.getValue(kind)) },
                                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
                                            modifier = Modifier.menuAnchor().fillMaxWidth(),
                                        )
                                        ExposedDropdownMenu(expanded = open, onDismissRequest = { dropdownOpenKind = null }) {
                                            for (i in 0 until n) {
                                                val o = options!!.getJSONObject(i)
                                                DropdownMenuItem(
                                                    text = { Text(o.optString("name")) },
                                                    onClick = { dropdownOpenKind = null; select(kind, o.optString("id")) },
                                                )
                                            }
                                        }
                                    }
                                } else if (n == 0 && kind != "location") {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "Keine ${KIND_LABEL.getValue(kind)} bei eBay – bitte im Verkäuferkonto anlegen.",
                                            color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
                                        )
                                        val page = c.optString("policyPage")
                                        if (page.isNotEmpty()) {
                                            TextButton(onClick = { if (!openWebLink(ctx, page)) error = "Link konnte nicht geöffnet werden." }) {
                                                Text("Seite öffnen")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (status.connected && !status.hasLocation) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Standort anlegen", style = MaterialTheme.typography.labelSmall, color = Muted)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(
                                    value = postalCode, onValueChange = { postalCode = it.filter(Char::isDigit).take(5) },
                                    label = { Text("PLZ") }, singleLine = true,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    modifier = Modifier.width(96.dp),
                                )
                                OutlinedTextField(
                                    value = city, onValueChange = { city = it }, label = { Text("Ort") }, singleLine = true,
                                    modifier = Modifier.width(160.dp),
                                )
                            }
                            Button(onClick = { createLocation() }, enabled = !busy && postalCode.length == 5 && city.isNotBlank()) {
                                Text("Standort anlegen")
                            }
                        }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Button(onClick = { syncNow() }, enabled = !busy) { Text("Jetzt abgleichen") }
                        runInfo?.lastRunAt?.let {
                            Text("Letzter Abgleich: ${localTime(it)} – ${runInfo.summary}", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        runInfo?.lastError?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
                    }

                    Text(
                        "Solange der Check nicht vollständig ist, bleiben eBay-Angebote auf „wartet“.",
                        color = Muted, style = MaterialTheme.typography.bodySmall,
                    )
                }
                notice?.let { Text(it, color = Good, style = MaterialTheme.typography.bodySmall) }
                error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }

    if (confirmDisconnect) {
        AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            title = { Text("eBay trennen?") },
            text = { Text("Neue eBay-Angebote warten dann.") },
            confirmButton = { TextButton(onClick = { confirmDisconnect = false; disconnect() }) { Text("Trennen") } },
            dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Abbrechen") } },
        )
    }
    confirmEnv?.let { env ->
        AlertDialog(
            onDismissRequest = { confirmEnv = null },
            title = { Text("Umgebung wechseln?") },
            text = { Text("Umgebung wechseln trennt die Verbindung und leert die Einrichtung.") },
            confirmButton = { TextButton(onClick = { confirmEnv = null; switchEnv(env) }) { Text("Wechseln") } },
            dismissButton = { TextButton(onClick = { confirmEnv = null }) { Text("Abbrechen") } },
        )
    }
}
