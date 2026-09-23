package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.WishlistRepository
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SalesOverview
import com.example.yugiohscanner.ml.Tags
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.TypeChip
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.Warn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun CardDetailScreen(cardId: String, onClose: () -> Unit) {
    // Spec §5: Drucke, Exemplare und Behaelter aus dem Speicher, nach Karte gefiltert. `remember`
    // haengt an der Listen-Identitaet -- ein Abgleich ohne Aenderung liefert dieselbe Liste.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val printings = remember(ready?.cards, cardId) { ready?.cards?.filter { it.id == cardId } ?: emptyList() }
    val copies = remember(ready?.copies, cardId) { ready?.copies?.filter { it.cardId == cardId } ?: emptyList() }
    val containers = ready?.containers ?: emptyList()
    var error by remember { mutableStateOf<String?>(null) }
    // Spec §8: aus dem Wunschlisten-Speicher. `addedHere` sperrt den Knopf sofort nach dem Tippen,
    // bevor der Speicher nachgeladen hat -- der POST ist ein reines Insert, ein zweiter Tipp legte
    // eine Dublette an.
    val wish by SideStores.wishlist.state.collectAsState()
    var addedHere by remember { mutableStateOf(false) }
    val inWishlist = addedHere || wish.value?.any { it.cardId == cardId } == true
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // Catalog first (Task 9): Name, Kartentext and Stats prefer the offline catalog when it has
    // this card; the owned printings below (rarity, set code, valuation) stay collection data,
    // unchanged. Off the UI thread — this is a SQLite read.
    var catalogCard by remember(cardId) { mutableStateOf<CatalogCard?>(null) }

    var sheetCopy by remember { mutableStateOf<CopyRow?>(null) }

    LaunchedEffect(Unit) { SideStores.wishlist.ensureLoaded() }
    // Spec H3a §6: "angeboten auf <Kanal> für <Preis>" am Exemplar.
    val listingsState by SideStores.listings.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.listings.ensureLoaded() }
    val offers = remember(listingsState.value) { listingsState.value?.byCopy() ?: emptyMap() }

    // Spec H2 §7: eine komplett verkaufte Karte hat keinen lebenden Druck mehr, die Ansicht bleibt aber
    // offen, solange der Verkaufs-Speicher Positionen dieser Karte hat (SalesOverview.cardSold -- dieselbe
    // Auswahl wie CardSoldSection, damit "offen" nie mit einem leeren Abschnitt zusammenfaellt).
    val salesState by SideStores.sales.state.collectAsState()
    // Abschluss-Fixwelle I2: frisch laden -- die Schliesslogik unten haengt am aktuellen Verkaufsstand.
    LaunchedEffect(Unit) { SideStores.sales.refresh() }
    val salesData = salesState.value
    val soldHere = remember(salesData, cardId) { salesData?.let { SalesOverview.cardSold(it, cardId).isNotEmpty() } == true }
    // "Entschieden" = geladen oder gescheitert, und gerade kein Nachladen (z. B. direkt nach dem Verkauf des
    // letzten Exemplars, bevor der neue Verkauf im Speicher steht). Gescheitert ohne Wert: soldHere = false.
    val salesSettled = !salesState.loading && (salesData != null || salesState.error != null)

    LaunchedEffect(cardId) {
        catalogCard = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(cardId) }.getOrNull() }
    }

    // Nach jedem Schreibvorgang: abgleichen statt selbst nachladen (Spec §5). awaitSync wirft nie --
    // ein gescheiterter Abgleich zeigt sich im Hinweis, nicht als Absturz (Spec §7.2).
    suspend fun refresh() {
        CollectionStore.awaitSync()
    }

    val base = printings.firstOrNull()
    // Nur schliessen, wenn der Speicher bereit ist und die Karte wirklich keine Drucke mehr hat
    // (z. B. der letzte wurde geloescht) und auch nicht verkauft wurde. Ohne Ready zeigt AppNav den
    // Ladebildschirm. Als Effekt, nicht waehrend der Komposition -- die darf keine Navigation ausloesen.
    // Solange ein Exemplar-Sheet offen ist (z. B. Verkauf des letzten Exemplars, das Sheet laedt danach die
    // Verkaeufe nach), wird nicht geschlossen -- sonst entschiede ein veralteter Verkaufs-Stand.
    val gone = ready != null && base == null && !soldHere && salesSettled && sheetCopy == null
    LaunchedEffect(gone) { if (gone) onClose() }
    if (base == null) {
        if (ready != null && soldHere) {
            val soldName = catalogCard?.nameDe
                ?: salesData?.let { SalesOverview.cardSold(it, cardId).firstOrNull()?.item?.name } ?: cardId
            Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                    Text(soldName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Text("Nicht mehr in der Sammlung", color = Muted, style = MaterialTheme.typography.bodyMedium)
                CardSoldSection(cardId)
            }
        } else if (ready != null && !gone) {
            // Die Verkaeufe laden noch -- erst danach steht fest, ob die Ansicht schliesst.
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("…", color = Muted) }
        }
    } else {
        val displayName = catalogCard?.nameDe ?: base.name ?: base.id
        val displayDesc = catalogCard?.descDe ?: base.desc
        val displayLevel = catalogCard?.level ?: base.level
        val displayAtk = catalogCard?.atk ?: base.atk
        val displayDef = catalogCard?.def ?: base.def

        val isLink = base.type?.contains("Link") == true
        val isXyz = base.type?.contains("XYZ") == true
        val levelLabel = if (isLink) "Link" else if (isXyz) "Rang" else "Level"

        Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                Text(displayName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                IconButton(enabled = !inWishlist, onClick = {
                    scope.launch {
                        try {
                            WishlistRepository.addToWishlist(base.id, base.name ?: base.id, base.imageUrl, null)
                            error = null; addedHere = true; notice = "Zur Wunschliste hinzugefügt"; SideStores.wishlist.refresh()
                        } catch (e: Exception) { error = e.message }
                    }
                }) {
                    Icon(
                        if (inWishlist) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        if (inWishlist) "Auf der Wunschliste" else "Zur Wunschliste hinzufügen",
                        tint = if (inWishlist) Primary else LocalContentColor.current,
                    )
                }
            }

            // Hero image with a soft violet glow.
            Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                AsyncImage(
                    model = base.imageUrl,
                    contentDescription = base.name,
                    modifier = Modifier
                        .height(320.dp)
                        .shadow(28.dp, RoundedCornerShape(12.dp))
                        .clip(RoundedCornerShape(12.dp)),
                )
            }

            // Type / race / attribute chips.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                TypeChip(base.type)
                base.attribute?.takeIf { it.isNotBlank() }?.let { NeutralChip(it) }
                base.race?.takeIf { it.isNotBlank() }?.let { NeutralChip(it) }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            notice?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Good, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader("Deine Exemplare")
            Spacer(Modifier.height(8.dp))
            val ctx = androidx.compose.ui.platform.LocalContext.current
            val byKey = copies.groupBy { it.printingKey() }
            printings.forEach { v ->
                val mine = byKey[v.printingKey()] ?: emptyList()
                val migrated = mine.isNotEmpty() || v.quantity == 0
                SpaceCard(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            RarityChip(v.rarity)
                            Text("${langFlag(v.language)} ${v.setCode}", style = MaterialTheme.typography.bodyMedium, fontFamily = MonoFontFamily, color = Muted, modifier = Modifier.weight(1f))
                            ValueText(Valuation.valueOf(v, mine), style = MaterialTheme.typography.bodyMedium)
                            IconButton(enabled = migrated, onClick = { scope.launch { try { CollectionRepository.softDelete(v); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                                Icon(Icons.Default.Delete, "Löschen", tint = MaterialTheme.colorScheme.error)
                            }
                        }
                        // Spec G4 §7: Preiszeile nur bei gesetztem 1st-Ed-Preis (Gegenstueck zu CardDetailPanel.jsx).
                        Valuation.firstEdLine(v)?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, fontFamily = MonoFontFamily, color = Muted)
                        }
                        PriceHistoryChart(v)
                        PriceAlertTargetsRow(v)
                        if (!migrated) {
                            Text("${v.quantity}× NM · Unbek. (nicht migriert – Desktop einmal starten)", style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        Valuation.group(mine).forEach { g ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                IconButton(enabled = migrated, onClick = { scope.launch { try { CollectionRepository.removeCopies(v, g.edition, g.condition); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                                    Icon(Icons.Default.Remove, "−", tint = MaterialTheme.colorScheme.primary)
                                }
                                Text("${g.count}×", fontFamily = MonoFontFamily, color = MaterialTheme.colorScheme.onSurface)
                                IconButton(enabled = migrated, onClick = { scope.launch { try { CollectionRepository.addCopies(v, g.edition, g.condition); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                                    Icon(Icons.Default.Add, "+", tint = MaterialTheme.colorScheme.primary)
                                }
                                Spacer(Modifier.width(6.dp))
                                CopyChip(g.edition, g.condition) { e, c ->
                                    scope.launch { try { CollectionRepository.updateCopyGroup(v, g.edition, g.condition, e, c); error = null; refresh() } catch (ex: Exception) { error = ex.message } }
                                }
                                Spacer(Modifier.weight(1f))
                                ValueText(Valuation.valueOf(v, mine.filter { it.edition == g.edition && it.condition == g.condition }), style = MaterialTheme.typography.bodySmall)
                            }
                            // Spec B1 §10.3: je Exemplar der Gruppe eine anklickbare Zeile mit
                            // Standort- und Tag-Chips -- oeffnet das Exemplar-Sheet fuer GENAU dieses
                            // copy_id (nicht die Gruppe). Gegenstueck zu CardDetailPanel.jsx.
                            mine.filter { !it.deleted && it.edition == g.edition && it.condition == g.condition }
                                .forEach { c ->
                                    CopyLocationRow(c, containers.find { ct -> ct.containerId == c.containerId },
                                        offered = ListingText.offeredText(offers[c.copyId] ?: emptyList()), onClick = { sheetCopy = c })
                                }
                        }
                        TextButton(enabled = migrated, onClick = {
                            scope.launch { try { CollectionRepository.addCopies(v, Prefs.defaultEdition(ctx), Prefs.defaultCondition(ctx)); error = null; refresh() } catch (e: Exception) { error = e.message } }
                        }) { Text("Exemplar hinzufügen", color = MaterialTheme.colorScheme.primary) }
                    }
                }
            }

            CardSoldSection(cardId)

            Spacer(Modifier.height(16.dp))
            AddPrintingSection(base = base, owned = printings, onError = { error = it }, onAdded = { scope.launch { refresh() } })

            displayDesc?.let { desc ->
                Spacer(Modifier.height(16.dp))
                var showText by remember { mutableStateOf(false) }
                TextButton(onClick = { showText = !showText }) { Text(if (showText) "Kartentext ausblenden" else "Kartentext anzeigen") }
                if (showText) {
                    SpaceCard(Modifier.fillMaxWidth()) {
                        Text(desc, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(12.dp))
                    }
                }
            }

            var showStats by remember { mutableStateOf(false) }
            TextButton(onClick = { showStats = !showStats }) { Text(if (showStats) "Stats ausblenden" else "Stats anzeigen") }
            if (showStats) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    displayLevel?.let { StatTile(levelLabel, it.toString()) }
                    displayAtk?.let { StatTile("ATK", it.toString()) }
                    if (!isLink) displayDef?.let { StatTile("DEF", it.toString()) }
                    StatTile("Passcode", base.id)
                }
            }
        }
    }

    // Genau EINE Aufrufstelle, ausserhalb der Verzweigung: faellt `base` weg (Verkauf des letzten Exemplars),
    // bleibt dieselbe CopySheet-/SaleSheet-Instanz bestehen und fuehrt ihr Nachladen und onBooked zu Ende.
    sheetCopy?.let { c ->
        CopySheet(copy = c, onDismiss = { sheetCopy = null }, onSaved = { scope.launch { refresh() } })
    }
}

// Small stat tile: label over a mono value, inside a SpaceCard.
@Composable
private fun StatTile(label: String, value: String) {
    SpaceCard {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = Muted)
            Text(value, style = MaterialTheme.typography.titleMedium, fontFamily = MonoFontFamily,
                fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

// Spec B1 §10.3: eine Zeile je Exemplar -- Standort-Chip links (CopyLocation.format, zeichengleich
// zum Desktop), Tag-Chips rechts. Ein Klick oeffnet das Exemplar-Sheet fuer genau dieses Exemplar.
@Composable
private fun CopyLocationRow(copy: CopyRow, container: ContainerRow?, offered: String?, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 2.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Muted.copy(alpha = 0.08f))
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            // Spec H1 §5.3: Preisschild an markierten Exemplaren.
            if (copy.forSale) {
                Icon(Icons.Default.Sell, "Zum Verkauf", tint = Warn, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(
                // Ohne Standort stand hier nur „—“ -- in der Kartenansicht liest sich das wie eine leere Zeile.
                if (copy.containerId == null) "ohne Standort" else CopyLocation.format(copy, container),
                style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted,
                maxLines = 1, modifier = Modifier.weight(1f),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Tags.parse(copy.tags).forEach { t -> TagChipSmall(t) }
            }
        }
        // Spec H3a §6: zweite Zeile "angeboten auf …".
        offered?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Warn) }
    }
}

// Small violet pill for a single tag -- same shape/border style as NeutralChip, tinted like the
// desktop's tag chip (space-violet).
@Composable
private fun TagChipSmall(text: String) {
    val shape = RoundedCornerShape(50)
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = Primary,
        modifier = Modifier
            .background(Primary.copy(alpha = 0.15f), shape)
            .border(1.dp, Primary.copy(alpha = 0.3f), shape)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

// Neutral (uncolored) pill for attribute/race metadata.
@Composable
private fun NeutralChip(text: String) {
    val shape = RoundedCornerShape(50)
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = Muted,
        modifier = Modifier
            .background(Muted.copy(alpha = 0.14f), shape)
            .border(1.dp, Muted.copy(alpha = 0.4f), shape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}
