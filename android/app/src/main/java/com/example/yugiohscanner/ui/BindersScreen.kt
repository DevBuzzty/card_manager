package com.example.yugiohscanner.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.ContainersRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.RarityRare
import com.example.yugiohscanner.ui.theme.RaritySuper
import com.example.yugiohscanner.ui.theme.TypeMonster
import com.example.yugiohscanner.ui.theme.TypeSpell
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.ceil

private val KIND_OPTIONS = listOf("binder" to "Ordner", "box" to "Box", "deckbox" to "Deckbox")
private val KIND_LABELS = KIND_OPTIONS.toMap()
private val KIND_VALUES = KIND_OPTIONS.map { it.first }.toSet()
private val POCKET_OPTIONS = listOf(4, 9, 12)
// Same hexes as the desktop swatch (Binders.jsx COLOR_PRESETS) -- all already in the theme palette.
private val COLOR_PRESETS = listOf(Primary, Gold, Good, ErrorColor, RarityRare, RaritySuper, TypeMonster, TypeSpell)
private val DEFAULT_COLOR_HEX = "#%06X".format(0xFFFFFF and Primary.toArgb())

private fun Color.toHex(): String = "#%06X".format(0xFFFFFF and this.toArgb())
private fun hexToColor(hex: String?): Color =
    try { Color(android.graphics.Color.parseColor(hex ?: DEFAULT_COLOR_HEX)) } catch (e: Exception) { Muted }

private data class BinderForm(
    val containerId: String?,
    val name: String,
    val kind: String,
    val pocketsPerPage: Int,
    val color: String,
    val sortOrder: Int,
)

// Spec B1 §7.1, Android side: counter for un-sorted copies, container list with occupancy and
// value, create/rename/delete. Reordering by long-press is explicitly NOT part of B1.
@Composable
fun BindersScreen() {
    val scope = rememberCoroutineScope()
    val containers = remember { mutableStateListOf<ContainerRow>() }
    val unsortedCopies = remember { mutableStateListOf<CopyRow>() }
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var copies by remember { mutableStateOf<List<CopyRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showUnsorted by remember { mutableStateOf(false) }

    var dialog by remember { mutableStateOf<BinderForm?>(null) }
    var dialogError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    // Plain (non-Compose-state) guard: checked synchronously at the very top of submitDialog(),
    // before any suspend gap, so a second click/Enter during a still-running save is dropped
    // immediately -- not just after the next recomposition. Mirrors the desktop bug fix in
    // Binders.jsx (savingRef.current), which needed a ref for the same reason (React state
    // there is genuinely asynchronous).
    val savingRef = remember { BooleanArray(1) }

    var pendingDelete by remember { mutableStateOf<ContainerRow?>(null) }

    suspend fun reload() {
        val c = ContainersRepository.list()
        val u = CollectionRepository.listUnsortedCopies()
        val cd = CollectionRepository.loadCards()
        val cp = CollectionRepository.loadCopies()
        containers.clear(); containers.addAll(c)
        unsortedCopies.clear(); unsortedCopies.addAll(u)
        cards = cd
        copies = cp
    }
    LaunchedEffect(Unit) {
        try { reload(); error = null }
        // A failed load must not look like an empty collection -- distinct message, kept
        // visible instead of silently falling through to "Noch keine Behälter angelegt.".
        catch (e: Exception) { error = e.message ?: "Laden fehlgeschlagen" }
        finally { loading = false }
    }

    val cardsByKey = remember(cards) { cards.associateBy { it.printingKey() } }
    val copiesByContainer = remember(copies) { copies.filter { it.containerId != null }.groupBy { it.containerId!! } }
    fun countFor(id: String) = copiesByContainer[id]?.size ?: 0
    fun valueFor(id: String) = copiesByContainer[id]?.sumOf { c -> (cardsByKey[c.printingKey()]?.price ?: 0.0) * Valuation.factor(c.condition) } ?: 0.0

    fun submitDialog() {
        val form = dialog ?: return
        if (savingRef[0]) return
        val name = form.name.trim()
        if (name.isBlank()) { dialogError = "Name darf nicht leer sein."; return }
        if (form.kind !in KIND_VALUES) { dialogError = "Ungültige Art."; return }
        val pockets = if (form.kind == "binder") {
            if (form.pocketsPerPage !in POCKET_OPTIONS) { dialogError = "Fächer pro Seite muss 4, 9 oder 12 sein."; return }
            form.pocketsPerPage
        } else null

        savingRef[0] = true
        saving = true
        dialogError = null
        scope.launch {
            try {
                ContainersRepository.save(
                    ContainerRow(
                        containerId = form.containerId ?: UUID.randomUUID().toString(),
                        name = name, kind = form.kind, pocketsPerPage = pockets,
                        color = form.color, sortOrder = form.sortOrder,
                    )
                )
                dialog = null
                reload()
                error = null
            } catch (e: Exception) {
                dialogError = e.message ?: "Speichern fehlgeschlagen."
            } finally {
                saving = false
                savingRef[0] = false
            }
        }
    }

    fun deleteContainer(c: ContainerRow) {
        pendingDelete = null
        scope.launch {
            try { ContainersRepository.delete(c.containerId); reload(); error = null }
            catch (e: Exception) { error = e.message ?: "Löschen fehlgeschlagen" }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            error?.let {
                SpaceCard(Modifier.fillMaxWidth()) {
                    Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(12.dp))
                }
                Spacer(Modifier.height(12.dp))
            }

            SpaceCard(Modifier.fillMaxWidth().clickable { showUnsorted = !showUnsorted }) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Nicht einsortiert: ${unsortedCopies.size} ${if (unsortedCopies.size == 1) "Exemplar" else "Exemplare"}",
                            color = OnSurface, fontWeight = FontWeight.Medium,
                            style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
                        )
                        Icon(if (showUnsorted) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, tint = Muted)
                    }
                    if (showUnsorted) {
                        Spacer(Modifier.height(8.dp))
                        if (unsortedCopies.isEmpty()) {
                            Text("Alle Exemplare sind einsortiert.", color = Muted, style = MaterialTheme.typography.bodySmall)
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                unsortedCopies.forEach { copy ->
                                    val card = cardsByKey[copy.printingKey()]
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            card?.name ?: copy.cardId, color = OnSurface, maxLines = 1,
                                            style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
                                        )
                                        Spacer(Modifier.width(8.dp))
                                        Text("${copy.setCode} · ${copy.rarity}", color = Muted, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Behälter", style = MaterialTheme.typography.titleMedium, color = OnSurface, modifier = Modifier.weight(1f))
                FilledIconButton(onClick = {
                    dialog = BinderForm(containerId = null, name = "", kind = "binder", pocketsPerPage = 4, color = DEFAULT_COLOR_HEX, sortOrder = containers.size)
                    dialogError = null
                }) { Icon(Icons.Default.Add, "Neuer Behälter") }
            }
            Spacer(Modifier.height(12.dp))

            if (loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
            } else if (containers.isEmpty() && error == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Noch keine Behälter angelegt.", color = Muted)
                }
            } else {
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(containers, key = { it.containerId }) { c ->
                        BinderRow(
                            c, count = countFor(c.containerId), value = valueFor(c.containerId),
                            onEdit = {
                                dialog = BinderForm(
                                    containerId = c.containerId, name = c.name, kind = c.kind,
                                    pocketsPerPage = c.pocketsPerPage ?: 4, color = c.color ?: DEFAULT_COLOR_HEX,
                                    sortOrder = c.sortOrder,
                                )
                                dialogError = null
                            },
                            onDelete = { pendingDelete = c },
                        )
                    }
                }
            }
        }
    }

    dialog?.let { form ->
        BinderDialog(form, dialogError, saving, onChange = { dialog = it }, onDismiss = { if (!saving) dialog = null }, onSubmit = { submitDialog() })
    }

    pendingDelete?.let { c ->
        val n = countFor(c.containerId)
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("„${c.name}“ löschen?") },
            text = { Text("$n ${if (n == 1) "Exemplar wird" else "Exemplare werden"} auf „nicht einsortiert“ gesetzt.") },
            confirmButton = { TextButton(onClick = { deleteContainer(c) }) { Text("Löschen", color = ErrorColor) } },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Abbrechen") } },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BinderRow(c: ContainerRow, count: Int, value: Double, onEdit: () -> Unit, onDelete: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    SpaceCard(Modifier.fillMaxWidth()) {
        Box {
            Column(
                Modifier.fillMaxWidth()
                    .combinedClickable(onClick = {}, onLongClick = { menuOpen = true })
                    .padding(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(hexToColor(c.color)))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        c.name, color = OnSurface, fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(KIND_LABELS[c.kind] ?: c.kind, color = Muted, style = MaterialTheme.typography.labelSmall)
                val pockets = c.pocketsPerPage
                val occupancy = buildString {
                    append(count); append(if (count == 1) " Exemplar" else " Exemplare")
                    if (c.kind == "binder" && pockets != null && pockets > 0) {
                        append(" · "); append(ceil(count.toDouble() / pockets).toInt()); append(" Seiten")
                    }
                }
                Text(occupancy, color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(2.dp))
                ValueText(value)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(text = { Text("Umbenennen") }, onClick = { menuOpen = false; onEdit() })
                DropdownMenuItem(text = { Text("Löschen", color = ErrorColor) }, onClick = { menuOpen = false; onDelete() })
            }
        }
    }
}

@Composable
private fun BinderDialog(
    form: BinderForm,
    error: String?,
    saving: Boolean,
    onChange: (BinderForm) -> Unit,
    onDismiss: () -> Unit,
    onSubmit: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (form.containerId == null) "Neuer Behälter" else "Behälter bearbeiten") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = form.name, onValueChange = { onChange(form.copy(name = it)) },
                    label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Column {
                    Text("Art", style = MaterialTheme.typography.labelSmall, color = Muted)
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        KIND_OPTIONS.forEach { (id, label) ->
                            FilterChip(selected = form.kind == id, onClick = { onChange(form.copy(kind = id)) }, label = { Text(label) })
                        }
                    }
                }
                if (form.kind == "binder") {
                    Column {
                        Text("Fächer pro Seite", style = MaterialTheme.typography.labelSmall, color = Muted)
                        Spacer(Modifier.height(4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            POCKET_OPTIONS.forEach { p ->
                                FilterChip(selected = form.pocketsPerPage == p, onClick = { onChange(form.copy(pocketsPerPage = p)) }, label = { Text("$p") })
                            }
                        }
                    }
                }
                Column {
                    Text("Farbe", style = MaterialTheme.typography.labelSmall, color = Muted)
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        COLOR_PRESETS.forEach { presetColor ->
                            val hex = presetColor.toHex()
                            Box(
                                Modifier.size(28.dp).clip(CircleShape).background(presetColor)
                                    .border(if (form.color.equals(hex, ignoreCase = true)) 2.dp else 0.dp, OnSurface, CircleShape)
                                    .clickable { onChange(form.copy(color = hex)) }
                            )
                        }
                    }
                }
                error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = onSubmit, enabled = !saving) { Text(if (saving) "Wird gespeichert…" else "Speichern") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !saving) { Text("Abbrechen") }
        },
    )
}
