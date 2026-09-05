package com.example.yugiohscanner.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.theme.OnSurface

private val SEGMENTS = listOf(
    "karten" to "Karten",
    "wunschliste" to "Wunschliste",
    "sets" to "Sets",
    "decks" to "Decks",
)

// Everything that is "my collection" lives on one tab; the chips swap the content below.
@Composable
fun SammlungScreen(segment: String, onSegment: (String) -> Unit, onOpenSuche: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Text("Sammlung", style = MaterialTheme.typography.headlineSmall, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SEGMENTS.forEach { (id, label) ->
                FilterChip(selected = segment == id, onClick = { onSegment(id) }, label = { Text(label) })
            }
        }
        Box(Modifier.weight(1f)) {
            when (segment) {
                "wunschliste" -> WishlistScreen()
                "sets" -> SetCompletionScreen()
                "decks" -> DecksScreen()
                else -> CollectionScreen(onOpenSuche = onOpenSuche)
            }
        }
    }
}
