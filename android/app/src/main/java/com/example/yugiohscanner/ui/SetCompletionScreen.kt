package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.SetsRepository
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.SurfaceColor
import com.example.yugiohscanner.ui.theme.ErrorColor

// Per-set completion: how many distinct printings the user owns out of the set total.
private data class SetProgress(val name: String, val prefix: String, val owned: Int, val total: Int)

@Composable
fun SetCompletionScreen(onClose: () -> Unit) {
    var rows by remember { mutableStateOf<List<SetProgress>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val cards = CollectionRepository.loadCards()
            val sets = SetsRepository.loadSets()

            // Distinct set codes owned, grouped by set prefix (skip the "Unknown" bucket).
            val ownedByPrefix = HashMap<String, MutableSet<String>>()
            for (c in cards) {
                if (c.setCode.equals("Unknown", ignoreCase = true)) continue
                val prefix = c.setCode.substringBefore("-").uppercase()
                if (prefix.isBlank()) continue
                ownedByPrefix.getOrPut(prefix) { HashSet() }.add(c.setCode)
            }

            rows = ownedByPrefix.mapNotNull { (prefix, codes) ->
                val info = sets[prefix] ?: return@mapNotNull null
                SetProgress(info.name, prefix, codes.size.coerceAtMost(info.total), info.total)
            }.sortedByDescending { it.owned.toFloat() / it.total }
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                }
                Spacer(Modifier.width(4.dp))
                Text(
                    "Set-Vervollständigung",
                    style = MaterialTheme.typography.headlineSmall,
                    color = OnSurface,
                )
            }

            Spacer(Modifier.height(12.dp))
            when {
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
                error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(error!!, color = ErrorColor)
                }
                rows.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Noch keine Sets — scanne oder importiere Karten.", color = Muted)
                }
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(rows, key = { it.prefix }) { SetRow(it) }
                }
            }
        }
    }
}

@Composable
private fun SetRow(row: SetProgress) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    row.name,
                    color = OnSurface,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    row.prefix,
                    color = Muted,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFontFamily),
                    modifier = Modifier
                        .background(SurfaceColor, RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }

            Spacer(Modifier.height(8.dp))
            ProgressBar(fraction = row.owned.toFloat() / row.total)

            Spacer(Modifier.height(6.dp))
            Text(
                "${row.owned} / ${row.total}",
                color = Gold,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = MonoFontFamily),
            )
        }
    }
}

// Primary fill on a Line track, rounded — matching the Dashboard StatBar style.
@Composable
private fun ProgressBar(fraction: Float) {
    Box(Modifier.fillMaxWidth().height(6.dp).background(Line, RoundedCornerShape(3.dp))) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .height(6.dp)
                .background(Primary, RoundedCornerShape(3.dp)),
        )
    }
}
