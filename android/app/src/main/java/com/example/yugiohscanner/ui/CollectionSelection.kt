package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Selection
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.SurfaceColor
import kotlinx.coroutines.launch

/**
 * Mehrfachauswahl in der Kartenliste (Spec I §5.1, Plan 2026-09-26) -- Leiste unten, solange ausgewählt wird
 * (ersetzt den „+“-Knopf). Zwilling der PC-Leiste (CollectionSelection.jsx), Texte aus ml/Selection.kt.
 */
@Composable
fun SelectionBar(cards: Int, copies: Int, onSelectAll: () -> Unit, onSell: () -> Unit, onMove: () -> Unit, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxWidth(), color = SurfaceColor, tonalElevation = 3.dp, shadowElevation = 6.dp) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(Selection.text(cards, copies), color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onSelectAll) { Text("Alle") }
                IconButton(onClick = onCancel) { Icon(Icons.Default.Close, "Auswahl beenden", tint = OnSurface) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onMove, enabled = copies > 0, modifier = Modifier.weight(1f)) { Text("Verschieben…") }
                Button(onClick = onSell, enabled = copies > 0, modifier = Modifier.weight(1f)) { Text("Verkaufen…") }
            }
        }
    }
}

/** Alte Standorte fürs Rückgängig: je Exemplar Behälter, Seite, Fach. */
private data class OldLocation(val copyId: String, val containerId: String?, val page: Int?, val slot: Int?)

/**
 * Ziel wählen (jeder Behälter oder „Kein Behälter“) und verschieben. Wer schon im Ziel liegt, bleibt unberührt
 * (sonst verlöre er sein Fach im Ordner) -- gleiche Regel wie relocateCopies am PC. Danach Snackbar mit Rückgängig.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoveSheet(copies: List<CopyRow>, containers: List<ContainerRow>, onDismiss: () -> Unit, onMoved: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var target by remember { mutableStateOf<ContainerRow?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val live = remember(containers) { containers.filter { !it.deleted } }
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Verschieben", style = MaterialTheme.typography.titleLarge, color = OnSurface)
            Text(if (copies.size == 1) "1 Exemplar" else "${copies.size} Exemplare", style = MaterialTheme.typography.labelSmall, color = Muted)
            Text("Ziel", style = MaterialTheme.typography.labelMedium, color = Muted)
            ContainerPicker(live, target) { target = it }
            Text("Seite und Fach im Ordner werden dabei geleert. Wer schon im Ziel liegt, bleibt, wo er ist.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
            error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Abbrechen") }
                Button(
                    onClick = {
                        if (!inFlight.tryStart()) return@Button
                        busy = true
                        error = null
                        val to = target
                        scope.launch {
                            val moved = ArrayList<OldLocation>()
                            try {
                                for (c in copies) {
                                    if (c.containerId == to?.containerId) continue
                                    CollectionRepository.setCopyLocation(c.copyId, to?.containerId, null, null)
                                    moved += OldLocation(c.copyId, c.containerId, c.page, c.slot)
                                }
                            } catch (e: Exception) {
                                error = (e.message ?: "Verschieben fehlgeschlagen") +
                                    if (moved.isNotEmpty()) " – ${moved.size} schon verschoben." else ""
                            }
                            CollectionStore.awaitSync()
                            busy = false
                            inFlight.finish()
                            if (error != null) return@launch
                            onMoved()
                            AppSnackbar.show(Selection.moveText(moved.size, to?.name), if (moved.isEmpty()) null else "Rückgängig") {
                                try {
                                    for (m in moved) CollectionRepository.setCopyLocation(m.copyId, m.containerId, m.page, m.slot)
                                } catch (e: Exception) {
                                    AppSnackbar.show(e.message ?: "Rückgängig fehlgeschlagen")
                                }
                                CollectionStore.awaitSync()
                            }
                        }
                    },
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                ) { Text(if (busy) "Verschiebe…" else "Verschieben") }
            }
        }
    }
}
