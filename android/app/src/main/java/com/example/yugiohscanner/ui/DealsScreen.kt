package com.example.yugiohscanner.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.DealAlert
import com.example.yugiohscanner.cloud.DealWatch
import com.example.yugiohscanner.cloud.DealsRepository
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.launch

// Autonomous Deals tab: reads watches + alerts straight from Supabase (no desktop needed).
// Adding a watch or hitting refresh fires an immediate cloud scrape, then reloads.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DealsScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val alerts = remember { mutableStateListOf<DealAlert>() }
    val watches = remember { mutableStateListOf<DealWatch>() }
    var query by remember { mutableStateOf("") }
    var maxPrice by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reloadFromCloud() {
        watches.clear(); watches.addAll(DealsRepository.loadWatches())
        alerts.clear(); alerts.addAll(DealsRepository.loadAlerts())
    }

    fun refresh(scrapeFirst: Boolean = true) {
        scope.launch {
            loading = true
            try {
                if (scrapeFirst) DealsRepository.triggerScrape()
                reloadFromCloud()
                error = null
            } catch (e: Exception) { error = e.message }
            loading = false
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val addWatch = {
        val p = maxPrice.toDoubleOrNull()
        if (query.isNotBlank() && p != null) {
            val q = query.trim()
            query = ""; maxPrice = ""
            scope.launch {
                loading = true
                try {
                    DealsRepository.addWatch(q, p)
                    DealsRepository.triggerScrape()
                    reloadFromCloud()
                    error = null
                } catch (e: Exception) { error = e.message }
                loading = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Deals", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                Spacer(Modifier.weight(1f))
                if (loading) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Primary)
                } else {
                    IconButton(onClick = { refresh() }) {
                        Icon(Icons.Default.Refresh, "Aktualisieren", tint = OnSurface)
                    }
                }
            }
            error?.let {
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(top = 4.dp))
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = query, onValueChange = { query = it },
                    placeholder = { Text("Suchbegriff, z.B. Battles of Legend …") },
                    singleLine = true, modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = maxPrice, onValueChange = { maxPrice = it.filter { c -> c.isDigit() || c == '.' } },
                    placeholder = { Text("≤ €") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.width(96.dp)
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = addWatch) { Icon(Icons.Default.Add, "Watch") }
            }

            if (watches.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(watches) { w ->
                        InputChip(
                            selected = false,
                            onClick = {},
                            label = { Text("${w.query}  ≤${w.maxPrice.toInt()}€") },
                            trailingIcon = {
                                Icon(Icons.Default.Close, "Löschen",
                                    modifier = Modifier.size(18.dp).clickable {
                                        scope.launch {
                                            try { DealsRepository.deleteWatch(w.id); reloadFromCloud() }
                                            catch (e: Exception) { error = e.message }
                                        }
                                    })
                            }
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            if (alerts.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (loading) "Suche Deals …" else "Noch keine Deals. Lege einen Watch an.",
                        color = Muted
                    )
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(alerts, key = { it.id }) { d -> DealRow(d, context, onDismiss = {
                        scope.launch {
                            try { DealsRepository.dismissAlert(d.id); alerts.remove(d) }
                            catch (e: Exception) { error = e.message }
                        }
                    }) }
                }
            }
        }
    }
}

@Composable
private fun DealRow(d: DealAlert, context: android.content.Context, onDismiss: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            // Listing photo (falls back to a placeholder tile).
            Box(
                Modifier.size(60.dp).clip(RoundedCornerShape(10.dp)).background(Background),
                contentAlignment = Alignment.Center,
            ) {
                if (!d.imageUrl.isNullOrBlank()) {
                    AsyncImage(model = d.imageUrl, contentDescription = d.title,
                        contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                } else {
                    Icon(Icons.Default.Image, null, tint = Muted, modifier = Modifier.size(24.dp))
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(d.title, color = OnSurface, maxLines = 2, fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SourceBadge(d.source)
                    Spacer(Modifier.width(8.dp))
                    Text(d.price?.let { "${it.toInt()} €" } ?: "—", color = Gold,
                        style = MaterialTheme.typography.titleMedium.copy(fontFamily = MonoFontFamily))
                }
            }
            IconButton(onClick = {
                if (d.url.isNotBlank()) context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(d.url)))
            }) { Icon(Icons.Default.OpenInNew, "Öffnen", tint = Primary) }
            IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Ausblenden", tint = Muted) }
        }
    }
}

@Composable
private fun SourceBadge(source: String) {
    val label = when (source.lowercase()) {
        "kleinanzeigen" -> "Kleinanzeigen"
        else -> source.replaceFirstChar { it.uppercase() }
    }
    Box(
        Modifier.clip(RoundedCornerShape(6.dp)).background(Line).padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(label, color = Muted, fontSize = 11.sp)
    }
}
