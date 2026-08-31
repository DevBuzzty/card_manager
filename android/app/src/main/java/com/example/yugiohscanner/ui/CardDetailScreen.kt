package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.TypeChip
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
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

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            base.level?.let { StatTile(levelLabel, it.toString()) }
            base.atk?.let { StatTile("ATK", it.toString()) }
            if (!isLink) base.def?.let { StatTile("DEF", it.toString()) }
            StatTile("Passcode", base.id)
        }

        base.desc?.let {
            Spacer(Modifier.height(12.dp))
            SpaceCard(Modifier.fillMaxWidth()) {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(12.dp))
            }
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(16.dp))
        SectionHeader("Deine Varianten")
        Spacer(Modifier.height(8.dp))
        printings.forEach { v ->
            SpaceCard(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            RarityChip(v.rarity)
                            Text(v.setCode, style = MaterialTheme.typography.bodyMedium,
                                fontFamily = MonoFontFamily, color = Muted)
                        }
                        Spacer(Modifier.height(4.dp))
                        ValueText(v.price, style = MaterialTheme.typography.bodySmall)
                    }
                    IconButton(onClick = {
                        if (v.quantity > 1) scope.launch {
                            try { CollectionRepository.setQuantity(v, v.quantity - 1); error = null; refresh() }
                            catch (e: Exception) { error = e.message }
                        }
                    }) { Icon(Icons.Default.Remove, "−", tint = MaterialTheme.colorScheme.primary) }
                    Text("${v.quantity}", fontFamily = MonoFontFamily,
                        color = MaterialTheme.colorScheme.onSurface)
                    IconButton(onClick = {
                        scope.launch {
                            try { CollectionRepository.setQuantity(v, v.quantity + 1); error = null; refresh() }
                            catch (e: Exception) { error = e.message }
                        }
                    }) { Icon(Icons.Default.Add, "+", tint = MaterialTheme.colorScheme.primary) }
                    IconButton(onClick = {
                        scope.launch {
                            try { CollectionRepository.softDelete(v); error = null; refresh() }
                            catch (e: Exception) { error = e.message }
                        }
                    }) { Icon(Icons.Default.Delete, "Löschen", tint = MaterialTheme.colorScheme.error) }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        AddPrintingSection(base = base, owned = printings, onError = { error = it }, onAdded = { scope.launch { refresh() } })
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
