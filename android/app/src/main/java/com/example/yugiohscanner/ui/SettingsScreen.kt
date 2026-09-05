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
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface

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
