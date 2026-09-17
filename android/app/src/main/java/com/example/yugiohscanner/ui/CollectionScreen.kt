package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.Tags
import com.example.yugiohscanner.ml.TagVocabulary
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.SurfaceColor

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
    // Spec B1 §10.4: nur gesetzt, waehrend ein Behaelterfilter aktiv ist -- der vorformatierte
    // Standort-Chip-Text (CopyLocation.format) DES ERSTEN passenden Exemplars (siehe groups
    // unten), nicht der Gruppe. Bereits hier statt erst beim Rendern aufgeloest, weil zu diesem
    // Zeitpunkt die Behaelterliste bereits vorliegt.
    val locationLabel: String? = null,
    // Spec H1 §5.3: Zusatz "(2 zum Verkauf)", sonst null.
    val saleNote: String? = null,
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
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("total") } // total | single | name
    var detailId by remember { mutableStateOf<String?>(null) }
    // Spec H1 §5.2: Chip-Zeile Alle · Duplikate · Zum Verkauf; Start oeffnet einen Chip ueber CollectionChip.
    var chip by rememberSaveable { mutableStateOf(CollectionChip.ALLE) }
    val requestedChip by CollectionChip.request.collectAsState()
    LaunchedEffect(requestedChip) { CollectionChip.take()?.let { chip = it } }
    val sale = rememberSaleData()
    // Spec H1 M2: history (§5.4 Vorgeschichte) und Scrollposition oberhalb des Karten-Detail-Returns
    // halten, damit ein Detail-Öffnen und -Schließen als "Liste bleibt offen" zählt. Verlassen des
    // Duplikate-Chips (nicht bloß das Detail) zählt als Schließen -- dann wird history geleert.
    val duplicatesHistory = remember { HashMap<String, List<String>>() }
    val duplicatesListState = rememberLazyListState()
    val forSaleListState = rememberLazyListState()
    LaunchedEffect(chip) { if (chip != CollectionChip.DUPLIKATE) duplicatesHistory.clear() }

    var searchOpen by remember { mutableStateOf(false) }
    var filterOpen by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(false) }
    var fSet by remember { mutableStateOf<String?>(null) }
    var fRarity by remember { mutableStateOf<String?>(null) }
    var fType by remember { mutableStateOf<String?>(null) }
    var fLang by remember { mutableStateOf<String?>(null) }
    var fCondition by remember { mutableStateOf<String?>(null) }
    var fEdition by remember { mutableStateOf<String?>(null) }
    // Spec B1 §10.4: Behaelter-/Tag-Filter, mehrfach waehlbar (leer = nicht filtern) -- greifen
    // am EXEMPLAR, nicht am Printing (siehe groups unten, "GRUPPIERUNGSFALLE").
    val fContainers = remember { mutableStateListOf<String>() }
    val fTags = remember { mutableStateListOf<String>() }
    // Spec §5: alles aus dem Speicher; Tag-Vorschlaege aus den Exemplaren im Speicher statt aus einem
    // zweiten Durchlauf durch alle Zeilen. Der Ladebildschirm garantiert Ready -- keine eigene
    // Ladeanzeige und kein eigener Ladefehler mehr.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    val containers = ready?.containers ?: emptyList()
    val tagOptions = remember(ready?.copies) { TagVocabulary.from(copies) }

    // Full-screen sub-view takes over the whole tab — system back closes it instead of the tab.
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }

    val byKey = remember(copies) { copies.groupBy { it.printingKey() } }
    val forSaleByCard = remember(copies) { copies.filter { !it.deleted && it.forSale }.groupingBy { it.cardId }.eachCount() }

    val setOptions = remember(cards) { cards.map { it.setCode.substringBefore('-') }.distinct().sorted() }
    val rarityOptions = remember(cards) { cards.mapNotNull { it.rarity }.distinct().sorted() }
    val typeOptions = remember(cards) { cards.mapNotNull { it.type }.distinct().sorted() }
    val langOptions = remember(cards) { cards.map { it.language }.distinct().sorted() }

    val activeFilterCount = listOf(fSet, fRarity, fType, fLang, fCondition, fEdition).count { it != null } +
        fContainers.size + fTags.size

    val groups = remember(cards, copies, query, sort, fSet, fRarity, fType, fLang, fCondition, fEdition, fContainers.toList(), fTags.toList(), containers, forSaleByCard) {
        fun copiesOfGroup(g: CardGroup): List<CopyRow> = g.variants.flatMap { byKey[it.printingKey()] ?: emptyList() }
        fun copyMatchesContainer(cp: CopyRow) = fContainers.isEmpty() || (cp.containerId != null && fContainers.contains(cp.containerId))
        fun copyMatchesTags(cp: CopyRow): Boolean {
            if (fTags.isEmpty()) return true
            val copyTags = Tags.parse(cp.tags).map { it.lowercase() }
            return fTags.any { copyTags.contains(it.lowercase()) }
        }

        val out = ArrayList<CardGroup>()
        for (g0 in groupCards(cards, byKey)) {
            // Spec B1 §10.4 Befund 1 (wie Task 7 am Desktop, CollectionList.jsx): die Textsuche
            // findet zusaetzlich Tags und Notizen der Exemplare -- ausschliesslich ueber
            // Tags.parse, kein eigenes Zerlegen der JSON-Spalte. Gleiche Entscheidungen wie
            // Desktop uebernommen: gross-/kleinschreibungsunabhaengig, Teiltreffer genuegt, keine
            // zusaetzliche Beschneidung des Suchbegriffs.
            if (query.isNotBlank() &&
                !((g0.name ?: "").contains(query, true) ||
                    g0.variants.any { it.setCode.contains(query, true) } ||
                    copiesOfGroup(g0).any { cp -> Tags.parse(cp.tags).any { it.contains(query, true) } } ||
                    copiesOfGroup(g0).any { cp -> cp.note?.contains(query, true) == true })
            ) continue
            if (fSet != null && g0.variants.none { it.setCode.substringBefore('-') == fSet }) continue
            if (fRarity != null && !g0.rarities.contains(fRarity)) continue
            if (fType != null && g0.variants.none { it.type == fType }) continue
            if (fLang != null && g0.variants.none { it.language == fLang }) continue
            if (fCondition != null && g0.variants.none { v -> byKey[v.printingKey()]?.any { !it.deleted && it.condition == fCondition } == true }) continue
            if (fEdition != null && g0.variants.none { v -> byKey[v.printingKey()]?.any { !it.deleted && it.edition == fEdition } == true }) continue

            // GRUPPIERUNGSFALLE (Spec B1 §10.4, wie Task 7 am Desktop): diese Liste gruppiert
            // nach Passcode (eine Gruppe kann mehrere Printings buendeln), Behaelter/Tag sitzen
            // aber am EXEMPLAR (card_copies). Eine Gruppe bleibt daher sichtbar, sobald
            // MINDESTENS EIN lebendes Exemplar eines ihrer Printings BEIDE aktiven Filter
            // ZUGLEICH erfuellt (nicht zwei verschiedene Exemplare je einen) -- der Chip unten
            // gehoert zu GENAU DIESEM Exemplar, nicht zur Gruppe. Liegen mehrere passende
            // Exemplare in verschiedenen Behaeltern, zeigt die Zeile bewusst nur das erste.
            var locationLabel: String? = null
            if (fContainers.isNotEmpty() || fTags.isNotEmpty()) {
                val match = copiesOfGroup(g0).firstOrNull { copyMatchesContainer(it) && copyMatchesTags(it) } ?: continue
                if (fContainers.isNotEmpty()) {
                    locationLabel = CopyLocation.format(match, containers.find { it.containerId == match.containerId })
                }
            }
            out.add(g0.copy(locationLabel = locationLabel, saleNote = Duplicates.forSaleSuffix(forSaleByCard[g0.id] ?: 0)))
        }
        out.sortedWith(
            when (sort) {
                "name" -> compareBy { it.name ?: it.id }
                "single" -> compareByDescending { it.maxPrice }
                else -> compareByDescending { it.totalValue }
            }
        )
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(12.dp)) {
            // T9: Suchen/Ansicht-wechseln/Filter wirken nur auf "Alle" (groups) -- in Duplikate/Zum
            // Verkauf waeren sie wirkungslose Knoepfe, deshalb dort ganz ausgeblendet.
            if (chip == CollectionChip.ALLE) {
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
            }
            // Spec H1 §5.2: Chip-Zeile ueber der Liste; Sortierung und aktive Filter gelten nur fuer "Alle".
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(chip == CollectionChip.ALLE, { chip = CollectionChip.ALLE }, label = { Text("Alle") })
                FilterChip(chip == CollectionChip.DUPLIKATE, { chip = CollectionChip.DUPLIKATE }, label = { Text("Duplikate") })
                FilterChip(chip == CollectionChip.VERKAUF, { chip = CollectionChip.VERKAUF }, label = { Text("Zum Verkauf") })
            }
            if (chip == CollectionChip.ALLE) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(sort == "total", { sort = "total" }, label = { Text("Wert") })
                    FilterChip(sort == "single", { sort = "single" }, label = { Text("Preis") })
                    FilterChip(sort == "name", { sort = "name" }, label = { Text("Name") })
                }
            }
            if (activeFilterCount > 0 && chip == CollectionChip.ALLE) {
                Spacer(Modifier.height(8.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    fSet?.let { ActiveFilterChip(it) { fSet = null } }
                    fRarity?.let { ActiveFilterChip(it) { fRarity = null } }
                    fType?.let { ActiveFilterChip(it) { fType = null } }
                    fLang?.let { ActiveFilterChip(it) { fLang = null } }
                    fCondition?.let { ActiveFilterChip(it) { fCondition = null } }
                    fEdition?.let { ActiveFilterChip(Valuation.EDITION_LABELS[it] ?: it) { fEdition = null } }
                    fContainers.forEach { id ->
                        ActiveFilterChip(containers.find { it.containerId == id }?.name ?: id) { fContainers.remove(id) }
                    }
                    fTags.forEach { t -> ActiveFilterChip(t) { fTags.remove(t) } }
                }
            }
            Spacer(Modifier.height(8.dp))
            if (chip == CollectionChip.DUPLIKATE) {
                DuplicatesList(sale, onOpenCard = { detailId = it }, history = duplicatesHistory, listState = duplicatesListState, modifier = Modifier.weight(1f))
            } else if (chip == CollectionChip.VERKAUF) {
                ForSaleList(sale, onOpenCard = { detailId = it }, listState = forSaleListState, modifier = Modifier.weight(1f))
            } else if (grid) {
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
                    // Spec B1 §10.4: Behaelter/Tag mehrfach waehlbar -- deshalb Toggle-Chips
                    // statt der Einfachauswahl von FilterGroup oben.
                    if (containers.isNotEmpty()) {
                        MultiFilterGroup("Behälter", containers.map { it.name to it.containerId }, fContainers) { id ->
                            if (fContainers.contains(id)) fContainers.remove(id) else fContainers.add(id)
                        }
                    }
                    if (tagOptions.isNotEmpty()) {
                        MultiFilterGroup("Tags", tagOptions.map { it to it }, fTags) { t ->
                            if (fTags.contains(t)) fTags.remove(t) else fTags.add(t)
                        }
                    }
                    TextButton(onClick = {
                        fSet = null; fRarity = null; fType = null; fLang = null; fCondition = null; fEdition = null
                        fContainers.clear(); fTags.clear()
                    }) {
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

// One multi-select filter row: several chips may be active at once (Behälter/Tag, Spec B1
// §10.4) -- unlike FilterGroup above (single choice), tapping any chip only toggles that one.
@Composable
private fun MultiFilterGroup(title: String, options: List<Pair<String, String>>, selected: List<String>, onToggle: (String) -> Unit) {
    Column {
        Text(title, style = MaterialTheme.typography.labelMedium, color = Muted)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { (label, value) ->
                FilterChip(selected.contains(value), { onToggle(value) }, label = { Text(label) })
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
                    group.saleNote?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Muted) }
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
            // Spec B1 §10.4: nur sichtbar, waehrend ein Behaelterfilter aktiv ist -- gehoert zum
            // ERSTEN passenden Exemplar (siehe groups oben), nicht zur Gruppe als Ganzes.
            group.locationLabel?.let {
                Spacer(Modifier.height(4.dp))
                Text(
                    it, style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily,
                    color = Muted, maxLines = 1,
                )
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
