package com.example.yugiohscanner

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
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
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.CenterFocusWeak
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.regex.Pattern

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF9D00FF),
                    background = Color(0xFF121212),
                    onBackground = Color(0xFFE0E0E0)
                )
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainScreen()
                }
            }
        }
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

    fun addScanToHistory(code: String) {
        // Avoid duplicates at the very top
        if (scanHistory.isEmpty() || scanHistory.first() != code) {
            scanHistory.add(0, code)
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

    if (isConnected && hasCameraPermission) {
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

    var cameraControl by remember { mutableStateOf<CameraControl?>(null) }
    var cameraInfo by remember { mutableStateOf<CameraInfo?>(null) }

    // Feedback Helpers
    val triggerFeedback = remember {
        {
            // Vibration
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            if (vibrator.hasVibrator()) {
                 if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
                 } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(100)
                 }
            }

            // Sound
            try {
                val toneGen = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
                toneGen.startTone(ToneGenerator.TONE_PROP_BEEP)
            } catch (e: Exception) {
                e.printStackTrace()
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

                val executor = Executors.newSingleThreadExecutor()

                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    val imageAnalyzer = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also {
                            it.setAnalyzer(executor, CardAnalyzer { code ->
                                if (code != lastScannedCode) {
                                    lastScannedCode = code
                                    scanStatus = "Detected: $code"

                                    // Trigger Feedback
                                    triggerFeedback()

                                    // Add to History
                                    onAddHistory(code)

                                    // Emit to socket
                                    val data = JSONObject()
                                    data.put("passcode", code)
                                    socket?.emit("card_scanned", data)
                                }
                            })
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

class CardAnalyzer(private val onCodeDetected: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val pattern = Pattern.compile("""\b\d{8}\b""")

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null) {
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)

            recognizer.process(image)
                .addOnSuccessListener { visionText ->
                    for (block in visionText.textBlocks) {
                        val text = block.text
                        val matcher = pattern.matcher(text)
                        if (matcher.find()) {
                            val code = matcher.group()
                            onCodeDetected(code)
                            break
                        }
                    }
                }
                .addOnFailureListener { e ->
                    Log.e("Analyzer", "Text recognition failed", e)
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
}
