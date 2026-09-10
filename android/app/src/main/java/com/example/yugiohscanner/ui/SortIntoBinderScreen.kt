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
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Pick
import com.example.yugiohscanner.ml.PickCandidate
import com.example.yugiohscanner.ml.Placement
import com.example.yugiohscanner.ml.PendingWrite
import com.example.yugiohscanner.ml.Ruecknahme
import com.example.yugiohscanner.ml.Schritt
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
 * Spec §6.3, Task 7: die drei Faelle, in denen ein Scan NICHT von selbst in sein Fach faellt und
 * der Modus stehenbleibt, bis der Nutzer geantwortet hat. Eine offene Frage verriegelt den Modus
 * genauso wie das Beenden (siehe die Riegel in `onCard`/`onUndo`) -- die Kamera laeuft weiter,
 * aber das Fach rueckt nicht unter der Frage weg.
 *
 * `Neu` fuehrt den gelesenen Passcode mit, weil sie ihn zum Anlegen des Staging-Eintrags braucht;
 * die Belege ([evidence]/[frames]/[editionTexts]) sind die des Augenblicks, in dem die Karte
 * erkannt wurde -- `SetCodeEvidence` vergisst sie, sobald die Karte aus dem Bild ist, waehrend das
 * Blatt noch offen sein kann.
 */
private sealed interface Frage {
    /** `PickCandidate.Many` -- in der GELIEFERTEN Reihenfolge, hier wird nichts nachsortiert. */
    class Auswahl(val copies: List<CopyRow>) : Frage
    /** `PickCandidate.AllPlaced` -- alle Exemplare liegen schon irgendwo; das erste wird bewegt. */
    class Verschieben(val copies: List<CopyRow>) : Frage
    /** `PickCandidate.NotOwned` -- ins Staging mit Reservierung, das Fach rueckt trotzdem vor. */
    class Neu(
        val passcode: String, val evidence: List<String>,
        val frames: List<String>, val editionTexts: List<String>,
    ) : Frage
}

/**
 * Was der Nutzer vor dem Verlassen erfahren MUSS -- zwei Listen, weil es zwei verschiedene Dinge
 * sind und der erklaerende Satz unter der einen der anderen widerspraeche, stuenden sie zusammen:
 * - [zuweisungen]: Faecher, deren Standort nicht geschrieben werden konnte. Die Karte IST in der
 *   Sammlung, nur ohne Fach -- sie steht danach unter "Nicht einsortiert".
 * - [faecher]: Reservierungen ohne Staging-Eintrag (Fixrunde 1, Minor 6). Dort liegt physisch eine
 *   Karte, zu der es digital gar NICHTS gibt -- weggetippt oder nicht aufgeloest.
 */
private class Verluste(val zuweisungen: List<String>, val faecher: List<String>) {
    val leer: Boolean get() = zuweisungen.isEmpty() && faecher.isEmpty()
    val anzahl: Int get() = zuweisungen.size + faecher.size
}

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
 * - **Immer lokal, kein Desktop-Spiegel** (§3): dieser Modus baut keinen Socket auf. Fuer
 *   `Pick.NotOwned` braucht er das Handy-Staging und haelt dafuer seit Task 7 eine eigene
 *   `ScanCapture`; benutzt wird davon AUSSCHLIESSLICH `stageLocally` -- der lokale Weg, der
 *   weder `connected()` fragt noch `seen` anfasst (Begruendung dort). `onCapture`, `sendScan`
 *   und der Socket bleiben unberuehrt.
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SortIntoBinderScreen(containerId: String, onDone: (Int?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    var container by remember { mutableStateOf<ContainerRow?>(null) }
    // ALLE Behaelter, nicht nur der eigene: `CopyLocation.format` braucht zu einem fremden
    // Standort dessen Behaelterzeile, und genau die zeigen die Sheets aus Task 7 an.
    var containers by remember { mutableStateOf<List<ContainerRow>>(emptyList()) }
    var cards by remember { mutableStateOf<List<CardRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    // Task 7: die offene Frage (einer der drei Sonderfaelle) und das Pruefen-Blatt fuer die
    // Karten, die nicht in der Sammlung waren. Beide verriegeln den Modus, solange sie offen sind.
    var frage by remember { mutableStateOf<Frage?>(null) }
    var showStaging by remember { mutableStateOf(false) }
    // Was das Pruefen-Blatt tatsaechlich uebernommen hat -- POSITIV festgehalten (Fixrunde 1,
    // Important 1). Ein Eintrag verlaesst `capture.stagingCards` auf DREI Wegen: uebernommen, vom
    // Nutzer weggetippt, oder seine Aufloesung ist gescheitert (`ScanCapture.stageScan` entfernt
    // ihn dann selbst). Aus der blossen Abwesenheit auf "uebernommen" zu schliessen, meldete dem
    // Nutzer in zwei von drei Faellen etwas Falsches -- und liesse sein Fach verschwinden, obwohl
    // gar nichts in der Sammlung steht. Gemerkt werden die EINTRAEGE, verglichen wird mit `===`.
    val uebernommen = remember { mutableStateListOf<ScanStagingEntry>() }
    // Die dritte Moeglichkeit, die es seit der Abschluss-Fixwelle (Minor 4) getrennt gibt:
    // uebernommen, aber OHNE Fach -- `setCopyLocation` scheiterte. Die Karte steht in der Sammlung
    // (unter "Nicht einsortiert"), das reservierte Fach wurde nie geschrieben. Wer diese Eintraege
    // zu `uebernommen` zaehlt, meldet beim Rueckgaengig ein Fach, in dem digital nichts liegt, und
    // gibt es nie wieder frei. Wer sie gar nicht merkt, laesst `orphanedReservations` behaupten,
    // die Karte sei nicht in die Sammlung gekommen -- auch falsch. Also eine eigene Liste.
    val ohneStandort = remember { mutableStateListOf<ScanStagingEntry>() }
    // Zwei getrennte Zustaende, obwohl immer nur eines der Blaetter offen sein kann: ein geteilter
    // waere ein Zustand mit zwei Besitzern, und der Rest halb ausgeblendet.
    val frageSheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val stagingSheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Das Handy-Staging fuer `Pick.NotOwned`. Eigene Instanz, weil die Staging-Liste des Scanners
    // in dessen Komposition lebt und diesen Modus gar nicht erreicht -- es ist trotzdem dieselbe
    // Liste, derselbe Eintragstyp, derselbe Aufloeser und dasselbe Pruefen-Blatt (`ScanStagingSheet`
    // unten), kein Nachbau. `socket`/`connected`/`mode` werden nie gelesen: dieser Modus ruft
    // ausschliesslich `stageLocally`, das am Sendeweg vorbeigeht. Sie stehen trotzdem auf den
    // Werten, die auch dann noch richtig waeren, wenn jemand spaeter `onCapture` von hier riefe.
    // `flash` ist Pflichtfeld des Konstruktors; ein Aufblitzen zeichnet dieser Modus nicht.
    val flash = remember { Animatable(0f) }
    val capture = remember {
        ScanCapture(
            context, scope, snackbar, flash,
            socket = { null }, connected = { false }, mode = { "einzeln" },
        )
    }

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
    var losses by remember { mutableStateOf<Verluste?>(null) }

    LaunchedEffect(containerId) {
        try {
            val alle = ContainersRepository.list()
            val gefunden = alle.find { it.containerId == containerId }
                ?: throw RuntimeException("Behälter nicht gefunden.")
            val cd = CollectionRepository.loadCards()
            val cp = CollectionRepository.loadCopies()
            containers = alle
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

    // Der Standorttext eines Exemplars -- ueber `CopyLocation.format`, den Zwilling der
    // Desktop-Fassung, damit ein Standort auf beiden Geraeten gleich aussieht. Hier wird er
    // NICHT nachgebaut; ohne bekannten Behaelter liefert er selbst "—".
    fun ortOf(c: CopyRow): String = CopyLocation.format(c, containers.find { it.containerId == c.containerId })

    // Dieselbe Angabe, aber fuer eine Aufzaehlung, die "einsortiert" behauptet (Abschluss-
    // Fixwelle, Minor 5): `CopyLocation.format` nennt Seite und Fach nur, wenn BEIDE stehen --
    // fehlt eines, liegt das Exemplar zwar im Behaelter, aber in keinem Fach (etwa gerade "Aus
    // Fach genommen", das bewusst nur Seite und Fach raeumt). Dann sagt die Zeile das ausdruecklich,
    // statt den Behaelternamen wie einen Fachplatz aussehen zu lassen. Nur Text: welches Exemplar
    // `PickCandidate` waehlt, bleibt unveraendert.
    fun ortZeile(c: CopyRow): String =
        if (c.page != null && c.slot != null) ortOf(c) else "${ortOf(c)}, ohne Fach"

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

    // Der EINE Weg, auf dem ein Exemplar sein Fach bekommt -- fuer alle drei Wege, die dort
    // hinfuehren, derselbe: der einfache Fall (genau ein Kandidat), die Auswahl aus mehreren und
    // das Verschieben eines schon einsortierten Exemplars. Ueber den vorherigen Standort wird hier
    // nichts angenommen; `SortSession.assign` traegt ihn selbst ein, auch wenn er nicht leer ist.
    suspend fun zuweisen(s: SortState, copyId: String) {
        val (next, placement) = SortSession.assign(s, copyId, containerId, pockets) ?: run {
            snackbar.showSnackbar("Exemplar nicht mehr vorhanden")
            return
        }
        // Das Fach rueckt SOFORT vor, noch vor dem Schreiben -- der Nutzer steckt die naechste
        // Karte ein und darf nicht auf das Netz warten.
        state = next
        writeLock.withLock { writeOrRemember(placement, zurueck = false) }
    }

    // Eine erkannte Karte. Laeuft auf dem Analyzer-Thread herein und wird sofort auf den
    // Hauptthread gehoben -- alles darunter liest und schreibt `state`.
    //
    // [setCodes] sind die abgestimmten Set-Code-Kandidaten, die `PickCandidate` erwartet.
    // [frames] und [editionTexts] gehen NUR in den Staging-Fall (`Pick.NotOwned`) und sind genau
    // das, womit der Scanner eine Karte aufloest -- ohne sie wuerde derselbe Scan hier schlechter
    // aufgeloest als dort (siehe `SetCodeEvidence.rawTexts`).
    fun onCard(passcode: String, setCodes: List<String>, frames: List<String>, editionTexts: List<String>) {
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
            if (frage != null || showStaging) {
                // Ein offenes Blatt haelt die Kamera NICHT an. Ohne diesen Riegel liefe die
                // naechste Karte in genau das Fach, ueber dessen Karte der Nutzer gerade noch
                // entscheidet -- und seine Antwort traefe danach ein Fach, das inzwischen
                // weitergerueckt ist.
                snackbar.showSnackbar("Erst die offene Frage beantworten – Karte nicht zugewiesen")
                return@launch
            }
            when (val pick = PickCandidate.pick(
                s.copies, passcode, setCodes,
                Prefs.defaultEdition(context), Prefs.defaultCondition(context),
            )) {
                is Pick.One -> zuweisen(s, pick.copyId)
                // Die drei Sonderfaelle ruecken das Fach NICHT vor: der Nutzer hat die Karte zwar
                // schon eingesteckt, aber wohin sie digital gehoert, ist noch offen. Vorgerueckt
                // wird erst in der jeweiligen Antwort unten.
                is Pick.Many -> frage = Frage.Auswahl(SortSession.chosen(s.copies, pick.copyIds))
                Pick.AllPlaced -> frage = Frage.Verschieben(SortSession.placedCandidates(s.copies, passcode))
                // Belege des Augenblicks mitnehmen: `SetCodeEvidence` vergisst sie, sobald die
                // Karte aus dem Bild ist, das Blatt kann dann noch offen sein. Kandidaten ZUERST,
                // dann die Rohtexte je Frame -- dieselbe Reihenfolge wie im Scanner.
                Pick.NotOwned -> frage = Frage.Neu(passcode, setCodes + frames, frames, editionTexts)
            }
        }
    }

    // Die Antworten auf die drei Fragen. Das Blatt wird jeweils IM Hauptthread-Block geschlossen,
    // nicht davor: bis dahin bleibt der Riegel in `onCard` zu, und eine Karte, die der Nutzer
    // schon wieder vorhaelt, kann das Fach nicht vor der Antwort wegnehmen.
    fun antwortZuweisen(copyId: String) {
        scope.launch {
            frage = null
            zuweisen(state ?: return@launch, copyId)
        }
    }

    fun antwortNeu(f: Frage.Neu) {
        scope.launch {
            frage = null
            val s = state ?: return@launch
            // Reihenfolge: erst der Staging-Eintrag -- er traegt das Fach, in dem die Karte JETZT
            // liegt --, dann das Vorruecken. `SortSession.reserve` liest dasselbe `s`, Fach im
            // Eintrag und Fach im Schritt sind damit zwangslaeufig dasselbe.
            //
            // Geschrieben wird hier NICHTS, und das ist kein zweiter Schreibweg: die Karte ist noch
            // gar nicht in der Sammlung, es gibt kein Exemplar mit einem Standort. Ihr Fach setzt
            // spaeter das Uebernehmen im Pruefen-Blatt -- ueber `setCopyLocation`, denselben einen
            // Standort-Schreibweg wie ueberall sonst (Task 5).
            val eintrag = capture.stageLocally(
                f.passcode, f.evidence, f.frames, f.editionTexts,
                reservedContainer = containerId, reservedPage = s.page, reservedSlot = s.slot,
            )
            state = SortSession.reserve(s, pockets, eintrag).first
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
            if (frage != null || showStaging) {
                snackbar.showSnackbar("Erst die offene Frage beantworten – Rücknahme nicht ausgeführt")
                return@launch
            }
            // Sonderfall vor dem eigentlichen Rueckgaengig: der letzte Schritt war eine
            // Reservierung, deren Staging-Eintrag der Nutzer inzwischen uebernommen hat. Dann
            // gibt es nichts mehr zu entfernen -- die Karte sitzt bereits mit Standort in der
            // Sammlung --, und das Fach darf NICHT zurueckspringen, sonst bekaeme die naechste
            // Karte ein belegtes Fach. Der Schritt faellt trotzdem vom Stapel, sonst bliebe jedes
            // weitere Rueckgaengig an ihm haengen.
            //
            // Gefragt wird die POSITIVE Merkliste `uebernommen`, nicht die Abwesenheit aus
            // `capture.stagingCards` (Fixrunde 1, Important 1): fehlt der Eintrag, weil der Nutzer
            // ihn weggetippt hat oder weil seine Aufloesung gescheitert ist, steht NICHTS in der
            // Sammlung -- dann ist der normale Reservierungs-Undo darunter richtig, und das Fach
            // kommt zurueck. Seit der Abschluss-Fixwelle (Minor 4) traegt `uebernommen` ausserdem
            // NUR noch, was sein Fach auch bekommen hat: ein Eintrag, dessen `setCopyLocation`
            // scheiterte, faellt bewusst in den Undo darunter, denn sein Fach ist tatsaechlich
            // frei -- geschrieben wurde es nie.
            val letzter = s.schritte.lastOrNull()
            if (letzter is Schritt.Reserviert) {
                val eintrag = letzter.marke as? ScanStagingEntry
                if (eintrag != null && uebernommen.any { it === eintrag }) {
                    state = SortSession.dropStep(s)
                    snackbar.showSnackbar(
                        "Die neue Karte wurde schon übernommen – sie bleibt in " +
                            "Seite ${letzter.page} · Fach ${letzter.slot}",
                    )
                    return@launch
                }
            }
            val (next, ruecknahme) = SortSession.undo(s) ?: run {
                snackbar.showSnackbar("Nichts zurückzunehmen")
                return@launch
            }
            // Fach und Standort springen SOFORT zurueck -- der Nutzer greift schon nach der Karte.
            state = next
            when (ruecknahme) {
                is Ruecknahme.Zuweisung -> writeLock.withLock {
                    // Erst hier, unter derselben Sperre wie das Schreiben: steht die urspruengliche
                    // Zuweisung noch ungeschrieben in der Warteschlange, heben sich beide auf und
                    // es muss gar nichts ans Netz. Frueher entschieden waere die Antwort ein
                    // Ratespiel -- die Zuweisung koennte in genau diesem Moment noch unterwegs
                    // sein.
                    val placement = ruecknahme.placement
                    val (rest, mussSchreiben) = SortSession.cancelPending(queue, placement)
                    queue = rest
                    if (mussSchreiben) writeOrRemember(placement, zurueck = true)
                }
                is Ruecknahme.Reservierung -> {
                    // Nichts zu schreiben und nichts einzureihen: es gibt kein Exemplar. Der
                    // Staging-Eintrag verschwindet wieder -- ueber Identitaet, nicht ueber Fach
                    // oder Passcode: zwei Eintraege koennten denselben Passcode tragen.
                    val eintrag = ruecknahme.marke as? ScanStagingEntry
                    // Abschluss-Fixwelle, Minor 4: der dritte Fall, der hier ankommen kann -- der
                    // Eintrag wurde uebernommen, aber sein Fach konnte nicht geschrieben werden.
                    // Das Fach ist dann wirklich frei (es steht in keiner Zeile der Datenbank) und
                    // springt richtig zurueck; die Karte aber bleibt, und "wieder entfernt" waere
                    // fuer sie falsch.
                    val warOhneStandort = eintrag != null && ohneStandort.any { it === eintrag }
                    if (eintrag != null) capture.stagingCards.removeAll { it === eintrag }
                    // "Fach wieder frei" gilt in allen Faellen, die hier ankommen koennen: der
                    // Eintrag stand noch im Pruefen-Blatt (und ist jetzt weg), oder er war schon
                    // weggetippt bzw. nie aufgeloest -- dann gab es ohnehin nichts zu entfernen.
                    // Das Fach springt so oder so zurueck, und genau das will der Nutzer wissen.
                    snackbar.showSnackbar(
                        if (warOhneStandort)
                            "Die neue Karte bleibt in der Sammlung, hat aber kein Fach bekommen – " +
                                "Fach wieder frei"
                        else "Neue Karte wieder entfernt – Fach wieder frei",
                    )
                }
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
        val offen = capture.stagingCards.size
        if (offen > 0) {
            // Die Karten aus `Pick.NotOwned` sind noch NICHT in der Sammlung, und diese Liste lebt
            // nur so lange wie dieser Modus -- wer jetzt hinausginge, verloere sie samt ihrer
            // Faecher, still. Also nicht hinaus, sondern das Pruefen-Blatt auf: dort kann der
            // Nutzer sie uebernehmen oder einzeln entfernen. Danach fuehrt "Fertig" normal hinaus.
            showStaging = true
            // Und dazu ein Wort, warum (Fixrunde 1, Minor 5): bleibt ein Eintrag beim Uebernehmen
            // liegen -- weil er noch aufloest --, schliesst das Blatt ohne Hinweis, und der
            // naechste Druck auf "Fertig" oeffnet es kommentarlos wieder. Ohne diesen Satz sieht
            // das aus wie ein Knopf, der nichts tut; den Ausgang (das X der Zeile) faende von
            // allein niemand.
            scope.launch {
                snackbar.showSnackbar(
                    if (offen == 1) "1 neue Karte muss erst übernommen oder entfernt werden"
                    else "$offen neue Karten müssen erst übernommen oder entfernt werden",
                )
            }
            return
        }
        flushing = true
        scope.launch {
            writeLock.withLock { flushQueue() }
            flushing = false
            // Zwei verschiedene Verluste, zwei Listen (siehe `Verluste`). Die zweite kommt aus
            // `SortSession.orphanedReservations`: Reservierungen, deren Staging-Eintrag weder
            // uebernommen wurde noch noch im Blatt steht. `stagingCards` ist an dieser Stelle zwar
            // immer leer (sonst waere oben schon zurueckgekehrt worden), steht aber trotzdem mit
            // in den bekannten Marken -- die Rechnung soll nicht davon abhaengen, wer sie ruft.
            // `ohneStandort` steht mit in den bekannten Marken (Abschluss-Fixwelle, Minor 4): zu
            // diesen Reservierungen GIBT es eine Karte in der Sammlung, sie sind also nicht
            // verwaist. Dass ihr Fach fehlt, hat das Pruefen-Blatt bereits als Hinweis gezeigt,
            // den der Nutzer wegtippen musste -- der zweite Abschnitt der Verlust-Meldung ("liegt
            // eine Karte, die nicht in die Sammlung gekommen ist") waere fuer sie schlicht falsch.
            val v = Verluste(
                SortSession.lossDescriptions(queue),
                SortSession.orphanedReservations(state, capture.stagingCards + uebernommen + ohneStandort),
            )
            if (v.leer) onDone(SortSession.lastPage(state)) else losses = v
        }
    }

    // Zurueck schliesst zuerst ein offenes Blatt (das Blatt setzt seinen eigenen Handler davor,
    // dieser hier greift also nur, wenn es das nicht getan hat) und verlaesst erst dann den Modus.
    // Dieselbe Bedingung wie die Riegel in `onCard`/`onUndo`, und aus demselben Grund (Fixrunde 1,
    // Minor 3): bei offenem Pruefen-Blatt liefe Zurueck sonst in `onFinish()` -- nach einem
    // Teil-Uebernehmen mit stehengebliebenen Standort-Hinweisen ist `stagingCards` leer, der Modus
    // ginge samt ungelesenem Hinweis hinaus, genau der Verlust, den `onCommitted` verhindern soll.
    BackHandler(enabled = true) {
        if (frage != null) frage = null else if (showStaging) showStaging = false else onFinish()
    }

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
                    stagingSize = capture.stagingCards.size,
                    // Fixrunde 1, Minor 2: der Fuss darf nur dann "im Pruefen-Blatt" sagen, wenn
                    // der Eintrag auch wirklich noch darin steht. Ueber Identitaet, wie ueberall.
                    nochImStaging = { e -> capture.stagingCards.any { it === e } },
                    cardOf = ::cardOf,
                    onCard = ::onCard,
                    onUndo = ::onUndo,
                    onFinish = ::onFinish,
                    onPruefen = { showStaging = true },
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

    // Die drei Sheets aus §6.3. Sie stehen ausserhalb der `Surface` oben, weil ein
    // ModalBottomSheet ohnehin sein eigenes Fenster aufzieht -- wie die Verlust-Meldung darunter.
    val aktuell = state
    if (aktuell != null) when (val f = frage) {
        null -> Unit

        // Mehrere Kandidaten. Die Reihenfolge kommt von `PickCandidate` (Standard-Exemplare
        // zuerst) und wird hier NICHT nachsortiert -- `SortSession.chosen` hat sie beim Anlegen
        // der Frage genau so uebernommen.
        is Frage.Auswahl -> ModalBottomSheet(onDismissRequest = { frage = null }, sheetState = frageSheet) {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp).padding(bottom = 24.dp),
            ) {
                Text("Welches Exemplar?", color = OnSurface, style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(
                    "${f.copies.size} Exemplare von " +
                        "${f.copies.firstOrNull()?.let { cardOf(it)?.name } ?: "dieser Karte"} " +
                        "sind noch nicht einsortiert. Welches liegt jetzt in " +
                        "Seite ${aktuell.page} · Fach ${aktuell.slot}?",
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(12.dp))
                f.copies.forEach { c ->
                    KandidatZeile(copy = c, ort = ortOf(c)) { antwortZuweisen(c.copyId) }
                    Spacer(Modifier.height(8.dp))
                }
                TextButton(onClick = { frage = null }) { Text("Abbrechen") }
            }
        }

        // Alle Exemplare liegen schon irgendwo. Achtung beim Text: `PickCandidate` liefert diesen
        // Fall NUR, wenn KEIN Exemplar dieses Passcodes frei ist -- liegt vom gelesenen Printing
        // eines im Ordner und ein freies gehoert zu einem ANDEREN Printing, entscheidet es
        // bewusst `One` auf das fremde Printing (Lesefehler-Toleranz vor Printing-Genauigkeit).
        // Der Satz spricht deshalb von "dieser Karte", nicht von "diesem Druck".
        is Frage.Verschieben -> ModalBottomSheet(onDismissRequest = { frage = null }, sheetState = frageSheet) {
            val erstes = f.copies.firstOrNull()
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                // Ueberschrift und Aufzaehlung sagen "liegt schon irgendwo", nicht "einsortiert"
                // (Abschluss-Fixwelle, Minor 5): `PickCandidate` liefert diesen Fall, sobald KEIN
                // Exemplar mehr ohne Behaelter ist -- ein Exemplar, das gerade aus seinem Fach
                // genommen wurde, liegt weiterhin im Ordner und zaehlt mit, steckt aber in keinem
                // Fach. Welche das sind, sagt `ortZeile` je Zeile.
                Text("Alle Exemplare liegen schon irgendwo", color = OnSurface,
                    style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Kein Exemplar dieser Karte ist frei:",
                    color = OnSurface, style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(4.dp))
                f.copies.forEach { c ->
                    Text("• ${ortZeile(c)}", color = OnSurface,
                        style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    if (erstes == null) "Kein Exemplar mehr vorhanden."
                    else "Eines nach Seite ${aktuell.page} · Fach ${aktuell.slot} verschieben? " +
                        "Bewegt wird ${ortZeile(erstes)}.",
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { frage = null }) { Text("Abbrechen") }
                    Button(
                        onClick = { erstes?.let { antwortZuweisen(it.copyId) } },
                        enabled = erstes != null,
                    ) { Text("Hierher verschieben") }
                }
            }
        }

        // Nicht in der Sammlung: ins Staging mit der Fach-Reservierung, das Fach rueckt trotzdem
        // vor -- die Karte liegt physisch schon drin (Nachtrag §2).
        is Frage.Neu -> ModalBottomSheet(onDismissRequest = { frage = null }, sheetState = frageSheet) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                Text("Nicht in der Sammlung", color = OnSurface, style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Karte ${f.passcode} ist nicht in der Sammlung. Hinzufügen und einsortieren?",
                    color = OnSurface, style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Sie kommt ins Prüfen-Blatt, mit Seite ${aktuell.page} · Fach ${aktuell.slot} " +
                        "vorgemerkt. Das Fach bekommt sie beim Übernehmen.",
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { frage = null }) { Text("Abbrechen") }
                    Button(onClick = { antwortNeu(f) }) { Text("Hinzufügen") }
                }
            }
        }
    }

    // Das Pruefen-Blatt fuer die Karten aus `Pick.NotOwned` -- dasselbe `ScanStagingSheet` wie im
    // Scanner, nicht ein zweites daneben. Es schreibt beim Uebernehmen auch die Reservierung, ueber
    // `setCopyLocation` (Task 5).
    if (showStaging) {
        ModalBottomSheet(onDismissRequest = { showStaging = false }, sheetState = stagingSheet) {
            ScanStagingSheet(
                entries = capture.stagingCards,
                onCommitted = { committed, fehlenderStandort, hinweise ->
                    // Positiv festhalten, was tatsaechlich uebernommen wurde -- daran und an
                    // nichts anderem erkennt `onUndo`, dass ein reserviertes Fach besetzt bleiben
                    // muss, und `onFinish`, welche Reservierung verwaist ist (Fixrunde 1).
                    // In `uebernommen` steht seit der Abschluss-Fixwelle (Minor 4) nur noch, was
                    // sein Fach auch WIRKLICH bekommen hat; alles andere daneben.
                    uebernommen.addAll(committed)
                    ohneStandort.addAll(fehlenderStandort)
                    // `capture.forget(...)` bleibt ungerufen: dieser Modus fuellt `seen` nie
                    // (siehe `ScanCapture.stageLocally`) -- es gibt nichts zu vergessen, und ein
                    // zweites Exemplar derselben Karte muss hier weiterhin durchkommen.
                    // Offen bleiben, solange Standort-Hinweise anstehen (Task 5, Fixrunde 1):
                    // `error` lebt IN der Komposition des Blattes und wuerde sonst im selben
                    // Snapshot abgeraeumt, in dem er gesetzt wird.
                    if (hinweise.isEmpty()) showStaging = false
                },
            )
        }
    }

    // Die Verlust-Meldung wird HIER gezeichnet, im Modus, den der Nutzer gerade verlaesst -- und
    // der bleibt so lange stehen, weil `onDone` erst der Knopf ausloest. Ein Hinweis, der in der
    // verlassenen Komposition gesetzt wird, verschwindet mit ihr, bevor er je auf dem Schirm war.
    losses?.let { v ->
        AlertDialog(
            onDismissRequest = { },   // nur ueber den Knopf -- das darf nicht weggewischt werden
            confirmButton = {
                TextButton(onClick = {
                    val letzteSeite = SortSession.lastPage(state)
                    losses = null
                    onDone(letzteSeite)
                }) { Text("Verstanden") }
            },
            // "Fach" traegt beide Faelle: einmal fehlt der Datenbank das Fach zur Karte, einmal
            // fehlt dem Fach die Karte. Welches welches ist, sagen die Abschnitte darunter.
            title = { Text("${v.anzahl} ${if (v.anzahl == 1) "Fach" else "Fächer"} nicht gespeichert") },
            text = {
                Column {
                    if (v.zuweisungen.isNotEmpty()) {
                        Text("Diese Fächer konnten nicht gespeichert werden und gehen verloren:",
                            color = OnSurface)
                        Spacer(Modifier.height(8.dp))
                        v.zuweisungen.forEach {
                            Text("• $it", color = ErrorColor, fontFamily = MonoFontFamily)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Die Karten bleiben in der Sammlung, stehen aber wieder unter " +
                                "„Nicht einsortiert“ – im Ordner liegen sie schon.",
                            color = Muted, style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    // Der andere Verlust (Fixrunde 1, Minor 6): das Fach ist vorgerueckt, die Karte
                    // liegt darin, aber ihr Staging-Eintrag ist weg -- weggetippt oder nie
                    // aufgeloest. Freigeben laesst sich das Fach nicht, die Karte steckt physisch
                    // darin; nur der Nutzer kann das zusammenbringen, also muss er es erfahren.
                    if (v.faecher.isNotEmpty()) {
                        if (v.zuweisungen.isNotEmpty()) Spacer(Modifier.height(16.dp))
                        Text(
                            "In diesen Fächern liegt eine Karte, die nicht in die Sammlung " +
                                "gekommen ist:",
                            color = OnSurface,
                        )
                        Spacer(Modifier.height(8.dp))
                        v.faecher.forEach {
                            Text("• $it", color = ErrorColor, fontFamily = MonoFontFamily)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Sie wurde im Prüfen-Blatt entfernt oder konnte nicht aufgelöst " +
                                "werden. Nimm sie wieder heraus oder erfasse sie von Hand.",
                            color = Muted, style = MaterialTheme.typography.bodySmall,
                        )
                    }
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
 * Eine Zeile im Auswahl-Sheet (§6.3, mehrere Kandidaten). Zeigt, was zwei Exemplare derselben
 * Karte unterscheidet: Druck und Seltenheit, Edition und Zustand -- und den Standort, geschrieben
 * von [CopyLocation.format], dem Zwilling der Desktop-Fassung. Bei diesen Kandidaten ist das
 * regelmaessig „—": `PickCandidate` bietet nur nicht einsortierte Exemplare an, und genau das
 * sagt der Strich.
 */
@Composable
private fun KandidatZeile(copy: CopyRow, ort: String, onClick: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp)) {
            Text("${copy.setCode} · ${copy.rarity}", color = OnSurface, maxLines = 1,
                style = MaterialTheme.typography.bodyMedium)
            Text(
                "${Valuation.EDITION_LABELS[copy.edition] ?: copy.edition} · ${copy.condition} · $ort",
                color = Muted, fontFamily = MonoFontFamily,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

/**
 * Spec §6.2: die Kamera-Shell. Kopf gross „<Binder> · Seite p · Fach s", Fuss die zuletzt
 * eingelegte Karte mit Bild, Name und Fach sowie Rückgängig. Kein Desktop-Spiegel, und im
 * Normalfall auch kein Staging-Zähler und kein Prüfen-Knopf.
 *
 * Die eine Ausnahme kommt aus Task 7: Karten, die NICHT in der Sammlung sind, gehen ins
 * Handy-Staging, und das lebt nur so lange wie dieser Modus. Sobald dort etwas liegt, blendet der
 * Kopf Zähler und Prüfen-Knopf ein -- die Begründung steht im Rumpf, bei `stagingSize > 0`.
 */
@Composable
private fun SortRunning(
    binder: String,
    state: SortState,
    queueSize: Int,
    stagingSize: Int,
    nochImStaging: (ScanStagingEntry) -> Boolean,
    cardOf: (CopyRow) -> CardRow?,
    onCard: (String, List<String>, List<String>, List<String>) -> Unit,
    onUndo: () -> Unit,
    onFinish: () -> Unit,
    onPruefen: () -> Unit,
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
            // Nur wenn es sie gibt: der Modus hat weiterhin keinen Staging-Zaehler im Normalfall
            // (§6.2). Karten, die NICHT in der Sammlung sind, gehen aber ins Handy-Staging, und
            // das lebt nur so lange wie dieser Modus -- ohne diesen Zugang gaebe es keinen Weg,
            // sie zu uebernehmen, und "Fertig" verloere sie.
            if (stagingSize > 0) {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "$stagingSize ${if (stagingSize == 1) "neue Karte" else "neue Karten"} – " +
                            "vor dem Verlassen übernehmen",
                        color = Color.White.copy(alpha = 0.85f), modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelSmall,
                    )
                    TextButton(onClick = onPruefen) { Text("Prüfen ($stagingSize)", color = Color.White) }
                }
            }
        }

        val letzter = state.schritte.lastOrNull()
        Row(
            Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                .background(Color.Black.copy(alpha = 0.6f)).navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (letzter == null) {
                Text(
                    "Karte einlegen und vor die Kamera halten.", color = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                )
            } else {
                // Zwei Arten von Schritt, zwei Zeilen -- aber DERSELBE Rueckgaengig-Knopf: welcher
                // der beiden zurueckgedreht wird, entscheidet `SortSession.undo`, nicht dieser Fuss.
                val zugewiesen = letzter as? Schritt.Zugewiesen
                val copy = zugewiesen?.let { p -> state.copies.firstOrNull { it.copyId == p.placement.copyId } }
                val card = copy?.let(cardOf)
                // Bei einer Reservierung gibt es kein Exemplar -- der Name steht im Staging-Eintrag,
                // sobald er aufgeloest ist (`marke` ist genau dieser Eintrag, siehe Schritt.Reserviert).
                val neu = (letzter as? Schritt.Reserviert)?.marke as? ScanStagingEntry
                AsyncImage(
                    model = card?.imageUrl ?: neu?.base?.imageUrl, contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(width = 34.dp, height = 48.dp).clip(RoundedCornerShape(4.dp)),
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        card?.name ?: neu?.base?.name ?: zugewiesen?.placement?.cardId ?: neu?.passcode.orEmpty(),
                        color = Color.White, maxLines = 1, style = MaterialTheme.typography.bodyMedium,
                    )
                    // Der Zusatz haengt am Blatt, nicht bloss an der Schrittart (Fixrunde 1,
                    // Minor 2): hat der Nutzer den Eintrag inzwischen uebernommen oder weggetippt,
                    // oder ist seine Aufloesung gescheitert, wartet dort nichts mehr und der Satz
                    // waere schlicht falsch. Dann steht hier nur noch das Fach -- nach dem
                    // Uebernehmen ist das ohnehin die ganze Wahrheit, und die beiden anderen Faelle
                    // nennt die Verlust-Meldung beim Verlassen beim Namen.
                    Text(
                        "Seite ${letzter.page} · Fach ${letzter.slot}" +
                            if (neu != null && nochImStaging(neu)) " · neu, im Prüfen-Blatt" else "",
                        color = Color.White.copy(alpha = 0.7f),
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
 * das, was `PickCandidate.pick` als `setCodes` erwartet. Dazu -- seit Task 7 -- die Rohtexte je
 * Frame und die Editions-Zonentexte: die braucht NUR der Staging-Fall (`Pick.NotOwned`), und zwar
 * genau so, wie der Scanner sie an `ScanResolver` gibt. Ohne sie loeste derselbe Scan hier
 * schlechter auf als dort (siehe `SetCodeEvidence.rawTexts`).
 */
@Composable
private fun SortCamera(
    onCard: (String, List<String>, List<String>, List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
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
                onCardState.value(
                    d.passcode.toString(),
                    setEvidence.setCodeCandidates(d.passcode),
                    setEvidence.rawTexts(d.passcode),
                    setEvidence.editionTexts(d.passcode),
                )
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
