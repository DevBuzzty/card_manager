package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.SurfaceColor
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

private fun groupCards(cards: List<CardRow>, byKey: Map<String, List<CopyRow>>): List<CardGroup> =
    cards.groupBy { it.id }.map { (id, rows) ->
        CardGroup(
            id = id,
            name = rows.firstOrNull()?.name,
            imageUrl = rows.firstOrNull { !it.imageUrl.isNullOrBlank() }?.imageUrl,
            totalQty = rows.sumOf { it.quantity },
            totalValue = rows.sumOf { printingValue(it, byKey) },
            maxPrice = rows.maxOfOrNull { it.price ?: 0.0 } ?: 0.0,
            rarities = rows.mapNotNull { it.rarity }.distinct(),
            variants = rows.sortedByDescending { it.price ?: 0.0 },
        )
    }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(onOpenSuche: () -> Unit) {
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var copies by remember { mutableStateOf<List<CopyRow>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("total") } // total | single | name
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var detailId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    var searchOpen by remember { mutableStateOf(false) }
    var filterOpen by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(false) }
    var fSet by remember { mutableStateOf<String?>(null) }
    var fRarity by remember { mutableStateOf<String?>(null) }
    var fType by remember { mutableStateOf<String?>(null) }
    var fLang by remember { mutableStateOf<String?>(null) }
    var fCondition by remember { mutableStateOf<String?>(null) }
    var fEdition by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        cards = CollectionRepository.loadCards()
        copies = CollectionRepository.loadCopies()
        loading = false
    }
    LaunchedEffect(Unit) {
        try { reload() } catch (e: Exception) { errorMsg = e.message ?: "Laden fehlgeschlagen"; loading = false }
    }

    // Full-screen sub-view takes over the whole tab.
    detailId?.let { id ->
        CardDetailScreen(
            cardId = id,
            initial = cards,
            initialCopies = copies,
            onClose = { detailId = null },
            onChanged = { scope.launch { runCatching { reload() } } },
        )
        return
    }

    val byKey = remember(copies) { copies.groupBy { it.printingKey() } }

    val setOptions = remember(cards) { cards.map { it.setCode.substringBefore('-') }.distinct().sorted() }
    val rarityOptions = remember(cards) { cards.mapNotNull { it.rarity }.distinct().sorted() }
    val typeOptions = remember(cards) { cards.mapNotNull { it.type }.distinct().sorted() }
    val langOptions = remember(cards) { cards.map { it.language }.distinct().sorted() }

    val activeFilterCount = listOf(fSet, fRarity, fType, fLang, fCondition, fEdition).count { it != null }

    val groups = remember(cards, copies, query, sort, fSet, fRarity, fType, fLang, fCondition, fEdition) {
        groupCards(cards, byKey)
            .filter { g ->
                query.isBlank() || (g.name ?: "").contains(query, true) ||
                    g.variants.any { it.setCode.contains(query, true) }
            }
            .filter { g -> fSet == null || g.variants.any { it.setCode.substringBefore('-') == fSet } }
            .filter { g -> fRarity == null || g.rarities.contains(fRarity) }
            .filter { g -> fType == null || g.variants.any { it.type == fType } }
            .filter { g -> fLang == null || g.variants.any { it.language == fLang } }
            .filter { g ->
                fCondition == null || g.variants.any { v ->
                    byKey[v.printingKey()]?.any { !it.deleted && it.condition == fCondition } == true
                }
            }
            .filter { g ->
                fEdition == null || g.variants.any { v ->
                    byKey[v.printingKey()]?.any { !it.deleted && it.edition == fEdition } == true
                }
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (searchOpen) {
                    OutlinedTextField(query, { query = it }, singleLine = true, modifier = Modifier.weight(1f),
                        placeholder = { Text("Suchen") },
                        trailingIcon = { IconButton(onClick = { query = ""; searchOpen = false }) { Icon(Icons.Default.Close, "Suche schließen") } })
                } else {
                    Text("${groups.size} Karten", color = Muted, modifier = Modifier.weight(1f))
                    IconButton(onClick = { searchOpen = true }) { Icon(Icons.Default.Search, "Suchen", tint = OnSurface) }
                }
                IconButton(onClick = { grid = !grid }) {
                    Icon(if (grid) Icons.AutoMirrored.Filled.List else Icons.Default.GridView, "Ansicht wechseln", tint = OnSurface)
                }
                BadgedBox(badge = { if (activeFilterCount > 0) Badge { Text("$activeFilterCount") } }) {
                    IconButton(onClick = { filterOpen = true }) { Icon(Icons.Default.FilterList, "Filter", tint = OnSurface) }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(sort == "total", { sort = "total" }, label = { Text("Wert") })
                FilterChip(sort == "single", { sort = "single" }, label = { Text("Preis") })
                FilterChip(sort == "name", { sort = "name" }, label = { Text("Name") })
            }
            if (activeFilterCount > 0) {
                Spacer(Modifier.height(8.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    fSet?.let { ActiveFilterChip(it) { fSet = null } }
                    fRarity?.let { ActiveFilterChip(it) { fRarity = null } }
                    fType?.let { ActiveFilterChip(it) { fType = null } }
                    fLang?.let { ActiveFilterChip(it) { fLang = null } }
                    fCondition?.let { ActiveFilterChip(it) { fCondition = null } }
                    fEdition?.let { ActiveFilterChip(Valuation.EDITION_LABELS[it] ?: it) { fEdition = null } }
                }
            }
            Spacer(Modifier.height(8.dp))
            errorMsg?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
            }
            if (loading) { CircularProgressIndicator(); return@Column }
            if (grid) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 88.dp), // clear the "+" FAB
                ) {
                    items(groups, key = { it.id }) { group ->
                        CardGroupGridItem(group, onOpen = { detailId = group.id })
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 88.dp), // clear the "+" FAB
                ) {
                    items(groups, key = { it.id }) { group ->
                        CardGroupItem(group, onOpen = { detailId = group.id })
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = onOpenSuche,
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        ) { Icon(Icons.Default.Add, "Karte suchen") }

        if (filterOpen) {
            ModalBottomSheet(onDismissRequest = { filterOpen = false }) {
                Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
                       verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Filter", style = MaterialTheme.typography.titleLarge, color = OnSurface)
                    FilterGroup("Set", setOptions, fSet) { fSet = it }
                    FilterGroup("Rarity", rarityOptions, fRarity) { fRarity = it }
                    FilterGroup("Typ", typeOptions, fType) { fType = it }
                    FilterGroup("Sprache", langOptions, fLang) { fLang = it }
                    FilterGroup("Zustand", Valuation.CONDITIONS, fCondition) { fCondition = it }
                    FilterGroup("Edition", Valuation.EDITIONS, fEdition, { Valuation.EDITION_LABELS[it] ?: it }) { fEdition = it }
                    TextButton(onClick = { fSet = null; fRarity = null; fType = null; fLang = null; fCondition = null; fEdition = null }) {
                        Text("Alle Filter entfernen")
                    }
                }
            }
        }
    }
}

// One filter row: a scrollable chip per option, tapping the active chip clears it.
@Composable
private fun FilterGroup(title: String, options: List<String>, selected: String?, label: (String) -> String = { it }, onSelect: (String?) -> Unit) {
    Column {
        Text(title, style = MaterialTheme.typography.labelMedium, color = Muted)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { o ->
                FilterChip(selected == o, { onSelect(if (selected == o) null else o) }, label = { Text(label(o)) })
            }
        }
    }
}

// One active-filter chip, removable via its trailing close icon.
@Composable
private fun ActiveFilterChip(text: String, onClear: () -> Unit) {
    InputChip(
        selected = true,
        onClick = onClear,
        label = { Text(text) },
        trailingIcon = { Icon(Icons.Default.Close, "Filter entfernen", modifier = Modifier.size(InputChipDefaults.IconSize)) },
    )
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

// Grid tile: cover art with quantity/value overlays; tapping opens the same detail screen as the list.
@Composable
private fun CardGroupGridItem(group: CardGroup, onOpen: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(0.68f)
            .clip(RoundedCornerShape(6.dp))
            .clickable { onOpen() },
    ) {
        AsyncImage(
            model = group.imageUrl,
            contentDescription = group.name,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Text(
            "×${group.totalQty}",
            fontFamily = MonoFontFamily,
            style = MaterialTheme.typography.labelSmall,
            color = OnSurface,
            modifier = Modifier.align(Alignment.BottomStart)
                .background(SurfaceColor.copy(alpha = 0.85f), RoundedCornerShape(topEnd = 6.dp))
                .padding(horizontal = 4.dp, vertical = 2.dp),
        )
        Box(
            modifier = Modifier.align(Alignment.BottomEnd)
                .background(SurfaceColor.copy(alpha = 0.85f), RoundedCornerShape(topStart = 6.dp))
                .padding(horizontal = 4.dp, vertical = 2.dp),
        ) {
            ValueText(group.totalValue, style = MaterialTheme.typography.labelSmall)
        }
    }
}
