package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import kotlinx.coroutines.launch

@Composable
fun CollectionScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var detailId by remember { mutableStateOf<String?>(null) }
    var showSearch by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun reload() { cards = CollectionRepository.loadCards(); loading = false }
    LaunchedEffect(Unit) { try { reload() } catch (_: Exception) { loading = false } }

    // Full-screen sub-views take over the whole tab.
    if (showSearch) {
        SearchScreen(onClose = { showSearch = false }, onAdded = { scope.launch { runCatching { reload() } } })
        return
    }
    detailId?.let { id ->
        CardDetailScreen(
            cardId = id,
            initial = cards,
            onClose = { detailId = null },
            onChanged = { scope.launch { runCatching { reload() } } },
        )
        return
    }

    val filtered = cards.filter {
        query.isBlank() || (it.name ?: "").contains(query, true) || it.setCode.contains(query, true)
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(12.dp)) {
            OutlinedTextField(query, { query = it }, label = { Text("Suche") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            errorMsg?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
            }
            if (loading) { CircularProgressIndicator(); return@Column }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(filtered, key = { "${it.id}|${it.setCode}|${it.language}" }) { card ->
                    CardListItem(card,
                        onOpen = { detailId = card.id },
                        onInc = { scope.launch {
                            try { CollectionRepository.setQuantity(card, card.quantity + 1); errorMsg = null; reload() }
                            catch (e: Exception) { errorMsg = e.message ?: "Aktualisieren fehlgeschlagen" }
                        } },
                        onDec = { if (card.quantity > 1) scope.launch {
                            try { CollectionRepository.setQuantity(card, card.quantity - 1); errorMsg = null; reload() }
                            catch (e: Exception) { errorMsg = e.message ?: "Aktualisieren fehlgeschlagen" }
                        } },
                        onDelete = { scope.launch {
                            try { CollectionRepository.softDelete(card); errorMsg = null; reload() }
                            catch (e: Exception) { errorMsg = e.message ?: "Löschen fehlgeschlagen" }
                        } })
                }
            }
        }
        FloatingActionButton(
            onClick = { showSearch = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        ) { Icon(Icons.Default.Add, "Karte suchen") }
    }
}

@Composable
private fun CardListItem(card: CardRow, onOpen: () -> Unit, onInc: () -> Unit, onDec: () -> Unit, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).clickable { onOpen() }, verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(model = card.imageUrl, contentDescription = card.name,
                modifier = Modifier.width(48.dp).height(70.dp))
            Spacer(Modifier.width(8.dp))
            Column {
                Text(card.name ?: card.id, style = MaterialTheme.typography.bodyLarge)
                Text("${card.setCode} · ${card.rarity ?: "?"} · ${"%.2f".format(card.price ?: 0.0)} €",
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        IconButton(onClick = onDec) { Icon(Icons.Default.Remove, "−") }
        Text("${card.quantity}")
        IconButton(onClick = onInc) { Icon(Icons.Default.Add, "+") }
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Löschen") }
    }
}
