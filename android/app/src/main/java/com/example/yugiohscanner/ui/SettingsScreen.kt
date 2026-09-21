package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.BuildConfig
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogState
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.SaleChannel
import com.example.yugiohscanner.cloud.SalesRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SaleInput
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val PRICE_SOURCES = listOf(
    "cardmarket" to "Cardmarket", "tcgplayer" to "TCGplayer", "ebay" to "eBay",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(prefs: SharedPreferences, onBack: () -> Unit, onLoggedOut: () -> Unit) {
    val email = remember { prefs.getString("supabase_email", "") ?: "" }
    var ip by remember { mutableStateOf(prefs.getString("ip_address", "") ?: "") }
    var priceSource by remember { mutableStateOf(prefs.getString("price_source", "cardmarket") ?: "cardmarket") }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
            Spacer(Modifier.width(4.dp))
            Text("Einstellungen", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
        }

        // ---- Konto ------------------------------------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Konto")
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(9.dp).clip(CircleShape)
                            .background(if (email.isNotBlank()) Good else Muted))
                        Spacer(Modifier.width(10.dp))
                        Text(if (email.isNotBlank()) email else "Nicht verbunden", color = OnSurface)
                    }
                    if (email.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        TextButton(onClick = {
                            prefs.edit().putString("supabase_password", "").apply()
                            onLoggedOut()
                        }, contentPadding = PaddingValues(0.dp)) {
                            Text("Abmelden", color = ErrorColor)
                        }
                    }
                }
            }
        }

        // ---- Desktop-Verbindung (optional) -----------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Desktop-Verbindung")
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Optional — nur zum Übertragen gescannter Karten an die Desktop-App.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = ip,
                        onValueChange = { ip = it; prefs.edit().putString("ip_address", it.trim()).apply() },
                        label = { Text("IP-Adresse") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        // ---- Katalog --------------------------------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Katalog")
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    val scope = rememberCoroutineScope()
                    val catalogState by CatalogSync.state.collectAsState()
                    var catalogVersion by remember { mutableStateOf(0) }
                    var catalogCards by remember { mutableStateOf(0) }
                    var mobileOk by remember { mutableStateOf(prefs.getBoolean("catalog_mobile_ok", false)) }

                    // Only re-reads the DB when the sync moves to a new phase (e.g. Importing ->
                    // Ready) — not on every Downloading percent tick. Reads go through
                    // CatalogRepository's long-lived connection rather than opening a third
                    // CatalogDb on the same file, and a failed read keeps the last known values
                    // instead of throwing out of the coroutine and killing the screen.
                    LaunchedEffect(catalogState::class) {
                        val read = withContext(Dispatchers.IO) {
                            runCatching { CatalogRepository.version() to CatalogRepository.cardCount() }
                        }
                        read.getOrNull()?.let { (version, cards) ->
                            catalogVersion = version
                            catalogCards = cards
                        }
                    }

                    Text(
                        if (catalogVersion > 0) "Version $catalogVersion · $catalogCards Karten" else "Noch nicht geladen",
                        color = OnSurface,
                    )
                    val statusText = when (val s = catalogState) {
                        is CatalogState.Idle -> null
                        is CatalogState.Checking -> "Wird geprüft…"
                        is CatalogState.Downloading -> "Wird geladen … ${s.percent} %"
                        is CatalogState.Importing -> "Wird importiert…"
                        is CatalogState.Ready -> "Aktuell"
                        is CatalogState.Failed -> "Fehlgeschlagen: ${s.reason}"
                    }
                    if (statusText != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            statusText,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (catalogState is CatalogState.Failed) ErrorColor else Muted,
                        )
                    }

                    Spacer(Modifier.height(12.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text("Auch über Mobilfunk laden", color = OnSurface)
                        Switch(
                            checked = mobileOk,
                            onCheckedChange = {
                                mobileOk = it
                                prefs.edit().putBoolean("catalog_mobile_ok", it).apply()
                            },
                        )
                    }

                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { scope.launch { CatalogSync.checkAndUpdate(ctx, force = true) } }) {
                        Text("Jetzt prüfen")
                    }
                }
            }
        }

        // ---- Preise -------------------------------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Preise")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PRICE_SOURCES.forEach { (key, label) ->
                    FilterChip(
                        selected = priceSource == key,
                        onClick = { priceSource = key; prefs.edit().putString("price_source", key).apply() },
                        label = { Text(label) },
                    )
                }
            }
        }

        // ---- Preis-Alarme (Spec G2) ----------------------------------------
        PriceAlertSettingsSection()

        // ---- Standards ----------------------------------------------------
        val ctx = androidx.compose.ui.platform.LocalContext.current
        var defEdition by remember { mutableStateOf(com.example.yugiohscanner.Prefs.defaultEdition(ctx)) }
        var defCondition by remember { mutableStateOf(com.example.yugiohscanner.Prefs.defaultCondition(ctx)) }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Standards")
            Text("Jeder Scan legt Exemplare mit diesen Werten an. Abweichungen setzt du pro Zeile.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
            Text("Zustand", style = MaterialTheme.typography.labelSmall, color = Muted)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                com.example.yugiohscanner.cloud.Valuation.CONDITIONS.forEach { c ->
                    FilterChip(selected = defCondition == c, onClick = { defCondition = c; com.example.yugiohscanner.Prefs.setDefaultCondition(ctx, c) }, label = { Text(c) })
                }
            }
            Text("Edition", style = MaterialTheme.typography.labelSmall, color = Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                com.example.yugiohscanner.cloud.Valuation.EDITIONS.forEach { e ->
                    FilterChip(selected = defEdition == e, onClick = { defEdition = e; com.example.yugiohscanner.Prefs.setDefaultEdition(ctx, e) },
                        label = { Text(com.example.yugiohscanner.cloud.Valuation.EDITION_LABELS[e] ?: e) })
                }
            }
            // Spec H1 §4: keep_per_card -- gespeichert beim Verlassen des Felds oder "Fertig", normalisiert (ungültig -> 3).
            var keepInput by remember { mutableStateOf(com.example.yugiohscanner.Prefs.keepPerCard(ctx).toString()) }
            var keepFocused by remember { mutableStateOf(false) }
            fun saveKeep() { keepInput = com.example.yugiohscanner.Prefs.setKeepPerCard(ctx, keepInput).toString() }
            Text("Duplikate: behalten je Karte", style = MaterialTheme.typography.labelSmall, color = Muted)
            OutlinedTextField(
                value = keepInput, onValueChange = { keepInput = it.filter(Char::isDigit).take(2) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { saveKeep() }),
                modifier = Modifier.width(96.dp).onFocusChanged { f ->
                    if (keepFocused && !f.isFocused) saveKeep()
                    keepFocused = f.isFocused
                },
            )
            Text("Ganze Zahl 1–99, Standard 3. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
        }

        // ---- Preisvorschlag (Spec H2 §9 / Abweichung 5) --------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Preisvorschlag")
            Text("Vorschlag beim Verkaufen = Marktwert abzüglich Abschlag, mindestens der Mindestpreis.",
                style = MaterialTheme.typography.bodySmall, color = Muted)

            var discountInput by remember { mutableStateOf(com.example.yugiohscanner.Prefs.saleDiscount(ctx).toString()) }
            var discountFocused by remember { mutableStateOf(false) }
            fun saveDiscount() { discountInput = com.example.yugiohscanner.Prefs.setSaleDiscount(ctx, discountInput).toString() }
            Text("Abschlag (%)", style = MaterialTheme.typography.labelSmall, color = Muted)
            OutlinedTextField(
                value = discountInput, onValueChange = { discountInput = it.filter(Char::isDigit).take(2) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { saveDiscount() }),
                modifier = Modifier.width(96.dp).onFocusChanged { f ->
                    if (discountFocused && !f.isFocused) saveDiscount()
                    discountFocused = f.isFocused
                },
            )
            Text("Ganze Zahl 0–90, Standard 5. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.",
                style = MaterialTheme.typography.bodySmall, color = Muted)

            var minInput by remember { mutableStateOf(String.format(java.util.Locale.GERMANY, "%.2f", com.example.yugiohscanner.Prefs.saleMinCents(ctx) / 100.0)) }
            var minFocused by remember { mutableStateOf(false) }
            fun saveMin() { minInput = String.format(java.util.Locale.GERMANY, "%.2f", com.example.yugiohscanner.Prefs.setSaleMinPrice(ctx, minInput) / 100.0) }
            Text("Mindestpreis (€)", style = MaterialTheme.typography.labelSmall, color = Muted)
            OutlinedTextField(
                value = minInput, onValueChange = { minInput = it.filter { c -> c.isDigit() || c == ',' || c == '.' }.take(6) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { saveMin() }),
                modifier = Modifier.width(96.dp).onFocusChanged { f ->
                    if (minFocused && !f.isFocused) saveMin()
                    minFocused = f.isFocused
                },
            )
            Text("0,00–100,00 €, Standard 0,10 €. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
        }

        // ---- Verkaufskanäle (Spec H2 §8) ---------------------------------------
        SaleChannelSettings()

        // ---- Über -------------------------------------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Über")
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Card Scanner", color = OnSurface, style = MaterialTheme.typography.titleMedium)
                    Text("Version ${BuildConfig.VERSION_NAME}", color = Muted,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

private fun feeText(v: Double): String =
    if (v == Math.floor(v)) v.toLong().toString() else v.toString().replace('.', ',')

/**
 * Spec H2 §8 -- Verkaufskanäle wie am PC (Settings.jsx#SaleChannelSettings): Gebühr je Kanal ändern,
 * eigene Kanäle anlegen, umbenennen und ausblenden. Feste Kanäle behalten ihren Namen und lassen sich
 * nicht ausblenden (die Cloud ignorierte es still). Schreibvorgänge durch [InFlight], danach neu laden.
 */
@Composable
private fun SaleChannelSettings() {
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val state by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val channels = state.value?.channels
    // Entwürfe je Kanal (Name, Gebühr), neu vorbelegt bei jedem Laden -- wie setDrafts am PC.
    val drafts = remember(channels) {
        mutableStateMapOf<String, Pair<String, String>>().apply { channels?.forEach { put(it.channelId, it.name to feeText(it.feePercent)) } }
    }
    var newName by remember { mutableStateOf("") }
    var newFee by remember { mutableStateOf("") }

    fun write(action: suspend () -> Unit) {
        if (!inFlight.tryStart()) return
        busy = true
        error = null
        scope.launch {
            try {
                action()
                SideStores.sales.refreshAndWait()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "Speichern fehlgeschlagen."
            } finally {
                inFlight.finish()
                busy = false
            }
        }
    }

    fun save(c: SaleChannel) {
        val (name, feeRaw) = drafts[c.channelId] ?: (c.name to feeText(c.feePercent))
        val fee = SaleInput.parsePercent(feeRaw) ?: run { error = "Die Gebühr muss zwischen 0 und 100 % liegen."; return }
        write { SalesRepository.saveChannel(c.channelId, if (c.builtin) c.name else name, fee) }
    }

    fun create() {
        val fee = SaleInput.parsePercent(newFee) ?: run { error = "Die Gebühr muss zwischen 0 und 100 % liegen."; return }
        write {
            SalesRepository.saveChannel(null, newName, fee)
            newName = ""
            newFee = ""
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader("Verkaufskanäle")
        if (channels == null) {
            if (state.error != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Kanäle konnten nicht geladen werden.", color = ErrorColor, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f))
                    TextButton(onClick = { SideStores.sales.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
                }
            } else {
                Text("…", color = Muted)
            }
        } else {
            channels.forEach { c ->
                val d = drafts[c.channelId] ?: (c.name to feeText(c.feePercent))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (c.builtin) {
                        Text(c.name, color = OnSurface, modifier = Modifier.weight(1f))
                    } else {
                        OutlinedTextField(value = d.first, onValueChange = { drafts[c.channelId] = it to d.second }, singleLine = true,
                            modifier = Modifier.weight(1f))
                    }
                    OutlinedTextField(value = d.second, onValueChange = { drafts[c.channelId] = d.first to it }, singleLine = true,
                        isError = SaleInput.parsePercent(d.second) == null, suffix = { Text("%") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(88.dp))
                    TextButton(onClick = { save(c) }, enabled = !busy, contentPadding = PaddingValues(horizontal = 6.dp)) { Text("Speichern") }
                }
                if (!c.builtin) {
                    TextButton(onClick = { write { SalesRepository.hideChannel(c.channelId) } }, enabled = !busy,
                        contentPadding = PaddingValues(0.dp)) { Text("Ausblenden", color = Muted) }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(value = newName, onValueChange = { newName = it }, placeholder = { Text("Neuer Kanal") }, singleLine = true,
                    modifier = Modifier.weight(1f))
                OutlinedTextField(value = newFee, onValueChange = { newFee = it }, placeholder = { Text("0") }, singleLine = true,
                    isError = SaleInput.parsePercent(newFee) == null, suffix = { Text("%") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(88.dp))
                TextButton(onClick = { create() }, enabled = !busy && newName.isNotBlank(), contentPadding = PaddingValues(horizontal = 6.dp)) {
                    Text("Anlegen")
                }
            }
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
        Text("Gebühren sind vorbelegt – bitte mit deinen eigenen Konditionen abgleichen. Alte Verkäufe behalten den Namen, den der Kanal beim Buchen hatte.",
            style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}
