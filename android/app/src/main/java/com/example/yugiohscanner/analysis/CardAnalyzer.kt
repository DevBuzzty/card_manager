package com.example.yugiohscanner.analysis

import android.util.Log
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.regex.Pattern

class CardAnalyzer(private val onCodeDetected: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    // Yu-Gi-Oh codes are 8 digits.
    // Regex matches 8 digits exactly, surrounded by word boundaries.
    private val pattern = Pattern.compile("\\b\\d{8}\\b")

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
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
                            break // Found one, that's enough for this frame
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
