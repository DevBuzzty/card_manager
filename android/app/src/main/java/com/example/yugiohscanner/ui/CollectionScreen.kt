package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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

// One passcode grouped across all its owned printings.
private data class CardGroup(
    val id: String,
    val name: String?,
    val imageUrl: String?,
    val totalQty: Int,
    val totalValue: Double,
    val maxPrice: Double,
    val rarities: List<String>,
    val variants: List<CardRow>,
)

private fun groupCards(cards: List<CardRow>): List<CardGroup> =
    cards.groupBy { it.id }.map { (id, rows) ->
        CardGroup(
            id = id,
            name = rows.firstOrNull()?.name,
            imageUrl = rows.firstOrNull { !it.imageUrl.isNullOrBlank() }?.imageUrl,
            totalQty = rows.sumOf { it.quantity },
            totalValue = rows.sumOf { (it.price ?: 0.0) * it.quantity },
            maxPrice = rows.maxOfOrNull { it.price ?: 0.0 } ?: 0.0,
            rarities = rows.mapNotNull { it.rarity }.distinct(),
            variants = rows.sortedByDescending { it.price ?: 0.0 },
        )
    }

@Composable
fun CollectionScreen() {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("total") } // total | single | name
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

    val groups = remember(cards, query, sort) {
        groupCards(cards)
            .filter { g ->
                query.isBlank() || (g.name ?: "").contains(query, true) ||
                    g.variants.any { it.setCode.contains(query, true) }
            }
            .sortedWith(
                when (sort) {
                    "name" -> compareBy { it.name ?: it.id }
                    "single" -> compareByDescending { it.maxPrice }
                    else -> compareByDescending { it.totalValue }
                }
            )
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(12.dp)) {
            OutlinedTextField(query, { query = it }, label = { Text("Suche") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(sort == "total", { sort = "total" }, label = { Text("Wert") })
                FilterChip(sort == "single", { sort = "single" }, label = { Text("Preis") })
                FilterChip(sort == "name", { sort = "name" }, label = { Text("Name") })
            }
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
                items(groups, key = { it.id }) { group ->
                    CardGroupItem(group, onOpen = { detailId = group.id })
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
private fun CardGroupItem(group: CardGroup, onOpen: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.clickable { onOpen() }.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(model = group.imageUrl, contentDescription = group.name,
                    modifier = Modifier.width(48.dp).height(70.dp).clip(RoundedCornerShape(6.dp)))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(group.name ?: group.id, style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface, maxLines = 2)
                    Spacer(Modifier.height(4.dp))
                    // All owned rarities.
                    Row(Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        group.rarities.forEach { RarityChip(it) }
                    }
                }
                Spacer(Modifier.width(8.dp))
                Column(horizontalAlignment = Alignment.End) {
                    ValueText(group.totalValue, style = MaterialTheme.typography.titleMedium)
                    Text("×${group.totalQty}", fontFamily = MonoFontFamily,
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                }
            }
            Spacer(Modifier.height(8.dp))
            // Per-set breakdown: set code · quantity · unit price.
            group.variants.forEach { v ->
                Row(Modifier.fillMaxWidth().padding(vertical = 1.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(v.setCode, fontFamily = MonoFontFamily,
                        style = MaterialTheme.typography.bodySmall, color = Muted,
                        modifier = Modifier.weight(1f))
                    Text("×${v.quantity}", fontFamily = MonoFontFamily,
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                    Spacer(Modifier.width(10.dp))
                    ValueText(v.price ?: 0.0, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
