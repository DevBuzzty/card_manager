package com.example.yugiohscanner.ui

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.DealAlert
import com.example.yugiohscanner.cloud.DealWatch
import com.example.yugiohscanner.cloud.DealsRepository
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

    Surface(Modifier.fillMaxSize(), color = Color(0xFF121212)) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Deals", style = MaterialTheme.typography.headlineSmall, color = Color.White)
                Spacer(Modifier.weight(1f))
                if (loading) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Color(0xFF9D00FF))
                } else {
                    IconButton(onClick = { refresh() }) {
                        Icon(Icons.Default.Refresh, "Aktualisieren", tint = Color.White)
                    }
                }
            }
            error?.let {
                Text(it, color = Color(0xFFEF4444), style = MaterialTheme.typography.labelSmall,
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
                        color = Color(0xFF888888)
                    )
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(alerts, key = { it.id }) { d ->
                        Surface(color = Color(0xFF1E1E1E), shape = RoundedCornerShape(12.dp)) {
                            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(d.title, color = Color.White, maxLines = 2,
                                        style = MaterialTheme.typography.bodyMedium)
                                    Text(d.source, color = Color(0xFF888888),
                                        style = MaterialTheme.typography.labelSmall)
                                }
                                Spacer(Modifier.width(8.dp))
                                Text(d.price?.let { "${it.toInt()} €" } ?: "—", color = Color(0xFFF5C542),
                                    style = MaterialTheme.typography.titleMedium)
                                IconButton(onClick = {
                                    if (d.url.isNotBlank()) context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse(d.url))
                                    )
                                }) { Icon(Icons.Default.OpenInNew, "Öffnen", tint = Color(0xFF9D00FF)) }
                                IconButton(onClick = {
                                    scope.launch {
                                        try { DealsRepository.dismissAlert(d.id); alerts.remove(d) }
                                        catch (e: Exception) { error = e.message }
                                    }
                                }) { Icon(Icons.Default.Close, "Ausblenden", tint = Color(0xFF888888)) }
                            }
                        }
                    }
                }
            }
        }
    }
}
