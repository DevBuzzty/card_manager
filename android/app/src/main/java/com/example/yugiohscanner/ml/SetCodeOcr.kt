package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.Locale
import java.util.regex.Pattern

/**
 * Best-effort set-code reader for rarity resolution. Runs ML Kit text recognition on a card
 * crop and returns any set codes (e.g. RA05-EN129, DOOD-DE038). Same pattern as the legacy
 * CardAnalyzer. Async; the callback runs on the main thread.
 */
class SetCodeOcr {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val pattern = Pattern.compile("\\b[A-Z0-9]{2,5}-[A-Z]{2}\\d{2,4}\\b")

    fun read(crop: Bitmap, onResult: (List<String>) -> Unit) {
        // Grayscale + contrast + upscale so ML Kit can resolve the tiny set-code text.
        val up = OcrPrep.enhance(crop, targetWidth = 1000)
        recognizer.process(InputImage.fromBitmap(up, 0))
            .addOnSuccessListener { visionText ->
                val codes = LinkedHashSet<String>()
                for (block in visionText.textBlocks) {
                    val m = pattern.matcher(block.text.uppercase(Locale.ROOT))
                    while (m.find()) codes.add(m.group())
                }
                onResult(codes.toList())
            }
            .addOnFailureListener { onResult(emptyList()) }
    }

    fun close() = recognizer.close()
}
