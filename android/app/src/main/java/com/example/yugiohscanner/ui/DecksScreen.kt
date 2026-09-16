package com.example.yugiohscanner.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.WishlistRepository
import com.example.yugiohscanner.ml.Coverage
import com.example.yugiohscanner.ml.CoverageCard
import com.example.yugiohscanner.ml.DeckCoverage
import com.example.yugiohscanner.ml.DeckWishlist
import com.example.yugiohscanner.ml.FillBoxProposal
import com.example.yugiohscanner.ml.FillProposal
import com.example.yugiohscanner.ml.WishPlan
import com.example.yugiohscanner.ml.WishResult
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Spec E1 §5: Katalogpreise der Passcodes, abseits des Hauptthreads gelesen. null = noch nicht gelesen -- die Zahlen
 * zeigen dann "…" statt kurz "Preis unbekannt". Ohne Katalog (oder vor Version 6) ist jeder Preis null.
 */
@Composable
private fun rememberCatalogPrices(ids: Set<String>?): Map<String, Double?>? {
    val prices by produceState<Map<String, Double?>?>(initialValue = null, ids) {
        if (ids != null) value = withContext(Dispatchers.IO) { runCatching { CatalogRepository.cmPrices(ids) }.getOrDefault(emptyMap()) }
    }
    return prices
}

@Composable
fun DecksScreen(onClose: (() -> Unit)? = null) {
    var openDeckId by remember { mutableStateOf<Long?>(null) }
    val cache by SideStores.decks.state.collectAsState()
    val decks = cache.value ?: emptyList()

    // The editor is a sub-view of this destination — system back closes it, not the destination.
    BackHandler(openDeckId != null) { openDeckId = null }
    openDeckId?.let { id ->
        // Spec E1: der Editor liest das Deck aus dem Speicher, damit eine neu zugeordnete Deckbox sofort erscheint.
        val deck = decks.firstOrNull { it.id == id }
        if (deck != null) {
            DeckEditor(deck, decks, onBack = { openDeckId = null })
            return
        }
    }

    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = busy || (cache.value == null && cache.error == null)
    val error = writeError ?: cache.error

    // Spec E1 §8: Zahlen der Deck-Liste. Alles null, bis Decks, alle Deckkarten, Sammlung und Preise da sind -> "…".
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val allCardsCache by SideStores.allDeckCards.state.collectAsState()
    val allCards = allCardsCache.value
    val priceIds = remember(allCards) { allCards?.mapTo(HashSet()) { it.cardId } }
    val prices = rememberCatalogPrices(priceIds)
    val coverages: Map<Long, Coverage>? = remember(cache.value, allCards, ready, prices) {
        val r = ready
        if (cache.value == null || allCards == null || r == null || prices == null) null
        else {
            val byDeck = allCards.groupBy { it.deckId }
            decks.associate { d -> d.id to DeckCoverage.compute(d.id, byDeck[d.id] ?: emptyList(), r.copies, r.cards, decks, r.containers, prices) }
        }
    }

    LaunchedEffect(Unit) { SideStores.decks.refresh(); SideStores.allDeckCards.refresh() }

    val create = {
        val n = name.trim()
        if (n.isNotBlank()) {
            name = ""
            scope.launch {
                busy = true
                try { DecksRepository.createDeck(n); SideStores.decks.refreshAndWait(); writeError = null }
                catch (e: Exception) { writeError = e.message }
                busy = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            if (onClose != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("Decks", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                }
                Spacer(Modifier.height(12.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    placeholder = { Text("Deckname") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = create) { Icon(Icons.Default.Add, "Anlegen") }
            }

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }

            Spacer(Modifier.height(12.dp))
            if (loading) {
                // Spec §8: scrollbarer Nachfahre statt eines nackten Box -- sonst greift
                // Nach-unten-ziehen (verschachteltes Scrollen) hier nie.
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Primary)
                        }
                    }
                }
            } else if (decks.isEmpty()) {
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Noch keine Decks.", color = Muted)
                        }
                    }
                }
            } else {
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(decks, key = { it.id }) { deck ->
                        val summary = coverages?.get(deck.id)?.let { cov ->
                            "${DeckCoverage.boxLabel(deck, ready?.containers ?: emptyList())} · ${DeckCoverage.listText(cov)}"
                        } ?: DeckCoverage.LOADING
                        DeckRow(
                            deck, summary,
                            onOpen = { openDeckId = deck.id },
                            onDelete = {
                                scope.launch {
                                    try { DecksRepository.deleteDeck(deck.id); SideStores.decks.refreshAndWait(); SideStores.allDeckCards.refresh() }
                                    catch (e: Exception) { writeError = e.message }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DeckRow(deck: Deck, summary: String, onOpen: () -> Unit, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    deck.name, color = OnSurface, fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(summary, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Löschen", tint = ErrorColor)
            }
        }
    }
}

// "extra" for Extra-Deck monster types, else "main".
private fun extraOrMain(type: String?): String {
    val t = type?.lowercase() ?: return "main"
    return if (listOf("fusion", "synchro", "xyz", "link").any { t.contains(it) }) "extra" else "main"
}

private fun buildYdk(cards: List<DeckCard>): String {
    fun section(name: String) = cards.filter { it.section == name }
        .flatMap { c -> List(c.count.coerceAtLeast(0)) { c.cardId } }
    val sb = StringBuilder()
    sb.append("#created by Card Scanner\n")
    sb.append("#main\n")
    section("main").forEach { sb.append(it).append("\n") }
    sb.append("#extra\n")
    section("extra").forEach { sb.append(it).append("\n") }
    sb.append("!side\n")
    return sb.toString()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeckEditor(deck: Deck, decks: List<Deck>, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val deckCache = remember(deck.id) { SideStores.deckCards(deck.id) }
    val cache by deckCache.state.collectAsState()
    val cards = cache.value ?: emptyList()
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = cache.value == null && cache.error == null
    val error = writeError ?: cache.error

    var query by remember { mutableStateOf("") }
    val results = remember { mutableStateListOf<CardRow>() }
    var searching by remember { mutableStateOf(false) }

    // Spec E1 §4/§8: Abgleich dieses Decks. null, solange Deckkarten, Sammlung oder Preise fehlen -> "…".
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val priceIds = remember(cache.value) { cache.value?.mapTo(HashSet()) { it.cardId } }
    val prices = rememberCatalogPrices(priceIds)
    val coverage: Coverage? = remember(deck, decks, cache.value, ready, prices) {
        val r = ready
        val dc = cache.value
        if (dc == null || r == null || prices == null) null
        else DeckCoverage.compute(deck.id, dc, r.copies, r.cards, decks, r.containers, prices)
    }
    val numbers = remember(coverage) { coverage?.cards?.associateBy { it.cardId } }
    var boxError by remember { mutableStateOf<String?>(null) }
    var fill by remember { mutableStateOf<FillProposal?>(null) }
    var wishlistOpen by remember { mutableStateOf(false) }

    LaunchedEffect(deck.id) { deckCache.refresh() }

    fun mutate(block: suspend () -> Unit) {
        scope.launch {
            try { block(); deckCache.refreshAndWait(); SideStores.allDeckCards.refresh(); writeError = null } catch (e: Exception) { writeError = e.message }
        }
    }

    val search = {
        val q = query.trim()
        if (q.isNotBlank()) {
            scope.launch {
                searching = true
                try {
                    val found = CardSearchRepository.search(q)
                    results.clear(); results.addAll(found.take(8))
                    writeError = null
                } catch (e: Exception) { writeError = e.message }
                searching = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                }
                Spacer(Modifier.width(4.dp))
                Text(
                    deck.name, style = MaterialTheme.typography.headlineSmall,
                    color = OnSurface, modifier = Modifier.weight(1f),
                )
                IconButton(onClick = {
                    val ydk = buildYdk(cards)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TITLE, "${deck.name}.ydk")
                        putExtra(Intent.EXTRA_TEXT, ydk)
                    }
                    context.startActivity(Intent.createChooser(send, "Deck exportieren"))
                }) { Icon(Icons.Default.Share, "Exportieren", tint = Primary) }
            }

            DeckCoverageHead(
                deck = deck, decks = decks, containers = ready?.containers, coverage = coverage, boxError = boxError,
                onPickBox = { containerId ->
                    scope.launch {
                        try { DecksRepository.setContainer(deck.id, containerId); SideStores.decks.refreshAndWait(); boxError = null }
                        catch (e: Exception) { boxError = e.message }
                    }
                },
                onWishlist = { wishlistOpen = true },
                onFillBox = {
                    val r = ready
                    val dc = cache.value
                    if (r != null && dc != null) fill = FillBoxProposal.compute(deck.id, dc, r.copies, r.cards, decks, r.containers)
                },
            )

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = query, onValueChange = { query = it },
                    placeholder = { Text("Karte suchen (Name/Passcode)") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = search) { Icon(Icons.Default.Search, "Suchen") }
            }

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }

            if (searching) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator(color = Primary, modifier = Modifier.size(20.dp))
            } else if (results.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    results.forEach { r ->
                        SearchResultRow(r, onAdd = {
                            mutate {
                                DecksRepository.addCard(
                                    deck.id, cardId = r.id, name = r.name,
                                    imageUrl = r.imageUrl, section = extraOrMain(r.type),
                                )
                            }
                        })
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            if (loading) {
                // Spec §8: scrollbarer Nachfahre statt eines nackten Box -- sonst greift
                // Nach-unten-ziehen (verschachteltes Scrollen) hier nie.
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Primary)
                        }
                    }
                }
            } else {
                val main = cards.filter { it.section == "main" }
                val extra = cards.filter { it.section == "extra" }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        SectionHeader("Main · ${main.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId)) { block -> mutate(block) } }
                    item {
                        Spacer(Modifier.height(10.dp))
                        SectionHeader("Extra · ${extra.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId)) { block -> mutate(block) } }
                }
            }
        }
    }

    fill?.let { proposal ->
        val r = ready
        if (r != null) {
            FillBoxSheet(
                proposal = proposal, boxId = DeckCoverage.deckBoxId(deck, r.containers), containers = r.containers,
                onDismiss = { fill = null },
                onOpenWishlist = { fill = null; wishlistOpen = true },
            )
        }
    }

    if (wishlistOpen && coverage != null) {
        DeckWishlistDialog(
            coverage = coverage,
            nameOf = { id -> cards.firstOrNull { it.cardId == id }?.name ?: id },
            imageOf = { id -> cards.firstOrNull { it.cardId == id }?.imageUrl },
            onDismiss = { wishlistOpen = false },
        )
    }
}

/** Spec E1 §8: Editor-Kopf mit Deckbox-Auswahl, Kennzahlen und den beiden Knoepfen (Gegenstueck zu DeckCoverageHeader.jsx). */
@Composable
private fun DeckCoverageHead(
    deck: Deck,
    decks: List<Deck>,
    containers: List<ContainerRow>?,
    coverage: Coverage?,
    boxError: String?,
    onPickBox: (String?) -> Unit,
    onWishlist: () -> Unit,
    onFillBox: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        when {
            containers == null -> Text(DeckCoverage.LOADING, color = Muted, style = MaterialTheme.typography.bodyMedium)
            containers.none { it.kind == "deckbox" } -> Text("Noch keine Deckbox", color = Muted, style = MaterialTheme.typography.bodyMedium)
            else -> Box {
                Row(Modifier.clickable { expanded = true }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Deckbox: ${DeckCoverage.deckBoxId(deck, containers)?.let { id -> containers.firstOrNull { it.containerId == id }?.name } ?: "Keine Box"}",
                        color = OnSurface, style = MaterialTheme.typography.bodyMedium)
                    Icon(Icons.Default.ArrowDropDown, "Deckbox wählen", tint = Muted)
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DropdownMenuItem(text = { Text("Keine Box") }, onClick = { expanded = false; onPickBox(null) })
                    DeckCoverage.deckBoxChoices(deck.id, decks, containers).forEach { c ->
                        DropdownMenuItem(text = { Text(c.name) }, onClick = { expanded = false; onPickBox(c.containerId) })
                    }
                }
            }
        }
        Text(coverage?.let { DeckCoverage.headerText(it) } ?: DeckCoverage.LOADING,
            color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onWishlist, enabled = coverage != null && coverage.totals.missing > 0) { Text("Fehlende auf die Wunschliste") }
            OutlinedButton(onClick = onFillBox, enabled = coverage?.boxId != null) { Text("Box befüllen") }
        }
        boxError?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
    }
}

/** Spec E1 §7: Sheet "Box befüllen". Vorschlag beim Oeffnen eingefroren; verschoben wird Exemplar fuer Exemplar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FillBoxSheet(
    proposal: FillProposal,
    boxId: String?,
    containers: List<ContainerRow>,
    onDismiss: () -> Unit,
    onOpenWishlist: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val containersById = remember(containers) { containers.associateBy { it.containerId } }
    val checked = remember(proposal) { mutableStateMapOf<String, Boolean>().apply { proposal.rows.forEach { put(it.copy.copyId, true) } } }
    // copyId -> null = verschoben, Text = Fehlermeldung; leer = noch nichts versucht.
    val results = remember(proposal) { mutableStateMapOf<String, String?>() }
    var busy by remember { mutableStateOf(false) }
    var done by remember(proposal) { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Box befüllen", style = MaterialTheme.typography.titleMedium, color = OnSurface, fontWeight = FontWeight.Bold)
            if (proposal.rows.isEmpty()) Text("Nichts zu verschieben.", color = Muted, style = MaterialTheme.typography.bodySmall)
            proposal.rows.forEach { row ->
                val id = row.copy.copyId
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = checked[id] == true, enabled = !busy && !done, onCheckedChange = { checked[id] = it })
                    Column(Modifier.weight(1f)) {
                        Text(row.card.name ?: row.copy.cardId, color = OnSurface, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                        Text(
                            "${row.copy.setCode} · ${row.copy.rarity} · ${Valuation.EDITION_LABELS[row.copy.edition] ?: row.copy.edition}",
                            color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                        )
                        Text(FillBoxProposal.locationText(row.copy, row.copy.containerId?.let { containersById[it] }),
                            color = Muted, style = MaterialTheme.typography.labelSmall)
                        if (results.containsKey(id)) {
                            val err = results[id]
                            Text(err ?: "Verschoben", color = if (err == null) Good else ErrorColor, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            FillBoxProposal.shortText(proposal.short)?.let {
                Text(it, color = Gold, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onOpenWishlist, enabled = !busy) { Text("Fehlende auf die Wunschliste") }
            }
            FillBoxProposal.surplusText(proposal.surplus)?.let { Text(it, color = Muted, style = MaterialTheme.typography.bodySmall) }
            if (!done) {
                Button(
                    onClick = {
                        val box = boxId ?: return@Button
                        busy = true
                        scope.launch {
                            for (row in proposal.rows) {
                                if (checked[row.copy.copyId] != true) continue
                                results[row.copy.copyId] = try {
                                    CollectionRepository.setCopyLocation(row.copy.copyId, box, null, null); null
                                } catch (e: Exception) { e.message ?: "Verschieben fehlgeschlagen" }
                            }
                            CollectionStore.awaitSync()
                            busy = false
                            done = true
                        }
                    },
                    enabled = !busy && boxId != null && checked.values.any { it },
                ) { Text(if (busy) "Wird verschoben…" else "In die Box verschieben") }
            } else {
                TextButton(onClick = onDismiss) { Text("Schließen") }
            }
        }
    }
}

/** Spec E1 §6: Bestaetigung und Rueckmeldung. Die Wunschliste wird beim Oeffnen frisch geladen. */
@Composable
private fun DeckWishlistDialog(coverage: Coverage, nameOf: (String) -> String, imageOf: (String) -> String?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var plan by remember { mutableStateOf<WishPlan?>(null) }
    var result by remember { mutableStateOf<WishResult?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        SideStores.wishlist.refreshAndWait()
        val s = SideStores.wishlist.state.value
        val list = s.value
        if (list == null) error = s.error ?: "Wunschliste nicht geladen"
        else plan = DeckWishlist.missingForWishlist(coverage, list.map { it.cardId })
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Fehlende auf die Wunschliste") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val r = result
                val p = plan
                Text(
                    when {
                        r != null -> DeckWishlist.resultText(r.total, r.added, r.watches)
                        p != null -> DeckWishlist.confirmText(p)
                        else -> DeckCoverage.LOADING
                    },
                )
                error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
            }
        },
        confirmButton = {
            if (result != null) {
                TextButton(onClick = onDismiss) { Text("Schließen") }
            } else {
                val p = plan
                TextButton(
                    enabled = !busy && p != null && p.candidates.isNotEmpty(),
                    onClick = {
                        if (p == null) return@TextButton
                        busy = true
                        scope.launch {
                            try {
                                result = WishlistRepository.addMissing(p.candidates, nameOf, imageOf)
                                SideStores.wishlist.refresh()
                                SideStores.dealWatches.refresh()
                            } catch (e: Exception) { error = e.message }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Wird hinzugefügt…" else "Hinzufügen") }
            }
        },
        dismissButton = {
            if (result == null) TextButton(onClick = onDismiss, enabled = !busy) { Text("Abbrechen") }
        },
    )
}

@Composable
private fun SearchResultRow(r: CardRow, onAdd: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(r.imageUrl, r.name)
            Spacer(Modifier.width(10.dp))
            Text(
                r.name ?: r.id, color = OnSurface, maxLines = 2,
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onAdd) { Icon(Icons.Default.Add, "Hinzufügen", tint = Primary) }
        }
    }
}

@Composable
private fun DeckCardRow(card: DeckCard, numbers: CoverageCard?, mutate: ((suspend () -> Unit)) -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(card.imageUrl, card.name)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    card.name ?: card.cardId, color = OnSurface, maxLines = 2,
                    style = MaterialTheme.typography.bodyMedium,
                )
                // Spec E1 §8: "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
                Text(
                    numbers?.let { DeckCoverage.rowText(it) } ?: DeckCoverage.LOADING,
                    color = if (numbers != null && numbers.missing > 0) ErrorColor else Muted,
                    fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                )
                numbers?.let { DeckCoverage.reservedTexts(it) }?.forEach {
                    Text(it, color = Gold, style = MaterialTheme.typography.labelSmall)
                }
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = { mutate { DecksRepository.setCount(card.id, card.count - 1) } }) {
                Text("−", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
            }
            Text(
                card.count.toString(), color = OnSurface,
                style = MaterialTheme.typography.titleMedium.copy(fontFamily = MonoFontFamily),
            )
            IconButton(onClick = { mutate { DecksRepository.setCount(card.id, card.count + 1) } }) {
                Text("+", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
            }
            IconButton(onClick = { mutate { DecksRepository.removeCard(card.id) } }) {
                Icon(Icons.Default.Delete, "Entfernen", tint = ErrorColor)
            }
        }
    }
}

@Composable
private fun Thumb(imageUrl: String?, contentDescription: String?) {
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).background(Background),
        contentAlignment = Alignment.Center,
    ) {
        if (!imageUrl.isNullOrBlank()) {
            AsyncImage(
                model = imageUrl, contentDescription = contentDescription,
                contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(Icons.Default.Image, null, tint = Muted, modifier = Modifier.size(18.dp))
        }
    }
}
