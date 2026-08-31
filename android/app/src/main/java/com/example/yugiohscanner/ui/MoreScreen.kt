package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

@Composable
fun MoreScreen(prefs: SharedPreferences, onLoggedOut: () -> Unit) {
    var sub by remember { mutableStateOf<String?>(null) }

    // Full-screen sub-views take over the whole tab.
    if (sub == "wishlist") {
        WishlistScreen(onClose = { sub = null })
        return
    }
    if (sub == "settings") {
        Surface(Modifier.fillMaxSize(), color = Background) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { sub = null }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                    }
                }
                SettingsScreen(prefs, onLoggedOut)
            }
        }
        return
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mehr", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
            Spacer(Modifier.height(2.dp))
            MenuRow(Icons.Default.FavoriteBorder, "Wishlist", onClick = { sub = "wishlist" })
            MenuRow(Icons.Default.Dashboard, "Set-Vervollständigung", soon = true)
            MenuRow(Icons.Default.Style, "Decks", soon = true)
            MenuRow(Icons.Default.Settings, "Einstellungen", onClick = { sub = "settings" })
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, soon: Boolean = false, onClick: () -> Unit = {}) {
    val cardModifier = if (soon) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().clickable { onClick() }
    SpaceCard(cardModifier) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = Primary)
            Spacer(Modifier.width(14.dp))
            Text(label, color = OnSurface, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f))
            if (soon) {
                Text("Bald", color = Muted, style = MaterialTheme.typography.bodySmall)
            } else {
                Icon(Icons.Default.ChevronRight, null, tint = Muted)
            }
        }
    }
}
