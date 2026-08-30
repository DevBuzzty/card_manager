package com.example.yugiohscanner.ui

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

private data class Deal(
    val id: String, val source: String, val title: String,
    val price: Double?, val url: String
)

private const val CH_ID = "deals"
private val notifId = AtomicInteger(1000)

private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CH_ID) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(CH_ID, "Deals", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }
}

private fun notifyDeal(ctx: Context, d: Deal) {
    try {
        val n = NotificationCompat.Builder(ctx, CH_ID)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setContentTitle("Deal ${d.price?.let { "$it €" } ?: ""}".trim())
            .setContentText(d.title)
            .setAutoCancel(true)
            .build()
        androidx.core.app.NotificationManagerCompat.from(ctx).notify(notifId.incrementAndGet(), n)
    } catch (_: SecurityException) { /* POST_NOTIFICATIONS not granted */ }
}

private fun dealFrom(o: JSONObject): Deal = Deal(
    id = o.optString("listingId", o.optString("listing_id", o.optString("id"))),
    source = o.optString("source"),
    title = o.optString("title"),
    price = if (o.isNull("price")) null else o.optDouble("price"),
    url = o.optString("url"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DealsScreen(prefs: SharedPreferences) {
    val context = LocalContext.current
    val ip = remember { prefs.getString("ip_address", "") ?: "" }
    var connected by remember { mutableStateOf(false) }
    val deals = remember { mutableStateListOf<Deal>() }
    var query by remember { mutableStateOf("") }
    var maxPrice by remember { mutableStateOf("") }
    var socketRef by remember { mutableStateOf<Socket?>(null) }

    // main-thread poster for socket callbacks
    val post = remember { { r: () -> Unit -> android.os.Handler(android.os.Looper.getMainLooper()).post(r) } }

    // Ask for notification permission on Android 13+ so deal alerts can pop.
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    DisposableEffect(ip) {
        ensureChannel(context)
        var socket: Socket? = null
        if (ip.isNotBlank()) {
            try {
                val s = IO.socket("http://$ip:4000")
                s.on(Socket.EVENT_CONNECT) { post { connected = true }; s.emit("request_deals") }
                s.on(Socket.EVENT_DISCONNECT) { post { connected = false } }
                s.on("deals_snapshot") { args ->
                    val obj = args.getOrNull(0) as? JSONObject ?: return@on
                    val arr = obj.optJSONArray("alerts") ?: return@on
                    val list = ArrayList<Deal>()
                    for (i in 0 until arr.length()) list.add(dealFrom(arr.getJSONObject(i)))
                    post { deals.clear(); deals.addAll(list) }
                }
                s.on("deal_alert") { args ->
                    val obj = args.getOrNull(0) as? JSONObject ?: return@on
                    val d = dealFrom(obj)
                    post { deals.add(0, d) }
                    notifyDeal(context, d)
                }
                s.connect()
                socket = s
                socketRef = s
            } catch (_: Exception) {}
        }
        onDispose { socket?.disconnect() }
    }

    val addWatch = {
        val p = maxPrice.toDoubleOrNull()
        if (query.isNotBlank() && p != null) {
            socketRef?.emit("add_deal_watch", JSONObject().apply {
                put("query", query.trim()); put("maxPrice", p)
            })
            query = ""; maxPrice = ""
        }
    }

    Surface(Modifier.fillMaxSize(), color = Color(0xFF121212)) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Deals", style = MaterialTheme.typography.headlineSmall, color = Color.White)
                Spacer(Modifier.width(8.dp))
                Text(if (connected) "• verbunden" else "• nicht verbunden",
                    color = if (connected) Color(0xFF4ADE80) else Color(0xFF888888),
                    style = MaterialTheme.typography.labelMedium)
            }
            if (ip.isBlank()) {
                Text("Verbinde zuerst im Scan-Tab mit dem Desktop.",
                    color = Color(0xFF888888), modifier = Modifier.padding(top = 8.dp))
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = query, onValueChange = { query = it },
                    placeholder = { Text("Suchbegriff, z.B. Display …") },
                    singleLine = true, modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = maxPrice, onValueChange = { maxPrice = it.filter { c -> c.isDigit() || c == '.' } },
                    placeholder = { Text("≤ €") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.width(96.dp)
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = addWatch) { Icon(Icons.Default.Add, "Watch") }
            }

            Spacer(Modifier.height(12.dp))
            if (deals.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Noch keine Deals. Lege einen Watch an.", color = Color(0xFF888888))
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(deals) { d ->
                        Surface(color = Color(0xFF1E1E1E), shape = RoundedCornerShape(12.dp)) {
                            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(d.title, color = Color.White, maxLines = 2,
                                        style = MaterialTheme.typography.bodyMedium)
                                    Text(d.source, color = Color(0xFF888888),
                                        style = MaterialTheme.typography.labelSmall)
                                }
                                Spacer(Modifier.width(8.dp))
                                Text(d.price?.let { "$it €" } ?: "—", color = Color(0xFFF5C542),
                                    style = MaterialTheme.typography.titleMedium)
                                IconButton(onClick = {
                                    if (d.url.isNotBlank()) context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse(d.url))
                                    )
                                }) { Icon(Icons.Default.OpenInNew, "Öffnen", tint = Color(0xFF9D00FF)) }
                            }
                        }
                    }
                }
            }
        }
    }
}
