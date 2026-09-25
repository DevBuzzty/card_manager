package com.example.yugiohscanner.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.ml.OfflineStart
import com.example.yugiohscanner.ui.theme.ErrorColor
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val SYNC_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

/**
 * Spec §6: scheitert der Abgleich im Hintergrund, bleiben die Daten stehen -- dieser Hinweis sagt,
 * seit wann. Verschwindet beim naechsten erfolgreichen Abgleich.
 */
@Composable
fun SyncHint(modifier: Modifier = Modifier) {
    val sync by CollectionStore.sync.collectAsState()
    val offline by SupabaseCloud.offline.collectAsState()
    val seit = sync.lastSuccess?.let { SYNC_TIME.format(it) }
    // Offline-Start: eigener Hinweis, auch bevor der erste Abgleich scheitert.
    if (offline) {
        Text(OfflineStart.hintText(seit), color = ErrorColor, style = MaterialTheme.typography.labelSmall, modifier = modifier)
        return
    }
    if (!sync.failing) return
    Text(
        if (seit != null) "Nicht abgeglichen seit $seit – nächster Versuch läuft" else "Nicht abgeglichen – nächster Versuch läuft",
        color = ErrorColor,
        style = MaterialTheme.typography.labelSmall,
        modifier = modifier,
    )
}
