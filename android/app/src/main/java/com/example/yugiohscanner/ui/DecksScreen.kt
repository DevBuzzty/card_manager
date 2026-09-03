package com.example.yugiohscanner.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
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
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.launch

@Composable
fun DecksScreen(onClose: () -> Unit) {
    var openDeck by remember { mutableStateOf<Deck?>(null) }

    openDeck?.let { deck ->
        DeckEditor(deck, onBack = { openDeck = null })
        return
    }

    val scope = rememberCoroutineScope()
    val decks = remember { mutableStateListOf<Deck>() }
    var name by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        decks.clear(); decks.addAll(DecksRepository.loadDecks())
    }
    LaunchedEffect(Unit) {
        try { reload() } catch (e: Exception) { error = e.message } finally { loading = false }
    }

    val create = {
        val n = name.trim()
        if (n.isNotBlank()) {
            name = ""
            scope.launch {
                loading = true
                try { DecksRepository.createDeck(n); reload(); error = null }
                catch (e: Exception) { error = e.message }
                loading = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                }
                Spacer(Modifier.width(4.dp))
                Text("Decks", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
            }

            Spacer(Modifier.height(12.dp))
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
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
            } else if (decks.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Noch keine Decks.", color = Muted)
                }
            } else {
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(decks, key = { it.id }) { deck ->
                        DeckRow(
                            deck,
                            onOpen = { openDeck = deck },
                            onDelete = {
                                scope.launch {
                                    try { DecksRepository.deleteDeck(deck.id); reload() }
                                    catch (e: Exception) { error = e.message }
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
private fun DeckRow(deck: Deck, onOpen: () -> Unit, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                deck.name, color = OnSurface, fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f),
            )
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

@Composable
private fun DeckEditor(deck: Deck, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cards = remember { mutableStateListOf<DeckCard>() }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    var query by remember { mutableStateOf("") }
    val results = remember { mutableStateListOf<CardRow>() }
    var searching by remember { mutableStateOf(false) }

    suspend fun reload() {
        cards.clear(); cards.addAll(DecksRepository.loadCards(deck.id))
    }
    LaunchedEffect(deck.id) {
        try { reload() } catch (e: Exception) { error = e.message } finally { loading = false }
    }

    fun mutate(block: suspend () -> Unit) {
        scope.launch {
            try { block(); reload(); error = null } catch (e: Exception) { error = e.message }
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
                    error = null
                } catch (e: Exception) { error = e.message }
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
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
            } else {
                val main = cards.filter { it.section == "main" }
                val extra = cards.filter { it.section == "extra" }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        SectionHeader("Main · ${main.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(main, key = { it.id }) { DeckCardRow(it) { block -> mutate(block) } }
                    item {
                        Spacer(Modifier.height(10.dp))
                        SectionHeader("Extra · ${extra.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it) { block -> mutate(block) } }
                }
            }
        }
    }
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
private fun DeckCardRow(card: DeckCard, mutate: ((suspend () -> Unit)) -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(card.imageUrl, card.name)
            Spacer(Modifier.width(10.dp))
            Text(
                card.name ?: card.cardId, color = OnSurface, maxLines = 2,
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
            )
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
