package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.WishlistItem
import com.example.yugiohscanner.cloud.WishlistRepository
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistScreen(onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val items = remember { mutableStateListOf<WishlistItem>() }
    var name by remember { mutableStateOf("") }
    var maxPrice by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        items.clear(); items.addAll(WishlistRepository.loadWishlist())
    }
    LaunchedEffect(Unit) {
        try { reload() } catch (e: Exception) { error = e.message } finally { loading = false }
    }

    val add = {
        val n = name.trim()
        if (n.isNotBlank()) {
            val p = maxPrice.toDoubleOrNull()
            name = ""; maxPrice = ""
            scope.launch {
                loading = true
                try {
                    WishlistRepository.addToWishlist(cardId = n.lowercase(), name = n, imageUrl = null, maxPrice = p)
                    reload()
                    error = null
                } catch (e: Exception) { error = e.message }
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
                Text("Wishlist", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    placeholder = { Text("Kartenname") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = maxPrice, onValueChange = { maxPrice = it.filter { c -> c.isDigit() || c == '.' } },
                    placeholder = { Text("≤ €") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.width(96.dp),
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = add) { Icon(Icons.Default.Add, "Hinzufügen") }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "Wunschkarten werden automatisch als Deal-Watch überwacht.",
                color = Muted, style = MaterialTheme.typography.bodySmall,
            )

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }

            Spacer(Modifier.height(12.dp))
            if (loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
            } else if (items.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Noch keine Wunschkarten.", color = Muted)
                }
            } else {
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(items, key = { it.id }) { item ->
                        WishlistRow(item, onDelete = {
                            scope.launch {
                                try { WishlistRepository.removeFromWishlist(item.id); reload() }
                                catch (e: Exception) { error = e.message }
                            }
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun WishlistRow(item: WishlistItem, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                item.name, color = OnSurface, fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
            )
            item.maxPrice?.let {
                Spacer(Modifier.width(8.dp))
                ValueText(it, style = MaterialTheme.typography.bodyMedium)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Löschen", tint = ErrorColor)
            }
        }
    }
}
