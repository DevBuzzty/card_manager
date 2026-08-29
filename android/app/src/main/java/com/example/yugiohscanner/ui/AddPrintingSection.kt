package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetOption
import kotlinx.coroutines.launch

// Fetches a card's printings from YGOPRODeck, excludes ones the user already owns
// (by set_code), and adds the chosen printing to the cloud. Shared by card detail and search.
@Composable
fun AddPrintingSection(base: CardRow, owned: List<CardRow>, onError: (String) -> Unit, onAdded: () -> Unit) {
    var sets by remember { mutableStateOf<List<SetOption>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Text("Weitere Druckvariante hinzufügen", style = MaterialTheme.typography.titleMedium)
    Button(enabled = !loading, onClick = {
        loading = true
        scope.launch {
            try {
                val ownedKeys = owned.map { it.setCode }.toHashSet()
                sets = PrintingRepository.fetchSets(base.id).filter { it.setCode !in ownedKeys }
                expanded = true
            } catch (e: Exception) { onError(e.message ?: "Sets laden fehlgeschlagen") }
            loading = false
        }
    }) { Text(if (loading) "Lade Sets…" else "Sets anzeigen") }

    if (expanded) {
        if (sets.isEmpty()) {
            Text("Keine weiteren Sets gefunden.", style = MaterialTheme.typography.bodySmall)
        } else {
            LazyColumn(Modifier.heightIn(max = 240.dp)) {
                items(sets, key = { "${it.setCode}|${it.rarity}" }) { s ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${s.setCode} · ${s.rarity}", style = MaterialTheme.typography.bodyMedium)
                            Text("%.2f €".format(s.price), style = MaterialTheme.typography.bodySmall)
                        }
                        Button(enabled = !adding, onClick = {
                            adding = true
                            scope.launch {
                                try { CollectionRepository.addPrinting(base, s.setCode, s.rarity, s.price); onAdded(); expanded = false }
                                catch (e: Exception) { onError(e.message ?: "Hinzufügen fehlgeschlagen") }
                                adding = false
                            }
                        }) { Text("Hinzufügen") }
                    }
                }
            }
        }
    }
}
