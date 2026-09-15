package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.PriceAlertEvent
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ml.AlertText
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

/**
 * Spec G2 §7 -- offene Preis-Alarme. Start (`full = false`) zeigt zwei Zeilen und erscheint nur bei
 * bekannten offenen Treffern; Insights (`full = true`) zeigt alle, Lade-/Fehler-/Leerzustand und
 * "Alle erledigt". Texte aus ml/AlertText.kt (Zwilling von electron/alert-text.cjs).
 */
@Composable
fun PriceAlertsSection(full: Boolean, onOpenCard: (String) -> Unit, onOpenAll: (() -> Unit)?) {
    val cacheState by SideStores.priceAlertEvents.state.collectAsState()
    val events = cacheState.value
    if (!full && events.isNullOrEmpty()) return

    val store by CollectionStore.state.collectAsState()
    val cards = (store as? StoreState.Ready)?.cards
    // Nur die Namen der angezeigten Treffer; gemerkt, damit nicht jede Komposition die Sammlung durchlaeuft.
    val names = remember(cards, events) {
        val ids = events?.map { it.cardId }?.toSet() ?: emptySet()
        cards?.filter { it.id in ids && it.name != null }?.associate { it.id to it.name!! } ?: emptyMap()
    }
    val scope = rememberCoroutineScope()
    var actionError by remember { mutableStateOf<String?>(null) }

    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                SectionHeader(if (full) "Preis-Alarme" else "Preis-Alarme (${events?.size ?: 0})")
                Spacer(Modifier.weight(1f))
                if (onOpenAll != null) {
                    Text("Alle", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable { onOpenAll() }.padding(4.dp))
                }
                if (full && !events.isNullOrEmpty()) {
                    Text("Alle erledigt", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable {
                            // Nur die gerade angezeigten Treffer (Spec G2 §5.4); Math.max zur Sicherheit.
                            val maxId = events.maxOf { it.id }
                            scope.launch {
                                try {
                                    PriceAlertsRepository.dismissAllEvents(maxId)
                                    SideStores.priceAlertEvents.update { list -> list.filterNot { it.id <= maxId } }
                                    actionError = null
                                } catch (e: Exception) {
                                    actionError = "Erledigen fehlgeschlagen."
                                }
                            }
                        }.padding(4.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            actionError?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor)
                Spacer(Modifier.height(4.dp))
            }
            when {
                events == null && cacheState.error != null && !cacheState.loading ->
                    Text("Preis-Alarme konnten nicht geladen werden — zum Aktualisieren ziehen",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                events == null ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        repeat(3) { Box(Modifier.fillMaxWidth().height(28.dp).background(Line, RoundedCornerShape(6.dp))) }
                    }
                else -> {
                    if (cacheState.error != null) {
                        Text("Stand von zuvor — Aktualisieren fehlgeschlagen.", style = MaterialTheme.typography.labelSmall, color = Muted)
                        Spacer(Modifier.height(4.dp))
                    }
                    if (events.isEmpty()) {
                        Text("Keine offenen Preis-Alarme", style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                    (if (full) events else events.take(2)).forEach { e ->
                        AlertRow(e, names[e.cardId], onOpenCard) {
                            scope.launch {
                                try {
                                    PriceAlertsRepository.dismissEvent(e.id)
                                    SideStores.priceAlertEvents.update { list -> list.filterNot { it.id == e.id } }
                                    actionError = null
                                } catch (ex: Exception) {
                                    actionError = "Erledigen fehlgeschlagen."
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AlertRow(e: PriceAlertEvent, name: String?, onOpenCard: (String) -> Unit, onDismiss: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).clickable { onOpenCard(e.cardId) }.padding(vertical = 4.dp)) {
            Text(UtcDay.formatDe(e.day), style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
            Text(
                AlertText.of(e.kind, name, e.cardId, e.setCode, e.rarity, e.oldPrice, e.newPrice, e.pct, e.days, e.threshold),
                style = MaterialTheme.typography.bodySmall, color = OnSurface, maxLines = 2,
            )
        }
        TextButton(onClick = onDismiss) { Text("Erledigt") }
    }
}
