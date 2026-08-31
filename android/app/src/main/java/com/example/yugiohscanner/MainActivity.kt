package com.example.yugiohscanner

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.CenterFocusWeak
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Style
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.SupabaseCloud
import kotlinx.coroutines.launch
import com.example.yugiohscanner.ui.theme.AppTheme
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.SurfaceColor
import com.example.yugiohscanner.ui.CloudLoginScreen
import com.example.yugiohscanner.ui.CollectionScreen
import com.example.yugiohscanner.ui.DealsScreen
import com.example.yugiohscanner.ui.PortfolioScreen
import com.example.yugiohscanner.ui.MoreScreen
import com.example.yugiohscanner.ui.UebersichtScreen
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.regex.Pattern
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainScaffold()
                }
            }
        }
    }
}

enum class Tab { HOME, SCANNER, COLLECTION, PORTFOLIO, DEALS, SETTINGS }

@Composable
fun MainScaffold() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE) }
    var tab by remember { mutableStateOf(Tab.HOME) }   // land on the Übersicht dashboard
    var cloudReady by remember { mutableStateOf(false) }

    // Auto-init cloud if already configured from a previous session.
    LaunchedEffect(Unit) {
        if (SupabaseCloud.isConfigured(prefs)) {
            try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); cloudReady = true } catch (_: Exception) {}
        }
    }

    Scaffold(
        bottomBar = { AppBottomBar(current = tab, onSelect = { tab = it }) }
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (tab) {
                Tab.HOME -> if (cloudReady) UebersichtScreen(
                        onOpenWert = { tab = Tab.PORTFOLIO }, onOpenScan = { tab = Tab.SCANNER },
                        onOpenDeals = { tab = Tab.DEALS }, onOpenSammlung = { tab = Tab.COLLECTION })
                    else CloudLoginScreen(prefs) { cloudReady = true }
                Tab.SCANNER -> MainScreen() // existing scanner+config flow, untouched
                Tab.COLLECTION -> if (cloudReady) CollectionScreen()
                    else CloudLoginScreen(prefs) { cloudReady = true }
                Tab.PORTFOLIO -> if (cloudReady) PortfolioScreen()
                    else CloudLoginScreen(prefs) { cloudReady = true }
                Tab.DEALS -> if (cloudReady) DealsScreen()
                    else CloudLoginScreen(prefs) { cloudReady = true }
                Tab.SETTINGS -> MoreScreen(prefs, onOpenWert = { tab = Tab.PORTFOLIO }) { cloudReady = false }
            }
        }
    }
}

// Bottom bar with a raised center Scan button: Sammlung · Wert · ⦿Scan⦿ · Deals · Mehr.
@Composable
private fun AppBottomBar(current: Tab, onSelect: (Tab) -> Unit) {
    Box(Modifier.fillMaxWidth().height(84.dp)) {
        Surface(
            modifier = Modifier.fillMaxWidth().height(64.dp).align(Alignment.BottomCenter),
            color = SurfaceColor,
        ) {
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                NavItem(Modifier.weight(1f), "Übersicht", Icons.Default.Home, current == Tab.HOME) { onSelect(Tab.HOME) }
                NavItem(Modifier.weight(1f), "Sammlung", Icons.Default.Style, current == Tab.COLLECTION) { onSelect(Tab.COLLECTION) }
                Spacer(Modifier.weight(1f))   // gap under the raised Scan button
                NavItem(Modifier.weight(1f), "Deals", Icons.Default.Sell, current == Tab.DEALS) { onSelect(Tab.DEALS) }
                NavItem(Modifier.weight(1f), "Mehr", Icons.Default.Settings, current == Tab.SETTINGS) { onSelect(Tab.SETTINGS) }
            }
        }
        Box(
            modifier = Modifier.align(Alignment.TopCenter).size(60.dp).clip(CircleShape)
                .background(Primary).clickable { onSelect(Tab.SCANNER) },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.CameraAlt, "Scan", tint = Color.White, modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
private fun NavItem(modifier: Modifier, label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    val tint = if (selected) Primary else Muted
    Column(
        modifier = modifier.fillMaxHeight().clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, label, tint = tint, modifier = Modifier.size(24.dp))
        Text(label, color = tint, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
fun MainScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE) }

    var ipAddress by remember { mutableStateOf(prefs.getString("ip_address", "192.168.1.X") ?: "") }
    var isConnected by remember { mutableStateOf(false) }
    var socket by remember { mutableStateOf<Socket?>(null) }

    // History State
    val scanHistory = remember { mutableStateListOf<String>() }

    // Load History
    LaunchedEffect(Unit) {
        val historyJson = prefs.getString("scan_history", "[]")
        try {
            val jsonArray = JSONArray(historyJson)
            for (i in 0 until jsonArray.length()) {
                scanHistory.add(jsonArray.getString(i))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Save History Helper
    fun saveHistory() {
        val jsonArray = JSONArray()
        scanHistory.take(50).forEach { jsonArray.put(it) } // Limit to last 50
        prefs.edit().putString("scan_history", jsonArray.toString()).apply()
    }

    fun addScanToHistory(text: String) {
        // Avoid duplicates at the very top
        if (scanHistory.isEmpty() || scanHistory.first() != text) {
            scanHistory.add(0, text)
            saveHistory()
        }
    }

    fun clearHistory() {
        scanHistory.clear()
        saveHistory()
    }

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
            Toast.makeText(context, "Connection Failed: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    val disconnectSocket = {
        socket?.disconnect()
        socket = null
        isConnected = false
    }

    // Desktop is now OPTIONAL: auto-connect in the background if an IP is saved (so scans still
    // reach the desktop staging area when it's running), but never gate the camera on it.
    LaunchedEffect(Unit) {
        val savedIp = prefs.getString("ip_address", "") ?: ""
        if (savedIp.isNotBlank() && socket == null) connectSocket(savedIp)
    }

    if (hasCameraPermission) {
        ScannerScreen(
            socket = socket,
            onDisconnect = disconnectSocket,
            scanHistory = scanHistory,
            onAddHistory = ::addScanToHistory,
            onClearHistory = ::clearHistory
        )
    } else {
        ConfigScreen(
            ipAddress = ipAddress,
            onIpChange = { ipAddress = it },
            onConnect = { connectSocket(ipAddress) },
            isPermissionGranted = hasCameraPermission,
            onRequestPermission = { launcher.launch(Manifest.permission.CAMERA) }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigScreen(
    ipAddress: String,
    onIpChange: (String) -> Unit,
    onConnect: () -> Unit,
    isPermissionGranted: Boolean,
    onRequestPermission: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Wifi,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(32.dp))

        Text(
            text = "Connect to Desktop",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground
        )

        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Enter the IP address displayed on your desktop app.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.Gray
        )

        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = ipAddress,
            onValueChange = onIpChange,
            label = { Text("IP Address") },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MaterialTheme.colorScheme.primary,
                unfocusedBorderColor = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f)
            ),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = onConnect,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
        ) {
            Text("Connect")
        }

        if (!isPermissionGranted) {
            Spacer(modifier = Modifier.height(16.dp))
            TextButton(onClick = onRequestPermission) {
                Text("Grant Camera Permission", color = Color.Red)
            }
        }
    }
}

@Composable
fun ScannerScreen(
    socket: Socket?,
    onDisconnect: () -> Unit,
    scanHistory: List<String>,
    onAddHistory: (String) -> Unit,
    onClearHistory: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }

    var lastScannedCode by remember { mutableStateOf<String?>(null) }
    var scanStatus by remember { mutableStateOf("Scanning...") }
    var isFlashOn by remember { mutableStateOf(false) }
    var isFocusLocked by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var showManualEntry by remember { mutableStateOf(false) }
    var manualCode by remember { mutableStateOf("") }

    var cameraControl by remember { mutableStateOf<CameraControl?>(null) }
    var cameraInfo by remember { mutableStateOf<CameraInfo?>(null) }

    // Feedback Helper (Empty as per requirement)
    val triggerFeedback = remember { {} }
    val scope = rememberCoroutineScope()

    // Detection handlers wrapped in rememberUpdatedState so the single remembered analyzer
    // always runs the latest logic without being recreated on every recomposition.
    // Autonomous flow: scanned passcode → YGOPRODeck lookup → add to the Supabase collection
    // (set 'Unknown', quantity +1). No desktop needed. Set codes are ignored in this mode.
    val onDetected = rememberUpdatedState<(String, List<String>) -> Unit> { code, _ ->
        if (code != lastScannedCode) {
            lastScannedCode = code
            triggerFeedback()
            scanStatus = "Nachschlagen $code…"
            scope.launch {
                try {
                    val base = CardSearchRepository.search(code).firstOrNull()
                    if (base == null) {
                        scanStatus = "Karte $code nicht gefunden"
                    } else {
                        val msg = CollectionRepository.addScanned(base)
                        scanStatus = "✓ $msg"
                        onAddHistory(msg)
                    }
                } catch (e: Exception) {
                    scanStatus = "Fehler: ${e.message}"
                }
            }
        }
    }
    val onProgress = rememberUpdatedState<(String, Int, Int) -> Unit> { code, hits, required ->
        if (code != lastScannedCode) {
            scanStatus = "Reading $code… ($hits/$required)"
        }
    }

    // Owned once and disposed explicitly (see below) to avoid leaking a thread and the ML Kit
    // recognizer every time the camera use-cases rebind.
    val executor = remember { Executors.newSingleThreadExecutor() }
    val analyzer = remember {
        CardAnalyzer(
            onResultDetected = { code, setCodes -> onDetected.value(code, setCodes) },
            onProgress = { code, hits, required -> onProgress.value(code, hits, required) }
        )
    }

    // Phase-4: on-device recognition pipeline + live overlay state.
    // Identification is by passcode OCR of each detector crop (the artwork embedder is disabled
    // until it's trained well enough — see PasscodePipeline).
    val pipeline = remember { com.example.yugiohscanner.ml.PasscodePipeline(context) }
    val tracker = remember { com.example.yugiohscanner.ml.BoxTracker(need = 3) }
    val setCodeOcr = remember { com.example.yugiohscanner.ml.SetCodeOcr() }
    var mlDetections by remember { mutableStateOf<List<com.example.yugiohscanner.ml.Detection>>(emptyList()) }
    var mlFrameW by remember { mutableStateOf(1) }
    var mlFrameH by remember { mutableStateOf(1) }
    val mlAnalyzer = remember {
        com.example.yugiohscanner.ml.MlScanAnalyzer(pipeline) { dets, frame, w, h, ms ->
            mlDetections = dets
            mlFrameW = w
            mlFrameH = h
            // Stabilise across frames; on confirm, OCR the set code (region below the artwork
            // where it's printed) for rarity, then emit passcode + set codes.
            for (d in tracker.update(dets)) {
                Log.i("MlScan", "confirmed card ${d.passcode}")
                val bw = d.box.x2 - d.box.x1
                val bh = d.box.y2 - d.box.y1
                val cx = (d.box.x1 - bw * 0.10f).toInt().coerceIn(0, frame.width - 1)
                val cy = d.box.y1.toInt().coerceIn(0, frame.height - 1)
                val cw = (bw * 1.20f).toInt().coerceIn(1, frame.width - cx)
                val ch = (bh * 1.55f).toInt().coerceIn(1, frame.height - cy)  // extend down for the set code
                val crop = android.graphics.Bitmap.createBitmap(frame, cx, cy, cw, ch)
                setCodeOcr.read(crop) { codes ->
                    onDetected.value(d.passcode.toString(), codes)
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
            executor.shutdown()
            analyzer.close()
            pipeline.close()
            setCodeOcr.close()
            if (cameraProviderFuture.isDone) {
                try {
                    cameraProviderFuture.get().unbindAll()
                } catch (e: Exception) {
                    Log.e("Scanner", "Error unbinding camera on dispose", e)
                }
            }
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

                    val imageAnalyzer = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also {
                            // Placeholder single-card scanner: reliable full-frame passcode OCR
                            // (the artwork ML pipeline `mlAnalyzer` stays built but detached until
                            // the embedder is trained).
                            it.setAnalyzer(executor, analyzer)
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
        androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
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
                        topLeft = androidx.compose.ui.geometry.Offset(l, t),
                        size = androidx.compose.ui.geometry.Size(r - l, b - t),
                        style = androidx.compose.ui.graphics.drawscope.Stroke(width = 4f)
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

        // Status Bar
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.7f))
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = scanStatus,
                style = MaterialTheme.typography.titleMedium,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = {
                    lastScannedCode = null
                    scanStatus = "Scanning..."
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color.Gray)
            ) {
                Text("Reset Scan")
            }
        }

        // Top Controls Row
        Row(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Manual Entry
            IconButton(
                onClick = { showManualEntry = true },
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
            ) {
                Icon(Icons.Default.Edit, contentDescription = "Manual Entry", tint = Color.White)
            }

             // History Toggle
            IconButton(
                onClick = { showHistory = true },
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
            ) {
                Icon(Icons.Default.History, contentDescription = "History", tint = Color.White)
            }

            // Auto Focus Reset
            IconButton(
                onClick = {
                    if (isFocusLocked) {
                        cameraControl?.cancelFocusAndMetering()
                        isFocusLocked = false
                        Toast.makeText(context, "Continuous Auto Focus", Toast.LENGTH_SHORT).show()
                    } else {
                         cameraControl?.cancelFocusAndMetering()
                         Toast.makeText(context, "Refocusing...", Toast.LENGTH_SHORT).show()
                    }
                },
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
            ) {
                Icon(
                    imageVector = if (isFocusLocked) Icons.Default.CenterFocusStrong else Icons.Default.CenterFocusWeak,
                    contentDescription = "Reset Focus",
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
                    contentDescription = "Toggle Flash",
                    tint = if (isFlashOn) Color.Yellow else Color.White
                )
            }

            // Disconnect
            IconButton(
                onClick = onDisconnect,
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
            ) {
                Icon(Icons.Default.Settings, contentDescription = "Disconnect", tint = Color.White)
            }
        }

        // Manual Entry Overlay
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
                    Text("Manual Entry", style = MaterialTheme.typography.headlineSmall, color = Color.White)
                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = manualCode,
                        onValueChange = { if (it.length <= 8 && it.all { char -> char.isDigit() }) manualCode = it },
                        label = { Text("Passcode (Required)") },
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
                            Text("Cancel")
                        }
                        Button(
                            onClick = {
                                if (manualCode.length >= 4) { // Basic validation
                                    lastScannedCode = manualCode
                                    val status = "Manual: $manualCode"
                                    scanStatus = status

                                    // Trigger Feedback
                                    triggerFeedback()

                                    // Add to History
                                    onAddHistory(status)

                                    // Emit to socket
                                    val data = JSONObject()
                                    data.put("passcode", manualCode)
                                    socket?.emit("card_scanned", data)

                                    showManualEntry = false
                                    manualCode = ""
                                } else {
                                    Toast.makeText(context, "Invalid Code", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            Text("Submit")
                        }
                    }
                }
            }
        }

        // History Overlay
        if (showHistory) {
             Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.9f))
                    .padding(16.dp)
            ) {
                Column(modifier = Modifier.fillMaxSize()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Scan History", style = MaterialTheme.typography.headlineSmall, color = Color.White)
                        IconButton(onClick = { showHistory = false }) {
                            Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                        }
                    }

                    if (scanHistory.isNotEmpty()) {
                        Button(
                            onClick = onClearHistory,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Red.copy(alpha = 0.6f))
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.size(8.dp))
                            Text("Clear History")
                        }
                    }

                    LazyColumn(
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(scanHistory) { code ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color.Gray.copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                                    .padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(code, color = Color.White, style = MaterialTheme.typography.bodyLarge)
                            }
                        }
                    }
                }
            }
        }
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

    @OptIn(ExperimentalGetImage::class)
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
