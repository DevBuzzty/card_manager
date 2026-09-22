package com.example.yugiohscanner.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.EbayRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.ml.EbayMarks
import com.example.yugiohscanner.ml.PhotoScale
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Spec H3b1 §6 -- eigene Fotos eines Angebots am Handy: Vorschau (LazyRow), verschieben (Nachbar tauschen), entfernen
 * (weiches Löschen, Bestätigung), hinzufügen per Kamera oder Galerie. Jede Mutation läuft durch [InFlight] und lädt
 * INNERHALB des Gatters frisch (Global Constraints), bevor sie über die Fotoanzahl (<= [PhotoScale.MAX_PHOTOS])
 * entscheidet. Die Aufnahme-Launcher stehen oben im Composable, nie in einem Zweig (Global Constraints §Sheets).
 */
@Composable
fun ListingPhotos(listingId: String, enabled: Boolean) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }

    val state by SideStores.listingPhotos.state.collectAsState()
    LaunchedEffect(listingId) { SideStores.listingPhotos.ensureLoaded() }
    val value = state.value
    val photos = remember(value, listingId) { EbayRepository.photosOf(value.orEmpty(), listingId) }

    fun add(uri: Uri) {
        if (!inFlight.tryStart()) return
        busy = true; error = null
        scope.launch {
            try {
                val jpeg = PhotoImport.jpegFrom(ctx, uri)
                SideStores.listingPhotos.refreshAndWait()
                val fresh = SideStores.listingPhotos.state.value.value ?: throw IllegalStateException("Fotos nicht geladen.")
                val mine = EbayRepository.photosOf(fresh, listingId)
                if (mine.size >= PhotoScale.MAX_PHOTOS) throw IllegalStateException(PhotoScale.TOO_MANY)
                EbayRepository.addPhoto(listingId, jpeg, (mine.maxOfOrNull { it.sort } ?: -1) + 1)
                SideStores.listingPhotos.refreshAndWait()
                EbayRepository.kick()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Foto konnte nicht hinzugefügt werden." }
            finally { inFlight.finish(); busy = false }
        }
    }

    fun move(photoId: String, delta: Int) {
        if (!inFlight.tryStart()) return
        busy = true; error = null
        scope.launch {
            try {
                SideStores.listingPhotos.refreshAndWait()
                val fresh = SideStores.listingPhotos.state.value.value ?: throw IllegalStateException("Fotos nicht geladen.")
                val mine = EbayRepository.photosOf(fresh, listingId)
                val i = mine.indexOfFirst { it.photoId == photoId }
                val j = i + delta
                if (i < 0 || j < 0 || j >= mine.size) return@launch
                val ids = mine.map { it.photoId }.toMutableList()
                val tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp
                EbayRepository.reorder(mine, ids)
                SideStores.listingPhotos.refreshAndWait()
                EbayRepository.kick()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Fotos wurden inzwischen geändert – bitte neu öffnen." }
            finally { inFlight.finish(); busy = false }
        }
    }

    fun delete(photoId: String) {
        if (!inFlight.tryStart()) return
        busy = true; error = null
        scope.launch {
            try {
                EbayRepository.deletePhoto(photoId)
                SideStores.listingPhotos.refreshAndWait()
                EbayRepository.kick()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Foto konnte nicht entfernt werden." }
            finally { inFlight.finish(); busy = false }
        }
    }

    // Oben im Composable, nie in einem Zweig.
    var pendingCamera by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) pendingCamera?.let { add(it) } }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) add(uri) }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { val u = PhotoImport.cameraUri(ctx); pendingCamera = u; camera.launch(u) } else error = "Kamera nicht erlaubt."
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (value == null && state.error == null) {
            Text("…", color = Muted, style = MaterialTheme.typography.bodySmall)
        } else if (value == null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Fotos nicht geladen", color = ErrorColor, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { SideStores.listingPhotos.refresh() }, enabled = !state.loading) { Text("Erneut versuchen") }
            }
        } else {
            Text(EbayMarks.photoCountText(photos.size), color = Muted, style = MaterialTheme.typography.labelSmall)
            if (photos.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(photos, key = { it.photoId }) { p ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            AsyncImage(
                                model = PhotoScale.publicUrl(SupabaseCloud.base(), p.path), contentDescription = null,
                                modifier = Modifier.size(72.dp).clip(RoundedCornerShape(6.dp)),
                            )
                            Row {
                                TextButton(onClick = { move(p.photoId, -1) }, enabled = enabled && !busy, contentPadding = PaddingValues(2.dp)) { Text("◀") }
                                TextButton(onClick = { move(p.photoId, 1) }, enabled = enabled && !busy, contentPadding = PaddingValues(2.dp)) { Text("▶") }
                                TextButton(onClick = { confirmDelete = p.photoId }, enabled = enabled && !busy, contentPadding = PaddingValues(2.dp)) {
                                    Text("✕", color = ErrorColor)
                                }
                            }
                        }
                    }
                }
            }
        }
        val limitReached = photos.size >= PhotoScale.MAX_PHOTOS
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = {
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        val u = PhotoImport.cameraUri(ctx); pendingCamera = u; camera.launch(u)
                    } else cameraPermission.launch(Manifest.permission.CAMERA)
                },
                enabled = enabled && !busy && !limitReached,
            ) { Text("Foto aufnehmen") }
            OutlinedButton(
                onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                enabled = enabled && !busy && !limitReached,
            ) { Text("Aus Galerie") }
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
    }

    confirmDelete?.let { id ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Foto entfernen?") },
            confirmButton = { TextButton(onClick = { confirmDelete = null; delete(id) }) { Text("Entfernen") } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Abbrechen") } },
        )
    }
}
