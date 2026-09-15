package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogSealedProduct
import com.example.yugiohscanner.cloud.SealedRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SealedValue
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Spec G3 §8 -- Suche in `sealed_products` (catalog.db), Treffer mit Name, Art und Trend; Menge; "Hinzufuegen".
 * Leere Tabelle (Katalog von vor G3 oder noch nie geladen): Hinweis auf die Einstellungen.
 */
@Composable
fun SealedSearchScreen(onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<CatalogSealedProduct>?>(null) }
    var available by remember { mutableStateOf<Boolean?>(null) }
    var selected by remember { mutableStateOf<CatalogSealedProduct?>(null) }
    var quantity by remember { mutableStateOf("1") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // SQLite nie aus der Komposition lesen (wie catalogReady in StartScreen).
    LaunchedEffect(Unit) {
        available = withContext(Dispatchers.IO) {
            runCatching { CatalogRepository.sealedProductCount() > 0 }.getOrDefault(false)
        }
    }

    BackHandler(selected != null) { selected = null; error = null }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (selected != null) { selected = null; error = null } else onClose() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück")
            }
            Text("Sealed hinzufügen", style = MaterialTheme.typography.titleLarge)
        }

        val product = selected
        if (product != null) {
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(product.name, style = MaterialTheme.typography.titleMedium, color = OnSurface)
                    Text(SealedValue.kindLabel(product.kind), style = MaterialTheme.typography.labelSmall, color = Muted)
                    ValueText(product.trend, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = quantity, onValueChange = { quantity = it.filter(Char::isDigit) },
                label = { Text("Menge") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.width(140.dp),
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(12.dp))
            Button(enabled = !busy, onClick = {
                val qty = quantity.toIntOrNull()
                if (qty == null || qty < 1) {
                    error = "Die Menge muss mindestens 1 sein."
                } else {
                    busy = true
                    scope.launch {
                        try {
                            SealedRepository.add(product, qty)
                            SideStores.sealedItems.refreshAndWait()
                            onClose()
                        } catch (e: Exception) {
                            error = e.message ?: "Speichern fehlgeschlagen"
                        }
                        busy = false
                    }
                }
            }) { Text(if (busy) "Wird gespeichert…" else "Hinzufügen") }
        } else {
            if (available == false) {
                Text("Produktliste noch nicht geladen — Katalog in den Einstellungen prüfen",
                    color = ErrorColor, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
            }
            OutlinedTextField(query, { query = it }, label = { Text("Produktname") },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Button(enabled = !busy && query.isNotBlank() && available == true, onClick = {
                busy = true
                scope.launch {
                    results = try {
                        error = null
                        withContext(Dispatchers.IO) { CatalogRepository.searchSealed(query) }
                    } catch (e: Exception) {
                        error = e.message ?: "Suche fehlgeschlagen"
                        null
                    }
                    busy = false
                }
            }) { Text(if (busy) "Suche…" else "Suchen") }
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            results?.let { list ->
                if (list.isEmpty()) {
                    Text("Keine Treffer", color = Muted, style = MaterialTheme.typography.bodySmall)
                } else {
                    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(list, key = { it.cmProductId }) { p ->
                            SpaceCard(Modifier.fillMaxWidth().clickable { error = null; quantity = "1"; selected = p }) {
                                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(p.name, style = MaterialTheme.typography.bodyMedium, color = OnSurface, maxLines = 2)
                                        Text(SealedValue.kindLabel(p.kind), style = MaterialTheme.typography.labelSmall, color = Muted)
                                    }
                                    ValueText(p.trend, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
