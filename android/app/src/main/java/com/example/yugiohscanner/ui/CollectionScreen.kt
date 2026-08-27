package com.example.yugiohscanner.ui

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
    val scope = rememberCoroutineScope()

    suspend fun reload() { cards = CollectionRepository.loadCards(); loading = false }
    LaunchedEffect(Unit) { try { reload() } catch (_: Exception) { loading = false } }

    val filtered = cards.filter {
        query.isBlank() || (it.name ?: "").contains(query, true) || it.setCode.contains(query, true)
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        OutlinedTextField(query, { query = it }, label = { Text("Suche") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        if (loading) { CircularProgressIndicator(); return@Column }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(filtered, key = { "${it.id}|${it.setCode}|${it.language}" }) { card ->
                CardListItem(card,
                    onInc = { scope.launch { CollectionRepository.setQuantity(card, card.quantity + 1); reload() } },
                    onDec = { if (card.quantity > 1) scope.launch { CollectionRepository.setQuantity(card, card.quantity - 1); reload() } },
                    onDelete = { scope.launch { CollectionRepository.softDelete(card); reload() } })
            }
        }
    }
}

@Composable
private fun CardListItem(card: CardRow, onInc: () -> Unit, onDec: () -> Unit, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(model = card.imageUrl, contentDescription = card.name,
            modifier = Modifier.width(48.dp).height(70.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(card.name ?: card.id, style = MaterialTheme.typography.bodyLarge)
            Text("${card.setCode} · ${card.rarity ?: "?"} · ${"%.2f".format(card.price ?: 0.0)} €",
                style = MaterialTheme.typography.bodySmall)
        }
        IconButton(onClick = onDec) { Icon(Icons.Default.Remove, "−") }
        Text("${card.quantity}")
        IconButton(onClick = onInc) { Icon(Icons.Default.Add, "+") }
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Löschen") }
    }
}
