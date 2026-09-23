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
import androidx.camera.core.ImageCapture
import androidx.camera.core.UseCase
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.Animatable
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
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.LooksOne
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Euro
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
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.theme.AppColors
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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern
import java.util.Locale

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
    var scanMode by remember { mutableStateOf(com.example.yugiohscanner.Prefs.scanMode(context)) }

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

    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    // Full-screen "capture" flash — the screen blinks each time a card is recognised, so you can
    // just keep panning without watching the status text.
    val flash = remember { Animatable(0f) }

    // Spec B2 Task 1: die Erfassungslogik (Staging-Liste, `seen`, Fortschrittsanzeige, die vier
    // zuvor ineinandergreifenden lokalen Funktionen) lebt jetzt in ScanCapture statt hier.
    // `socket`/`isConnected`/`scanMode` werden als Lambda hineingereicht, nicht als Wert -- sie
    // aendern sich waehrend der Lebensdauer des Scanners, ein einmal gelesener Wert wuerde sonst
    // veralten (siehe ScanCapture's eigener Kommentar).
    val capture = remember {
        ScanCapture(
            context, scope, snackbar, flash,
            socket = { socket }, connected = { isConnected }, mode = { scanMode },
        )
    }

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
            // wieder gescannt werden. Laeuft auf dem Socket-Thread; `capture.seen` ist ein
            // ConcurrentHashMap-Set und genau dafuer da.
            newSocket.on("staging_released") { args ->
                val obj = args.firstOrNull() as? JSONObject ?: return@on
                val arr = obj.optJSONArray("passcodes") ?: return@on
                capture.forget((0 until arr.length()).map { arr.optString(it) })
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
    var isFocusLocked by remember { mutableStateOf(false) }
    var showManualEntry by remember { mutableStateOf(false) }
    var manualCode by remember { mutableStateOf("") }

    var cameraControl by remember { mutableStateOf<CameraControl?>(null) }
    var cameraInfo by remember { mutableStateOf<CameraInfo?>(null) }

    val triggerFeedback = remember { {} }

    var showSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // [frames] is [evidence]'s per-frame breakdown (see ScanCapture.stageScan's own doc) — a
    // separate parameter rather than re-deriving it from [evidence], since the two callers below
    // don't always have the same list to offer for both. [editionTexts] is stageScan's own new
    // parameter (Task 7), threaded through the same way.
    val onConfirmed = rememberUpdatedState<(Int, List<String>, List<String>, List<String>) -> Unit> { passcode, evidence, frames, editionTexts ->
        if (passcode > 0) capture.onCapture(passcode.toString(), evidence, frames, editionTexts)
    }

    // Waermestufe des Systems ins Protokoll, alle 10 s. Nicht selbst geschaetzt: die Stufe kommt vom
    // PowerManager. Sie ist die Gegenrechnung zur Analyse-Aufloesung -- mehr Bildpunkte je Bild
    // heizen, und Hitze war schon einmal ein Thema (43,6 Grad im Lauf vom 19.09.).
    LaunchedEffect(Unit) {
        while (true) {
            val stufe = runCatching {
                val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
                if (android.os.Build.VERSION.SDK_INT >= 29 && pm != null) pm.currentThermalStatus else -1
            }.getOrDefault(-1)
            com.example.yugiohscanner.ml.ScanLog.line("Waerme", "stufe=$stufe")
            kotlinx.coroutines.delay(10_000)
        }
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
    // Stapel-Lichtschranke (docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/brief.md): im
    // Modus "stapel" zaehlt jeder Einwurf ueber die Rutsche genau +1. Der Analyzer erkennt Einwuerfe
    // (ChuteGate), StackCounter loest sie mit Bestaetigungen ein.
    val stackCounter = remember { com.example.yugiohscanner.ml.StackCounter() }
    // Gezaehlte Stapel-Karten warten bis zu 1,5 s auf einen gelesenen Set-Code, bevor sie rausgehen.
    val pendingSends = remember { com.example.yugiohscanner.ml.PendingSends() }
    var stapelCount by remember { mutableStateOf(0) }
    val tone = remember { try { android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 80) } catch (e: RuntimeException) { null } }
    val vibrator = remember { context.getSystemService(android.os.Vibrator::class.java) }
    // Scan-Protokoll (ScanLog): seit wann ein Einwurf auf seine Buchung wartet (0 = keiner), ob sein Foto
    // schon abgelegt ist, und das letzte Analysebild fuer "Fehler melden".
    val einwurfOffenSeit = remember { java.util.concurrent.atomic.AtomicLong(0L) }
    val einwurfFoto = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    // Zeitpunkt des letzten schwachen Stosses (Analyse-Thread -> Erkennungs-Thread), 0 = keiner.
    val schwacherStoss = remember { java.util.concurrent.atomic.AtomicLong(0L) }
    val letzteBuchung = remember { java.util.concurrent.atomic.AtomicLong(0L) }
    // Der Analyzer selbst, fuer Einstellungen aus seinem eigenen Ergebnis-Callback (dort ist er noch nicht zugewiesen).
    val mlAnalyzerRef = remember { java.util.concurrent.atomic.AtomicReference<com.example.yugiohscanner.ml.MlScanAnalyzer?>(null) }
    val letztesBild = remember { java.util.concurrent.atomic.AtomicReference<android.graphics.Bitmap?>(null) }
    var mlDetections by remember { mutableStateOf<List<com.example.yugiohscanner.ml.Detection>>(emptyList()) }
    var mlFrameW by remember { mutableStateOf(1) }
    var mlFrameH by remember { mutableStateOf(1) }
    val mlAnalyzer = remember {
        // [times]-mal an Staging/PC mit den bis jetzt gesammelten Belegen. Voted candidates FIRST,
        // then every frame's raw text (see SetCodeEvidence.rawTexts); EDITION per-frame text from
        // the same record() calls (SetCodeEvidence.editionTexts).
        fun sendConfirmed(passcode: Int, times: Int) {
            val frames = setEvidence.rawTexts(passcode)
            repeat(times) {
                onConfirmed.value(
                    passcode, setEvidence.setCodeCandidates(passcode) + frames, frames,
                    setEvidence.editionTexts(passcode),
                )
            }
        }
        com.example.yugiohscanner.ml.MlScanAnalyzer(pipeline) { dets, frame, w, h, ms, einwuerfe, einwurfStartMs ->
            mlDetections = dets
            letztesBild.set(frame)
            mlFrameW = w
            mlFrameH = h
            val now = System.currentTimeMillis()
            if (scanMode == "stapel" && einwuerfe > 0) {
                // Noch wartende Karten sofort senden -- rearm unten verwirft ihre Belege.
                for ((pc, n) in pendingSends.flushAll()) sendConfirmed(pc, n)
                stackCounter.einwurf(einwuerfe, now)
                // Die eingeworfene Karte hat denselben Passcode wie die liegende: ALLE bestaetigten
                // erneut bestaetigungsfaehig machen -- im Einwurf-Bild ist oft keine erkannt (siehe
                // BoxTracker.rearmAll). Erst nach Einwurfbeginn bestaetigte bleiben unberuehrt. Alte
                // OCR-Belege vergessen, bevor setEvidence.record() unten den ersten der neuen schreibt.
                val rearmed = tracker.rearmAll(einwurfStartMs)
                for (pc in rearmed) setEvidence.forget(pc)
                com.example.yugiohscanner.ml.ScanLog.line("Einwurf", "anzahl=$einwuerfe rearmt=$rearmed start=$einwurfStartMs")
                if (einwurfOffenSeit.get() == 0L) { einwurfOffenSeit.set(now); einwurfFoto.set(false) }
            }
            // Einwurf wartet: nach 2 s ohne Buchung ein Foto (was sieht die Erkennung?), nach 15 s verfaellt
            // er (StackCounter) -- beides ins Protokoll.
            val offen = einwurfOffenSeit.get()
            if (offen != 0L && now - offen > 15_000) {
                com.example.yugiohscanner.ml.ScanLog.line("Einwurf", "verfallen nach ${now - offen}ms ohne Erkennung")
                einwurfOffenSeit.set(0L)
            } else if (offen != 0L && now - offen >= 2_000 && einwurfFoto.compareAndSet(false, true)) {
                val foto = com.example.yugiohscanner.ml.ScanLog.photo(frame, "offen-$offen")
                com.example.yugiohscanner.ml.ScanLog.line("Einwurf", "offen seit ${now - offen}ms erkannt=${dets.map { "${it.passcode}@${"%.2f".format(it.sim)}" }} foto=$foto")
            }
            if (scanMode == "stapel") {
                val w = schwacherStoss.getAndSet(0L)
                if (w != 0L) stackCounter.schwach(w)
            }
            // Pool each visible card's bottom-band OCR text (set-code voting across frames).
            for (d in dets) setEvidence.record(d.passcode, d.zoneTexts, d.legacyText)
            // On confirmation, resolve the set code from ALL pooled evidence for that card, then
            // emit passcode + evidence downstream (constrained matching happens in onConfirmed).
            for (d in tracker.update(dets, now)) {
                com.example.yugiohscanner.ml.ScanLog.line("Bestaetigt", "${d.passcode} sim=${"%.2f".format(d.sim)}")
                // Modus "stapel": so oft buchen, wie Einwuerfe offen sind; ohne Einwurf gar nicht.
                // Rueckmeldung sofort, Senden erst mit Set-Code (PendingSends, unten).
                if (scanMode == "stapel") {
                    val times = stackCounter.claim(now, d.passcode)
                    com.example.yugiohscanner.ml.ScanLog.line("Gebucht", "${d.passcode} x$times")
                    if (times > 0) {
                        einwurfOffenSeit.set(0L)
                        letzteBuchung.set(now)
                        stapelCount += times
                        capture.blink()
                        tone?.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 120)
                        vibrator?.vibrate(android.os.VibrationEffect.createOneShot(60, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                        pendingSends.add(d.passcode, times, now)
                    }
                } else {
                    sendConfirmed(d.passcode, 1)
                }
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
            // Wartende Stapel-Karten senden, sobald ein Set-Code-Kandidat da ist oder 1,5 s um sind --
            // vor dem Abraeumen unten, das die Belege einer verschwundenen Karte verwirft.
            for ((pc, n) in pendingSends.due(now) { setEvidence.setCodeCandidates(it).isNotEmpty() }) {
                com.example.yugiohscanner.ml.ScanLog.line("Gesendet", "$pc x$n kandidaten=${setEvidence.setCodeCandidates(pc)}")
                sendConfirmed(pc, n)
            }
            for (gone in tracker.droppedThisFrame) setEvidence.forget(gone)
            // Ruhepause (MlScanAnalyzer.mlPauseMs): im Stapel-Modus, wenn weder ein Einwurf noch eine Sendung
            // wartet und seit 2 s nichts gebucht wurde, nur noch ~1,5 Erkennungen pro Sekunde.
            if (scanMode == "stapel" && einwurfOffenSeit.get() == 0L && pendingSends.isEmpty() && now - letzteBuchung.get() > 2_000) {
                mlAnalyzerRef.get()?.mlPauseMs = 700L
            } else {
                mlAnalyzerRef.get()?.mlPauseMs = 0L
            }

            // Silent improvement (Spec D3 Task 6, plan Section 6.2): a card already staged
            // (`seen`) but still visible gets its set code re-resolved from ALL evidence gathered
            // so far on every frame — a later, cleaner frame can genuinely beat the one(s) that won
            // the first resolve. `shouldSilentlyImprove` also enforces the one thing this must
            // never do: overwrite a set/rarity/language/edition the user already corrected by hand
            // (`entry.userTouched`).
            for (d in dets) {
                if (d.passcode <= 0) continue
                val pc = d.passcode.toString()
                if (pc !in capture.seen) continue
                val entry = capture.stagingCards.find { it.passcode == pc }
                if (entry == null) {
                    // Bei verbundenem PC gibt es keinen Handy-Eintrag, also lief die Nachbesserung
                    // unten NIE -- im Lauf vom 20.09. 164 mal "stage=erst", null mal "verbessert".
                    // Vorerst wird nur mitgerechnet und protokolliert, nicht eingegriffen.
                    capture.schattenrechnung(
                        pc, setEvidence.setCodeCandidates(d.passcode) + setEvidence.rawTexts(d.passcode),
                        setEvidence.rawTexts(d.passcode), setEvidence.editionTexts(d.passcode),
                    )
                    continue
                }
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

    remember { mlAnalyzer.onSchwacherStoss = { t -> schwacherStoss.set(t) } }

    // Kamera je Modus binden (21.09.2026). Stapel: Vorschau + Live-Analyse (Lichtschranke). Einzeln:
    // Vorschau + FOTO in voller Aufloesung, OHNE Live-Analyse -- im Einzel-Modus rechnet im
    // Hintergrund nichts, gewertet wird nur, was der Auslöser aufnimmt. Anlass: ohne Halterung
    // hielt der Nutzer Karten im Stapel-Modus hin, sie wurden erkannt, aber nie gebucht
    // ("Bestaetigt ... Gebucht x0"), weil der Stapel absichtlich nur zaehlt, was durch die
    // Lichtschranke faellt. Der Auslöser macht den Modus zugleich unuebersehbar.
    val kamera = remember { KameraTeile() }
    val fotoAufnahme = remember { com.example.yugiohscanner.ml.FotoAufnahme(pipeline) }
    var fotoLaeuft by remember { mutableStateOf(false) }
    // Karten-Info (21.09.2026): die zuletzt fotografierte Karte -- nur im Einzel-Modus.
    var letzteFotoKarte by remember { mutableStateOf<String?>(null) }
    var zeigeKartenInfo by remember { mutableStateOf(false) }

    fun binde(modus: String) {
        val provider = kamera.provider ?: return
        val preview = kamera.preview ?: return
        val zweiter: UseCase = (if (modus == "stapel") kamera.analyse else kamera.foto) ?: return
        try {
            provider.unbindAll()
            val camera = provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, zweiter)
            cameraControl = camera.cameraControl
            cameraInfo = camera.cameraInfo
            // Gemerkten Zoom wiederherstellen (Prefs.zoom). Der Halter steht fest, die Karte liegt
            // immer gleich weit weg -- einmal eingestellt soll das bleiben, statt vor jedem Stapel
            // neu gekniffen zu werden. Gilt im Fotomodus genauso.
            val z = camera.cameraInfo.zoomState.value
            val gewuenscht = com.example.yugiohscanner.Prefs.zoomGeklemmt(
                com.example.yugiohscanner.Prefs.zoom(context),
                z?.minZoomRatio ?: 1f, z?.maxZoomRatio ?: 1f,
            )
            if (gewuenscht > 1f) camera.cameraControl.setZoomRatio(gewuenscht)
            com.example.yugiohscanner.ml.ScanLog.line(
                "Kamera", "modus=%s zoom=%.2f moeglich=%.2f..%.2f".format(
                    modus, gewuenscht, z?.minZoomRatio ?: 1f, z?.maxZoomRatio ?: 1f))
        } catch (exc: Exception) {
            Log.e("Scanner", "Use case binding failed", exc)
        }
    }

    LaunchedEffect(scanMode) {
        // Im Fotomodus liefert die Live-Analyse nichts mehr -- alte Rahmen nicht stehen lassen.
        if (scanMode != "stapel") mlDetections = emptyList()
        binde(scanMode)
    }

    val fotoAusloesen: () -> Unit = {
        val cap = kamera.foto
        if (cap != null && !fotoLaeuft) {
            fotoLaeuft = true
            scope.launch {
                try {
                    val erg = fotoAufnahme.serie(cap, executor)
                    if (erg == null) {
                        snackbar.showSnackbar("Keine Karte erkannt")
                    } else {
                        capture.onFoto(erg.passcode.toString(), erg.evidence, erg.frames, erg.editionTexts)
                        letzteFotoKarte = erg.passcode.toString()
                        tone?.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 120)
                        vibrator?.vibrate(android.os.VibrationEffect.createOneShot(60, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                    }
                } catch (e: OutOfMemoryError) {
                    com.example.yugiohscanner.ml.ScanLog.line("Foto", "Speicher reicht nicht: ${e.message}")
                    snackbar.showSnackbar("Foto zu gross für den Speicher")
                } catch (e: Exception) {
                    com.example.yugiohscanner.ml.ScanLog.line("Foto", "Fehler: ${e.message}")
                    snackbar.showSnackbar("Foto fehlgeschlagen: ${e.message}")
                } finally {
                    fotoLaeuft = false
                }
            }
        }
    }
    remember { mlAnalyzerRef.set(mlAnalyzer) }

    // Scan-Protokoll: eine Datei je Scanner-Sitzung (ScanLog).
    DisposableEffect(Unit) {
        com.example.yugiohscanner.ml.ScanLog.start(context.filesDir, scanMode)
        onDispose { com.example.yugiohscanner.ml.ScanLog.stop() }
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
            // Die Erkennung laeuft seit der Stapel-Lichtschranke auf mlAnalyzers eigenem Thread --
            // auch den abwarten, bevor pipeline.close() die nativen Sitzungen freigibt.
            mlAnalyzer.shutdown()
            tone?.release()
            analyzer.close()
            pipeline.close()
        }
    }

    // Stapel-Lichtschranke: die Umrandung (Card Frame) in PreviewView-Pixeln an den Analyzer geben.
    var previewBounds by remember { mutableStateOf<androidx.compose.ui.geometry.Rect?>(null) }
    var guideBounds by remember { mutableStateOf<androidx.compose.ui.geometry.Rect?>(null) }
    fun pushGuide() {
        val p = previewBounds ?: return
        val g = guideBounds ?: return
        if (p.width <= 0f || p.height <= 0f) return
        mlAnalyzer.setGuide(g.left - p.left, g.top - p.top, g.right - p.left, g.bottom - p.top, p.width, p.height)
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
                             val z = cameraInfo?.zoomState?.value
                             control.setZoomRatio(
                                 com.example.yugiohscanner.Prefs.zoomGeklemmt(
                                     currentZoomRatio * delta, z?.minZoomRatio ?: 1f, z?.maxZoomRatio ?: 1f,
                                 )
                             )
                        }
                        return true
                    }

                    // Erst am ENDE der Geste merken, nicht bei jedem Zwischenschritt: onScale feuert
                    // dutzendfach je Kniff.
                    override fun onScaleEnd(detector: ScaleGestureDetector) {
                        val z = cameraInfo?.zoomState?.value?.zoomRatio ?: return
                        com.example.yugiohscanner.Prefs.setZoom(ctx, z)
                        com.example.yugiohscanner.ml.ScanLog.line("Zoom", "gemerkt=%.2f".format(z))
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
                                // ZURUECK auf 1080p (20.09.2026, nach einem Lauf am Geraet).
                                // 2880x2160 war der Versuch, die OCR-Zonen ohne Zoom groesser zu
                                // bekommen. Das Protokoll hat ihn widerlegt: die BILDRATE blieb bei
                                // 30/s -- die misst aber nur die Lichtschranke --, waehrend die
                                // ERKENNUNG einbrach. Gemessen im Lauf 1789914143938: Einwurf bei
                                // :44.773, "Einwurf offen seit 2412ms erkannt=[]", Karte erst bei
                                // :53.253 erkannt, gebucht :55.988 -- ueber acht Sekunden. In der
                                // Zwischenzeit laufen weitere Einwuerfe auf und werden gesammelt auf
                                // die zuletzt erkannte Karte gebucht ("Gebucht x2" nach einem
                                // einzelnen Wurf). Dazu wurde das Geraet deutlich waerm, obwohl der
                                // PowerManager noch Stufe 0 meldete.
                                //
                                // Vier mal so viele Bildpunkte kosten eben nicht nur im Detektor
                                // (der laeuft auf seinem festen 640er Letterbox), sondern in allem,
                                // was je Bild umkopiert und vorverarbeitet wird. Wer das wieder
                                // anheben will, muss ZUERST diese Kette messen, nicht die Bildrate.
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

                    // Fotoaufnahme fuer den Einzel-Modus: volle Sensor-Aufloesung, weil dort die kleine
                    // Auflagenzeile gelesen werden muss (siehe FotoAufnahme). Kurze Ausloeseverzoegerung,
                    // weil ein Druck drei Fotos hintereinander nimmt.
                    val imageCapture = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .setJpegQuality(95)
                        .setResolutionSelector(
                            ResolutionSelector.Builder()
                                .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
                                .build()
                        )
                        .build()

                    kamera.provider = cameraProvider
                    kamera.preview = preview
                    kamera.analyse = imageAnalyzer
                    kamera.foto = imageCapture
                    binde(scanMode)
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize().onGloballyPositioned { previewBounds = it.boundsInRoot(); pushGuide() }
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
                        // Passcodes sind achtstellig; als Zahl verliert z. B. 02463794 die fuehrende 0.
                        if (d.passcode >= 0) "%08d".format(d.passcode) else "…",
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
                    .onGloballyPositioned { guideBounds = it.boundsInRoot(); pushGuide() }
                    .border(2.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.8f), RoundedCornerShape(8.dp))
            )
        }

        // Stapel-Zaehler: gross, damit ein fehlendes +1 beim Einwerfen sofort auffaellt.
        if (scanMode == "stapel") {
            Text(
                "+$stapelCount",
                color = Color.Yellow,
                style = MaterialTheme.typography.displayMedium,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 96.dp)
                    .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }

        // Auslöser des Fotomodus -- nur im Einzel-Modus sichtbar, und damit zugleich die Anzeige,
        // in welchem Modus der Scanner steht. Ueber der Fusszeile, damit er sie nicht verdeckt.
        if (scanMode != "stapel") {
            Button(
                onClick = fotoAusloesen,
                enabled = !fotoLaeuft,
                shape = CircleShape,
                contentPadding = PaddingValues(0.dp),
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding()
                    .padding(bottom = 128.dp).size(84.dp),
            ) {
                if (fotoLaeuft) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
                } else {
                    Icon(Icons.Default.PhotoCamera, contentDescription = "Foto aufnehmen", modifier = Modifier.size(40.dp))
                }
            }
        }

        // Karten-Info der zuletzt fotografierten Karte -- rechts unten, auf Hoehe des Auslösers.
        if (scanMode != "stapel" && letzteFotoKarte != null) {
            FilledTonalIconButton(
                onClick = { zeigeKartenInfo = true },
                modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding()
                    .padding(end = 24.dp, bottom = 146.dp).size(48.dp),
            ) {
                Icon(Icons.Default.Euro, contentDescription = "Karten-Info und Preise")
            }
        }
        if (zeigeKartenInfo) {
            letzteFotoKarte?.let { pc ->
                ModalBottomSheet(onDismissRequest = { zeigeKartenInfo = false }) { KartenInfoSheet(pc) }
            }
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
                        else "Einzeln: Karte hinhalten, Auslöser drücken",
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
            // "Fehler melden": Markierung + aktuelles Bild ins Scan-Protokoll.
            IconButton(
                onClick = {
                    val bild = letztesBild.get()
                    val foto = bild?.let { com.example.yugiohscanner.ml.ScanLog.photo(it, "meldung-${System.currentTimeMillis()}") }
                    com.example.yugiohscanner.ml.ScanLog.line("MELDUNG", "Nutzer meldet Fehler, zaehler=$stapelCount foto=$foto")
                    Toast.makeText(context, "Fehler vermerkt", Toast.LENGTH_SHORT).show()
                },
                modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)),
            ) {
                Icon(Icons.Default.Flag, contentDescription = "Fehler melden", tint = Color(0xFFFF8A65))
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
        if ((isConnected && capture.sentCount > 0) || capture.stagingCards.isNotEmpty()) {
            Column(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter).navigationBarsPadding()
            ) {
                if (isConnected && capture.sentCount > 0) {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${capture.sentCount} an den PC gesendet", color = Color.White, modifier = Modifier.weight(1f))
                        // Dieselben drei Ampelfarben wie im Staging-Sheet -- keine neuen Farben.
                        // Liegt auf dem immer dunklen Kamera-Scrim (Fixrunde 2, Punkt B) -- fest
                        // AppColors.dark statt der laufenden Rollen.
                        Box(Modifier.size(10.dp).clip(CircleShape).background(ScanStagingLogic.dotColor(capture.lastLight, AppColors.dark)))
                    }
                }
                if (capture.stagingCards.isNotEmpty()) {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${capture.stagingCards.size} Karten erkannt", color = Color.White, modifier = Modifier.weight(1f))
                        Button(onClick = { showSheet = true }) { Text("Prüfen (${capture.stagingCards.size})") }
                    }
                }
            }
        }
        if (showSheet) {
            ModalBottomSheet(onDismissRequest = { showSheet = false }, sheetState = sheetState) {
                ScanStagingSheet(
                    entries = capture.stagingCards,
                    // Only forget what was actually committed — entries left in the sheet (still
                    // resolving) must not be staged a second time.
                    onCommitted = { committed, ohneStandort, locationWarnings ->
                        // Vergessen wird IMMER: die Eintraege sind angelegt, nur ihr Fach fehlt
                        // womoeglich -- sie duerfen nicht ein zweites Mal im Staging landen. Genau
                        // dafuer stehen die beiden ersten Listen hier ZUSAMMEN: `ohneStandort` ist
                        // ebenso angelegt wie `committed`, nur ohne Fach (das unterscheidet allein
                        // der Einsortier-Modus, dieser Schirm reserviert keine Faecher).
                        // `forget` arbeitet ueber Passcodes; die Eintraege selbst braucht hier
                        // niemand (nur der Einsortier-Modus tut das, siehe onCommitted dort).
                        capture.forget((committed + ohneStandort).map { it.passcode })
                        // Angelegte Exemplare in den Speicher holen (Spec §7.4).
                        CollectionStore.requestSync()
                        // Das Blatt bleibt offen, solange Standort-Hinweise anstehen (Spec B2
                        // Task 5, Fixrunde 1). Sonst schliesst es im selben Snapshot, in dem der
                        // Hinweis gesetzt wird, und der Nutzer saehe nie, dass eine Karte, die er
                        // physisch schon eingesteckt hat, digital ohne Fach liegt. Ein Hinweis,
                        // der von selbst wieder verschwindet, kann uebersehen werden; hier laufen
                        // physischer und digitaler Zustand auseinander, das muss der Nutzer
                        // wegtippen. Wischen/Hintergrund schliesst das Blatt weiterhin normal.
                        if (locationWarnings.isEmpty()) showSheet = false
                    },
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
                    Text("Passcode", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onBackground)
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
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                contentColor = MaterialTheme.colorScheme.onSurface,
                            )
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
                                    capture.onCapture(manualCode, emptyList(), emptyList(), emptyList())

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

/** Die gebauten Kamera-Bausteine, damit ScanScreen sie beim Moduswechsel neu binden kann. */
private class KameraTeile {
    var provider: ProcessCameraProvider? = null
    var preview: Preview? = null
    var analyse: ImageAnalysis? = null
    var foto: ImageCapture? = null
}
