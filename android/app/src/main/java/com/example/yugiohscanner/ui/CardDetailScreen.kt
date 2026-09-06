package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.WishlistRepository
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.TypeChip
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun CardDetailScreen(cardId: String, initial: List<CardRow>, initialCopies: List<CopyRow>, onClose: () -> Unit, onChanged: () -> Unit) {
    var printings by remember { mutableStateOf(initial.filter { it.id == cardId }) }
    var copies by remember { mutableStateOf(initialCopies.filter { it.cardId == cardId }) }
    var error by remember { mutableStateOf<String?>(null) }
    // Wishlist state: the POST is a plain insert, so a second tap would write a duplicate row.
    var inWishlist by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // Catalog first (Task 9): Name, Kartentext and Stats prefer the offline catalog when it has
    // this card; the owned printings below (rarity, set code, valuation) stay collection data,
    // unchanged. Off the UI thread — this is a SQLite read.
    var catalogCard by remember(cardId) { mutableStateOf<CatalogCard?>(null) }

    LaunchedEffect(cardId) {
        runCatching { WishlistRepository.loadWishlist() }
            .onSuccess { list -> inWishlist = list.any { it.cardId == cardId } }
    }

    LaunchedEffect(cardId) {
        catalogCard = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(cardId) }.getOrNull() }
    }

    // Reload this card's printings and copies from the cloud after a mutation, and tell the parent to refresh.
    suspend fun refresh() {
        printings = CollectionRepository.loadCardsFor(cardId)
        copies = CollectionRepository.loadCopiesFor(cardId)
        onChanged()
    }

    val base = printings.firstOrNull() ?: initial.firstOrNull { it.id == cardId }
    if (base == null) { onClose(); return }

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
                        error = null; inWishlist = true; notice = "Zur Wunschliste hinzugefügt"
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
                    .shadow(28.dp, RoundedCornerShape(12.dp), ambientColor = Primary, spotColor = Primary)
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
                        ValueText(Valuation.valueOf(v.price, mine), style = MaterialTheme.typography.bodyMedium)
                        IconButton(enabled = migrated, onClick = { scope.launch { try { CollectionRepository.softDelete(v); error = null; refresh() } catch (e: Exception) { error = e.message } } }) {
                            Icon(Icons.Default.Delete, "Löschen", tint = MaterialTheme.colorScheme.error)
                        }
                    }
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
                            ValueText(Valuation.valueOf(v.price, mine.filter { it.edition == g.edition && it.condition == g.condition }), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    TextButton(enabled = migrated, onClick = {
                        scope.launch { try { CollectionRepository.addCopies(v, Prefs.defaultEdition(ctx), Prefs.defaultCondition(ctx)); error = null; refresh() } catch (e: Exception) { error = e.message } }
                    }) { Text("Exemplar hinzufügen", color = MaterialTheme.colorScheme.primary) }
                }
            }
        }

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
