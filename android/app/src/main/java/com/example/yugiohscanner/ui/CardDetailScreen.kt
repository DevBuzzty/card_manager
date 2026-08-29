package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import kotlinx.coroutines.launch

@Composable
fun CardDetailScreen(cardId: String, initial: List<CardRow>, onClose: () -> Unit, onChanged: () -> Unit) {
    var printings by remember { mutableStateOf(initial.filter { it.id == cardId }) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Reload this card's printings from the cloud after a mutation, and tell the parent to refresh.
    suspend fun refresh() {
        printings = CollectionRepository.loadCards().filter { it.id == cardId }
        onChanged()
    }

    val base = printings.firstOrNull() ?: initial.firstOrNull { it.id == cardId }
    if (base == null) { onClose(); return }

    val isLink = base.type?.contains("Link") == true
    val isXyz = base.type?.contains("XYZ") == true
    val levelLabel = if (isLink) "Link" else if (isXyz) "Rang" else "Level"

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.ArrowBack, "Zurück") }
            Text(base.name ?: base.id, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        AsyncImage(model = base.imageUrl, contentDescription = base.name,
            modifier = Modifier.fillMaxWidth().height(320.dp))
        Spacer(Modifier.height(8.dp))
        Text(listOfNotNull(base.type, base.race, base.attribute).joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            base.level?.let { Stat(levelLabel, it.toString()) }
            base.atk?.let { Stat("ATK", it.toString()) }
            if (!isLink) base.def?.let { Stat("DEF", it.toString()) }
            Stat("Passcode", base.id)
        }
        base.desc?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall)
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(16.dp))
        Text("Deine Varianten", style = MaterialTheme.typography.titleMedium)
        printings.forEach { v ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${v.setCode} · ${v.rarity ?: "?"}", style = MaterialTheme.typography.bodyMedium)
                    Text("%.2f €".format(v.price ?: 0.0), style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = {
                    if (v.quantity > 1) scope.launch {
                        try { CollectionRepository.setQuantity(v, v.quantity - 1); error = null; refresh() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Icon(Icons.Default.Remove, "−") }
                Text("${v.quantity}")
                IconButton(onClick = {
                    scope.launch {
                        try { CollectionRepository.setQuantity(v, v.quantity + 1); error = null; refresh() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Icon(Icons.Default.Add, "+") }
                IconButton(onClick = {
                    scope.launch {
                        try { CollectionRepository.softDelete(v); error = null; refresh() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Icon(Icons.Default.Delete, "Löschen") }
            }
        }

        Spacer(Modifier.height(16.dp))
        AddPrintingSection(base = base, owned = printings, onError = { error = it }, onAdded = { scope.launch { refresh() } })
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

