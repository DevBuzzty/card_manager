package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
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
fun SettingsScreen(prefs: SharedPreferences, onLoggedOut: () -> Unit) {
    val email = remember { prefs.getString("supabase_email", "") ?: "" }
    var ip by remember { mutableStateOf(prefs.getString("ip_address", "") ?: "") }
    var priceSource by remember { mutableStateOf(prefs.getString("price_source", "cardmarket") ?: "cardmarket") }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text("Einstellungen", style = MaterialTheme.typography.headlineSmall, color = OnSurface)

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

        // ---- Preisquelle ------------------------------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Preisquelle")
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

        // ---- Über -------------------------------------------------------------
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Über")
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Card Scanner", color = OnSurface, style = MaterialTheme.typography.titleMedium)
                    Text("Yu-Gi-Oh! Sammlung · Wert · Deals", color = Muted,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
