package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

// Karten · Binder · Wunschliste · Sets · Decks -- the two most-used segments lead (Spec §11).
private val SEGMENTS = listOf(
    "karten" to "Karten",
    "binder" to "Binder",
    "wunschliste" to "Wunschliste",
    "sets" to "Sets",
    "decks" to "Decks",
)

// Everything that is "my collection" lives on one tab; the tabs swap the content below.
// Five segments no longer fit un-scrolled (Spec §11 risk) -- ScrollableTabRow instead of a
// plain Row, so nothing gets cut off on narrow screens.
@Composable
fun SammlungScreen(
    segment: String,
    onSegment: (String) -> Unit,
    onOpenSuche: () -> Unit,
    onOpenBehaelter: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Text("Sammlung", style = MaterialTheme.typography.headlineSmall, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        SyncHint(Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        val selected = SEGMENTS.indexOfFirst { it.first == segment }.coerceAtLeast(0)
        ScrollableTabRow(
            selectedTabIndex = selected,
            containerColor = Background,
            contentColor = Primary,
            edgePadding = 16.dp,
        ) {
            SEGMENTS.forEachIndexed { i, (id, label) ->
                Tab(selected = i == selected, onClick = { onSegment(id) }, text = { Text(label) })
            }
        }
        Box(Modifier.weight(1f)) {
            when (segment) {
                "binder" -> BindersScreen(onOpenBehaelter)
                "wunschliste" -> WishlistScreen()
                "sets" -> SetCompletionScreen()
                "decks" -> DecksScreen()
                else -> CollectionScreen(onOpenSuche = onOpenSuche)
            }
        }
    }
}
