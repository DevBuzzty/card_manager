package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
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
    LaunchedEffect(Unit) {
        try { reload() } catch (e: Exception) { errorMsg = e.message ?: "Laden fehlgeschlagen"; loading = false }
    }

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
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 88.dp), // clear the "+" FAB
            ) {
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
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        ) { Icon(Icons.Default.Add, "Karte suchen") }
    }
}

@Composable
private fun CardListItem(card: CardRow, onOpen: () -> Unit, onInc: () -> Unit, onDec: () -> Unit, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).clickable { onOpen() }, verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(model = card.imageUrl, contentDescription = card.name,
                    modifier = Modifier.width(48.dp).height(70.dp).clip(RoundedCornerShape(6.dp)))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(card.name ?: card.id, style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface, maxLines = 2)
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        RarityChip(card.rarity)
                        Text(card.setCode, style = MaterialTheme.typography.bodySmall,
                            fontFamily = MonoFontFamily, color = Muted)
                    }
                    Spacer(Modifier.height(4.dp))
                    ValueText(card.price, style = MaterialTheme.typography.bodySmall)
                }
            }
            IconButton(onClick = onDec) {
                Icon(Icons.Default.Remove, "−", tint = MaterialTheme.colorScheme.primary)
            }
            Text("${card.quantity}", fontFamily = MonoFontFamily,
                color = MaterialTheme.colorScheme.onSurface)
            IconButton(onClick = onInc) {
                Icon(Icons.Default.Add, "+", tint = MaterialTheme.colorScheme.primary)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Löschen", tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}
