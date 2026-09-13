package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
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
import com.example.yugiohscanner.cloud.CONTAINER_KIND_LABELS
import com.example.yugiohscanner.cloud.CONTAINER_KIND_OPTIONS
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.ContainersRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.BinderGrid
import com.example.yugiohscanner.ml.ReloadScope
import com.example.yugiohscanner.ml.UnsortedCopies
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
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.util.UUID

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
// Spec B2 §7.2: ein Tipp auf einen Behaelter schlaegt ihn auf (BinderPageScreen); der Langdruck
// bleibt das Menue aus B1.
@Composable
fun BindersScreen(onOpen: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val containers = remember { mutableStateListOf<ContainerRow>() }
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var copies by remember { mutableStateOf<List<CopyRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showUnsorted by remember { mutableStateOf(false) }
    // Spec B1 §7.1 Befund 6: Tipp auf ein nicht einsortiertes Exemplar springt ins Kartendetail --
    // das ist der Weg, auf dem der Nutzer es einsortiert. Gleiche Bauart wie CollectionScreen.kt
    // (detailId, volle Seite ersetzt den Tab-Inhalt statt eines NavController).
    var detailId by remember { mutableStateOf<String?>(null) }

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

    // Die drei Aufrufe haengen nicht voneinander ab und laufen deshalb NEBENLAEUFIG -- gewartet
    // wird auf den laengsten, nicht auf die Summe. Der vierte Aufruf (listUnsortedCopies) ist ganz
    // weg: `UnsortedCopies.from(cp)` leitet dieselbe Liste in derselben Reihenfolge aus `cp` ab.
    //
    // `coroutineScope` haelt die Fehlerbehandlung genau so, wie sie vorher war: schlaegt EINER der
    // Aufrufe fehl, brechen die anderen ab und der Block wirft an den Aufrufer weiter, der `error`
    // setzt. Gesetzt wird erst, wenn ALLE da sind -- kein halb gefuellter Bildschirm, der wie
    // "leer" aussieht (in Spec B1 zweimal ein Befund).
    suspend fun reload(umfang: ReloadScope.Scope = ReloadScope.Scope.EVERYTHING) {
        if (umfang == ReloadScope.Scope.CONTAINERS_ONLY) {
            val c = ContainersRepository.list()
            containers.clear(); containers.addAll(c)
            return
        }
        coroutineScope {
            val dContainers = async { ContainersRepository.list() }
            val dCards = async { CollectionRepository.loadCards() }
            val dCopies = async { CollectionRepository.loadCopies() }
            val c = dContainers.await()
            val cd = dCards.await()
            val cp = dCopies.await()
            containers.clear(); containers.addAll(c)
            cards = cd
            copies = cp
        }
    }
    LaunchedEffect(Unit) {
        try { reload(); error = null }
        // A failed load must not look like an empty collection -- distinct message, kept
        // visible instead of silently falling through to "Noch keine Behälter angelegt.".
        catch (e: Exception) { error = e.message ?: "Laden fehlgeschlagen" }
        finally { loading = false }
    }

    // Full-screen sub-view takes over the whole tab, wie in CollectionScreen.kt.
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }

    val cardsByKey = remember(cards) { cards.associateBy { it.printingKey() } }
    // ABGELEITET, nicht zweiter Zustand: dieselben Zeilen, aus denen auch die Behaelter gefuellt
    // werden. Die Reihenfolge (aeltestes Exemplar zuerst) steckt in UnsortedCopies, nicht hier.
    val unsortedCopies = remember(copies) { UnsortedCopies.from(copies) }
    val copiesByContainer = remember(copies) { copies.filter { it.containerId != null }.groupBy { it.containerId!! } }
    fun countFor(id: String) = copiesByContainer[id]?.size ?: 0
    fun valueFor(id: String) = copiesByContainer[id]?.sumOf { c -> (cardsByKey[c.printingKey()]?.price ?: 0.0) * Valuation.factor(c.condition) } ?: 0.0
    // Spec 5.3: die hoechste BELEGTE Seite bestimmt die Anzeige, nicht ceil(Anzahl/Faecher) --
    // null, wenn kein Exemplar dieses Behaelters in einem darstellbaren Fach liegt (BinderRow
    // zeigt dann die 1). Gleiche Regel wie listContainers' max_page am Desktop
    // (copies.cjs). Die reine Rechnung steckt in BinderGrid.maxPlacedPage; hier bleibt nur das
    // Nachschlagen nach id.
    //
    // Ueber BinderGrid und nicht direkt ueber SlotMath.maxOccupiedPage (Abschluss-Fixwelle,
    // Minor 3): sonst zaehlte diese Liste ein Exemplar auf einem Fach jenseits der heutigen
    // Ordnergroesse mit, das Raster aber nicht -- die Liste sagte "7 Seiten", aufgeschlagen
    // stuende "Seite 1 von 3" und die Karte laege unter "Ohne Fach".
    fun maxPageFor(c: ContainerRow): Int? =
        BinderGrid.maxPlacedPage(copiesByContainer[c.containerId] ?: emptyList(), c.pocketsPerPage ?: 0)

    fun submitDialog() {
        val form = dialog ?: return
        if (savingRef[0]) return
        // Keine eigene Pruefung hier: ContainersRepository.save() prueft dieselben drei Regeln
        // bereits (markiert, mit Verweis auf den Desktop) -- der Desktop macht es genauso
        // (Binders.jsx schraenkt nur die Eingaben ein und laesst saveContainer entscheiden). Eine
        // zweite Pruefung hier mit eigenen Texten und ohne Verweis lief unmarkiert auseinander.
        // Die Einschraenkung der EINGABEN (Faecher-Auswahl nur bei binder, nur 4/9/12) bleibt in
        // der Oberflaeche weiter unten (BinderDialog).
        val pockets = if (form.kind == "binder") form.pocketsPerPage else null
        // Wie viel danach neu zu laden ist, entscheidet NICHT diese Oberflaeche: ReloadScope kennt
        // die Regel und begruendet sie Fall fuer Fall. Die bisherige Art muss VOR dem Speichern
        // abgelesen werden -- danach steht in `containers` die neue.
        val vorherigeArt = form.containerId?.let { id -> containers.find { it.containerId == id }?.kind }
        val umfang = ReloadScope.afterSave(form.containerId == null, vorherigeArt, form.kind)

        savingRef[0] = true
        saving = true
        dialogError = null
        scope.launch {
            // Der Dialog schliesst, sobald gespeichert ist -- scheitert danach nur das Nachladen,
            // gehoert die Meldung auf den Bildschirm, nicht in den geschlossenen Dialog. Sonst sieht
            // es aus, als sei nichts passiert, und ein zweiter Versuch legt einen zweiten Behaelter an.
            var gespeichert = false
            try {
                ContainersRepository.save(
                    ContainerRow(
                        containerId = form.containerId ?: UUID.randomUUID().toString(),
                        name = form.name, kind = form.kind, pocketsPerPage = pockets,
                        color = form.color, sortOrder = form.sortOrder,
                    )
                )
                gespeichert = true
                dialog = null
                reload(umfang)
                error = null
            } catch (e: Exception) {
                if (gespeichert) {
                    error = "Gespeichert, aber die Liste konnte nicht neu geladen werden: ${e.message ?: "unbekannter Fehler"}"
                } else {
                    dialogError = e.message ?: "Speichern fehlgeschlagen."
                }
            } finally {
                saving = false
                savingRef[0] = false
            }
        }
    }

    fun deleteContainer(c: ContainerRow) {
        pendingDelete = null
        scope.launch {
            // reload() steht in BEIDEN Zweigen: delete() raeumt Standorte und Behaelter in zwei
            // getrennten REST-Aufrufen (bewusst nicht atomar) -- bricht der zweite ab, sind
            // Exemplare serverseitig bereits standortlos, obwohl der Behaelter noch existiert.
            // Dieser Zwischenzustand ist echt und muss sichtbar werden, auch im Fehlerfall.
            var deleteError: String? = null
            try {
                ContainersRepository.delete(c.containerId)
            } catch (e: Exception) {
                deleteError = e.message ?: "Löschen fehlgeschlagen"
            }
            try {
                reload(ReloadScope.afterDelete())
                error = deleteError
            } catch (e: Exception) {
                error = deleteError ?: (e.message ?: "Laden fehlgeschlagen")
            }
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
                            // Eigene, lazy gerenderte und hoehenbegrenzte Liste statt einer
                            // schlichten Column: am ersten Tag nach dieser Funktion sind praktisch
                            // ALLE Exemplare "nicht einsortiert" (noch keine Behaelter angelegt).
                            // Eine Column wuerde dann jede Zeile auf einmal aufbauen und die
                            // Behaelterliste darunter aus dem Bild draengen, ohne Weg dorthin --
                            // die aeussere Column ist selbst nicht scrollbar. Diese Liste scrollt
                            // stattdessen innerhalb ihrer eigenen Hoehenbegrenzung; dank LazyColumn
                            // werden auch bei 2000 nicht einsortierten Exemplaren nur die paar
                            // sichtbaren Zeilen aufgebaut, nicht alle 2000 auf einmal.
                            LazyColumn(
                                modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                items(unsortedCopies, key = { it.copyId }) { copy ->
                                    val card = cardsByKey[copy.printingKey()]
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.fillMaxWidth().clickable { detailId = copy.cardId },
                                    ) {
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
                            c, count = countFor(c.containerId), value = valueFor(c.containerId), maxPage = maxPageFor(c),
                            onOpen = { onOpen(c.containerId) },
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
private fun BinderRow(
    c: ContainerRow,
    count: Int,
    value: Double,
    maxPage: Int?,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    SpaceCard(Modifier.fillMaxWidth()) {
        Box {
            Column(
                Modifier.fillMaxWidth()
                    .combinedClickable(onClick = onOpen, onLongClick = { menuOpen = true })
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
                Text(CONTAINER_KIND_LABELS[c.kind] ?: c.kind, color = Muted, style = MaterialTheme.typography.labelSmall)
                val pockets = c.pocketsPerPage
                val occupancy = buildString {
                    append(count); append(if (count == 1) " Exemplar" else " Exemplare")
                    if (c.kind == "binder" && pockets != null && pockets > 0) {
                        // Spec 5.3: die hoechste BELEGTE Seite bestimmt die Anzeige, nie
                        // ceil(Anzahl/Faecher). Dieselbe Zahl, die der aufgeschlagene Ordner als
                        // "von N" zeigt: maxPageFor rechnet ueber dieselbe Fachpruefung wie
                        // BinderGrid.isPlaced, und die 1 bei null ist BinderGrid.pageCount
                        // Mindestwert -- ein leerer Ordner hat eine leere erste Seite zum
                        // Blaettern. Wortgleich am Desktop: Binders.jsx.
                        val seiten = maxPage ?: 1
                        append(" · "); append(seiten); append(if (seiten == 1) " Seite" else " Seiten")
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
                        CONTAINER_KIND_OPTIONS.forEach { (id, label) ->
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
