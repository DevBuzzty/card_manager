package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.PreparedImport
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val IMPORT_SECTIONS = listOf("main" to "Main Deck", "extra" to "Extra Deck", "side" to "Side Deck")

/**
 * Spec E2 §5/§6: Import am Handy im Vollbild. [sharedText] (Share-Ziel) geht direkt in die Vorschau; sonst erst das
 * Textfeld, vorbefuellt mit der Zwischenablage. Lesen, Katalog und Aufloesung laufen abseits des Hauptthreads
 * (DeckImport.prepare); der Plan ist nach Aufloesung und Auswahl gemerkt. Legt immer ein neues Deck an.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckImportScreen(sharedText: String?, onBack: () -> Unit, onCreated: (Long) -> Unit) {
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf(sharedText ?: clipboard.getText()?.text.orEmpty()) }
    var previewText by remember { mutableStateOf(sharedText) }
    var prepared by remember { mutableStateOf<PreparedImport?>(null) }
    var choices by remember { mutableStateOf(mapOf<Int, String>()) }
    var name by remember { mutableStateOf(DeckImport.DEFAULT_DECK_NAME) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(previewText) {
        val text = previewText ?: return@LaunchedEffect
        prepared = null
        choices = emptyMap()
        prepared = withContext(Dispatchers.IO) {
            // Namen nur waehrend des Imports im Speicher; ohne Katalog (z. B. direkt nach einem Katalog-Upgrade) null.
            DeckImport.prepare(text, null) { ids -> if (CatalogRepository.isReady()) CatalogRepository.importRows(ids) else null }
        }
    }
    val resolved = prepared?.resolved
    val plan = remember(resolved, choices) { resolved?.let { DeckImport.plan(it, choices) } }
    val openRows = remember(resolved) {
        resolved?.rows?.withIndex()?.filter { it.value.status == "suggest" || it.value.status == "ambiguous" } ?: emptyList()
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack, enabled = !busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface) }
                Spacer(Modifier.width(4.dp))
                Text(if (previewText == null) "Einfügen (YDKE/Text)" else "Import-Vorschau",
                    style = MaterialTheme.typography.headlineSmall, color = OnSurface)
            }
            Spacer(Modifier.height(12.dp))

            when {
                previewText == null -> {
                    OutlinedTextField(
                        value = input, onValueChange = { input = it }, minLines = 6,
                        placeholder = { Text("ydke://… oder eine Deckliste") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { previewText = input }, enabled = input.isNotBlank()) { Text("Vorschau") }
                }
                prepared == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
                prepared?.error != null -> Text(prepared?.error.orEmpty(), color = ErrorColor, style = MaterialTheme.typography.bodyMedium)
                resolved != null && plan != null -> LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true,
                            label = { Text("Deckname") }, modifier = Modifier.fillMaxWidth())
                    }
                    if (resolved.catalogMissing) item { Text(DeckImport.CATALOG_MISSING, color = Gold, style = MaterialTheme.typography.bodySmall) }
                    item {
                        Text(DeckImport.countsText(plan.counts), color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelLarge)
                        DeckImport.skippedText(plan.skipped.size)?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelMedium) }
                    }
                    items(openRows, key = { it.index }) { (i, row) ->
                        SpaceCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(row.source, color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                    if (row.candidates.none { it.passcode == choices[i] }) Text(DeckImport.OPEN, color = Gold, style = MaterialTheme.typography.labelSmall)
                                }
                                if (row.status == "ambiguous") Text(DeckImport.AMBIGUOUS, color = Muted, style = MaterialTheme.typography.labelSmall)
                                row.candidates.forEach { c ->
                                    FilterChip(
                                        selected = choices[i] == c.passcode,
                                        onClick = { choices = if (choices[i] == c.passcode) choices - i else choices + (i to c.passcode) },
                                        label = { Text(if (row.status == "suggest") DeckImport.suggestionText(c.name) else DeckImport.ambiguousOptionText(c)) },
                                    )
                                }
                            }
                        }
                    }
                    IMPORT_SECTIONS.forEach { (section, title) ->
                        val cards = plan.cards.filter { it.section == section }
                        if (cards.isNotEmpty()) {
                            item { SectionHeader(title) }
                            items(cards, key = { "$section-${it.cardId}" }) { c ->
                                Text("${c.count} ${c.name}", color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    if (plan.skippedLabels.isNotEmpty()) {
                        item { SectionHeader("Nicht übernommen") }
                        items(plan.skippedLabels) { Text(it, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall) }
                    }
                    item {
                        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
                        Button(
                            enabled = !busy,
                            onClick = {
                                busy = true
                                error = null
                                scope.launch {
                                    try {
                                        val images = withContext(Dispatchers.IO) {
                                            CatalogRepository.importRows(plan.cards.map { it.cardId }).associate { it.id to it.image }
                                        }
                                        val id = DecksRepository.createImportedDeck(DeckImport.deckNameFor(name), plan.notes, plan.cards, images)
                                        SideStores.decks.refreshAndWait()
                                        SideStores.allDeckCards.refresh()
                                        onCreated(id)
                                    } catch (e: Exception) {
                                        error = DeckImport.failedText(e.message)
                                    }
                                    busy = false
                                }
                            },
                        ) { Text(if (busy) "Wird angelegt…" else "Anlegen", fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
        }
    }
}
