package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import kotlinx.coroutines.launch

@Composable
fun SearchScreen(onClose: () -> Unit, onAdded: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var owned by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var selected by remember { mutableStateOf<CardRow?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Add view for a chosen search result.
    selected?.let { card ->
        Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { selected = null; error = null }) { Icon(Icons.Default.ArrowBack, "Zurück") }
                Text(card.name ?: card.id, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            AsyncImage(model = card.imageUrl, contentDescription = card.name,
                modifier = Modifier.fillMaxWidth().height(280.dp))
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(16.dp))
            AddPrintingSection(
                base = card,
                owned = owned.filter { it.id == card.id },
                onError = { error = it },
                onAdded = { onAdded(); selected = null },
            )
        }
        return
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.ArrowBack, "Zurück") }
            Text("Karte suchen", style = MaterialTheme.typography.titleLarge)
        }
        OutlinedTextField(query, { query = it }, label = { Text("Name oder Passcode") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Button(enabled = !loading && query.isNotBlank(), onClick = {
            loading = true
            scope.launch {
                try {
                    results = CardSearchRepository.search(query)
                    owned = runCatching { CollectionRepository.loadCards() }.getOrDefault(emptyList())
                    error = if (results.isEmpty()) "Nichts gefunden." else null
                } catch (e: Exception) { error = e.message ?: "Suche fehlgeschlagen" }
                loading = false
            }
        }) { Text(if (loading) "Suche…" else "Suchen") }
        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(results, key = { it.id }) { card ->
                Row(Modifier.fillMaxWidth().clickable { error = null; selected = card }.padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    AsyncImage(model = card.imageUrl, contentDescription = card.name,
                        modifier = Modifier.width(40.dp).height(58.dp))
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(card.name ?: card.id, style = MaterialTheme.typography.bodyLarge)
                        Text(card.type ?: "", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
