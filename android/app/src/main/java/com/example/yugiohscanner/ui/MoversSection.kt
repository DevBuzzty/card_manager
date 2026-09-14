package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ml.Mover
import com.example.yugiohscanner.ml.MoversResult
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Spec G1 §4.7/§4.8 -- Gewinner und Verlierer. Referenzpreise aus SideStores (einmal pro UTC-Tag),
 * Rechnung ueber MoversMemo im Hintergrund. Die Leertexte gleichen desktop/src/utils/moversText.js.
 */
@Composable
fun MoversSection(days: Int, top: Int, full: Boolean, onOpenCard: (String) -> Unit, onOpenAll: (() -> Unit)?) {
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cache = SideStores.reference(days)
    val refState by cache.state.collectAsState()
    LaunchedEffect(days) { cache.ensureFresh() }

    val cards = ready?.cards
    val copies = ready?.copies
    val refs = refState.value
    val today = remember { UtcDay.today() }
    val result by produceState(
        if (cards != null && copies != null && refs != null) MoversMemo.peek(cards, copies, refs, today, days) else null,
        cards, copies, refs, days,
    ) {
        value = if (cards != null && copies != null && refs != null)
            withContext(Dispatchers.Default) { MoversMemo.get(cards, copies, refs, today, days) } else null
    }

    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                SectionHeader(if (onOpenAll != null) "Bewegungen · $days Tage" else "Bewegungen")
                Spacer(Modifier.weight(1f))
                if (onOpenAll != null) {
                    Text("Alle", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable { onOpenAll() }.padding(4.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            val r = result
            when {
                refs == null && refState.error != null && !refState.loading ->
                    Text("Bewegungen konnten nicht geladen werden — zum Aktualisieren ziehen",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                r == null -> Placeholders(if (full) 6 else 3)
                else -> {
                    if (refState.error != null) {
                        Text("Stand von zuvor — Aktualisieren fehlgeschlagen.", style = MaterialTheme.typography.labelSmall, color = Muted)
                        Spacer(Modifier.height(4.dp))
                    }
                    val message = moversMessage(r, days)
                    if (message != null) {
                        Text(message, style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        MoverList("Gewinner", r.winners.take(top), full, onOpenCard)
                        Spacer(Modifier.height(10.dp))
                        MoverList("Verlierer", r.losers.take(top), full, onOpenCard)
                    }
                }
            }
        }
    }
}

internal fun moversMessage(r: MoversResult, days: Int): String? = when {
    r.status == "no_reference" ->
        r.firstDay?.let { "Noch nicht genug Verlauf — Bewegungen erscheinen ab ${UtcDay.formatDe(it)}" } ?: "Noch nicht genug Verlauf"
    r.winners.isEmpty() && r.losers.isEmpty() -> "Keine Bewegungen in $days Tagen"
    else -> null
}

@Composable
private fun Placeholders(rows: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(rows) { Box(Modifier.fillMaxWidth().height(28.dp).background(Line, RoundedCornerShape(6.dp))) }
    }
}

@Composable
private fun MoverList(title: String, movers: List<Mover>, full: Boolean, onOpenCard: (String) -> Unit) {
    Text(title, style = MaterialTheme.typography.labelSmall, color = Muted)
    if (movers.isEmpty()) {
        Text("—", style = MaterialTheme.typography.bodySmall, color = Muted)
        return
    }
    movers.forEach { m ->
        val up = m.deltaHolding > 0
        val tint = if (up) Good else ErrorColor
        // Controller-Ruling (nach Task 8): sichtbarer Rueckfall "Unbekannt" statt "Unknown", auch
        // wenn die gespeicherte Raritaet woertlich "Unknown" ist. Der interne Schluessel bleibt
        // unveraendert bei "Unknown" (printingKey(), PriceRef.key()).
        val rarityLabel = m.card.rarity?.takeIf { it.isNotBlank() && it != "Unknown" } ?: "Unbekannt"
        val setCodeLabel = m.card.setCode.takeIf { it.isNotBlank() && it != "Unknown" } ?: "Unbekannt"
        Row(Modifier.fillMaxWidth().clickable { onOpenCard(m.card.id) }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.card.name ?: m.card.id, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = OnSurface)
                val extra = if (full) " · %.2f € → %.2f € · %d×".format(m.oldPrice, m.newPrice, m.copies) else ""
                Text("$setCodeLabel · $rarityLabel$extra", maxLines = 1,
                    style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("%+.2f €".format(m.deltaHolding), style = MaterialTheme.typography.bodySmall, fontFamily = MonoFontFamily, color = tint)
                Text("%+.1f %%".format(m.pct), style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = tint)
            }
        }
    }
}
