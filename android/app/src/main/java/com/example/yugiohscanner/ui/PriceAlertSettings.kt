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
                // Minor 3 (Abschlussreview): REST kann Cloud-nicht-verbunden nicht von anderen Fehlern
                // unterscheiden, darum ein neutraler Text statt "Cloud nicht verbunden".
                Text("Preis-Alarme konnten nicht geladen werden.", style = MaterialTheme.typography.bodySmall, color = ErrorColor)
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
        var pctError by remember { mutableStateOf<String?>(null) }
        var eurError by remember { mutableStateOf<String?>(null) }
        var saveError by remember { mutableStateOf<String?>(null) }

        // Speichert eine vollstaendige Regel, wenn sie sich von der zuletzt gespeicherten (`rule`)
        // unterscheidet -- das erste Speichern (rule == null) legt sie an.
        fun saveRule(p: Double, m: Double, nextDays: Int, nextActive: Boolean) {
            if (rule != null && rule.active == nextActive && rule.days == nextDays && rule.pct == p && rule.minEur == m) return
            scope.launch {
                try {
                    PriceAlertsRepository.saveMoveRule(p, m, nextDays, nextActive)
                    cache.refreshAndWait()
                } catch (e: Exception) {
                    saveError = "Speichern fehlgeschlagen"
                }
            }
        }

        // Schalter und Tage-Auswahl speichern unabhaengig von den Textfeldern: sie senden die
        // zuletzt gespeicherte pct/minEur zusammen mit dem geaenderten Wert, ohne den Feldtext
        // zu pruefen -- ein ungueltiges/unbestaetigtes Feld blockiert sie nicht.
        fun saveToggle(nextActive: Boolean = active, nextDays: Int = days) {
            saveError = null
            active = nextActive
            days = nextDays
            saveRule(rule?.pct ?: 20.0, rule?.minEur ?: 2.0, nextDays, nextActive)
        }

        // Jedes Zahlenfeld prueft bei "Fertig" nur sich selbst; das jeweils andere Feld bleibt
        // unangetastet und kann ungueltigen/unvollstaendigen Text behalten, ohne das Speichern zu blockieren.
        fun savePct() {
            val parsed = AlertInput.parsePct(pctText)
            pctError = parsed.error
            saveError = null
            if (parsed.error != null) return
            saveRule(parsed.value!!, rule?.minEur ?: 2.0, rule?.days ?: 7, rule?.active ?: false)
        }

        fun saveMinEur() {
            val parsed = AlertInput.parseMinEur(eurText)
            eurError = parsed.error
            saveError = null
            if (parsed.error != null) return
            saveRule(rule?.pct ?: 20.0, parsed.value!!, rule?.days ?: 7, rule?.active ?: false)
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Bewegungsalarm", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = OnSurface)
            Switch(checked = active, onCheckedChange = { saveToggle(nextActive = it) })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                OutlinedTextField(
                    value = pctText, onValueChange = { pctText = it; pctError = null },
                    modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("ab … %") },
                    isError = pctError != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); savePct() }),
                )
                pctError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor) }
            }
            Column(Modifier.weight(1f)) {
                OutlinedTextField(
                    value = eurText, onValueChange = { eurText = it; eurError = null },
                    modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("ab … €") },
                    isError = eurError != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); saveMinEur() }),
                )
                eurError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(7, 30).forEach { d ->
                FilterChip(selected = days == d, onClick = { saveToggle(nextDays = d) }, label = { Text("$d Tage") })
            }
        }
        saveError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = ErrorColor) }
        Text("Ausgewertet wird stündlich in der Cloud. Am Handy erscheinen Treffer beim Öffnen.",
            style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}
