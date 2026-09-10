package com.example.yugiohscanner.ui

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.util.Size
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.ContainersRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Pick
import com.example.yugiohscanner.ml.PickCandidate
import com.example.yugiohscanner.ml.Placement
import com.example.yugiohscanner.ml.PendingWrite
import com.example.yugiohscanner.ml.SlotMath
import com.example.yugiohscanner.ml.SortSession
import com.example.yugiohscanner.ml.SortState
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Spec B2 §6: der Einsortier-Modus. Der Nutzer sitzt mit dem aufgeschlagenen Ordner und einem
 * Stapel Karten am Tisch; der Kopf sagt gross, in welches Fach die naechste Karte gehoert, er
 * steckt sie hinein und haelt sie vor die Kamera -- die Karte wird erkannt, dem Fach zugewiesen,
 * das Fach rueckt vor.
 *
 * Alle Rechnungen dahinter (Startvorschlag, Vorruecken, Rueckgaengig-Stapel, Warteschlange)
 * stehen in `ml/SortSession.kt` und sind in `SortSessionTest` geprueft. Diese Datei zeigt an und
 * ruft dort hinein; sie trifft KEINE eigene Entscheidung ueber Fachzahlen, Vorruecken oder das
 * Raeumen von Seite und Fach -- in Spec B1 hat die Oberflaeche zweimal eine Standortregel selbst
 * noch einmal getroffen, beide Male mit Datenverlust.
 *
 * Bindende Punkte des Nachtrags:
 * - **Immer lokal, kein Desktop-Spiegel** (§3): dieser Modus baut keinen Socket auf und benutzt
 *   `ScanCapture` nicht -- der wuerde bei verbundenem PC dorthin senden. Task 7 braucht fuer
 *   `Pick.NotOwned` das Handy-Staging und haengt sich dann an `ScanCapture` (siehe unten).
 * - **Dedup bleibt, wie sie ist:** `BoxTracker` meldet eine Karte einmal je Anwesenheit und
 *   vergisst sie, wenn sie aus dem Bild ist. Eine wiederkommende Karte ist ein neues Ereignis --
 *   genau richtig hier, wo zwei Exemplare derselben Karte nacheinander in zwei Faecher gehen.
 *   Es gibt bewusst KEINE zweite Merkliste (`ScanCapture.seen` wuerde das zweite Exemplar
 *   verschlucken).
 * - **Jede Zuweisung wird sofort geschrieben.** Scheitert das Netz, geht sie in die
 *   Warteschlange und der Modus laeuft weiter.
 *
 * Beim Verlassen wird die Warteschlange EINMAL nachgeschrieben; was dann noch offen ist, wird
 * verworfen -- aber nicht still: der Modus BLEIBT OFFEN, bis der Nutzer die Verlust-Meldung
 * weggetippt hat. Ein in dieser Komposition gesetzter Hinweis, der im selben Zug verlassen wird,
 * wuerde nie gezeichnet (in Task 5 genau so passiert). Erst das Wegtippen ruft [onDone].
 * Begruendung fuer das Verwerfen: eine verworfene Zuweisung ist NICHT der Verlust einer Karte --
 * das Exemplar bleibt in der Sammlung und liegt danach unter "Nicht einsortiert", das ist
 * wiederherstellbar. Ein Modus, der sich nicht verlassen laesst, ist es nicht. Der Nutzer MUSS es
 * aber erfahren, weil seine physische Ablage der Datenbank dann voraus ist.
 *
 * [onDone] bekommt die zuletzt bearbeitete Seite -- die Binder-Ansicht schlaegt dort auf (§6.6) --
 * oder `null`, wenn nichts einsortiert wurde (Abbruch im Start-Sheet, Ladefehler, kein Ordner).
 * `null` heisst ausdruecklich "kein Ergebnis": die Binder-Ansicht bleibt dann stehen, wo sie war,
 * statt auf eine Seite zu blaettern, die der Nutzer nie bearbeitet hat.
 */
@Composable
fun SortIntoBinderScreen(containerId: String, onDone: (Int?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    var container by remember { mutableStateOf<ContainerRow?>(null) }
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    // Der Sitzungszustand (Fach, Rueckgaengig-Stapel, Arbeitskopie der Exemplare) und die
    // Warteschlange. Beide leben nur im Speicher, sitzungsgebunden, ohne Persistenz (Spec §11).
    var state by remember { mutableStateOf<SortState?>(null) }
    var queue by remember { mutableStateOf<List<PendingWrite>>(emptyList()) }
    var running by remember { mutableStateOf(false) }   // false = Start-Sheet, true = Kamera

    // Die Schreibvorgaenge laufen alle auf dem Hauptthread, aber mit einer Unterbrechung am Netz.
    // Der Mutex haelt sie in der Reihenfolge, in der sie ausgeloest wurden: sonst koennte eine
    // Ruecknahme ihren Standort schreiben, BEVOR die zugehoerige Zuweisung ueberhaupt durch ist --
    // und die spaeter ankommende Zuweisung wuerde die Ruecknahme wieder ueberschreiben.
    val writeLock = remember { Mutex() }

    // Verlassen: Fortschritt beim Nachschreiben, danach ggf. die Verlust-Meldung.
    var flushing by remember { mutableStateOf(false) }
    var losses by remember { mutableStateOf<List<String>?>(null) }

    LaunchedEffect(containerId) {
        try {
            val gefunden = ContainersRepository.list().find { it.containerId == containerId }
                ?: throw RuntimeException("Behälter nicht gefunden.")
            val cd = CollectionRepository.loadCards()
            val cp = CollectionRepository.loadCopies()
            container = gefunden
            cards = cd
            state = SortSession.start(cp, containerId, gefunden.pocketsPerPage ?: 0)
            error = null
        } catch (e: Exception) {
            error = e.message ?: "Laden fehlgeschlagen"
        } finally {
            loading = false
        }
    }

    val pockets = container?.pocketsPerPage ?: 0   // 0 -> SlotMath.clampPockets zieht auf 4
    val cardsByKey = remember(cards) { cards.associateBy { it.printingKey() } }
    fun cardOf(c: CopyRow): CardRow? = cardsByKey[c.printingKey()]

    // Schreibt EINEN Warteschlangeneintrag. Erfolg -> raus aus der Schlange, sonst bleibt er drin.
    // Nur unter `writeLock` aufrufen.
    suspend fun writePending(pending: PendingWrite): Boolean {
        val p = pending.placement
        return try {
            if (pending.zurueck) {
                CollectionRepository.setCopyLocation(p.copyId, p.vorherContainerId, p.vorherPage, p.vorherSlot)
            } else {
                CollectionRepository.setCopyLocation(p.copyId, p.containerId, p.page, p.slot)
            }
            queue = SortSession.settled(queue, pending)
            true
        } catch (e: CancellationException) {
            // Ein Abbruch ist KEIN Netzfehler und darf nicht als "wird nachgeholt" durchgehen --
            // er beendet diese Coroutine, weiterreichen.
            throw e
        } catch (e: Exception) {
            // Die Meldung an den Nutzer nennt nur noch die Wirkung (die Ursache steht nicht fest).
            // Damit sie wenigstens IRGENDWO steht, geht sie hier ins Log: ein dauerhaft kaputter
            // Eintrag ("Behälter nicht gefunden") ist sonst im Nachhinein nicht von einem
            // Netzhaenger zu unterscheiden -- und genau er laesst nach der Abbruchregel von
            // flushQueue alle folgenden Eintraege verfallen.
            Log.w("SortMode", "Standort schreiben fehlgeschlagen: ${p.copyId}", e)
            false
        }
    }

    // Nachholen, was liegengeblieben ist -- ein Durchgang ueber den aktuellen Stand. Beim ersten
    // erneuten Fehlschlag wird abgebrochen: das Netz ist dann offensichtlich immer noch weg, und
    // jeder weitere Versuch haelt den Nutzer nur auf. Nur unter `writeLock` aufrufen.
    suspend fun flushQueue() {
        for (pending in queue.toList()) {
            if (!writePending(pending)) return
        }
    }

    // Der eine Schreibweg fuer Zuweisung UND Ruecknahme: sofort schreiben, bei Netzfehler in die
    // Warteschlange, Modus laeuft weiter. Nur unter `writeLock` aufrufen.
    //
    // Die Meldung geht mit einem EIGENEN launch hinaus: `showSnackbar` haelt an, bis der Schnipsel
    // wieder weg ist -- unter der Sperre wuerde damit jede weitere Karte sekundenlang auf ihren
    // Schreibvorgang warten, obwohl das Netz laengst wieder da sein koennte.
    suspend fun writeOrRemember(placement: Placement, zurueck: Boolean) {
        if (writePending(PendingWrite(placement, zurueck))) {
            flushQueue()
            return
        }
        queue = SortSession.enqueue(queue, placement, zurueck)
        val offen = queue.size
        scope.launch {
            // Nicht "Kein Netz": `writePending` faengt JEDE Ausnahme, und ein geloeschter
            // Behaelter sieht von hier aus genauso aus wie eine Zeitueberschreitung (derselbe
            // Vorbehalt wie Task 5, Minor 2). Der Satz nennt deshalb die Wirkung, nicht eine
            // geratene Ursache -- die Ursache steht ohnehin nicht fest.
            snackbar.showSnackbar(
                if (zurueck) "Rücknahme nicht gespeichert – wird nachgeholt ($offen)"
                else "Zuweisung nicht gespeichert – wird nachgeholt ($offen)"
            )
        }
    }

    // Eine erkannte Karte. Laeuft auf dem Analyzer-Thread herein und wird sofort auf den
    // Hauptthread gehoben -- alles darunter liest und schreibt `state`.
    fun onCard(passcode: String, setCodes: List<String>) {
        scope.launch {
            val s = state ?: return@launch
            if (!running) return@launch
            if (flushing || losses != null) {
                // Waehrend des Nachschreibens laeuft die Kamera weiter (das Overlay blitzt im
                // Normalfall gar nicht erst auf). Wer jetzt noch eine Karte vorhaelt, sieht sie
                // erkannt -- ohne diesen Schnipsel bekaeme er weder Zuweisung noch Hinweis, also
                // genau den stillen Fehlschlag, den §6 ausschliesst.
                snackbar.showSnackbar("Wird gerade beendet – Karte nicht zugewiesen")
                return@launch
            }
            val pick = PickCandidate.pick(
                s.copies, passcode, setCodes,
                Prefs.defaultEdition(context), Prefs.defaultCondition(context),
            )
            if (pick !is Pick.One) {
                // Task 7 baut die drei Sonderfaelle. Bis dahin darf hier NICHTS still passieren:
                // der Nutzer hat die Karte bereits ins Fach gesteckt. Das Fach rueckt nicht vor,
                // und er bekommt eine ehrliche Meldung statt einer falschen Zuweisung.
                val name = s.copies.firstOrNull { it.cardId == passcode }?.let { cardOf(it)?.name } ?: passcode
                snackbar.showSnackbar(
                    when (pick) {
                        is Pick.Many -> "$name: mehrere Exemplare zur Auswahl – kommt in Task 7"
                        Pick.AllPlaced -> "$name: alle Exemplare sind schon einsortiert – kommt in Task 7"
                        Pick.NotOwned -> "$name: nicht in der Sammlung – kommt in Task 7"
                        is Pick.One -> ""   // oben ausgeschlossen
                    }
                )
                return@launch
            }
            val (next, placement) = SortSession.assign(s, pick.copyId, containerId, pockets) ?: run {
                snackbar.showSnackbar("Exemplar nicht mehr vorhanden")
                return@launch
            }
            // Das Fach rueckt SOFORT vor, noch vor dem Schreiben -- der Nutzer steckt die naechste
            // Karte ein und darf nicht auf das Netz warten.
            state = next
            writeLock.withLock { writeOrRemember(placement, zurueck = false) }
        }
    }

    fun onUndo() {
        scope.launch {
            val s = state ?: return@launch
            // Derselbe Riegel wie in onCard und onFinish. Waehrend des Nachschreibens beim
            // Verlassen darf nichts mehr dazukommen: onFinish liest die Warteschlange EINMAL,
            // nachdem die Sperre wieder frei ist, und eine danach eintreffende Ruecknahme stuende
            // in keiner Verlust-Meldung -- sie waere still verschwunden.
            if (!running) return@launch
            if (flushing || losses != null) {
                snackbar.showSnackbar("Wird gerade beendet – Rücknahme nicht ausgeführt")
                return@launch
            }
            val (next, placement) = SortSession.undo(s) ?: run {
                snackbar.showSnackbar("Nichts zurückzunehmen")
                return@launch
            }
            // Fach und Standort springen SOFORT zurueck -- der Nutzer greift schon nach der Karte.
            state = next
            writeLock.withLock {
                // Erst hier, unter derselben Sperre wie das Schreiben: steht die urspruengliche
                // Zuweisung noch ungeschrieben in der Warteschlange, heben sich beide auf und es
                // muss gar nichts ans Netz. Frueher entschieden waere die Antwort ein Ratespiel --
                // die Zuweisung koennte in genau diesem Moment noch unterwegs sein.
                val (rest, mussSchreiben) = SortSession.cancelPending(queue, placement)
                queue = rest
                if (mussSchreiben) writeOrRemember(placement, zurueck = true)
            }
        }
    }

    // Fertig / Zurueck: EIN Durchgang durch die Warteschlange, dann entweder direkt hinaus oder --
    // wenn etwas offen blieb -- die Verlust-Meldung, die der Nutzer wegtippen MUSS.
    //
    // Es gibt hier bewusst KEINE Abkuerzung fuer die leere Warteschlange. Eine Zuweisung, die noch
    // unterwegs ist, steht NOCH NICHT in `queue` -- sie steht nirgends. Wer bei leerer Schlange
    // sofort hinausginge, verliesse die Komposition, `rememberCoroutineScope` braeche ihren Job ab,
    // und die haengende Zuweisung staerbe zwischen ihren beiden Netzwegen: die Karte liegt im
    // Ordner, hat keinen Standort, und es erscheint keine Verlust-Meldung. Das Warten am
    // `writeLock` ist die einzige Stelle, an der eine laufende Zuweisung noch in die Verlust-Liste
    // finden kann; `flushQueue` ist auf leerer Schlange ohnehin ein Nichts-Tun.
    fun onFinish() {
        if (flushing || losses != null) return
        flushing = true
        scope.launch {
            writeLock.withLock { flushQueue() }
            flushing = false
            val rest = SortSession.lossDescriptions(queue)
            if (rest.isEmpty()) onDone(SortSession.lastPage(state)) else losses = rest
        }
    }

    BackHandler(enabled = true) { onFinish() }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Box(Modifier.fillMaxSize()) {
            when {
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
                state == null || container == null -> LoadFailed(error) { onDone(null) }
                container?.kind != "binder" ->
                    // Nur Ordner haben Faecher. Dieselbe Unterscheidung, die die Binder-Ansicht
                    // schon trifft (dort steht der Einstieg im Ordner-Zweig) -- hier als Riegel,
                    // damit ein Fach, das der Nutzer physisch fuellt, nicht ins Leere zeigt.
                    // Ob page/slot geschrieben werden, entscheidet weiterhin allein
                    // CollectionRepository.setCopyLocation.
                    LoadFailed("Nur Ordner haben Fächer zum Einsortieren.") { onDone(null) }
                // Hinter der Verlust-Meldung braucht es keine Kamera mehr: der Analysefaden wuerde
                // sonst je Frame Detektor, Embedder und OCR durchlaufen, waehrend nichts davon noch
                // irgendwohin fuehren kann. Der ruhige Hintergrund schliesst das Fenster und spart
                // Akku; der Dialog selbst wird weiter unten gezeichnet.
                losses != null -> Box(Modifier.fillMaxSize())
                !running -> StartSheet(
                    binder = container!!.name,
                    page = state!!.page,
                    slot = state!!.slot,
                    pockets = pockets,
                    // Abbruch ist KEIN Ergebnis: die Binder-Ansicht soll dort stehenbleiben, wo der
                    // Nutzer sie verlassen hat, statt auf den blossen Startvorschlag zu blaettern.
                    onCancel = { onDone(null) },
                    onStart = { p, s ->
                        state = state!!.copy(page = p, slot = s)
                        running = true
                    },
                )
                else -> SortRunning(
                    binder = container!!.name,
                    state = state!!,
                    queueSize = queue.size,
                    cardOf = ::cardOf,
                    onCard = ::onCard,
                    onUndo = ::onUndo,
                    onFinish = ::onFinish,
                )
            }

            // Das Overlay haengt bewusst nicht an `flushing` allein: im Normalfall (nichts offen,
            // nichts unterwegs) ist das Nachschreiben in einem Wimpernschlag durch und ein Overlay
            // wuerde nur aufblitzen. GEWARTET wird trotzdem immer -- gezeigt wird es nur, wenn es
            // etwas zu warten gibt. `writeLock.isLocked` wird beim Wechsel von `flushing`
            // abgelesen; genau dann steht fest, ob eine Zuweisung noch unterwegs ist.
            if (flushing && (queue.isNotEmpty() || writeLock.isLocked)) {
                Box(
                    Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.7f))
                        // Ein blosser Hintergrund haelt in Compose KEINE Beruehrung auf -- die
                        // Knoepfe darunter blieben antippbar, obwohl der Schirm verdeckt aussieht.
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { },
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Primary)
                        Spacer(Modifier.height(12.dp))
                        Text(
                            if (queue.isEmpty()) "Zuweisung wird noch gespeichert…"
                            else "Offene Zuweisungen werden gespeichert… (${queue.size})",
                            color = OnSurface,
                        )
                    }
                }
            }

            SnackbarHost(
                hostState = snackbar,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 96.dp),
            )
        }
    }

    // Die Verlust-Meldung wird HIER gezeichnet, im Modus, den der Nutzer gerade verlaesst -- und
    // der bleibt so lange stehen, weil `onDone` erst der Knopf ausloest. Ein Hinweis, der in der
    // verlassenen Komposition gesetzt wird, verschwindet mit ihr, bevor er je auf dem Schirm war.
    losses?.let { list ->
        AlertDialog(
            onDismissRequest = { },   // nur ueber den Knopf -- das darf nicht weggewischt werden
            confirmButton = {
                TextButton(onClick = {
                    val letzteSeite = SortSession.lastPage(state)
                    losses = null
                    onDone(letzteSeite)
                }) { Text("Verstanden") }
            },
            title = { Text("${list.size} ${if (list.size == 1) "Zuweisung" else "Zuweisungen"} nicht gespeichert") },
            text = {
                Column {
                    Text("Diese Fächer konnten nicht gespeichert werden und gehen verloren:", color = OnSurface)
                    Spacer(Modifier.height(8.dp))
                    list.forEach { Text("• $it", color = ErrorColor, fontFamily = MonoFontFamily) }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Die Karten bleiben in der Sammlung, stehen aber wieder unter " +
                            "„Nicht einsortiert“ – im Ordner liegen sie schon.",
                        color = Muted, style = MaterialTheme.typography.bodySmall,
                    )
                }
            },
        )
    }
}

@Composable
private fun LoadFailed(message: String?, onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message ?: "Laden fehlgeschlagen", color = ErrorColor)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onBack) { Text("Zurück") }
    }
}

/** Spec §6.1: Vorschlag „erstes freies Fach", editierbar; Bestätigen öffnet die Kamera. */
@Composable
private fun StartSheet(
    binder: String,
    page: Int,
    slot: Int,
    pockets: Int,
    onCancel: () -> Unit,
    onStart: (Int, Int) -> Unit,
) {
    var pageText by remember(page) { mutableStateOf(page.toString()) }
    var slotText by remember(slot) { mutableStateOf(slot.toString()) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onCancel) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
            }
            Text(
                binder, color = OnSurface, maxLines = 1, fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleLarge,
            )
        }
        Spacer(Modifier.height(24.dp))
        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Wo soll es losgehen?", color = OnSurface, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Vorschlag: das erste freie Fach – ${SlotMath.clampPockets(pockets)} Fächer pro Seite.",
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = pageText,
                        onValueChange = { v -> pageText = v.filter { it.isDigit() }.take(4) },
                        label = { Text("Seite") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = slotText,
                        onValueChange = { v -> slotText = v.filter { it.isDigit() }.take(2) },
                        label = { Text("Fach") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        // Zurechtrueckung in SortSession.startAt, nicht hier -- eine leere Eingabe
                        // ist 0 und wird dort auf 1 gezogen, ein Fach jenseits der Seite auf das
                        // letzte, ein Vertipper jenseits von MAX_PAGE auf die letzte Seite. Die
                        // Fachzahl selbst kommt aus SlotMath.clampPockets. `take(4)` unten begrenzt
                        // nur die Zeichenzahl, es ist keine zweite Abschrift der Regel.
                        val (p, s) = SortSession.startAt(
                            pageText.toIntOrNull() ?: 0, slotText.toIntOrNull() ?: 0, pockets,
                        )
                        onStart(p, s)
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Einsortieren starten") }
            }
        }
    }
}

/**
 * Spec §6.2: die Kamera-Shell. Kopf gross „<Binder> · Seite p · Fach s", Fuss die zuletzt
 * eingelegte Karte mit Bild, Name und Fach sowie Rückgängig. Kein Staging-Zähler, kein
 * Prüfen-Knopf, kein Desktop-Spiegel.
 */
@Composable
private fun SortRunning(
    binder: String,
    state: SortState,
    queueSize: Int,
    cardOf: (CopyRow) -> CardRow?,
    onCard: (String, List<String>) -> Unit,
    onUndo: () -> Unit,
    onFinish: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        SortCamera(onCard = onCard, modifier = Modifier.fillMaxSize())

        Column(
            Modifier.fillMaxWidth().align(Alignment.TopCenter)
                .background(Color.Black.copy(alpha = 0.55f)).statusBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(binder, color = Color.White.copy(alpha = 0.75f), maxLines = 1,
                        style = MaterialTheme.typography.labelLarge)
                    Text(
                        "Seite ${state.page} · Fach ${state.slot}", color = Color.White,
                        fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.headlineMedium,
                    )
                }
                Button(onClick = onFinish) { Text("Fertig") }
            }
            if (queueSize > 0) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "$queueSize ${if (queueSize == 1) "Zuweisung" else "Zuweisungen"} noch nicht gespeichert",
                    color = ErrorColor, style = MaterialTheme.typography.labelSmall,
                )
            }
        }

        val letzte = state.placed.lastOrNull()
        Row(
            Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                .background(Color.Black.copy(alpha = 0.6f)).navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (letzte == null) {
                Text(
                    "Karte einlegen und vor die Kamera halten.", color = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                )
            } else {
                val copy = state.copies.firstOrNull { it.copyId == letzte.copyId }
                val card = copy?.let(cardOf)
                AsyncImage(
                    model = card?.imageUrl, contentDescription = null, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(width = 34.dp, height = 48.dp).clip(RoundedCornerShape(4.dp)),
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(card?.name ?: letzte.cardId, color = Color.White, maxLines = 1,
                        style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Seite ${letzte.page} · Fach ${letzte.slot}", color = Color.White.copy(alpha = 0.7f),
                        fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                    )
                }
                TextButton(onClick = onUndo) {
                    Icon(Icons.AutoMirrored.Filled.Undo, null, tint = Color.White)
                    Spacer(Modifier.width(4.dp))
                    Text("Rückgängig", color = Color.White)
                }
            }
        }
    }
}

/**
 * Die Kamera dieses Modus. Bewusst schmal: Vorschau, Erkennung, ein gruener Rahmen um jede
 * gesehene Karte. Kein Zoom, kein Fokus-Riegel, keine Handeingabe, kein Modusschalter -- der
 * Nutzer haelt hier Karte fuer Karte in immer derselben Haltung vor die Linse.
 *
 * Aufbau, Aufloesung und vor allem die REIHENFOLGE beim Abbau sind von `ScanScreen` uebernommen:
 * erst die Kamera abmelden, dann den Analysefaden leerlaufen lassen, erst dann die nativen
 * Sitzungen schliessen -- eine ONNX-Sitzung unter einer laufenden Inferenz zu schliessen ist ein
 * nicht abfangbarer nativer Absturz. Die beiden Kamera-Aufbauten sind damit Zwillinge; wer hier
 * etwas an dieser Reihenfolge aendert, aendert es dort mit. Sie zu EINEM gemeinsamen Baustein
 * zusammenzuziehen waere richtig, aber ein Umbau am wichtigsten Bildschirm der App ohne
 * Oberflaechentests -- deshalb hier bewusst nicht mitgemacht.
 *
 * [onCard] bekommt Passcode und die ABGESTIMMTEN Set-Code-Kandidaten (nicht die Rohtexte): genau
 * das, was `PickCandidate.pick` als `setCodes` erwartet.
 */
@Composable
private fun SortCamera(onCard: (String, List<String>) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { granted -> hasPermission = granted },
    )
    LaunchedEffect(Unit) { if (!hasPermission) launcher.launch(Manifest.permission.CAMERA) }

    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val pipeline = remember { com.example.yugiohscanner.ml.HybridPipeline(context, minSim = 0.6f) }
    // need = 4 wie im Scanner: mit weniger Stimmen ist die Set-Code-Abstimmung ein Losentscheid.
    val tracker = remember { com.example.yugiohscanner.ml.BoxTracker(need = 4) }
    val setEvidence = remember { com.example.yugiohscanner.ml.SetCodeEvidence() }

    var detections by remember { mutableStateOf<List<com.example.yugiohscanner.ml.Detection>>(emptyList()) }
    var frameW by remember { mutableIntStateOf(1) }
    var frameH by remember { mutableIntStateOf(1) }

    val onCardState = rememberUpdatedState(onCard)
    val analyzer = remember {
        com.example.yugiohscanner.ml.MlScanAnalyzer(pipeline) { dets, _, w, h, _ ->
            detections = dets
            frameW = w
            frameH = h
            for (d in dets) setEvidence.record(d.passcode, d.zoneTexts, d.legacyText)
            for (d in tracker.update(dets)) {
                if (d.passcode <= 0) continue
                onCardState.value(d.passcode.toString(), setEvidence.setCodeCandidates(d.passcode))
            }
            // Die Belege einer Karte abraeumen, sobald sie endgueltig aus dem Bild ist -- sonst
            // waechst die Map ueber einen langen Stapel unbegrenzt. Anders als im Scanner gibt es
            // hier keine stille Verbesserung, die die Historie danach noch braeuchte.
            for (gone in tracker.droppedThisFrame) setEvidence.forget(gone)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (cameraProviderFuture.isDone) {
                try { cameraProviderFuture.get().unbindAll() }
                catch (e: Exception) { Log.e("SortMode", "unbind failed", e) }
            }
            executor.shutdown()
            try { executor.awaitTermination(2, TimeUnit.SECONDS) }
            catch (e: InterruptedException) { Thread.currentThread().interrupt() }
            pipeline.close()
        }
    }

    if (!hasPermission) {
        Column(
            modifier.padding(32.dp), verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Kamera-Berechtigung nötig", style = MaterialTheme.typography.titleMedium, color = OnSurface)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Kamera erlauben") }
        }
        return
    }

    Box(modifier) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                previewView.layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
                )
                cameraProviderFuture.addListener({
                    val provider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                    // ~1080p wie im Scanner: auf 640x480 sind die Passcode-Ziffern zu klein fuer OCR.
                    val resolution = ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)
                        ).build()
                    val imageAnalyzer = ImageAnalysis.Builder()
                        .setResolutionSelector(resolution)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also { it.setAnalyzer(executor, analyzer) }
                    try {
                        provider.unbindAll()
                        provider.bindToLifecycle(
                            lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalyzer,
                        )
                    } catch (e: Exception) {
                        Log.e("SortMode", "Use case binding failed", e)
                    }
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
            modifier = Modifier.fillMaxSize(),
        )

        Canvas(Modifier.fillMaxSize()) {
            val dets = detections
            if (dets.isEmpty() || frameW <= 1) return@Canvas
            val sc = maxOf(size.width / frameW, size.height / frameH)
            val offX = (size.width - frameW * sc) / 2f
            val offY = (size.height - frameH * sc) / 2f
            for (d in dets) {
                // Dieselbe kosmetische Aufweitung des Bildausschnitts auf die Kartenkontur wie im
                // Scanner: das Artwork sitzt in der Kartenmitte.
                val bw = d.box.x2 - d.box.x1
                val bh = d.box.y2 - d.box.y1
                val l = (d.box.x1 - bw * 0.06f) * sc + offX
                val t = (d.box.y1 - bh * 0.35f) * sc + offY
                val r = (d.box.x2 + bw * 0.06f) * sc + offX
                val b = (d.box.y2 + bh * 0.75f) * sc + offY
                drawRect(
                    color = Color(0xFF00FF66), topLeft = Offset(l, t),
                    size = androidx.compose.ui.geometry.Size(r - l, b - t), style = Stroke(width = 4f),
                )
            }
        }
    }
}
