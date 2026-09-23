package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.CardFilterPresets
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.SurfaceColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Performance (Seitenwechsel): Filterlisten ueberleben das Verlassen des Reiters (NavHost saveState).
@Composable
private fun rememberSaveableList(): SnapshotStateList<String> =
    rememberSaveable(saver = listSaver(save = { it.toList() }, restore = { it.toMutableStateList() })) { mutableStateListOf() }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(onOpenSuche: () -> Unit) {
    // Performance (Seitenwechsel): Suche, Sortierung, Ansicht und Filter per rememberSaveable -- sie
    // bleiben beim Reiterwechsel erhalten, statt jedes Mal auf den Anfang zurueckzuspringen.
    var query by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("total") } // total | single | name
    var detailId by remember { mutableStateOf<String?>(null) }

    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var filterOpen by remember { mutableStateOf(false) }
    var grid by rememberSaveable { mutableStateOf(false) }
    var fSet by rememberSaveable { mutableStateOf<String?>(null) }
    var fRarity by rememberSaveable { mutableStateOf<String?>(null) }
    var fType by rememberSaveable { mutableStateOf<String?>(null) }
    var fLang by rememberSaveable { mutableStateOf<String?>(null) }
    var fCondition by rememberSaveable { mutableStateOf<String?>(null) }
    var fEdition by rememberSaveable { mutableStateOf<String?>(null) }
    // Spec B1 §10.4: Behaelter-/Tag-Filter, mehrfach waehlbar (leer = nicht filtern) -- greifen
    // am EXEMPLAR, nicht am Printing (siehe filterGroups, "GRUPPIERUNGSFALLE").
    val fContainers = rememberSaveableList()
    val fTags = rememberSaveableList()
    // Spec I §3.3 (Task 10): Voreinstellungen "Unvollständige Daten" / "Nur Foils" -- wirken wie
    // die anderen Filter oben, mehrfach waehlbar.
    val fPresets = rememberSaveableList()
    // Spec §5: alles aus dem Speicher. Der Ladebildschirm garantiert Ready -- keine eigene
    // Ladeanzeige und kein eigener Ladefehler mehr.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    val containers = ready?.containers ?: emptyList()

    // Full-screen sub-view takes over the whole tab — system back closes it instead of the tab.
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }

    val activeFilterCount = listOf(fSet, fRarity, fType, fLang, fCondition, fEdition).count { it != null } +
        fContainers.size + fTags.size + fPresets.size

    // Performance: Gruppieren/Filtern/Sortieren von ~8700 Karten lief frueher bei jedem Betreten und
    // jedem Tastendruck auf dem Hauptthread. Jetzt abseits davon ueber CollectionGroupsMemo; beim
    // Wiederkommen steht das letzte Ergebnis sofort da (peek), waehrend einer Neuberechnung bleibt
    // der vorige Stand sichtbar.
    val filter = GroupFilter(
        query, sort, fSet, fRarity, fType, fLang, fCondition, fEdition,
        fContainers.toList(), fTags.toList(), fPresets.toList(),
    )
    val computed by produceState(CollectionGroupsMemo.peek(cards, copies, containers, filter), cards, copies, containers, filter) {
        value = withContext(Dispatchers.Default) { CollectionGroupsMemo.get(cards, copies, containers, filter) }
    }
    val groups = computed ?: emptyList()
    // Die Filteroptionen haengen nur am Speicherstand; get() oben hat die Basis dafuer schon gebaut.
    val base = remember(computed, cards, copies, containers) { CollectionGroupsMemo.peekBase(cards, copies, containers) }
    val tagOptions = base?.tagOptions ?: emptyList()
    val setOptions = base?.setOptions ?: emptyList()
    val rarityOptions = base?.rarityOptions ?: emptyList()
    val typeOptions = base?.typeOptions ?: emptyList()
    val langOptions = base?.langOptions ?: emptyList()

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (searchOpen) {
                    OutlinedTextField(query, { query = it }, singleLine = true, modifier = Modifier.weight(1f),
                        placeholder = { Text("Suchen") },
                        trailingIcon = { IconButton(onClick = { query = ""; searchOpen = false }) { Icon(Icons.Default.Close, "Suche schließen") } })
                } else {
                    Text(if (computed == null) "Karten …" else "${groups.size} Karten", color = Muted, modifier = Modifier.weight(1f))
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
                    fContainers.forEach { id ->
                        ActiveFilterChip(containers.find { it.containerId == id }?.name ?: id) { fContainers.remove(id) }
                    }
                    fTags.forEach { t -> ActiveFilterChip(t) { fTags.remove(t) } }
                    fPresets.forEach { id ->
                        val label = CardFilterPresets.ALLE.firstOrNull { it.first == id }?.second ?: id
                        ActiveFilterChip(label) { fPresets.remove(id) }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            if (grid) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 88.dp), // clear the "+" FAB
                ) {
                    items(groups, key = { it.id }, contentType = { "karte" }) { group ->
                        CardGroupGridItem(group, onOpen = { detailId = group.id })
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 88.dp), // clear the "+" FAB
                ) {
                    items(groups, key = { it.id }, contentType = { "karte" }) { group ->
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
                    // Spec I §3.3 (Task 10): Voreinstellungen wie ein normaler Mehrfachfilter.
                    MultiFilterGroup("Voreinstellungen", CardFilterPresets.ALLE.map { (id, label) -> label to id }, fPresets) { id ->
                        if (fPresets.contains(id)) fPresets.remove(id) else fPresets.add(id)
                    }
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
                        fContainers.clear(); fTags.clear(); fPresets.clear()
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
