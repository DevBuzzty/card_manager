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
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogState
import com.example.yugiohscanner.cloud.CatalogSync
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
import com.example.yugiohscanner.ml.DeckEntry
import com.example.yugiohscanner.ml.DeckFormats
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.DeckLegality
import com.example.yugiohscanner.ml.LegalityCard
import com.example.yugiohscanner.ml.LegalityCatalog
import com.example.yugiohscanner.ml.LegalityResult
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
import com.example.yugiohscanner.ui.theme.Warn
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

/**
 * Spec E3 §4: gelesener Legalitaets-Katalog fuer genau diese [ids]; catalog null = kein (E3-)Katalog.
 * ids gehoert dazu, damit eine neu hinzugefuegte Karte nie kurz als "Banlist unbekannt" erscheint.
 */
private data class LegalityLoad(val ids: Set<String>, val catalog: LegalityCatalog?)

/**
 * Spec E3 §4/§7: Legalitaetsdaten der Deckkarten-Passcodes, abseits des Hauptthreads gelesen; null = laedt ("…").
 * F4: zusaetzlich auf die fertig geladene Katalogversion geschluesselt (aus dem vorhandenen [CatalogSync.state]),
 * damit ein offener Deck-Bildschirm nach "Jetzt pruefen" (SettingsScreen) neu laedt, statt am alten Katalog-Index
 * haengen zu bleiben. Nur [CatalogState.Ready] zaehlt -- die haeufigen Downloading(percent)-Ticks sollen keine
 * eigene DB-Lesung anstossen.
 */
@Composable
private fun rememberLegalityCatalog(ids: Set<String>?): LegalityLoad? {
    val catalogState by CatalogSync.state.collectAsState()
    val catalogVersion = (catalogState as? CatalogState.Ready)?.version
    val load by produceState<LegalityLoad?>(initialValue = null, ids, catalogVersion) {
        if (ids != null) value = withContext(Dispatchers.IO) { LegalityLoad(ids, runCatching { CatalogRepository.legalityCatalog(ids) }.getOrNull()) }
    }
    return load?.takeIf { it.ids == ids }
}

private fun legalityCardsOf(cards: List<DeckCard>) = cards.map { LegalityCard(it.cardId, it.name, it.count, it.section) }

private val BanOrange = Color(0xFFFF9800)

/** Spec E3 §7: Format-Chip und Badge (gruen "Legal", gelb "Legal · n Warnungen", rot "n Verstöße", grau "Frei"); null = "…". */
@Composable
private fun LegalityBadge(format: String, result: LegalityResult?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(DeckLegality.FORMAT_LABELS[format] ?: "TCG", color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
        if (result == null) Text(DeckCoverage.LOADING, color = Muted, style = MaterialTheme.typography.labelSmall)
        else {
            val color = when (DeckLegality.badgeKind(result, format)) { "legal" -> Good; "warn" -> Warn; "crit" -> ErrorColor; else -> Muted }
            Text(DeckLegality.badgeText(result, format), color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Spec E3 §7: Banlist-Icon rot "Verboten", orange "1", gelb "2"; uneingeschraenkt kein Icon. */
@Composable
private fun BanIcon(ban: String?) {
    val label = ban?.let { DeckLegality.BAN_LABELS[it] } ?: return
    val bg = when (ban) { "forbidden" -> ErrorColor; "limited" -> BanOrange; else -> Warn }
    Box(Modifier.clip(RoundedCornerShape(4.dp)).background(bg).padding(horizontal = 5.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
fun DecksScreen(onClose: (() -> Unit)? = null) {
    var openDeckId by remember { mutableStateOf<Long?>(null) }
    val cache by SideStores.decks.state.collectAsState()
    val decks = cache.value ?: emptyList()
    // Spec E2 §5/§6: offener Import -- null = keiner; text null = Einfuegen (Zwischenablage), sonst geteilter Text.
    var importRequest by remember { mutableStateOf<ImportRequest?>(null) }
    val sharedText by DeckImportInbox.text.collectAsState()
    LaunchedEffect(sharedText) {
        if (sharedText != null) DeckImportInbox.take()?.let { importRequest = ImportRequest(it); openDeckId = null }
    }

    // The editor is a sub-view of this destination — system back closes it, not the destination.
    BackHandler(importRequest != null) { importRequest = null }
    importRequest?.let { request ->
        DeckImportScreen(
            sharedText = request.text,
            onBack = { importRequest = null },
            onCreated = { id -> importRequest = null; openDeckId = id },
        )
        return
    }
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
    var newMenuOpen by remember { mutableStateOf(false) }
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
    // Spec E3 §7: Badge der Deck-Liste aus dem gespeicherten Stand; null, solange Deckkarten oder Katalog laden.
    val legalityLoad = rememberLegalityCatalog(priceIds)
    val legalities: Map<Long, LegalityResult>? = remember(cache.value, allCards, legalityLoad) {
        val load = legalityLoad
        if (cache.value == null || allCards == null || load == null) null
        else {
            val byDeck = allCards.groupBy { it.deckId }
            decks.associate { d -> d.id to DeckLegality.check(legalityCardsOf(byDeck[d.id] ?: emptyList()), d.format, load.catalog) }
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
                // Spec E2 §5: Plus-Menue Leer · Einfügen (YDKE/Text).
                Box {
                    FilledIconButton(onClick = { newMenuOpen = true }) { Icon(Icons.Default.Add, "Neues Deck") }
                    DropdownMenu(expanded = newMenuOpen, onDismissRequest = { newMenuOpen = false }) {
                        DropdownMenuItem(text = { Text("Leer") }, onClick = { newMenuOpen = false; create() })
                        DropdownMenuItem(text = { Text("Einfügen (YDKE/Text)") }, onClick = { newMenuOpen = false; importRequest = ImportRequest(null) })
                    }
                }
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
                            deck, summary, legalities?.get(deck.id),
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
private fun DeckRow(deck: Deck, summary: String, legality: LegalityResult?, onOpen: () -> Unit, onDelete: () -> Unit) {
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
                LegalityBadge(deck.format, legality)
                Text(summary, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Löschen", tint = ErrorColor)
            }
        }
    }
}

/** Spec E2 §5/§6: offener Import; text null = Einfuegen (Zwischenablage), sonst geteilter Text direkt in die Vorschau. */
private data class ImportRequest(val text: String?)

/** Spec E2 §6: Deckliste als Text ueber den Android-Teilen-Dialog. */
private fun shareText(context: android.content.Context, title: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TITLE, title)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(send, "Deck teilen"))
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
    // Spec E2 §6: Ziel beim Hinzufuegen -- false = Deck (Main/Extra per deckSectionFor), true = Side.
    var addToSide by remember { mutableStateOf(false) }
    var shareMenuOpen by remember { mutableStateOf(false) }
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
    // Spec H1 §5.3: Passcodes mit mindestens einem markierten Exemplar (Preisschild; gleicher Schluessel wie der Abgleich).
    val forSaleCards = remember(ready?.copies) { ready?.copies?.filter { !it.deleted && it.forSale }?.map { it.cardId }?.toSet() ?: emptySet() }
    var boxError by remember { mutableStateOf<String?>(null) }
    var fill by remember { mutableStateOf<FillProposal?>(null) }
    var wishlistOpen by remember { mutableStateOf(false) }
    // Spec E3 §7: Legalitaet aus dem GESPEICHERTEN Stand; Format speichert sofort.
    val legalityLoad = rememberLegalityCatalog(priceIds)
    val legality: LegalityResult? = remember(deck.format, cache.value, legalityLoad) {
        val dc = cache.value
        val load = legalityLoad
        if (dc == null || load == null) null else DeckLegality.check(legalityCardsOf(dc), deck.format, load.catalog)
    }
    var formatError by remember { mutableStateOf<String?>(null) }
    // Spec E2 Task 8 Fix 1: ein Lauf gleichzeitig -- sonst kann ein Doppel-Tipp (+/-, entfernen, verschieben)
    // DecksRepository zweimal mit demselben, noch nicht aktualisierten Stand aufrufen (Review-Fund).
    val inFlight = remember { InFlight() }
    var mutating by remember { mutableStateOf(false) }

    LaunchedEffect(deck.id) { deckCache.refresh() }

    // Spec E3 §5: frischer Stand und Artwork-Zuordnung fuer die Kopien-Grenze -- innerhalb von mutate gelesen, damit ein
    // Tipp direkt nach einer Aenderung nicht mit dem Stand von vor der Aenderung zaehlt.
    suspend fun freshCardsAndAliases(extraId: String): Pair<List<DeckCard>, Map<String, String>> {
        val fresh = deckCache.state.value.value ?: cards
        val aliases = withContext(Dispatchers.IO) { runCatching { CatalogRepository.aliases(fresh.map { it.cardId } + extraId) }.getOrDefault(emptyMap()) }
        return fresh to aliases
    }

    fun mutate(block: suspend () -> Unit) {
        if (!inFlight.tryStart()) return
        mutating = true
        scope.launch {
            try { block(); deckCache.refreshAndWait(); SideStores.allDeckCards.refresh(); writeError = null }
            catch (e: Exception) { writeError = e.message }
            finally { inFlight.finish(); mutating = false }
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
                // Spec E2 §6: Teilen-Menue YDKE · Textliste · YDK (als Text; YDK jetzt mit Side-Deck).
                Box {
                    IconButton(onClick = { shareMenuOpen = true }) { Icon(Icons.Default.Share, "Teilen", tint = Primary) }
                    DropdownMenu(expanded = shareMenuOpen, onDismissRequest = { shareMenuOpen = false }) {
                        val entries = cards.map { DeckEntry(it.cardId, it.name, it.count, it.section) }
                        DropdownMenuItem(text = { Text("YDKE") }, onClick = { shareMenuOpen = false; shareText(context, deck.name, DeckFormats.buildYdke(entries)) })
                        DropdownMenuItem(text = { Text("Textliste") }, onClick = { shareMenuOpen = false; shareText(context, deck.name, DeckFormats.buildTextList(entries)) })
                        DropdownMenuItem(text = { Text("YDK") }, onClick = { shareMenuOpen = false; shareText(context, "${deck.name}.ydk", DeckFormats.buildYdk(entries)) })
                    }
                }
            }

            DeckLegalityHead(
                format = deck.format, legality = legality, builtAt = legalityLoad?.catalog?.builtAt, error = formatError,
                busy = mutating,
                // F5: dasselbe InFlight-Gatter wie mutate() -- ein laufender Formatwechsel sperrt Hinzufuegen/+
                // (mutate() kehrt bei laufendem inFlight sofort zurueck, ohne etwas zu tun) und umgekehrt blockiert
                // eine laufende Kartenaenderung hier den Formatwechsel (tryStart liefert dann false).
                onPickFormat = { f ->
                    if (inFlight.tryStart()) {
                        mutating = true
                        scope.launch {
                            try { DecksRepository.setFormat(deck.id, f); SideStores.decks.refreshAndWait(); formatError = null }
                            catch (e: Exception) { formatError = e.message ?: DeckLegality.FORMAT_SAVE_FAILED }
                            finally { inFlight.finish(); mutating = false }
                        }
                    }
                },
            )
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
            // Spec E2 §5: Notizen am Handy nur anzeigen, wenn vorhanden.
            deck.notes?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
            }

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
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Ziel:", color = Muted, style = MaterialTheme.typography.labelMedium)
                FilterChip(selected = !addToSide, onClick = { addToSide = false }, label = { Text("Deck") })
                FilterChip(selected = addToSide, onClick = { addToSide = true }, label = { Text("Side") })
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
                                // Spec E3 §5: bestehende Zeile erhoehen, 4. Kopie blockiert ("Höchstens 3 Kopien je Karte").
                                val (fresh, aliases) = freshCardsAndAliases(r.id)
                                DecksRepository.addCopy(
                                    deck.id, fresh, cardId = r.id, name = r.name, imageUrl = r.imageUrl,
                                    section = if (addToSide) "side" else DeckImport.deckSectionFor(r.type),
                                    format = deck.format, aliases = aliases,
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
                val side = cards.filter { it.section == "side" }
                // Spec E2 §6: eine Kopie verschieben; fuer "→ Deck" den Typ aus dem Katalog (ohne Katalog: Main).
                // Spec E3 §3: Typ ueber den Haupt-Passcode; frischer Stand (Verschieben aendert die Summe nicht, nie blockiert).
                val move: (DeckCard) -> Unit = { card ->
                    mutate {
                        val (fresh, aliases) = freshCardsAndAliases(card.cardId)
                        val type = if (card.section == "side") withContext(Dispatchers.IO) {
                            CatalogRepository.importRows(listOf(DeckImport.canonicalPasscode(card.cardId, aliases))).firstOrNull()?.type
                        } else null
                        DecksRepository.moveOne(deck.id, fresh.firstOrNull { it.id == card.id } ?: card, fresh, type)
                    }
                }
                // Spec E3 §5: "+" an einer Zeile mit derselben Grenze wie "Hinzufügen".
                val plusOne: (DeckCard) -> Unit = { card ->
                    mutate {
                        val (fresh, aliases) = freshCardsAndAliases(card.cardId)
                        DecksRepository.incrementCopy(card, fresh, deck.format, aliases)
                    }
                }
                val banOf: (DeckCard) -> String? = { card -> DeckLegality.banOf(card.cardId, deck.format, legalityLoad?.catalog) }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        SectionHeader("Main · ${main.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), it.cardId in forSaleCards, move, plusOne, mutating) { block -> mutate(block) } }
                    item {
                        Spacer(Modifier.height(10.dp))
                        SectionHeader("Extra · ${extra.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), it.cardId in forSaleCards, move, plusOne, mutating) { block -> mutate(block) } }
                    item {
                        Spacer(Modifier.height(10.dp))
                        SectionHeader("Side · ${side.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(side, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), it.cardId in forSaleCards, move, plusOne, mutating) { block -> mutate(block) } }
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

/**
 * Spec E3 §7: Format-Auswahl (speichert sofort) und Badge; darunter aufklappbar "n Verstöße" mit Warnungen und
 * "Banlist-Stand". Im Format "Frei" gibt es keine Liste.
 */
@Composable
private fun DeckLegalityHead(format: String, legality: LegalityResult?, builtAt: String?, error: String?, busy: Boolean, onPickFormat: (String) -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    var issuesOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                // F5: waehrend eines laufenden Formatwechsels (oder einer laufenden Kartenaenderung) nicht oeffnen.
                Row(Modifier.clickable(enabled = !busy) { menuOpen = true }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Format: ${DeckLegality.FORMAT_LABELS[format] ?: "TCG"}", color = OnSurface, style = MaterialTheme.typography.bodyMedium)
                    Icon(Icons.Default.ArrowDropDown, "Format wählen", tint = Muted)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DeckLegality.FORMATS.forEach { f ->
                        DropdownMenuItem(text = { Text(DeckLegality.FORMAT_LABELS.getValue(f)) }, onClick = { menuOpen = false; if (f != format) onPickFormat(f) })
                    }
                }
            }
            if (legality == null) Text(DeckCoverage.LOADING, color = Muted, style = MaterialTheme.typography.labelMedium)
            else {
                val color = when (DeckLegality.badgeKind(legality, format)) { "legal" -> Good; "warn" -> Warn; "crit" -> ErrorColor; else -> Muted }
                Text(DeckLegality.badgeText(legality, format), color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium)
            }
        }
        if (legality != null && DeckLegality.normalizeFormat(format) != "free") {
            Row(Modifier.clickable { issuesOpen = !issuesOpen }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(DeckLegality.violationCountText(legality.violations.size), color = if (legality.legal) Muted else ErrorColor, style = MaterialTheme.typography.labelMedium)
                Icon(if (issuesOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, tint = Muted)
            }
            if (issuesOpen) {
                legality.violations.forEach { Text(it.text, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
                legality.warnings.forEach { Text(it.text, color = Warn, style = MaterialTheme.typography.labelSmall) }
                DeckLegality.banlistDateText(builtAt)?.let { Text(it, color = Muted, style = MaterialTheme.typography.labelSmall) }
            }
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
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
            containers.none { it.kind == "deckbox" && !it.deleted } -> Text("Noch keine Deckbox", color = Muted, style = MaterialTheme.typography.bodyMedium)
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
                Text(it, color = Warn, style = MaterialTheme.typography.bodySmall)
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
private fun DeckCardRow(
    card: DeckCard, numbers: CoverageCard?, ban: String?, forSale: Boolean, onMove: (DeckCard) -> Unit, onPlus: (DeckCard) -> Unit, busy: Boolean,
    mutate: ((suspend () -> Unit)) -> Unit,
) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(card.imageUrl, card.name)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        card.name ?: card.cardId, color = OnSurface, maxLines = 2,
                        style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f, fill = false),
                    )
                    // Spec E3 §7: Banlist-Icon nach Format, kein Stern am Handy.
                    BanIcon(ban)
                    // Spec H1 §5.3: markierte Exemplare bleiben verfuegbar, mit Preisschild.
                    if (forSale) Icon(Icons.Default.Sell, "Zum Verkauf markiert", tint = Warn, modifier = Modifier.size(16.dp))
                }
                // Spec E1 §8: "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
                Text(
                    numbers?.let { DeckCoverage.rowText(it) } ?: DeckCoverage.LOADING,
                    color = if (numbers != null && numbers.missing > 0) ErrorColor else Muted,
                    fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                )
                numbers?.let { DeckCoverage.reservedTexts(it) }?.forEach {
                    Text(it, color = Warn, style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = { onMove(card) }, enabled = !busy, contentPadding = PaddingValues(0.dp)) {
                    Text(DeckImport.moveLabel(card.section), style = MaterialTheme.typography.labelSmall)
                }
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = { mutate { DecksRepository.setCount(card.id, card.count - 1) } }, enabled = !busy) {
                Text("−", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
            }
            Text(
                card.count.toString(), color = OnSurface,
                style = MaterialTheme.typography.titleMedium.copy(fontFamily = MonoFontFamily),
            )
            IconButton(onClick = { onPlus(card) }, enabled = !busy) {
                Text("+", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
            }
            IconButton(onClick = { mutate { DecksRepository.removeCard(card.id) } }, enabled = !busy) {
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
