package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.ContainersRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.Tags
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

private val KIND_LABELS = mapOf("binder" to "Ordner", "box" to "Box", "deckbox" to "Deckbox")

/**
 * Spec B1 §10.2: das Gegenstueck zu `desktop/src/components/CopySheet.jsx` -- die EINZIGE Stelle
 * am Handy, an der Standort, Tags und Notiz eines Exemplars geschrieben werden. Kein zweiter
 * Schreibweg irgendwo sonst.
 *
 * Tags laufen ausschliesslich ueber `Tags.parse/add/remove/serialize` (ml-Paket) --
 * `CollectionRepository.setCopyTagsNote` uebernimmt die Serialisierung selbst, hier wird nur die
 * rohe `List<String>` gefuehrt, kein eigenes Zerlegen/Beschneiden/Entdoppeln.
 *
 * Standort: `setCopyLocation` (Task 8) verwirft Seite/Fach bei Nicht-Bindern bereits selbst
 * anhand der Behaelterart in der Datenbank -- diese Oberflaeche schickt page/slot deshalb ROH mit
 * (kein `if (isBinder)`-Gate vor dem Aufruf). Ein clientseitiges Gate waere hier zusaetzlich
 * gefaehrlich, weil `containers` beim ersten Oeffnen noch laedt: waehrend des Ladens ist
 * `selectedContainer` noch null, `isBinder` also faelschlich `false` -- ein Speichern in genau
 * diesem Fenster wuerde Seite/Fach eines echten Ordner-Exemplars sonst still loeschen (das war
 * der Desktop-Datenverlust-Bug aus Task 6, Befund B).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CopySheet(copy: CopyRow, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var containers by remember { mutableStateOf<List<ContainerRow>>(emptyList()) }
    var tagSuggestions by remember { mutableStateOf<List<String>>(emptyList()) }
    // Eigener Zustand fuer den Vokabular-Ladefehler: anders als der Standort-Chip im Kartendetail
    // (der defensiv still auf "—" zurueckfaellt) MUSS das hier sichtbar sein -- eine leer
    // gebliebene Behaelterliste waehrend des Ladens darf nicht wie "kein Behaelter gewaehlt"
    // aussehen, sonst verschwindet ein echter Standort beim naechsten Speichern lautlos.
    var loadError by remember { mutableStateOf<String?>(null) }

    var containerId by remember { mutableStateOf(copy.containerId) }
    var page by remember { mutableStateOf(copy.page?.toString() ?: "") }
    var slot by remember { mutableStateOf(copy.slot?.toString() ?: "") }
    var tags by remember { mutableStateOf(Tags.parse(copy.tags)) }
    var tagInput by remember { mutableStateOf("") }
    var note by remember { mutableStateOf(copy.note ?: "") }

    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    // Spec B1 §10.4 Befund 2: "Entfernen" (Soft-Delete des Exemplars) mit Rueckfrage, wie am
    // Desktop (CopySheet.jsx#removeExemplar). `removing` ist die eigene Label-/Enabled-Anzeige,
    // faellt aber unter dieselbe Doppel-Tap-Sperre wie Speichern (savingRef unten) -- ein Tap auf
    // Entfernen waehrend gerade gespeichert wird (oder umgekehrt) wird sofort verworfen.
    var removing by remember { mutableStateOf(false) }
    var pendingRemove by remember { mutableStateOf(false) }
    // Plain (non-Compose-state) guard, geprueft SYNCHRON ganz am Anfang von save()/remove() -- ein
    // Doppel-Tap auf "Speichern" bzw. "Entfernen" waehrend eine der beiden Aktionen noch laeuft
    // wird sofort verworfen, nicht erst nach der naechsten Neuzeichnung. Gleiches Muster wie
    // BindersScreen.kt's savingRef.
    val savingRef = remember { BooleanArray(1) }

    LaunchedEffect(Unit) {
        try {
            containers = ContainersRepository.list()
            tagSuggestions = CollectionRepository.listTags()
            loadError = null
        } catch (e: Exception) {
            loadError = e.message ?: "Behälter und Tags konnten nicht geladen werden."
        }
    }

    val selectedContainer = containers.find { it.containerId == containerId }
    val isBinder = selectedContainer?.kind == "binder"

    // Box/Deckbox haben keine Seiten -- setCopyLocation verwirft page/slot dort ohnehin, die
    // Oberflaeche soll aber nicht erst anbieten, was verworfen wird. Wechselt die Auswahl auf
    // Box/Deckbox, werden Seite/Fach sofort sichtbar geleert (nicht erst beim Speichern).
    fun onContainerChange(id: String?) {
        containerId = id
        val c = containers.find { it.containerId == id }
        if (c == null || c.kind != "binder") { page = ""; slot = "" }
    }

    fun commitTagInput() {
        val t = tagInput.trim()
        if (t.isEmpty()) return
        tags = Tags.add(tags, t)
        tagInput = ""
    }

    fun save() {
        if (savingRef[0]) return
        savingRef[0] = true
        saving = true
        error = null
        scope.launch {
            try {
                CollectionRepository.setCopyLocation(
                    copyId = copy.copyId,
                    containerId = containerId,
                    page = page.trim().toIntOrNull(),
                    slot = slot.trim().toIntOrNull(),
                )
                CollectionRepository.setCopyTagsNote(
                    copyId = copy.copyId,
                    tags = tags,
                    note = note.trim().ifEmpty { null },
                )
                onSaved()
                onDismiss()
            } catch (e: Exception) {
                error = e.message ?: "Speichern fehlgeschlagen."
            } finally {
                saving = false
                savingRef[0] = false
            }
        }
    }

    // Copy_id-genau ueber CollectionRepository.deleteCopy, NICHT removeCopies: removeCopies waehlt
    // ueber Edition/Zustand/Erstellzeit aus einer ganzen Gruppe aus, ohne Ruecksicht auf Standort/
    // Tags/Notiz des einzelnen Exemplars -- hier ist aber genau EIN Exemplar (copy.copyId)
    // gemeint, das der Nutzer gerade vor sich hat (derselbe Desktop-Bug wie in Task 6, Befund A).
    fun remove() {
        if (savingRef[0]) return
        savingRef[0] = true
        removing = true
        error = null
        scope.launch {
            try {
                CollectionRepository.deleteCopy(copy.copyId)
                onSaved()
                onDismiss()
            } catch (e: Exception) {
                error = e.message ?: "Entfernen fehlgeschlagen."
            } finally {
                removing = false
                savingRef[0] = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!saving && !removing) onDismiss() }, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column {
                Text("Exemplar", style = MaterialTheme.typography.titleLarge, color = OnSurface, fontWeight = FontWeight.Bold)
                Text(
                    "${copy.setCode} · ${copy.rarity} · ${Valuation.EDITION_LABELS[copy.edition] ?: copy.edition} · ${copy.condition}",
                    style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted,
                )
            }

            loadError?.let {
                Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }

            Column {
                Text("Standort", style = MaterialTheme.typography.labelMedium, color = Muted)
                Spacer(Modifier.height(4.dp))
                ContainerPicker(containers, selectedContainer, onSelect = { onContainerChange(it?.containerId) })
                if (isBinder) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = page, onValueChange = { page = it.filter(Char::isDigit) },
                            label = { Text("Seite") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            value = slot, onValueChange = { slot = it.filter(Char::isDigit) },
                            label = { Text("Fach") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            Column {
                Text("Tags", style = MaterialTheme.typography.labelMedium, color = Muted)
                Spacer(Modifier.height(4.dp))
                if (tags.isNotEmpty()) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        tags.forEach { t ->
                            InputChip(
                                selected = true,
                                onClick = { tags = Tags.remove(tags, t) },
                                label = { Text(t) },
                                trailingIcon = { Icon(Icons.Default.Close, "Entfernen", modifier = Modifier.size(InputChipDefaults.IconSize)) },
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
                OutlinedTextField(
                    value = tagInput, onValueChange = { tagInput = it }, singleLine = true,
                    placeholder = { Text("Tag eingeben…") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { commitTagInput() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                val suggestions = tagSuggestions.filter { s -> tags.none { it.equals(s, ignoreCase = true) } }
                if (suggestions.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        suggestions.forEach { s ->
                            SuggestionChip(onClick = { tags = Tags.add(tags, s); tagInput = "" }, label = { Text(s) })
                        }
                    }
                }
            }

            Column {
                Text("Notiz", style = MaterialTheme.typography.labelMedium, color = Muted)
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = note, onValueChange = { note = it }, minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = { pendingRemove = true }, enabled = !saving && !removing) {
                    Icon(Icons.Default.Delete, "Entfernen", tint = ErrorColor, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(if (removing) "Wird entfernt…" else "Entfernen", color = ErrorColor)
                }
                Row {
                    TextButton(onClick = onDismiss, enabled = !saving && !removing) { Text("Abbrechen") }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { save() }, enabled = !saving && !removing) {
                        Text(if (saving) "Wird gespeichert…" else "Speichern")
                    }
                }
            }
        }
    }

    if (pendingRemove) {
        AlertDialog(
            onDismissRequest = { pendingRemove = false },
            title = { Text("Exemplar entfernen?") },
            text = { Text("Dieses Exemplar wird entfernt. Das kann nicht rückgängig gemacht werden.") },
            confirmButton = { TextButton(onClick = { pendingRemove = false; remove() }) { Text("Entfernen", color = ErrorColor) } },
            dismissButton = { TextButton(onClick = { pendingRemove = false }) { Text("Abbrechen") } },
        )
    }
}

// Dropdown fuer die Behaelterauswahl -- gleicher Aufbau wie SetPicker in ScanStagingScreen.kt.
@Composable
private fun ContainerPicker(containers: List<ContainerRow>, current: ContainerRow?, onSelect: (ContainerRow?) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = current?.let { "${it.name} (${KIND_LABELS[it.kind] ?: it.kind})" } ?: "Kein Behälter"

    Box {
        Row(
            Modifier.fillMaxWidth().clickable { expanded = true }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = OnSurface, modifier = Modifier.weight(1f))
            Icon(Icons.Default.ArrowDropDown, "Auswählen", tint = Muted)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("Kein Behälter") }, onClick = { onSelect(null); expanded = false })
            containers.forEach { c ->
                DropdownMenuItem(
                    text = { Text("${c.name} (${KIND_LABELS[c.kind] ?: c.kind})") },
                    onClick = { onSelect(c); expanded = false },
                )
            }
        }
    }
}
