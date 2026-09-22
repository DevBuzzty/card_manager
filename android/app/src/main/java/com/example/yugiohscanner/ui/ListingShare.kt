package com.example.yugiohscanner.ui

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.example.yugiohscanner.cloud.SupabaseCloud
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.util.Locale

/**
 * Spec H3a §5.6 -- Katalogbilder in den App-Cache laden und über das Android-Teilen-Menü teilen. Nicht ladbare Bilder
 * werden übersprungen; nur https. Dateinamen wie am PC (listing-images.cjs#imageFileName). Gleichnamige Dateien werden
 * beim nächsten Teilen überschrieben; geteilt werden nur die in diesem Lauf geschriebenen.
 */
object ListingShare {
    const val CACHE_DIR = "listing_images"
    const val AUTHORITY_SUFFIX = ".fileprovider"
    private val EXT = Regex("\\.(jpe?g|png|webp)(?:$|\\?)", RegexOption.IGNORE_CASE)

    fun fileName(index: Int, url: String): String =
        String.format(Locale.ROOT, "%02d", index + 1) + (EXT.find(url)?.groupValues?.get(1)?.lowercase(Locale.ROOT)?.let { ".$it" } ?: ".jpg")

    /** -> (geteilt, gesamt). Öffnet das Teilen-Menü nur, wenn mindestens ein Bild geladen wurde. */
    suspend fun shareImages(ctx: Context, title: String, urls: List<String>): Pair<Int, Int> {
        val list = urls.filter { it.isNotEmpty() }.distinct()
        val uris = ArrayList<Uri>()
        withContext(Dispatchers.IO) {
            val dir = File(ctx.cacheDir, CACHE_DIR).apply { mkdirs() }
            list.forEachIndexed { i, u ->
                if (!u.startsWith("https://", ignoreCase = true)) return@forEachIndexed
                try {
                    SupabaseCloud.http().newCall(Request.Builder().url(u).build()).execute().use { r ->
                        val bytes = if (r.isSuccessful) r.body?.bytes() else null
                        if (bytes != null && bytes.isNotEmpty()) {
                            val f = File(dir, fileName(i, u))
                            f.writeBytes(bytes)
                            uris += FileProvider.getUriForFile(ctx, ctx.packageName + AUTHORITY_SUFFIX, f)
                        }
                    }
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { /* Bild übersprungen (Spec §5.6) */ }
            }
        }
        if (uris.isNotEmpty()) {
            val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                putExtra(Intent.EXTRA_TITLE, title)
                // Leserecht muss über ClipData auch den Auswahldialog erreichen.
                clipData = ClipData.newRawUri(title, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(Intent.createChooser(send, "Bilder teilen").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
        return uris.size to list.size
    }
}
