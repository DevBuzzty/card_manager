package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.PriceAlertTarget
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.AlertInput
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Warn
import com.example.yugiohscanner.ui.theme.Muted
import kotlinx.coroutines.launch

/**
 * Spec G2 §7 -- "Preis-Alarm: ≥ [ ] € · ≤ [ ] €" unter dem Preisverlauf eines Printings. Gespeichert wird
 * mit "Fertig" und nur bei geaenderter Eingabe: jedes Speichern macht den Zielpreis wieder scharf
 * (Spec §4.1). Leer = entfernen. "ausgelöst" neben einem entschaerften Zielpreis.
 */
@Composable
fun PriceAlertTargetsRow(card: CardRow) {
    val cache = SideStores.priceAlertTargets
    val cacheState by cache.state.collectAsState()
    LaunchedEffect(Unit) { cache.ensureLoaded() }
    val targets = cacheState.value
    if (targets == null) {
        if (cacheState.error != null && !cacheState.loading) {
            Text("Preis-Alarm: nicht verfügbar", style = MaterialTheme.typography.labelSmall, color = Muted)
        }
        return
    }
    val key = card.printingKey()
    val above = targets.firstOrNull { it.kind == "above" && it.key() == key }
    val below = targets.firstOrNull { it.kind == "below" && it.key() == key }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text("Preis-Alarm", style = MaterialTheme.typography.labelSmall, color = Muted)
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TargetField("≥", above, card, "above")
            TargetField("≤", below, card, "below")
        }
    }
}

@Composable
private fun RowScope.TargetField(sign: String, current: PriceAlertTarget?, card: CardRow, kind: String) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var text by remember(current?.threshold) { mutableStateOf(AlertInput.toInput(current?.threshold)) }
    var error by remember { mutableStateOf<String?>(null) }

    fun commit() {
        val parsed = AlertInput.parseTarget(text)
        if (parsed.error != null) { error = parsed.error; return }
        focus.clearFocus()
        if (parsed.value == current?.threshold) return
        scope.launch {
            try {
                PriceAlertsRepository.saveTarget(card, kind, parsed.value)
                SideStores.priceAlertTargets.refreshAndWait()
                error = null
            } catch (e: Exception) {
                error = "Speichern fehlgeschlagen"
            }
        }
    }

    Column(Modifier.weight(1f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(sign, style = MaterialTheme.typography.bodyMedium, color = Muted)
            Spacer(Modifier.width(4.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; error = null },
                modifier = Modifier.weight(1f),
                singleLine = true,
                isError = error != null,
                textStyle = MaterialTheme.typography.bodySmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { commit() }),
            )
            Spacer(Modifier.width(4.dp))
            Text("€", style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        if (current != null && !current.armed) {
            Text("ausgelöst", style = MaterialTheme.typography.labelSmall, color = Warn)
        }
        error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor) }
    }
}
