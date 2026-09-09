package com.example.yugiohscanner.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.util.Log
import android.util.Size
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.CenterFocusWeak
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.LooksOne
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern
import java.util.Locale
import com.example.yugiohscanner.ml.ScanConfidence

// Catalog rows (Task 9: catalog first, network as fallback) map onto the same CardRow/SetOption
// shapes the network path already produces, so downstream code (ScanStagingEntry, the staging
// sheet, SetCodeMatch) doesn't need to know which source resolved a scan. Mirrors the conventions
// CardSearchRepository.parseData uses for a fresh network hit: no exact printing chosen yet
// ("Unknown"), German-first name.
internal fun CatalogCard.toCardRow() = CardRow(
    id = id, setCode = "Unknown", language = "DE", name = nameDe, imageUrl = image,
    rarity = null, quantity = 0, price = null, type = type, desc = descDe,
    atk = atk, def = def, level = level, race = race, attribute = attribute,
)

internal fun CatalogPrinting.toSetOption() = SetOption(setCode = code, rarity = rarity, price = 0.0, language = lang ?: "EN", verified = verified)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(onClose: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE) }

    var isConnected by remember { mutableStateOf(false) }
    var socket by remember { mutableStateOf<Socket?>(null) }

    // Permission handling
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { granted -> hasCameraPermission = granted }
    )

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            launcher.launch(Manifest.permission.CAMERA)
        }
    }

    // Passcodes already captured this session (phone-staged OR sent to desktop). Dedup so panning
    // over a card captures it once and re-detections don't spam. Committed passcodes are dropped
    // again when a batch is taken over. Concurrent: the analyzer thread adds while the main thread
    // adds (manual entry) and removes.
    val seen = remember { ConcurrentHashMap.newKeySet<String>() }

    val connectSocket = { ip: String ->
        try {
            val newSocket = IO.socket("http://$ip:4000")
            newSocket.on(Socket.EVENT_CONNECT) {
                isConnected = true
                prefs.edit().putString("ip_address", ip).apply()
            }
            newSocket.on(Socket.EVENT_DISCONNECT) {
                isConnected = false
            }
            // Spec D4 §6.4: der PC hat diese Karten uebernommen oder verworfen -- sie duerfen
            // wieder gescannt werden. Laeuft auf dem Socket-Thread; `seen` ist ein
            // ConcurrentHashMap-Set und genau dafuer da.
            newSocket.on("staging_released") { args ->
                val obj = args.firstOrNull() as? JSONObject ?: return@on
                val arr = obj.optJSONArray("passcodes") ?: return@on
                for (i in 0 until arr.length()) seen.remove(arr.optString(i))
            }
            newSocket.connect()
            socket = newSocket
        } catch (e: Exception) {
            Toast.makeText(context, "Verbindung fehlgeschlagen: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    // Desktop is now OPTIONAL: auto-connect in the background if an IP is saved (so scans still
    // reach the desktop staging area when it's running), but never gate the camera on it.
    LaunchedEffect(Unit) {
        val savedIp = prefs.getString("ip_address", "") ?: ""
        if (savedIp.isNotBlank() && socket == null) connectSocket(savedIp)
    }

    if (!hasCameraPermission) {
        Column(
            Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Kamera-Berechtigung nötig", style = MaterialTheme.typography.titleMedium, color = OnSurface)
            Spacer(Modifier.height(8.dp))
            Text("Zum Scannen braucht die App Zugriff auf die Kamera.", color = Muted,
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Kamera erlauben") }
        }
        return
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }

    var lastScannedCode by remember { mutableStateOf<String?>(null) }
    var isFlashOn by remember { mutableStateOf(false) }
    // Spec D4 §6.3: Fortschrittsanzeige bei verbundenem PC. `sentCount` zaehlt gesendete Karten
    // seit Scannerstart und wird von der Freigabe NICHT verringert -- es ist eine Fortschritts-,
    // keine Bestandsanzeige. `lastLight` ist die Ampel des zuletzt gesendeten Scans.
    var sentCount by remember { mutableIntStateOf(0) }
    var lastLight by remember { mutableStateOf<ScanConfidence.Light?>(null) }
    var scanMode by remember { mutableStateOf(com.example.yugiohscanner.Prefs.scanMode(context)) }
    var isFocusLocked by remember { mutableStateOf(false) }
    var showManualEntry by remember { mutableStateOf(false) }
    var manualCode by remember { mutableStateOf("") }

    var cameraControl by remember { mutableStateOf<CameraControl?>(null) }
    var cameraInfo by remember { mutableStateOf<CameraInfo?>(null) }

    val triggerFeedback = remember { {} }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    // Full-screen "capture" flash — the screen blinks each time a card is recognised, so you can
    // just keep panning without watching the status text.
    val flash = remember { Animatable(0f) }

    // Phone-side scan staging — a scan always lands here; a connected desktop additionally gets a
    // mirror of the scan (see onConfirmed below).
    val stagingCards = remember { mutableStateListOf<ScanStagingEntry>() }
    var showSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Continuous scanning: each newly-seen card is captured automatically (screen blinks) — no
    // per-card Reset/Prüfen. `evidence` is this card's set-code candidates, voted per zone across
    // every frame it was visible (see SetCodeEvidence.setCodeCandidates / ZoneVote). The set code
    // is resolved from it by constrained matching against the card's known printings, not by
    // trusting a single clean OCR token.
    // Shared by autonomous ML detection (onConfirmed below) and manual passcode entry: stage the
    // card locally, then resolve its base data + set code, reporting failures via the snackbar
    // (the success path stays silent — the flash, sound and footer counter already report it).
    // [framesEvidence] is one entry per SEPARATE frame (see SetCodeMatch.best's own doc on why
    // that's not the same list as [evidence]) — defaults to [evidence] for callers (manual entry)
    // that have no real per-frame breakdown to offer.
    // [editionTexts] is Spec D3 Task 7's addition: one EDITION-zone-text entry per frame (see
    // SetCodeEvidence.editionTexts), for the traffic light's edition signal. Defaults to empty for
    // callers (manual entry) that never OCR a zone at all — ScanConfidence.fromEvidence then
    // reports `edition = unknown`, the honest answer for "never looked".
    fun stageScan(pc: String, evidence: List<String>, framesEvidence: List<String> = evidence, editionTexts: List<String> = emptyList()) {
        scope.launch { flash.snapTo(0.8f); flash.animateTo(0f, animationSpec = tween(300)) }
        val entry = ScanStagingEntry(System.nanoTime(), pc).apply {
            edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
            condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
        }
        stagingCards.add(entry)
        scope.launch {
            try {
                val r = ScanResolver.resolve(
                    pc, evidence, framesEvidence, editionTexts,
                    com.example.yugiohscanner.Prefs.defaultEdition(context),
                )
                if (r == null) {
                    stagingCards.remove(entry); seen.remove(pc)   // eine spaetere Wiederholung erlauben
                    snackbar.showSnackbar("Karte $pc nicht gefunden")
                    return@launch
                }
                entry.base = r.base
                entry.knownSets = r.knownSets
                // .codeMatch bleibt liegen, damit eine spaetere, besser belegte Aufnahme sich damit
                // vergleichen kann (D3 Task 6, SetCodeEvidence.shouldSilentlyImprove) -- gegen die
                // SetOption allein ginge das nicht, sie traegt weder Distanz noch Frameanzahl.
                entry.codeMatch = r.match
                entry.selectedSet = r.match.selected
                entry.confidence = r.confidence
                entry.edition = r.confidence.effectiveEdition
                entry.loading = false
            } catch (e: Exception) {
                entry.loading = false
                snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
            }
        }
    }

    // Spec D4 §4: ein WIEDERHOLTES Erkennen derselben Karte im Modus "stapel". Kein Netz, kein
    // Katalog -- `entry.knownSets` steht bereits, `SetCodeMatch.best` laeuft direkt dagegen.
    // Wohin gebucht wird, entscheidet ScanAggregator (rein und getestet); hier wird nur gebucht.
    fun aggregateRepeat(pc: String, evidence: List<String>, framesEvidence: List<String>, editionTexts: List<String>) {
        val entry = stagingCards.lastOrNull { it.passcode == pc } ?: run {
            // Review-Befund 2: der Eintrag kann fehlen, weil der Nutzer die ganze Karte im
            // Pruefen-Blatt geloescht hat -- ihr Passcode steht aber weiterhin in `seen`. Stiller
            // Ausstieg wuerde die Karte fuer den Rest der Sitzung kommentarlos unscannbar machen,
            // der schlechteste aller Ausgaenge. Stattdessen wie eine neue Erfassung behandeln.
            // (Nicht `onCapture` -- zwei lokale Funktionen koennen sich in Kotlin nicht gegenseitig
            // aufrufen, und `stageScan` steht bereits vor dieser Funktion.)
            // Fix M1: `editionTexts` wird durchgereicht statt durch `emptyList()` ersetzt -- sonst
            // loest dieser Rueckfall die Karte mit leerer Editions-Beleglage auf (edition =
            // unknown), waehrend derselbe Passcode ueber den `stageScan`-Zweig direkt daneben sie
            // mitbekommen haette.
            stageScan(pc, evidence, framesEvidence, editionTexts)
            return
        }
        // Anderes Aufblitzen als bei einer Neuaufnahme (die blitzt mit 0.8f), damit ein "+1"
        // im Sucher nicht wie eine neue Karte aussieht.
        scope.launch { flash.snapTo(0.45f); flash.animateTo(0f, animationSpec = tween(300)) }

        // Fix-Durchlauf 2, Restbefund: `SetCodeMatch.best` bleibt hier auf dem Analyzer-Hintergrund-
        // thread -- es liest nur `entry.knownSets`, das nach dem ersten Aufloesen nicht mehr
        // veraendert wird (siehe stageScan), und ist ein reiner Vergleich ueber eine kurze Liste
        // (kein Netz, keine Datenbank), verursacht auf dem Hauptthread also keine spuerbare
        // Blockade -- waere er aber trotzdem noetig gewesen.
        val match = SetCodeMatch.best(evidence, entry.knownSets, framesEvidence)
        val name = entry.base?.name ?: pc
        // Review-Befund 3: `entry.quantity++`/`--` und das ExtraPrinting-Aequivalent sind
        // Lesen-Aendern-Schreiben auf einem Feld, das der QtyStepper im Pruefen-Blatt (Hauptthread)
        // ebenfalls beschreibt -- diese Funktion selbst laeuft auf dem Analyzer-Hintergrundthread.
        // `scope` ist ein rememberCoroutineScope (Main); Buchung UND Ruecknahme laufen deshalb
        // beide hier drin, in Reihenfolge: erst buchen, dann die Snackbar mit der Folgemenge.
        scope.launch {
            // Fix-Durchlauf 2: der Eintrag kann inzwischen aus `stagingCards` verschwunden sein
            // (der Nutzer hat die ganze Karte im Pruefen-Blatt geloescht) -- dann darf gar nicht
            // erst gebucht werden. Dieselbe Identitaetspruefung wie bei der Ruecknahme unten.
            if (stagingCards.none { it === entry }) return@launch
            // Fix-Durchlauf 2 (Restfenster aus Fix-Durchlauf 1): `ScanAggregator.target(...)` --
            // und die von ihm gelesenen `entry.selectedSet`/`entry.extraPrintings` -- werden ERST
            // HIER ermittelt, im selben Hauptthread-Block wie die Benutzung direkt darunter, statt
            // vorher auf dem Analyzer-Hintergrundthread. Zwischen einer vorherigen Berechnung und
            // dieser Benutzung liegt ein Dispatch-Wechsel; in genau diesem Fenster kann das
            // Pruefen-Blatt eine Zusatzzeile oder die ganze Karte loeschen (es haelt weder Kamera
            // noch Analyzer an) und der Index von `target` traefe dann daneben. Kein Index
            // ueberlebt einen Threadwechsel -- dieselbe Regel wie Review-Befund 1, nur mit kuerzerem
            // Fenster.
            val target = ScanAggregator.target(
                primary = entry.selectedSet,
                extras = entry.extraPrintings.map { it.selectedSet },
                scanned = match.selected,
            )
            // Review-Befund 1: das Ziel wird HIER, sofort beim Buchen, zum OBJEKT aufgeloest, nicht
            // zum Index -- der Index kann zwischen Buchen und Rueckgaengig veralten (das
            // Pruefen-Blatt kann waehrenddessen eine Zusatzzeile oder die ganze Karte loeschen; das
            // Sheet haelt weder Kamera noch Analyzer an). `bookedExtra` haelt das getroffene bzw.
            // neu angelegte ExtraPrinting-Objekt fest; die Ruecknahme unten prueft per Identitaet
            // (===), ob es das noch gibt, statt es erneut zu indizieren.
            var bookedExtra: ExtraPrinting? = null
            var isNewExtra = false
            val menge = when (target) {
                is ScanAggregator.Target.Primary -> {
                    entry.quantity++
                    entry.quantity
                }
                is ScanAggregator.Target.Extra -> {
                    val ep = entry.extraPrintings[target.index]
                    ep.quantity++
                    bookedExtra = ep
                    ep.quantity
                }
                is ScanAggregator.Target.NewExtra -> {
                    val ep = ExtraPrinting().apply {
                        selectedSet = target.set
                        edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
                        condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
                    }
                    entry.extraPrintings.add(ep)
                    bookedExtra = ep
                    isNewExtra = true
                    1
                }
            }
            val r = snackbar.showSnackbar(
                message = "$name ×$menge", actionLabel = "rückgängig",
                duration = SnackbarDuration.Short,
            )
            if (r != SnackbarResult.ActionPerformed) return@launch
            when (target) {
                is ScanAggregator.Target.Primary ->
                    // `entry` selbst kann der Nutzer inzwischen aus der Liste geloescht haben.
                    if (stagingCards.any { it === entry }) entry.quantity--
                is ScanAggregator.Target.Extra, is ScanAggregator.Target.NewExtra -> {
                    val ep = bookedExtra ?: return@launch
                    // Ist die Zeile weg, hat der Nutzer sie selbst geloescht: Ruecknahme tut dann
                    // nichts und wirft nicht.
                    if (entry.extraPrintings.any { it === ep }) {
                        if (isNewExtra) entry.extraPrintings.remove(ep) else ep.quantity--
                    }
                }
            }
        }
    }

    // Spec D4 §6: fuehrt der PC das Staging, legt das Handy KEINEN Eintrag an -- es loest auf und
    // sendet. Erste Sichtung wie Wiederholung gehen denselben Weg; zusammengefasst wird am PC (§5).
    //
    // [isRepeat] dient nur der Rueckmeldung (§7) und dem Rueckfall, wenn die Verbindung waehrend
    // der Aufloesung wegbricht -- es geht selbst NICHT auf die Leitung. Der aktuelle `scanMode`
    // dagegen schon (siehe `sendScanToDesktop`, Spec-Fix I2): die urspruengliche Annahme, im Modus
    // "einzeln" koenne beim PC nie eine Wiederholung ankommen, war falsch -- `seen` unten haelt
    // eine Wiederholung nur ab, solange DIESER Scanner offen bleibt; ein Schliessen/Wiederoeffnen
    // loescht `seen`, waehrend die Staging-Liste des PCs bestehen bleibt. Der PC muss deshalb
    // selbst wissen, ob er zusammenfassen darf.
    //
    // Diese Funktion muss VOR `onCapture` und NACH `stageScan`/`aggregateRepeat` stehen: lokale
    // Funktionen in Kotlin sehen nur, was vor ihnen deklariert ist, und `onCapture` ruft diese
    // hier auf. Deshalb faellt der Verbindungsabbruch unten direkt auf die beiden anderen zurueck
    // statt ueber `onCapture` zu gehen -- das waere ein gegenseitiger Aufruf und damit unmoeglich.
    fun sendScan(
        pc: String, evidence: List<String>, framesEvidence: List<String>,
        editionTexts: List<String>, isRepeat: Boolean,
    ) {
        scope.launch {
            flash.snapTo(if (isRepeat) 0.45f else 0.8f)
            flash.animateTo(0f, animationSpec = tween(300))
        }
        scope.launch {
            try {
                val r = ScanResolver.resolve(
                    pc, evidence, framesEvidence, editionTexts,
                    com.example.yugiohscanner.Prefs.defaultEdition(context),
                )
                if (r == null) {
                    seen.remove(pc)   // eine spaetere Wiederholung erlauben
                    snackbar.showSnackbar("Karte $pc nicht gefunden")
                    return@launch
                }
                val s = socket
                if (s == null || !isConnected) {
                    // Die Verbindung ist waehrend der Aufloesung weggebrochen. Die Karte darf
                    // nicht verschwinden: sie kommt ins Handy-Staging, wohin sie ohne PC gehoert.
                    // Eine Wiederholung wird nur dann gebucht, wenn es ueberhaupt einen Eintrag
                    // gibt -- die frueheren Kopien liegen ja beim PC. Sonst wird sie ein eigener
                    // Eintrag, damit diese eine Karte nicht still verlorengeht.
                    if (isRepeat && stagingCards.any { it.passcode == pc }) {
                        aggregateRepeat(pc, evidence, framesEvidence, editionTexts)
                    } else {
                        stageScan(pc, evidence, framesEvidence, editionTexts)
                    }
                    return@launch
                }
                sendScanToDesktop(s, pc, r, scanMode)
                sentCount++
                lastLight = r.confidence.light
                if (isRepeat) {
                    // §7: bei verbundenem PC ist die Meldung NUR informativ -- kein Knopf.
                    // Korrigiert wird am PC, wo der Eintrag mit seinen +/--Knoepfen sichtbar in
                    // der Liste steht. Die neue Menge steht bewusst NICHT hier: sie zaehlt am PC,
                    // das Handy kennt sie nicht und darf sie nicht erfinden.
                    snackbar.showSnackbar("${r.base.name} nochmal an den PC")
                }
            } catch (e: Exception) {
                seen.remove(pc)
                snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
            }
        }
    }

    // Der einzige Einstieg fuer eine erfasste Karte -- autonome Erkennung wie manuelle Eingabe.
    // Spec D4 §3: im Modus "einzeln" faengt `seen` jede Wiederholung ab (heutiges Verhalten);
    // im Modus "stapel" wird sie zusammengefasst.
    fun onCapture(pc: String, evidence: List<String>, frames: List<String>, editionTexts: List<String>) {
        val isRepeat = !seen.add(pc)
        if (isRepeat && scanMode != "stapel") return
        if (isConnected) {
            // §6: kein Handy-Staging. Erste Sichtung wie gewollte Wiederholung gehen an den PC,
            // der sie nach derselben Regel zusammenfasst (§5). `scanMode` reist als eigenes Feld
            // mit (siehe `sendScanToDesktop`, Spec-Fix I2) -- der PC braucht es, um im Modus
            // "einzeln" eine Wiederholung zu verwerfen statt sie zu buchen.
            sendScan(pc, evidence, frames, editionTexts, isRepeat)
        } else if (isRepeat) {
            aggregateRepeat(pc, evidence, frames, editionTexts)
        } else {
            stageScan(pc, evidence, frames, editionTexts)
        }
    }

    // [frames] is [evidence]'s per-frame breakdown (see stageScan's own doc) — a separate
    // parameter rather than re-deriving it from [evidence], since the two callers below don't
    // always have the same list to offer for both. [editionTexts] is stageScan's own new
    // parameter (Task 7), threaded through the same way.
    val onConfirmed = rememberUpdatedState<(Int, List<String>, List<String>, List<String>) -> Unit> { passcode, evidence, frames, editionTexts ->
        if (passcode > 0) onCapture(passcode.toString(), evidence, frames, editionTexts)
    }

    // Detection handlers wrapped in rememberUpdatedState so the single remembered analyzer
    // always runs the latest logic without being recreated on every recomposition.
    // (Legacy) socket flow, used by manual entry: push passcode (+ set code) to the desktop.
    val onDetected = rememberUpdatedState<(String, List<String>) -> Unit> { code, setCodes ->
        if (code != lastScannedCode) {
            lastScannedCode = code
            triggerFeedback()
            if (!isConnected) {
                // Nothing to receive the scan.
            } else {
                val best = setCodes.firstOrNull()
                val data = JSONObject()
                data.put("passcode", code)
                if (best != null) {
                    data.put("setCode", best)
                    data.put("setCodeCandidates", JSONArray(setCodes))
                }
                socket?.emit("card_scanned", data)
            }
        }
    }
    val onProgress = rememberUpdatedState<(String, Int, Int) -> Unit> { code, hits, required ->
        if (code != lastScannedCode) {
        }
    }

    // Owned once and disposed explicitly (see below) to avoid leaking a thread and the ML Kit
    // recognizer every time the camera use-cases rebind.
    val executor = remember { Executors.newSingleThreadExecutor() }
    val analyzer = remember {
        CardAnalyzer(
            // Reliable identification by passcode OCR → autonomous phone staging (onConfirmed).
            onResultDetected = { code, setCodes -> onConfirmed.value(code.toIntOrNull() ?: -1, setCodes, setCodes, emptyList()) },
            onProgress = { code, hits, required -> onProgress.value(code, hits, required) }
        )
    }

    // Phase-4: on-device recognition pipeline + live overlay state.
    // Identification is by ARTWORK embedding: each detector crop -> pad-to-square 224 -> embedder
    // -> nearest-neighbour over the on-device index (production model, TOP-1 ~0.998).
    val pipeline = remember { com.example.yugiohscanner.ml.HybridPipeline(context, minSim = 0.6f) }
    // need = 4, nicht 2. Der Tracker bestimmt zugleich, wie viele Stimmen die
    // Set-Code-Abstimmung ueberhaupt zu sehen bekommt: bei Bestaetigung loest
    // SetCodeEvidence.setCodeCandidates auf und forget() loescht die Belege. Mit need = 2 stimmte
    // Task 10 also ueber ZWEI Lesungen ab, und eine Mehrheit aus zwei ist ein Losentscheid, den
    // die Einfuegereihenfolge bricht. Der Beleg fuer Task 10 (eine 29-Stimmen-Mehrheit ueber eine
    // Fehllesung) stammt aus dem Nachspielen einer dichten Aufnahme und konnte auf dem Geraet gar
    // nicht vorkommen.
    //
    // Der Preis ist zwei Frames mehr bis zur Bestaetigung, bei ~10 Bildern/s also rund 0,2 s --
    // und Stimmen ueberleben kurze Aussetzer, weil votes erst nach maxMisses = 8 fehlenden Frames
    // verfallen. Eine Karte, die nur zwei Frames lang sichtbar ist, wird dafuer nicht mehr
    // erfasst; das ist die bewusst eingegangene Seite des Tauschs.
    //
    // NICHT vom Messkorb belegt: ml/ocr_bench.py bewertet Einzelbilder und kennt keinen Tracker.
    // Das ist eine begruendete Abwaegung, keine Messung.
    val tracker = remember { com.example.yugiohscanner.ml.BoxTracker(need = 4) }
    // Pools each card's bottom-band OCR text across frames so the set code is voted, not read once.
    val setEvidence = remember { com.example.yugiohscanner.ml.SetCodeEvidence() }
    var mlDetections by remember { mutableStateOf<List<com.example.yugiohscanner.ml.Detection>>(emptyList()) }
    var mlFrameW by remember { mutableStateOf(1) }
    var mlFrameH by remember { mutableStateOf(1) }
    val mlAnalyzer = remember {
        com.example.yugiohscanner.ml.MlScanAnalyzer(pipeline) { dets, _, w, h, ms ->
            mlDetections = dets
            mlFrameW = w
            mlFrameH = h
            // Pool each visible card's bottom-band OCR text (set-code voting across frames).
            for (d in dets) setEvidence.record(d.passcode, d.zoneTexts, d.legacyText)
            // On confirmation, resolve the set code from ALL pooled evidence for that card, then
            // emit passcode + evidence downstream (constrained matching happens in onConfirmed).
            for (d in tracker.update(dets)) {
                Log.i("MlScan", "confirmed card ${d.passcode}")
                // Voted candidates FIRST, then every frame's raw text. SetCodeMatch scores by
                // edit distance over both, so a grammar-clean winner still matches at 0 — but a
                // reading the grammar rejects (lost hyphen, line break, region digit) is no longer
                // silently dropped before the matcher that exists to handle it. See
                // SetCodeEvidence.rawTexts.
                val frames = setEvidence.rawTexts(d.passcode)
                // Task 7's own addition: the EDITION zone's per-frame text, recorded by the same
                // setEvidence.record() call above -- see SetCodeEvidence.editionTexts.
                onConfirmed.value(
                    d.passcode, setEvidence.setCodeCandidates(d.passcode) + frames, frames,
                    setEvidence.editionTexts(d.passcode),
                )
                // NO setEvidence.forget() here (Spec D3 Task 6, "Stille Verbesserung"): the card
                // usually stays visible after its first confirmation, and BoxTracker.update only
                // ever returns it ONCE per presence (see BoxTracker's own doc) — so this is the
                // only chance to seed setCodeCandidates/rawTexts, but NOT the last chance to
                // improve on them. The silent-improvement loop below keeps resolving from whatever
                // record() adds on every later frame, for as long as the card stays in `dets`.
            }
            // Belege einer Karte abraeumen, sobald sie endgueltig aus dem Bild ist. Seit Task 6
            // wird bei der Bestaetigung bewusst NICHT mehr vergessen -- die stille Verbesserung
            // braucht die Historie. Ohne diesen Abgang waechst die Map dann ueber eine lange
            // Sitzung unbegrenzt, und der Speed-Scan aus D4 schiebt Hunderte Karten durch eine
            // einzige. BoxTracker ist die einzige Stelle, die "weg" von "kurz verdeckt"
            // unterscheiden kann: es meldet erst nach maxMisses Frames ohne Sichtung.
            for (gone in tracker.droppedThisFrame) setEvidence.forget(gone)

            // Silent improvement (Spec D3 Task 6, plan Section 6.2): a card already staged
            // (`seen`) but still visible gets its set code re-resolved from ALL evidence gathered
            // so far on every frame — a later, cleaner frame can genuinely beat the one(s) that won
            // the first resolve. `shouldSilentlyImprove` also enforces the one thing this must
            // never do: overwrite a set/rarity/language/edition the user already corrected by hand
            // (`entry.userTouched`).
            for (d in dets) {
                if (d.passcode <= 0) continue
                val pc = d.passcode.toString()
                if (pc !in seen) continue
                val entry = stagingCards.find { it.passcode == pc } ?: continue
                if (entry.loading) continue // still resolving its first hit — nothing to compare yet
                val frames = setEvidence.rawTexts(d.passcode)
                val result = SetCodeMatch.best(
                    setEvidence.setCodeCandidates(d.passcode) + frames, entry.knownSets, frames,
                )
                if (com.example.yugiohscanner.ml.SetCodeEvidence.shouldSilentlyImprove(entry.userTouched, result, entry.codeMatch)) {
                    entry.codeMatch = result
                    entry.selectedSet = result.selected
                    // Task 7: the traffic light must move in lockstep with .codeMatch/.selectedSet
                    // above, or the dot+reason shown in the staging sheet would go stale against
                    // the very selection it's supposed to describe -- exactly the "second opinion"
                    // this task's brief warns against. Guarded by the same shouldSilentlyImprove
                    // (userTouched already false here, same as .selectedSet's own lack of a
                    // separate guard above), so a deliberate user correction still freezes both.
                    val confidence = com.example.yugiohscanner.ml.ScanConfidence.fromEvidence(
                        result, entry.knownSets, setEvidence.editionTexts(d.passcode),
                        com.example.yugiohscanner.Prefs.defaultEdition(context),
                    )
                    entry.confidence = confidence
                    entry.edition = confidence.effectiveEdition
                    logScanDecision("verbessert", d.passcode.toString(), result, confidence, entry.knownSets)
                }
            }
            if (dets.isNotEmpty()) {
                val top = dets.maxByOrNull { it.sim }
                Log.i("MlScan", "frame: ${dets.size} cards in ${ms}ms top=" +
                    (top?.let { String.format("%d@%.2f", it.passcode, it.sim) } ?: "-"))
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            // Order matters. Stop new frames FIRST (unbind the camera), then drain the analysis
            // thread, and only THEN free native resources. pipeline.close()/analyzer.close() free
            // the ONNX detector+embedder sessions and the ML Kit recognizer; a frame may still be
            // mid-inference on `executor` (MlScanAnalyzer runs pipeline.process() synchronously).
            // Closing a native session underneath a running inference is an UNCATCHABLE native
            // crash — the one seen when leaving the scanner while a card is highlighted.
            if (cameraProviderFuture.isDone) {
                try {
                    cameraProviderFuture.get().unbindAll()
                } catch (e: Exception) {
                    Log.e("Scanner", "Error unbinding camera on dispose", e)
                }
            }
            executor.shutdown()
            try {
                executor.awaitTermination(2, TimeUnit.SECONDS)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            analyzer.close()
            pipeline.close()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                previewView.layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )

                // Zoom Logic
                val scaleGestureDetector = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    override fun onScale(detector: ScaleGestureDetector): Boolean {
                        cameraControl?.let { control ->
                             val currentZoomRatio = cameraInfo?.zoomState?.value?.zoomRatio ?: 1f
                             val delta = detector.scaleFactor
                             control.setZoomRatio(currentZoomRatio * delta)
                        }
                        return true
                    }
                })

                // Tap-to-Focus Logic
                val gestureDetector = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
                    override fun onSingleTapUp(e: MotionEvent): Boolean {
                        val meteringPoint = previewView.meteringPointFactory.createPoint(e.x, e.y)
                        val action = FocusMeteringAction.Builder(meteringPoint).build()
                        cameraControl?.startFocusAndMetering(action)
                        isFocusLocked = true // User manually focused
                        return true
                    }
                })

                previewView.setOnTouchListener { _, event ->
                    scaleGestureDetector.onTouchEvent(event)
                    gestureDetector.onTouchEvent(event)
                    true
                }

                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    // Request ~1080p analysis frames. The default is 640x480, on which a card
                    // that fills half the height leaves the passcode digits only ~5-7 px tall —
                    // too small for OCR to recover. The detector still runs on a 640 letterbox
                    // (its input size is fixed), so higher analysis resolution costs no extra
                    // detector time; only the OCR crops, taken from this full-res frame, benefit.
                    val resolutionSelector = ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(
                                Size(1920, 1080),
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                            )
                        )
                        .build()
                    val imageAnalyzer = ImageAnalysis.Builder()
                        .setResolutionSelector(resolutionSelector)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also {
                            // Artwork scanner (restored strict thresholds 0.6/0.6) → autonomous
                            // phone staging via onConfirmed. The passcode CardAnalyzer stays built
                            // but detached (used only for manual entry).
                            it.setAnalyzer(executor, mlAnalyzer)
                        }

                    try {
                        cameraProvider.unbindAll()
                        val camera = cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            imageAnalyzer
                        )
                        cameraControl = camera.cameraControl
                        cameraInfo = camera.cameraInfo
                    } catch (exc: Exception) {
                        Log.e("Scanner", "Use case binding failed", exc)
                    }
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Phase-4: live detection overlay (boxes + passcodes), mapped frame->view (FILL_CENTER).
        Canvas(modifier = Modifier.fillMaxSize()) {
            val dets = mlDetections
            if (dets.isNotEmpty() && mlFrameW > 1) {
                val sc = maxOf(size.width / mlFrameW, size.height / mlFrameH)
                val offX = (size.width - mlFrameW * sc) / 2f
                val offY = (size.height - mlFrameH * sc) / 2f
                for (d in dets) {
                    // Expand the artwork box to approximate the full card outline (cosmetic;
                    // the embedder still uses the tight artwork crop). Artwork sits mid-card:
                    // ~35% of its height above (title) and ~75% below (text box).
                    val bw = d.box.x2 - d.box.x1
                    val bh = d.box.y2 - d.box.y1
                    val l = (d.box.x1 - bw * 0.06f) * sc + offX
                    val t = (d.box.y1 - bh * 0.35f) * sc + offY
                    val r = (d.box.x2 + bw * 0.06f) * sc + offX
                    val b = (d.box.y2 + bh * 0.75f) * sc + offY
                    drawRect(
                        color = Color(0xFF00FF66),
                        topLeft = Offset(l, t),
                        size = androidx.compose.ui.geometry.Size(r - l, b - t),
                        style = Stroke(width = 4f)
                    )
                    drawContext.canvas.nativeCanvas.drawText(
                        if (d.passcode >= 0) d.passcode.toString() else "…",
                        l, (t - 10f).coerceAtLeast(30f),
                        android.graphics.Paint().apply {
                            color = android.graphics.Color.rgb(0, 255, 102)
                            textSize = 34f
                            isFakeBoldText = true
                        }
                    )
                }
            }
        }

        // Overlay
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            // Card Frame
            Box(
                modifier = Modifier
                    .aspectRatio(0.68f) // Standard Card Ratio
                    .fillMaxWidth(0.8f)
                    .border(2.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.8f), RoundedCornerShape(8.dp))
            )
        }

        // Header: close, title, desktop-status dot, flash, focus, keyboard.
        Row(
            Modifier.fillMaxWidth().align(Alignment.TopCenter)
                .background(Color.Black.copy(alpha = 0.35f)).statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Schließen", tint = Color.White) }
            Text("Scannen", color = Color.White, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.width(8.dp))
            // Desktop status: green = mirroring scans to the PC, grey = phone only.
            Box(
                Modifier.size(9.dp).clip(CircleShape)
                    .background(if (isConnected) Good else Muted)
                    .clickable {
                        scope.launch {
                            snackbar.showSnackbar(
                                if (isConnected) "Desktop verbunden – Scans gehen zusätzlich an den PC."
                                else "Kein Desktop – Scans bleiben am Handy."
                            )
                        }
                    },
            )
            Spacer(Modifier.weight(1f))
            // Spec D4 §3: Einzeln = jede Karte einmal pro Stapel. Stapel = ein erneutes Erkennen
            // erhoeht die Menge. Gemerkt in scanner_prefs, damit der Modus einen Neustart ueberlebt.
            IconButton(
                onClick = {
                    scanMode = if (scanMode == "stapel") "einzeln" else "stapel"
                    com.example.yugiohscanner.Prefs.setScanMode(context, scanMode)
                    Toast.makeText(
                        context,
                        if (scanMode == "stapel") "Stapel: Wiederholungen zählen"
                        else "Einzeln: jede Karte einmal",
                        Toast.LENGTH_SHORT,
                    ).show()
                },
                modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)),
            ) {
                Icon(
                    imageVector = if (scanMode == "stapel") Icons.Default.Layers else Icons.Default.LooksOne,
                    contentDescription = "Scan-Modus",
                    tint = if (scanMode == "stapel") Color.Yellow else Color.White,
                )
            }
            // Auto Focus Reset
            IconButton(
                onClick = {
                    if (isFocusLocked) {
                        cameraControl?.cancelFocusAndMetering()
                        isFocusLocked = false
                        Toast.makeText(context, "Dauer-Autofokus", Toast.LENGTH_SHORT).show()
                    } else {
                         cameraControl?.cancelFocusAndMetering()
                         Toast.makeText(context, "Fokussiere…", Toast.LENGTH_SHORT).show()
                    }
                },
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
            ) {
                Icon(
                    imageVector = if (isFocusLocked) Icons.Default.CenterFocusStrong else Icons.Default.CenterFocusWeak,
                    contentDescription = "Fokus",
                    tint = if (isFocusLocked) Color.Red else Color.White
                )
            }
            // Flashlight Toggle
            IconButton(
                onClick = {
                    isFlashOn = !isFlashOn
                    cameraControl?.enableTorch(isFlashOn)
                },
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
            ) {
                Icon(
                    imageVector = if (isFlashOn) Icons.Default.FlashOn else Icons.Default.FlashOff,
                    contentDescription = "Blitz",
                    tint = if (isFlashOn) Color.Yellow else Color.White
                )
            }
            IconButton(onClick = { showManualEntry = true }) { Icon(Icons.Default.Keyboard, "Passcode eingeben", tint = Color.White) }
        }

        // Fusszeile: die Fortschrittsanzeige (Spec D4 §6.3) und die Staging-Zeile sind zwei
        // unabhaengige Sachverhalte und erscheinen unabhaengig voneinander -- kein "else if"
        // mehr, sonst verschwindet der Pruefen-Knopf (einziger Zugang zum Pruefen-Blatt),
        // sobald der PC waehrend eines laufenden Handy-Staging-Stapels verbindet.
        if ((isConnected && sentCount > 0) || stagingCards.isNotEmpty()) {
            Column(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter).navigationBarsPadding()
            ) {
                if (isConnected && sentCount > 0) {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("$sentCount an den PC gesendet", color = Color.White, modifier = Modifier.weight(1f))
                        // Dieselben drei Ampelfarben wie im Staging-Sheet -- keine neuen Farben.
                        Box(Modifier.size(10.dp).clip(CircleShape).background(ScanStagingLogic.dotColor(lastLight)))
                    }
                }
                if (stagingCards.isNotEmpty()) {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${stagingCards.size} Karten erkannt", color = Color.White, modifier = Modifier.weight(1f))
                        Button(onClick = { showSheet = true }) { Text("Prüfen (${stagingCards.size})") }
                    }
                }
            }
        }
        if (showSheet) {
            ModalBottomSheet(onDismissRequest = { showSheet = false }, sheetState = sheetState) {
                ScanStagingSheet(
                    entries = stagingCards,
                    // Only forget what was actually committed — entries left in the sheet (still
                    // resolving) must not be staged a second time.
                    onCommitted = { passcodes -> seen.removeAll(passcodes.toSet()); showSheet = false },
                )
            }
        }

        // Manual Entry Dialog
        if (showManualEntry) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.9f))
                    .padding(16.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.background, RoundedCornerShape(16.dp))
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Passcode", style = MaterialTheme.typography.headlineSmall, color = Color.White)
                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = manualCode,
                        onValueChange = { if (it.length <= 8 && it.all { char -> char.isDigit() }) manualCode = it },
                        label = { Text("Passcode") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MaterialTheme.colorScheme.primary,
                            unfocusedBorderColor = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                showManualEntry = false
                                manualCode = ""
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Gray)
                        ) {
                            Text("Abbrechen")
                        }
                        Button(
                            onClick = {
                                if (manualCode.length >= 4) { // Basic validation
                                    lastScannedCode = manualCode

                                    // Trigger Feedback
                                    triggerFeedback()

                                    // Stage like a scan; the desktop mirror (if connected) happens inside stageScan.
                                    onCapture(manualCode, emptyList(), emptyList(), emptyList())

                                    showManualEntry = false
                                    manualCode = ""
                                } else {
                                    Toast.makeText(context, "Ungültiger Passcode", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            Text("Übernehmen")
                        }
                    }
                }
            }
        }

        // Capture flash — a quick white blink over the whole screen on each recognition.
        if (flash.value > 0.01f) {
            Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = flash.value)))
        }

        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 72.dp),
        )
    }
}

class CardAnalyzer(
    private val onResultDetected: (String, List<String>) -> Unit,
    private val onProgress: (String, Int, Int) -> Unit = { _, _, _ -> }
) : ImageAnalysis.Analyzer {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    // Passcode: 8 digits. Set code: PREFIX-<2-letter region><digits>, e.g. LOB-EN001, DOOD-DE038.
    private val passcodePattern = Pattern.compile("\\b\\d{8}\\b")
    private val setCodePattern = Pattern.compile("\\b[A-Z0-9]{2,5}-[A-Z]{2}\\d{2,4}\\b")

    // Multi-frame confirmation for the passcode (the identity we key on); the set code is
    // detected opportunistically over the same window and attached when a passcode confirms.
    private val window = ArrayDeque<Set<String>>()
    private val setWindow = ArrayDeque<Set<String>>()
    private val WINDOW = 6
    private val REQUIRED_HITS = 3
    private var confirmed: String? = null

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val rotation = imageProxy.imageInfo.rotationDegrees
        val full = imageProxy.toBitmap()
        // Keep the central band where the framed card sits; drop edge/background text.
        val cropW = (full.width * 0.85f).toInt()
        val cropH = (full.height * 0.95f).toInt()
        val x = (full.width - cropW) / 2
        val y = (full.height - cropH) / 2
        val cropped = Bitmap.createBitmap(full, x, y, cropW, cropH)
        val image = InputImage.fromBitmap(cropped, rotation)

        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                val passcodes = HashSet<String>()
                val setCodes = HashSet<String>()
                for (block in visionText.textBlocks) {
                    val text = block.text.uppercase(Locale.ROOT)
                    val pm = passcodePattern.matcher(text)
                    while (pm.find()) passcodes.add(pm.group())
                    val sm = setCodePattern.matcher(text)
                    while (sm.find()) setCodes.add(sm.group())
                }
                registerFrame(passcodes, setCodes)
            }
            .addOnFailureListener { e ->
                Log.e("Analyzer", "Text recognition failed", e)
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }

    private fun registerFrame(passcodes: Set<String>, setCodes: Set<String>) {
        window.addLast(passcodes)
        while (window.size > WINDOW) window.removeFirst()
        setWindow.addLast(setCodes)
        while (setWindow.size > WINDOW) setWindow.removeFirst()

        val counts = HashMap<String, Int>()
        for (frame in window) for (code in frame) counts[code] = (counts[code] ?: 0) + 1

        // Clear the confirmation once that card has left the view, so re-scanning works.
        confirmed?.let { if (counts[it] == null) confirmed = null }

        val best = counts.maxByOrNull { it.value } ?: return
        if (best.key != confirmed) {
            onProgress(best.key, best.value.coerceAtMost(REQUIRED_HITS), REQUIRED_HITS)
            if (best.value >= REQUIRED_HITS) {
                confirmed = best.key
                onResultDetected(best.key, topSetCodes(3))
            }
        }
    }

    // Most frequent set codes across the current window, highest first (up to `limit`).
    private fun topSetCodes(limit: Int): List<String> {
        val counts = HashMap<String, Int>()
        for (frame in setWindow) for (code in frame) counts[code] = (counts[code] ?: 0) + 1
        return counts.entries.sortedByDescending { it.value }.take(limit).map { it.key }
    }

    // Release the ML Kit recognizer; call when the scanner is torn down.
    fun close() {
        recognizer.close()
    }
}

// Spec D3 Task 8, jetzt aus ResolvedScan statt aus einem Staging-Eintrag (Spec D4 §6.2): spiegelt
// die auf dem Handy BEREITS GEFAELLTE Entscheidung an den PC -- Set-Code, Rarity, Sprache, Edition,
// Ampel und deutscher Grund woertlich -- damit der PC dieselbe Vorauswahl zeigt, statt die
// Kandidaten selbst gegen eine Karte zu matchen, deren Bandtext er nie gesehen hat.
// Ein aelterer PC-Stand ignoriert die Felder, die er nicht kennt.
//
// Spec-Fix I2: dazu `mode` ("einzeln"/"stapel", woertlich wie am Handy). Die urspruengliche
// Annahme -- der PC brauche kein Modus-Feld, weil das Handy im Modus "einzeln" nie eine
// Wiederholung schickt -- ist widerlegt: `seen` (ScanScreen) lebt nur, solange der Scanner offen
// ist, die Staging-Liste des PCs ueberlebt ein Schliessen/Wiederoeffnen. Ohne das Feld zaehlte
// Modus "einzeln" bei verbundenem PC doppelt. Ein aelterer PC ignoriert auch dieses Feld.
private fun sendScanToDesktop(socket: Socket, pc: String, r: ResolvedScan, mode: String) {
    val data = JSONObject().put("passcode", pc)
    r.match.selected?.let {
        data.put("setCode", it.setCode)
        data.put("rarity", it.rarity)
        data.put("language", it.language)
    }
    if (r.match.candidates.isNotEmpty()) {
        data.put("setCodeCandidates", JSONArray(r.match.candidates.map { it.setCode }))
    }
    data.put("edition", r.confidence.effectiveEdition)
    data.put("editionConfidence", r.confidence.editionConfidence.name.lowercase(Locale.ROOT))
    data.put("confidence", r.confidence.light.name.lowercase(Locale.ROOT))
    data.put("reason", r.confidence.reason ?: JSONObject.NULL)
    data.put("mode", mode)
    socket.emit("card_scanned", data)
}
