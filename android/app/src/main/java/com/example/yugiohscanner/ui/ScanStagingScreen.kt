package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

// One scanned-but-not-yet-committed card in the phone-side staging area. Set/quantity are
// editable (mutable state) so a mis-recognised printing can be corrected before committing.
class ScanStagingEntry(
    val id: Long,
    val base: CardRow,
    val knownSets: List<SetOption>,
    initialSet: SetOption?,
) {
    var selectedSet by mutableStateOf(initialSet)
    var quantity by mutableIntStateOf(1)
}

@Composable
fun ScanStagingScreen(
    entries: SnapshotStateList<ScanStagingEntry>,
    onClose: () -> Unit,
    onCommitted: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var committing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                }
                Text("Prüfen & übernehmen", style = MaterialTheme.typography.titleLarge, color = OnSurface)
                Spacer(Modifier.weight(1f))
                Text("${entries.size}", color = Muted, fontFamily = MonoFontFamily)
            }
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 12.dp))
            }

            if (entries.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Keine gescannten Karten. Scanne welche im Scan-Tab.",
                        color = Muted, style = MaterialTheme.typography.bodyMedium)
                }
                return@Column
            }

            LazyColumn(
                Modifier.weight(1f).padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                items(entries, key = { it.id }) { entry ->
                    StagingRow(entry, onDelete = { entries.remove(entry) })
                }
            }

            Button(
                onClick = {
                    committing = true
                    scope.launch {
                        try {
                            for (e in entries.toList()) {
                                val s = e.selectedSet
                                CollectionRepository.addScanned(
                                    e.base,
                                    setCode = s?.setCode ?: "Unknown",
                                    rarity = s?.rarity ?: "",
                                    language = s?.language ?: "DE",
                                    quantity = e.quantity,
                                )
                            }
                            entries.clear()
                            error = null
                            onCommitted()
                            onClose()
                        } catch (ex: Exception) {
                            error = ex.message ?: "Übernehmen fehlgeschlagen"
                        } finally {
                            committing = false
                        }
                    }
                },
                enabled = !committing && entries.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().padding(12.dp),
            ) { Text(if (committing) "Übernehme…" else "Alle übernehmen (${entries.size})") }
        }
    }
}

@Composable
private fun StagingRow(entry: ScanStagingEntry, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(model = entry.base.imageUrl, contentDescription = entry.base.name,
                    modifier = Modifier.width(48.dp).height(70.dp).clip(RoundedCornerShape(6.dp)))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(entry.base.name ?: entry.base.id, style = MaterialTheme.typography.titleMedium,
                        color = OnSurface, maxLines = 2)
                    Text(entry.base.id, style = MaterialTheme.typography.labelSmall,
                        fontFamily = MonoFontFamily, color = Muted)
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, "Entfernen", tint = MaterialTheme.colorScheme.error)
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                SetPicker(entry, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                IconButton(onClick = { if (entry.quantity > 1) entry.quantity-- }) {
                    Icon(Icons.Default.Remove, "−", tint = MaterialTheme.colorScheme.primary)
                }
                Text("${entry.quantity}", fontFamily = MonoFontFamily, color = OnSurface)
                IconButton(onClick = { entry.quantity++ }) {
                    Icon(Icons.Default.Add, "+", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
private fun SetPicker(entry: ScanStagingEntry, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    val current = entry.selectedSet
    val label = current?.let { "[${it.language}] ${it.setCode} · ${it.rarity}" } ?: "Unbekannt (bitte wählen)"

    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().clickable { expanded = true }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium,
                color = if (current != null) OnSurface else Muted, modifier = Modifier.weight(1f))
            Icon(Icons.Default.ArrowDropDown, "Auswählen", tint = Muted)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("Unbekannt") },
                onClick = { entry.selectedSet = null; expanded = false },
            )
            entry.knownSets.forEach { s ->
                DropdownMenuItem(
                    text = { Text("[${s.language}] ${s.setCode} · ${s.rarity}") },
                    onClick = { entry.selectedSet = s; expanded = false },
                )
            }
        }
    }
}
