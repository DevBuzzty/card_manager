package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.cloud.SealedRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SealedValue
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.launch

private const val SEALED_LOAD_ERROR = "Sealed-Bestand konnte nicht geladen werden — zum Aktualisieren ziehen"

/** Was nach einer Rueckfrage passieren soll. */
private enum class SealedConfirm { OPEN_LAST, DELETE }

/**
 * Spec G3 §8 -- Sammlung › Sealed. Liste aus SideStores.sealedItems, Schreiben per REST (SealedRepository),
 * danach refreshAndWait. Reihenfolge, Summen und "Preis veraltet" aus ml/SealedValue (Zwilling des Desktops).
 */
@Composable
fun SealedScreen(onOpenScan: () -> Unit, onOpenSuche: () -> Unit) {
    val scope = rememberCoroutineScope()
    val cache by SideStores.sealedItems.state.collectAsState()
    val rows = remember(cache.value) { cache.value?.let { SealedValue.sortSealed(it) } }
    val total = remember(cache.value) { cache.value?.let { SealedValue.sealedValue(it) } }
    // "jetzt" und die Veraltung nur neu, wenn sich die Liste aendert -- nicht bei jeder Komposition.
    val staleIds = remember(cache.value) {
        val now = System.currentTimeMillis()
        cache.value.orEmpty().filter { it.price != null && SealedValue.isPriceStale(it.priceUpdatedAt, now) }
            .map { it.sealedId }.toSet()
    }
    var busy by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Pair<SealedItem, SealedConfirm>?>(null) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { SideStores.sealedItems.refresh() }

    fun write(block: suspend () -> Unit, afterSuccess: () -> Unit = {}) {
        scope.launch {
            busy = true
            try {
                block()
                writeError = null
                afterSuccess()
            } catch (e: Exception) {
                writeError = e.message ?: "Speichern fehlgeschlagen"
            } finally {
                SideStores.sealedItems.refreshAndWait()
                busy = false
            }
        }
    }

    // Eigener launch: showSnackbar haelt an, bis der Schnipsel verschwindet (wie in SortIntoBinderScreen).
    fun showOpened() {
        scope.launch {
            val r = snackbar.showSnackbar(message = "Geöffnet", actionLabel = "Jetzt scannen", duration = SnackbarDuration.Short)
            if (r == SnackbarResult.ActionPerformed) onOpenScan()
        }
    }

    fun open(item: SealedItem) {
        if (item.quantity > 1) write({ SealedRepository.open(item) }, { showOpened() })
        else confirm = item to SealedConfirm.OPEN_LAST
    }

    fun minus(item: SealedItem) {
        if (item.quantity > 1) write({ SealedRepository.setQuantity(item.sealedId, item.quantity - 1) })
        else confirm = item to SealedConfirm.DELETE
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    SectionHeader("Sealed-Wert")
                    if (total != null) ValueText(total, style = MaterialTheme.typography.titleLarge)
                    else Text("…", style = MaterialTheme.typography.titleLarge, color = Muted)
                }
                Button(onClick = onOpenSuche, enabled = !busy) {
                    Icon(Icons.Default.Add, null)
                    Spacer(Modifier.width(4.dp))
                    Text("Hinzufügen")
                }
            }
            writeError?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }
            if (cache.error != null && rows != null) {
                // Spec G3 §9: letzter Stand bleibt sichtbar, mit Hinweis.
                Spacer(Modifier.height(6.dp))
                Text(SEALED_LOAD_ERROR, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }
            Spacer(Modifier.height(12.dp))
            when {
                rows == null && cache.error == null -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Primary)
                        }
                    }
                }
                rows == null -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Text(SEALED_LOAD_ERROR, color = ErrorColor)
                        }
                    }
                }
                rows.isEmpty() -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Noch kein Sealed-Bestand", color = Muted)
                        }
                    }
                }
                else -> LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(rows, key = { it.sealedId }) { item ->
                        SealedRow(
                            item = item,
                            stale = item.sealedId in staleIds,
                            enabled = !busy,
                            onPlus = { write({ SealedRepository.setQuantity(item.sealedId, item.quantity + 1) }) },
                            onMinus = { minus(item) },
                            onOpen = { open(item) },
                            onDelete = { confirm = item to SealedConfirm.DELETE },
                        )
                    }
                }
            }
        }
        SnackbarHost(hostState = snackbar, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp))
    }

    confirm?.let { (item, kind) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (kind == SealedConfirm.OPEN_LAST) "Letztes Exemplar geöffnet?" else "„${item.name}“ löschen?") },
            text = {
                Text(
                    if (kind == SealedConfirm.OPEN_LAST) "„${item.name}“ wird aus dem Sealed-Bestand entfernt."
                    else "Der Eintrag wird aus dem Sealed-Bestand entfernt.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    if (kind == SealedConfirm.OPEN_LAST) write({ SealedRepository.open(item) }, { showOpened() })
                    else write({ SealedRepository.delete(item.sealedId) })
                }) { Text("Entfernen", color = ErrorColor) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun SealedRow(
    item: SealedItem,
    stale: Boolean,
    enabled: Boolean,
    onPlus: () -> Unit,
    onMinus: () -> Unit,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(SealedValue.kindLabel(item.kind), style = MaterialTheme.typography.labelSmall, color = Muted)
                    Text(item.name, style = MaterialTheme.typography.bodyMedium, color = OnSurface,
                        fontWeight = FontWeight.SemiBold, maxLines = 2)
                }
                IconButton(onClick = onDelete, enabled = enabled) { Icon(Icons.Default.Delete, "Löschen", tint = ErrorColor) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onMinus, enabled = enabled) { Icon(Icons.Default.Remove, "Menge verringern", tint = OnSurface) }
                Text("${item.quantity}", style = MaterialTheme.typography.titleMedium, color = OnSurface)
                IconButton(onClick = onPlus, enabled = enabled) { Icon(Icons.Default.Add, "Menge erhöhen", tint = OnSurface) }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    Text(item.price?.let { "je %.2f €".format(it) } ?: "je —",
                        style = MaterialTheme.typography.labelSmall, color = Muted)
                    if (stale) Text("Preis veraltet", style = MaterialTheme.typography.labelSmall, color = Gold)
                    ValueText(SealedValue.lineValue(item), style = MaterialTheme.typography.bodyMedium)
                }
            }
            TextButton(onClick = onOpen, enabled = enabled) { Text("Geöffnet") }
        }
    }
}
