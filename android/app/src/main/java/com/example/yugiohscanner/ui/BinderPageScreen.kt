package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CONTAINER_KIND_LABELS
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.BinderGrid
import com.example.yugiohscanner.ml.UnsortedCopies
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.SurfaceColor
import kotlinx.coroutines.launch

/**
 * Spec B2 §7.2: EIN Behaelter, aufgeschlagen. Ordner zeigen ein Fachraster pro Seite und blaettern
 * waagerecht; Box und Deckbox haben keine Seiten und zeigen stattdessen eine Liste mit
 * Standort-Chip. Aus dem Kopf dieser Seite betritt Task 6 den Einsortier-Modus.
 *
 * Keine Regel wird hier selbst getroffen:
 * - Rasterform, Seitenzahl und die Zuordnung Exemplar -> Fach kommen aus `BinderGrid` (geprueft in
 *   `BinderGridTest`), die Zurechtrueckung der Fachzahl ueber `SlotMath.clampPockets`.
 * - Ob Seite und Fach ueberhaupt geschrieben werden, entscheidet `CollectionRepository
 *   .setCopyLocation` anhand der Behaelterart in der Datenbank -- page/slot gehen deshalb ROH
 *   mit, ohne ein `if (isBinder)` davor (dieselbe Ueberlegung wie in `CopySheet.kt`).
 * - Der Standort-Text kommt aus `CopyLocation.format`, dem Zwilling der Desktop-Fassung.
 *
 * `onEinsortieren` ist der Einstieg in den Einsortier-Modus (Task 6, Route `Routes.EINSORTIEREN`);
 * solange er `null` ist, ist der Knopf sichtbar, aber ausgegraut.
 *
 * `seiteNachEinsortieren` ist der Rueckweg von dort: die zuletzt bearbeitete Seite (Spec §6.6).
 * Ist sie gesetzt, wird neu geladen -- der Modus hat Standorte geschrieben, die diese Ansicht noch
 * nicht kennt -- und dann dorthin geblaettert. `onSeiteAufgeschlagen` raeumt den Wert danach weg,
 * damit dasselbe Aufschlagen nicht bei jeder Neuzusammensetzung wieder passiert.
 */
// HorizontalPager/rememberPagerState sind in dieser Compose-Fassung (BOM 2024.02.02) noch als
// experimentell gekennzeichnet -- gleiche Zustimmung wie BindersScreen sie fuer combinedClickable
// gibt.
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BinderPageScreen(
    containerId: String,
    onBack: () -> Unit,
    onEinsortieren: (() -> Unit)?,
    seiteNachEinsortieren: Int? = null,
    onSeiteAufgeschlagen: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()

    // Spec §5: aus dem Speicher. Ist der Behaelter dort nicht (z. B. am PC geloescht), zeigt die
    // Seite das statt eines leeren Ordners.
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val containers = ready?.containers ?: emptyList()
    val cards = ready?.cards ?: emptyList()
    val copies = ready?.copies ?: emptyList()
    val container = containers.find { it.containerId == containerId }
    // Ein Ladefehler darf nicht wie ein leerer Ordner aussehen: eigener Zustand, im Erfolgsfall
    // ausdruecklich auf null zurueckgesetzt, und die Leermeldung erscheint nur bei `error == null`.
    // Das Banner steht ganz oben im Aufbau, damit es nicht hinter einem eingeklappten Teil
    // verschwinden kann (in B1 zweimal passiert). Gleiche Bauart wie BindersScreen.kt.
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // Einfache (nicht Compose-)Sperre, SYNCHRON ganz am Anfang jedes Schreibvorgangs geprueft --
    // ein zweiter Tipp waehrend eines laufenden Schreibens faellt sofort weg, nicht erst nach der
    // naechsten Neuzeichnung. Begruendung und Vorbild: BindersScreen.kt:92-96 und :141-153.
    val savingRef = remember { BooleanArray(1) }

    var detailId by remember { mutableStateOf<String?>(null) }
    var sheetCopy by remember { mutableStateOf<CopyRow?>(null) }        // Verschieben nach… (CopySheet)
    var actionSlot by remember { mutableStateOf<Pair<Int, Int>?>(null) } // Langdruck auf ein belegtes Fach
    var fillTarget by remember { mutableStateOf<Pair<Int, Int>?>(null) } // Tipp auf ein leeres Fach

    val myCopies = remember(copies, containerId) { copies.filter { it.containerId == containerId } }
    val pockets = container?.pocketsPerPage ?: 0   // 0 -> SlotMath.clampPockets zieht auf 4
    val isBinder = container?.kind == "binder"
    // Exemplare dieses Behaelters ohne darstellbares Fach: sie stehen unter dem Raster UND ganz
    // oben im Auswahlangebot fuer ein leeres Fach -- deshalb hier oben, nicht im Rasterzweig.
    val loose = remember(myCopies, pockets) { BinderGrid.loose(myCopies, pockets) }
    // ABGELEITET, nicht zweiter Zustand: dieselbe Liste und dieselbe Fachzahl, aus denen auch das
    // Raster gebaut wird. Ein eigenes, in reload() gesetztes Feld haette eine zweite Filterung und
    // eine zweite Fachzahl gebraucht -- heute deckungsgleich, morgen still auseinandergelaufen.
    val pageCount = remember(myCopies, pockets) { BinderGrid.pageCount(myCopies, pockets) }

    // Pager- und Rasterzustand stehen VOR dem fruehen `return` des Kartendetails weiter unten.
    // Sonst verlaesst die Gruppe, in der sie sitzen, beim Antippen einer Karte die Komposition,
    // ihr Zustand wird verworfen -- und der Ordner stuende nach dem Zurueckgehen wieder auf
    // Seite 1, mit an den Anfang zurueckgesprungenen Rastern.
    // HorizontalPager wertet die Lambda bei jedem Zugriff neu aus (und rememberPagerState reicht
    // sie bei jeder Neuzusammensetzung nach), deshalb erreicht eine neu entstandene letzte Seite
    // den Pager sofort; ein hereingereichter Zahlenwert waere fuer immer der erste.
    val pagerState = rememberPagerState(pageCount = { pageCount })
    // Je Ordnerseite eine senkrechte Rasterposition, aus demselben Grund hier oben gehalten.
    val gridScrolls = remember { mutableMapOf<Int, ScrollState>() }

    // Rueckweg aus dem Einsortier-Modus (Spec §6.6), in ZWEI Schritten -- absichtlich.
    // Erst abgleichen (der Modus hat Standorte geschrieben, die der Speicher noch nicht kennt) und das
    // Ziel merken; aufgeschlagen wird erst im zweiten Effekt, der an `pageCount` haengt und deshalb
    // mit dem frischen Wert laeuft -- eine neu entstandene letzte Seite wuerde sonst weggeklemmt.
    var seitenZiel by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(seiteNachEinsortieren) {
        val ziel = seiteNachEinsortieren ?: return@LaunchedEffect
        CollectionStore.awaitSync()
        seitenZiel = ziel
        // Raeumt den Rueckkanal weg: ohne das schlaegt jede Neuzusammensetzung dieselbe Seite
        // wieder auf und risse ein Blaettern des Nutzers zurueck.
        onSeiteAufgeschlagen()
    }
    LaunchedEffect(seitenZiel, pageCount) {
        val ziel = seitenZiel ?: return@LaunchedEffect
        pagerState.scrollToPage((ziel - 1).coerceIn(0, pageCount - 1))
        seitenZiel = null
    }

    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }

    val cardsByKey = remember(cards) { cards.associateBy { it.printingKey() } }
    // ABGELEITET, wie `loose` und `pageCount` daneben: dieselben Zeilen, aus denen auch das Raster
    // gebaut wird. Die Reihenfolge (aeltestes Exemplar zuerst) steckt in UnsortedCopies.
    val unsorted = remember(copies) { UnsortedCopies.from(copies) }
    fun cardOf(c: CopyRow): CardRow? = cardsByKey[c.printingKey()]
    fun valueOf(list: List<CopyRow>): Double =
        list.sumOf { c -> (cardOf(c)?.price ?: 0.0) * Valuation.factor(c.condition) }

    // Ein Schreibweg fuer beide Aktionen dieser Seite (aus dem Fach nehmen, in ein Fach legen):
    // Sperre, Schreiben, Abgleichen, Fehler zuruecksetzen. Liefert false, wenn die Sperre den
    // Vorgang verworfen hat -- der Aufrufer schliesst sein Sheet dann nicht.
    fun write(what: String, block: suspend () -> Unit): Boolean {
        if (savingRef[0]) return false
        savingRef[0] = true
        busy = true
        scope.launch {
            try {
                block()
                CollectionStore.awaitSync()
                error = null
            } catch (e: Exception) {
                error = e.message ?: "$what fehlgeschlagen"
            } finally {
                busy = false
                savingRef[0] = false
            }
        }
        return true
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface) }
                Column(Modifier.weight(1f)) {
                    Text(
                        container?.name ?: "Behälter", color = OnSurface, maxLines = 1,
                        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        CONTAINER_KIND_LABELS[container?.kind] ?: (container?.kind ?: ""),
                        color = Muted, style = MaterialTheme.typography.labelSmall,
                    )
                }
            }

            SyncHint(Modifier.padding(top = 4.dp))

            error?.let {
                Spacer(Modifier.height(8.dp))
                SpaceCard(Modifier.fillMaxWidth()) {
                    Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(12.dp))
                }
            }

            Spacer(Modifier.height(12.dp))

            if (container == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Behälter nicht gefunden.", color = Muted)
                }
            } else if (isBinder) {
                val page = pagerState.currentPage + 1
                val slotsOfPage = remember(myCopies, page, pockets) { BinderGrid.slots(myCopies, page, pockets) }

                SpaceCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Seite $page von $pageCount", color = OnSurface,
                                fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodyMedium,
                            )
                            Spacer(Modifier.height(2.dp))
                            ValueText(valueOf(slotsOfPage.flatten()))
                        }
                        Button(onClick = { onEinsortieren?.invoke() }, enabled = onEinsortieren != null && !busy) {
                            Text("Einsortieren")
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))

                HorizontalPager(state = pagerState, modifier = Modifier.weight(1f)) { index ->
                    PocketGrid(
                        slots = BinderGrid.slots(myCopies, index + 1, pockets),
                        columns = BinderGrid.columns(pockets),
                        scroll = remember(index) { gridScrolls.getOrPut(index) { ScrollState(0) } },
                        imageOf = { cardOf(it)?.imageUrl },
                        nameOf = { cardOf(it)?.name },
                        onOpen = { copy -> detailId = copy.cardId },
                        onActions = { slot -> actionSlot = (index + 1) to slot },
                        onFill = { slot -> fillTarget = (index + 1) to slot },
                    )
                }

                if (loose.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    // Exemplare, die diesem Ordner zugeordnet sind, aber in keinem darstellbaren
                    // Fach liegen (kein Fach vergeben, oder ein Fach aus einer frueheren, groesseren
                    // Ordnergroesse). Ohne diese Liste waeren sie auf keiner Seite zu sehen.
                    Text("Ohne Fach", color = Muted, style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.height(6.dp))
                    CopyList(
                        copies = loose,
                        containers = containers,
                        nameOf = { cardOf(it)?.name },
                        onOpen = { detailId = it.cardId },
                        onLongPress = { sheetCopy = it },
                        modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp),
                    )
                }
            } else {
                // Box und Deckbox haben kein Raster: eine Liste aller Exemplare mit Standort-Chip.
                SpaceCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${myCopies.size} ${if (myCopies.size == 1) "Exemplar" else "Exemplare"}",
                            color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
                        )
                        ValueText(valueOf(myCopies))
                    }
                }
                Spacer(Modifier.height(12.dp))
                if (myCopies.isEmpty() && error == null) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Noch nichts in diesem Behälter.", color = Muted)
                    }
                } else {
                    CopyList(
                        copies = myCopies,
                        containers = containers,
                        nameOf = { cardOf(it)?.name },
                        onOpen = { detailId = it.cardId },
                        onLongPress = { sheetCopy = it },
                        modifier = Modifier.fillMaxWidth().weight(1f),
                    )
                }
            }
        }
    }

    actionSlot?.let { (page, slot) ->
        val inSlot = BinderGrid.slots(myCopies, page, pockets).getOrNull(slot - 1).orEmpty()
        if (inSlot.isNotEmpty()) SlotActionSheet(
            page = page, slot = slot, copies = inSlot, busy = busy,
            nameOf = { cardOf(it)?.name },
            onDismiss = { if (!busy) actionSlot = null },
            onMove = { copy -> actionSlot = null; sheetCopy = copy },
            onTakeOut = { copy ->
                // "Aus Fach nehmen" raeumt genau das, was der Name sagt: Seite und Fach. Der
                // Behaelter bleibt -- wer die Karte aus einem Fach nimmt, verliert sie nicht aus
                // dem Ordner (in B1 war genau das ein echter Datenverlust: eine Aktion tat mehr am
                // Standort, als ihr Name ankuendigte). Das Exemplar erscheint danach unter
                // "Ohne Fach" und steht im Auswahlangebot jedes leeren Fachs dieses Ordners ganz
                // oben (BinderGrid.candidateGroups). Geschrieben wird ueber denselben und einzigen
                // Standort-Weg; der Behaelter geht unveraendert wieder mit.
                val started = write("Aus Fach nehmen") {
                    CollectionRepository.setCopyLocation(copy.copyId, copy.containerId, null, null)
                }
                if (started) actionSlot = null
            },
        )
    }

    fillTarget?.let { (page, slot) ->
        FillSlotSheet(
            page = page, slot = slot, loose = loose, unsorted = unsorted, busy = busy,
            nameOf = { cardOf(it)?.name },
            onDismiss = { if (!busy) fillTarget = null },
            onPick = { copy ->
                val started = write("Einlegen") {
                    CollectionRepository.setCopyLocation(copy.copyId, containerId, page, slot)
                }
                if (started) fillTarget = null
            },
        )
    }

    sheetCopy?.let { copy ->
        // "Verschieben nach…" ist genau das, was CopySheet kann (Behaelter, Seite, Fach) -- und es
        // ist die einzige Schreibstelle fuer Tags und Notiz. Kein zweites Sheet mit denselben
        // Feldern.
        CopySheet(
            copy = copy,
            onDismiss = { sheetCopy = null },
            onSaved = { scope.launch { CollectionStore.awaitSync() } },
        )
    }
}

// Ein Fachraster: `slots` ist immer genau so lang wie die Seite Faecher hat (BinderGrid.slots).
@Composable
private fun PocketGrid(
    slots: List<List<CopyRow>>,
    columns: Int,
    scroll: ScrollState,
    imageOf: (CopyRow) -> String?,
    nameOf: (CopyRow) -> String?,
    onOpen: (CopyRow) -> Unit,
    onActions: (Int) -> Unit,
    onFill: (Int) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(scroll),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        slots.chunked(columns).forEachIndexed { rowIndex, row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEachIndexed { colIndex, inSlot ->
                    val slot = rowIndex * columns + colIndex + 1
                    Pocket(
                        inSlot = inSlot, imageOf = imageOf, nameOf = nameOf,
                        onOpen = onOpen, onActions = { onActions(slot) }, onFill = { onFill(slot) },
                        modifier = Modifier.weight(1f),
                    )
                }
                // Letzte Reihe auffuellen, damit die Faecher darueber gleich breit bleiben.
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// Der Rahmen eines leeren Fachs in dp, nicht in Roh-Pixeln: als Pixel gelesen waeren aus 2f auf
// einem 3x-Schirm 0,67 dp geworden -- eine Haarlinie. Der Eckenradius ist derselbe, mit dem das
// BELEGTE Fach beschnitten wird (RoundedCornerShape(POCKET_CORNER) weiter unten), damit leere und
// volle Faecher dieselbe Form haben.
private val POCKET_CORNER = 6.dp
private val POCKET_STROKE = 1.5.dp
private val POCKET_DASH_ON = 6.dp
private val POCKET_DASH_OFF = 4.dp

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Pocket(
    inSlot: List<CopyRow>,
    imageOf: (CopyRow) -> String?,
    nameOf: (CopyRow) -> String?,
    onOpen: (CopyRow) -> Unit,
    onActions: () -> Unit,
    onFill: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val first = inSlot.firstOrNull()
    if (first == null) {
        // Das Strichmuster braucht Pixel und wird deshalb einmal je Schirmdichte umgerechnet;
        // Strichstaerke und Eckenradius rechnet der DrawScope selbst um (er IST eine Density).
        val density = LocalDensity.current
        val dashes = remember(density) {
            with(density) { PathEffect.dashPathEffect(floatArrayOf(POCKET_DASH_ON.toPx(), POCKET_DASH_OFF.toPx()), 0f) }
        }
        Box(
            modifier.aspectRatio(0.68f).clickable { onFill() }
                .drawBehind {
                    val r = POCKET_CORNER.toPx()
                    drawRoundRect(
                        color = Muted.copy(alpha = 0.5f),
                        style = Stroke(width = POCKET_STROKE.toPx(), pathEffect = dashes),
                        cornerRadius = CornerRadius(r, r),
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Inbox, "Leeres Fach füllen", tint = Muted.copy(alpha = 0.5f), modifier = Modifier.size(20.dp))
        }
        return
    }
    Box(
        modifier.aspectRatio(0.68f).clip(RoundedCornerShape(POCKET_CORNER))
            .combinedClickable(onClick = { onOpen(first) }, onLongClick = onActions),
    ) {
        AsyncImage(
            model = imageOf(first), contentDescription = nameOf(first) ?: first.cardId,
            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
        )
        if (inSlot.size > 1) {
            Text(
                "×${inSlot.size}", color = OnSurface, fontFamily = MonoFontFamily,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.align(Alignment.TopEnd)
                    .padding(3.dp).clip(CircleShape).background(SurfaceColor.copy(alpha = 0.9f))
                    .padding(horizontal = 5.dp, vertical = 2.dp),
            )
        }
    }
}

// Liste von Exemplaren mit Standort-Chip -- Box/Deckbox und die "Ohne Fach"-Reste eines Ordners.
@Composable
private fun CopyList(
    copies: List<CopyRow>,
    containers: List<ContainerRow>,
    nameOf: (CopyRow) -> String?,
    onOpen: (CopyRow) -> Unit,
    onLongPress: (CopyRow) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(copies, key = { it.copyId }) { copy ->
            CopyListRow(copy, containers, nameOf(copy), onOpen = { onOpen(copy) }, onLongPress = { onLongPress(copy) })
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CopyListRow(
    copy: CopyRow,
    containers: List<ContainerRow>,
    name: String?,
    onOpen: () -> Unit,
    onLongPress: () -> Unit,
) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth()
                .combinedClickable(onClick = onOpen, onLongClick = onLongPress)
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(name ?: copy.cardId, color = OnSurface, maxLines = 1, style = MaterialTheme.typography.bodyMedium)
                Text(
                    "${copy.setCode} · ${copy.rarity} · ${copy.condition}",
                    color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1,
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(
                CopyLocation.format(copy, containers.find { it.containerId == copy.containerId }),
                color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SlotActionSheet(
    page: Int,
    slot: Int,
    copies: List<CopyRow>,
    busy: Boolean,
    nameOf: (CopyRow) -> String?,
    onDismiss: () -> Unit,
    onMove: (CopyRow) -> Unit,
    onTakeOut: (CopyRow) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Seite $page · Fach $slot", style = MaterialTheme.typography.titleMedium, color = OnSurface, fontWeight = FontWeight.Bold)
            // Auch bei einem einzelnen Exemplar je Zeile aufgefuehrt: liegen zwei im selben Fach,
            // muss die Aktion sagen, welches gemeint ist -- ein Menue ohne Auswahl traefe eines
            // von beiden auf gut Glueck.
            copies.forEach { copy ->
                Column(Modifier.fillMaxWidth()) {
                    Text(nameOf(copy) ?: copy.cardId, color = OnSurface, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                    Text(
                        "${copy.setCode} · ${copy.rarity} · ${Valuation.EDITION_LABELS[copy.edition] ?: copy.edition} · ${copy.condition}",
                        color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { onMove(copy) }, enabled = !busy) { Text("Verschieben nach…") }
                        TextButton(onClick = { onTakeOut(copy) }, enabled = !busy) { Text("Aus Fach nehmen", color = ErrorColor) }
                    }
                }
            }
        }
    }
}

// Zwei Gruppen: die Exemplare DIESES Ordners ohne Fach zuerst (sie sind die naheliegenderen
// Kandidaten fuer diese Seite und der Rueckweg fuer alles, was "Aus Fach nehmen" abgelegt hat),
// darunter die Exemplare ohne Behaelter. Welche Zeile in welche Gruppe gehoert, rechnet
// BinderGrid.candidateGroups aus.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FillSlotSheet(
    page: Int,
    slot: Int,
    loose: List<CopyRow>,
    unsorted: List<CopyRow>,
    busy: Boolean,
    nameOf: (CopyRow) -> String?,
    onDismiss: () -> Unit,
    onPick: (CopyRow) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val shown = remember(loose, unsorted, query) { BinderGrid.candidateGroups(loose, unsorted, query, nameOf) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("In Seite $page · Fach $slot legen", style = MaterialTheme.typography.titleMedium, color = OnSurface, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                placeholder = { Text("Exemplare durchsuchen") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth(),
            )
            if (shown.isEmpty()) {
                Text(
                    if (loose.isEmpty() && unsorted.isEmpty()) "Es ist nichts übrig, das hier hinein könnte."
                    else "Kein Exemplar passt zur Suche.",
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                )
            } else {
                LazyColumn(
                    Modifier.fillMaxWidth().heightIn(max = 320.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (shown.inContainer.isNotEmpty()) {
                        item(key = "kopf-ordner") { CandidateHeader("In diesem Ordner, ohne Fach") }
                        items(shown.inContainer, key = { it.copyId }) { copy ->
                            CandidateRow(copy, nameOf(copy), busy) { onPick(copy) }
                        }
                    }
                    if (shown.unsorted.isNotEmpty()) {
                        item(key = "kopf-unsortiert") { CandidateHeader("Nicht einsortiert") }
                        items(shown.unsorted, key = { it.copyId }) { copy ->
                            CandidateRow(copy, nameOf(copy), busy) { onPick(copy) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CandidateHeader(text: String) {
    Text(
        text, color = Muted, style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
    )
}

@Composable
private fun CandidateRow(copy: CopyRow, name: String?, busy: Boolean, onPick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(enabled = !busy) { onPick() }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(name ?: copy.cardId, color = if (busy) Muted else OnSurface, maxLines = 1, style = MaterialTheme.typography.bodyMedium)
            Text(
                "${copy.setCode} · ${copy.rarity} · ${copy.condition}",
                color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}
