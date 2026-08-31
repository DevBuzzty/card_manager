package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.regex.Pattern

/**
 * Synchronous 8-digit passcode reader. Blocks on the ML Kit task, so it MUST be called off
 * the main thread (the camera analyzer runs on a background executor, which is fine).
 */
class PasscodeOcr {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val pattern = Pattern.compile("\\b\\d{8}\\b")

    /** First 8-digit passcode found in the crop, or null. */
    fun read(crop: Bitmap): Int? {
        val text = Tasks.await(recognizer.process(InputImage.fromBitmap(crop, 0)))
        for (block in text.textBlocks) {
            val m = pattern.matcher(block.text)
            if (m.find()) return m.group().toIntOrNull()
        }
        return null
    }

    fun close() = recognizer.close()
}
