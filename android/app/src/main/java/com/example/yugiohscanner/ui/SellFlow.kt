package com.example.yugiohscanner.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.PlaylistRemove
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.SalesRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SaleFlow
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Spec I §5.1/§5.2 -- "Verkaufen" am Exemplar (und in "Kandidaten"): drei Wege IM SELBEN Blatt, kein zweites
 * Blatt. Der Inhalt wechselt per AnimatedContent (150 ms). Gegenstueck zu desktop/src/components/SellFlow.jsx.
 *   ways    -- Auswahl der drei Wege
 *   sale    -- SaleSheetContent eingebettet (Kanal wie beim letzten Mal, Preis vorbelegt)
 *   listing -- ListingSheetContent eingebettet
 *   next    -- Vorschlaege fuer den naechsten Schritt (nur, wenn es mehr als "Fertig" gibt)
 * [copies]: die zu verkaufenden Exemplare; [siblings]: weitere vorgemerkte Exemplare derselben Karte.
 */
@Composable
fun SellFlow(
    copies: List<CopyRow>,
    siblings: List<CopyRow> = emptyList(),
    initialGrossCents: Long? = null,
    onBack: () -> Unit,
    onClose: () -> Unit,
    onOpenCopy: ((CopyRow) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf("ways") }
    var next by remember { mutableStateOf<Pair<String, List<String>>?>(null) } // way to steps
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val copyIds = copies.map { it.copyId }
    val pending by PendingForSale.state.collectAsState()
    val allMarked = copies.isNotEmpty() && copies.all { pending[it.copyId] ?: it.forSale }

    // Spec I §5.2 Punkt 2: Kanal wie beim letzten Mal -- aus den Verkaeufen selbst, kein neues Feld.
    val salesState by SideStores.sales.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }
    val defaultChannel = remember(salesState.value) { SaleFlow.lastChannel(salesState.value?.sales ?: emptyList()) }

    fun finish(way: String, listingId: String? = null) {
        val steps = SaleFlow.nextSteps(way, siblings.size, listingId)
        if (steps.size == 1) { onClose(); return } // nur "Fertig": kein Schritt, den man wegtippen muesste
        next = way to steps
        step = "next"
    }

    fun toggleList() {
        if (busy) return
        val value = !allMarked
        busy = true
        error = null
        PendingForSale.set(copyIds, value) // Spec I §5.2 Punkt 3: Marke gilt ab dem Tippen
        scope.launch {
            try {
                CollectionRepository.setForSale(copyIds, value)
                AppSnackbar.show(
                    if (value) "Auf der Verkaufsliste" else "Von der Verkaufsliste genommen",
                    actionLabel = if (value) "Ansehen" else null,
                    action = if (value) ({ NavRequests.open(Routes.verkaufen("zum-verkauf")) }) else null,
                )
                onClose()
                try { CollectionStore.awaitSync() } catch (e: CancellationException) { throw e } catch (_: Exception) { }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "Speichern fehlgeschlagen."
            } finally {
                PendingForSale.clear(copyIds) // Abgleich liefert den echten Stand; bei Fehler erscheint der alte wieder
                busy = false
            }
        }
    }

    AnimatedContent(
        targetState = step,
        transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(150)) },
        label = "verkaufsweg",
    ) { s ->
        when (s) {
            "ways" -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val n = copyIds.size
                Text(if (n == 1) "1 Exemplar – wie möchtest du verkaufen?" else "$n Exemplare – wie möchtest du verkaufen?",
                    color = Muted, style = MaterialTheme.typography.bodyMedium)
                WayCard(Icons.Default.ReceiptLong, "Verkauft buchen", "Schon verkauft – Preis, Kanal und Datum erfassen.", !busy) { step = "sale" }
                WayCard(Icons.Default.Storefront, "Angebot erstellen", "Auf Cardmarket, eBay oder woanders einstellen.", !busy) { step = "listing" }
                WayCard(
                    if (allMarked) Icons.Default.PlaylistRemove else Icons.AutoMirrored.Filled.PlaylistAdd,
                    if (allMarked) "Von der Verkaufsliste nehmen" else "Auf die Verkaufsliste",
                    if (allMarked) "Bleibt in der Sammlung, nicht mehr vorgemerkt." else "Vormerken und später gesammelt verkaufen.",
                    !busy,
                ) { toggleList() }
                error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onBack) { Text("Zurück") }
                }
            }
            "sale" -> SaleSheetContent(
                copyIds, initialGrossCents, onBack = { step = "ways" },
                onBooked = { saleId, count ->
                    val amount = lastAmount.value?.let { " · ${SalesMath.euroCentsText(it)}" } ?: ""
                    AppSnackbar.show(
                        (if (count == 1) "Verkauft gebucht" else "$count Karten verkauft gebucht") + amount,
                        actionLabel = "Rückgängig",
                        action = {
                            try {
                                SalesRepository.cancel(saleId)
                                SideStores.sales.refreshAndWait()
                                CollectionStore.awaitSync()
                            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                                AppSnackbar.show(e.message ?: "Rückgängig fehlgeschlagen.")
                            }
                        },
                    )
                    finish("verkauft")
                },
                embedded = true, defaultChannelId = defaultChannel,
                onBookedAmount = { lastAmount.value = it },
            )
            "listing" -> ListingSheetContent(
                copyIds, onBack = { step = "ways" },
                onSaved = { ids -> AppSnackbar.show("Angebot erstellt"); finish("angebot", ids.firstOrNull()) },
                embedded = true,
            )
            else -> NextSteps(next, onStep = { st ->
                when (st) {
                    SaleFlow.NAECHSTES -> siblings.firstOrNull()?.let { c -> onOpenCopy?.invoke(c) } ?: onClose()
                    SaleFlow.ANGEBOT_ANSEHEN -> { onClose(); NavRequests.open(Routes.verkaufen("angebote")) }
                    SaleFlow.LISTE_ANSEHEN -> { onClose(); NavRequests.open(Routes.verkaufen("zum-verkauf")) }
                    else -> onClose()
                }
            })
        }
    }
}

// Gebuchter Betrag fuer die Snackbar (SaleSheetContent meldet ihn vor onBooked) -- ausserhalb der Komposition,
// weil AnimatedContent den Inhalt beim Schrittwechsel verwirft.
private val lastAmount = mutableStateOf<Long?>(null)

@Composable
private fun WayCard(icon: ImageVector, title: String, hint: String, enabled: Boolean, onClick: () -> Unit) {
    OutlinedCard(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(), border = BorderStroke(1.dp, Line)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, tint = Primary, modifier = Modifier.size(22.dp))
            Column {
                Text(title, color = OnSurface, style = MaterialTheme.typography.bodyLarge)
                Text(hint, color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NextSteps(next: Pair<String, List<String>>?, onStep: (String) -> Unit) {
    val (way, steps) = next ?: return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(if (way == "verkauft") "Gebucht. Wie geht es weiter?" else "Angebot erstellt. Wie geht es weiter?",
            color = OnSurface, style = MaterialTheme.typography.bodyLarge)
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            steps.forEach { st ->
                val label = SaleFlow.NEXT_STEP_LABELS[st] ?: st
                if (st == SaleFlow.FERTIG) Button(onClick = { onStep(st) }) { Text(label) }
                else OutlinedButton(onClick = { onStep(st) }) { Text(label) }
            }
        }
    }
}

/**
 * Spec I §5.1 -- derselbe Verkaufen-Einstieg ausserhalb des Exemplar-Blatts (Kandidaten): ein Blatt, darin
 * SellFlow. "Zurueck" aus den drei Wegen schliesst hier, weil kein Exemplar-Blatt dahinter liegt.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
// subtitle: frei wählbare Unterzeile (Mehrfachauswahl der Kartenliste); ohne sie gilt der Kandidaten-Text.
fun SellFlowSheet(title: String, copies: List<CopyRow>, onDismiss: () -> Unit, subtitle: String? = null) {
    val sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true)
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)
                .verticalScroll(androidx.compose.foundation.rememberScrollState()).imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column {
                Text("Verkaufen", style = MaterialTheme.typography.titleLarge, color = OnSurface)
                val n = copies.size
                Text(subtitle ?: "$title · ${if (n == 1) "1 Exemplar" else "$n Exemplare"} über dem Playset", style = MaterialTheme.typography.labelSmall, color = Muted)
            }
            SellFlow(copies = copies, onBack = onDismiss, onClose = onDismiss)
        }
    }
}
