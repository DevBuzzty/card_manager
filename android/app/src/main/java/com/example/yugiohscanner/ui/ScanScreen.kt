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
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern
import java.util.Locale

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
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    // Full-screen "capture" flash — the screen blinks each time a card is recognised, so you can
    // just keep panning without watching the status text.
    val flash = remember { Animatable(0f) }
    // Passcodes already captured this session (phone-staged OR sent to desktop). Dedup so panning
    // over a card captures it once and re-detections don't spam. Committed passcodes are dropped
    // again when a batch is taken over. Concurrent: the analyzer thread adds while the main thread
    // adds (manual entry) and removes.
    val seen = remember { ConcurrentHashMap.newKeySet<String>() }

    // Phone-side scan staging — a scan always lands here; a connected desktop additionally gets a
    // mirror of the scan (see onConfirmed below).
    val stagingCards = remember { mutableStateListOf<ScanStagingEntry>() }
    var showSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Continuous scanning: each newly-seen card is captured automatically (screen blinks) — no
    // per-card Reset/Prüfen. `evidence` is the pooled raw OCR text of this card's bottom band
    // across the frames it was visible (see SetCodeEvidence). The set code is resolved from it by
    // constrained matching against the card's known printings, not by trusting a single clean OCR
    // token.
    // Shared by autonomous ML detection (onConfirmed below) and manual passcode entry: stage the
    // card locally, then resolve its base data + set code, reporting failures via the snackbar
    // (the success path stays silent — the flash, sound and footer counter already report it).
    fun stageScan(pc: String, evidence: List<String>) {
        scope.launch { flash.snapTo(0.8f); flash.animateTo(0f, animationSpec = tween(300)) }
        // Always stage on the phone; a connected desktop additionally gets a mirror of the scan.
        val mirrorSocket = socket
        if (isConnected && mirrorSocket != null) {
            val data = JSONObject().put("passcode", pc)
            val cand = com.example.yugiohscanner.ml.SetCodeOcr.extract(evidence.joinToString(" "))
            if (cand.isNotEmpty()) { data.put("setCode", cand.first()); data.put("setCodeCandidates", JSONArray(cand)) }
            mirrorSocket.emit("card_scanned", data)
        }
        val entry = ScanStagingEntry(System.nanoTime(), pc).apply {
            edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
            condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
        }
        stagingCards.add(entry)
        scope.launch {
            try {
                val base = CardSearchRepository.search(pc).firstOrNull()
                if (base == null) {
                    stagingCards.remove(entry); seen.remove(pc)   // allow a later re-scan
                    snackbar.showSnackbar("Karte $pc nicht gefunden")
                } else {
                    entry.base = base
                    val known = runCatching { PrintingRepository.fetchAllSets(pc) }.getOrDefault(emptyList())
                    entry.knownSets = known
                    entry.selectedSet = SetCodeMatch.best(evidence, known)
                    entry.loading = false
                }
            } catch (e: Exception) {
                entry.loading = false
                snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
            }
        }
    }

    val onConfirmed = rememberUpdatedState<(Int, List<String>) -> Unit> { passcode, evidence ->
        val pc = passcode.toString()
        if (passcode > 0 && seen.add(pc)) stageScan(pc, evidence)
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
            onResultDetected = { code, setCodes -> onConfirmed.value(code.toIntOrNull() ?: -1, setCodes) },
            onProgress = { code, hits, required -> onProgress.value(code, hits, required) }
        )
    }

    // Phase-4: on-device recognition pipeline + live overlay state.
    // Identification is by ARTWORK embedding: each detector crop -> pad-to-square 224 -> embedder
    // -> nearest-neighbour over the on-device index (production model, TOP-1 ~0.998).
    val pipeline = remember { com.example.yugiohscanner.ml.HybridPipeline(context, minSim = 0.6f) }
    val tracker = remember { com.example.yugiohscanner.ml.BoxTracker(need = 2) }
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
            for (d in dets) setEvidence.record(d.passcode, d.bandText)
            // On confirmation, resolve the set code from ALL pooled evidence for that card, then
            // emit passcode + evidence downstream (constrained matching happens in onConfirmed).
            for (d in tracker.update(dets)) {
                Log.i("MlScan", "confirmed card ${d.passcode}")
                onConfirmed.value(d.passcode, setEvidence.textsFor(d.passcode))
                setEvidence.forget(d.passcode)
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

        // Footer: count of recognised cards + open the review sheet.
        if (stagingCards.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .background(Color.Black.copy(alpha = 0.55f)).navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${stagingCards.size} Karten erkannt", color = Color.White, modifier = Modifier.weight(1f))
                Button(onClick = { showSheet = true }) { Text("Prüfen (${stagingCards.size})") }
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
                                    if (seen.add(manualCode)) stageScan(manualCode, emptyList())

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
