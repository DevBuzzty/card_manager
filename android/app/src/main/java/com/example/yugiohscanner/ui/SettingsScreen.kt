package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.BuildConfig
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogState
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
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
        }

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
