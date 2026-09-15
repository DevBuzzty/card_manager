package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.AlertInput
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

/**
 * Spec G2 §7 -- Einstellungen › Preise › Preis-Alarme, wie am Desktop. Ohne gespeicherte Regel ist der
 * Bewegungsalarm aus; die Felder zeigen 20 % · 2 € · 7 Tage, das erste Speichern legt die Regel an.
 */
@Composable
fun PriceAlertSettingsSection() {
    val cache = SideStores.priceAlertMoveRule
    val st by cache.state.collectAsState()
    LaunchedEffect(Unit) { cache.ensureLoaded() }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader("Preis-Alarme")
        val loaded = st.value
        if (loaded == null) {
            if (st.error != null && !st.loading) {
                Text("Preis-Alarme nicht verfügbar — Cloud nicht verbunden.", style = MaterialTheme.typography.bodySmall, color = ErrorColor)
            } else {
                Text("Wird geladen …", style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            return@Column
        }
        val rule = loaded.firstOrNull()
        var active by remember(rule) { mutableStateOf(rule?.active ?: false) }
        var days by remember(rule) { mutableStateOf(rule?.days ?: 7) }
        var pctText by remember(rule) { mutableStateOf(AlertInput.toInput(rule?.pct ?: 20.0)) }
        var eurText by remember(rule) { mutableStateOf(AlertInput.toInput(rule?.minEur ?: 2.0)) }
        var error by remember { mutableStateOf<String?>(null) }

        fun save(nextActive: Boolean = active, nextDays: Int = days) {
            val pct = AlertInput.parsePct(pctText)
            val eur = AlertInput.parseMinEur(eurText)
            error = pct.error ?: eur.error
            if (error != null) return
            val p = pct.value!!
            val m = eur.value!!
            if (rule != null && rule.active == nextActive && rule.days == nextDays && rule.pct == p && rule.minEur == m) return
            active = nextActive
            days = nextDays
            scope.launch {
                try {
                    PriceAlertsRepository.saveMoveRule(p, m, nextDays, nextActive)
                    cache.refreshAndWait()
                } catch (e: Exception) {
                    error = "Speichern fehlgeschlagen"
                }
            }
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Bewegungsalarm", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = OnSurface)
            Switch(checked = active, onCheckedChange = { save(nextActive = it) })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = pctText, onValueChange = { pctText = it; error = null },
                modifier = Modifier.weight(1f), singleLine = true, label = { Text("ab … %") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); save() }),
            )
            OutlinedTextField(
                value = eurText, onValueChange = { eurText = it; error = null },
                modifier = Modifier.weight(1f), singleLine = true, label = { Text("ab … €") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); save() }),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(7, 30).forEach { d ->
                FilterChip(selected = days == d, onClick = { save(nextDays = d) }, label = { Text("$d Tage") })
            }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = ErrorColor) }
        Text("Ausgewertet wird stündlich in der Cloud. Am Handy erscheinen Treffer beim Öffnen.",
            style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}
