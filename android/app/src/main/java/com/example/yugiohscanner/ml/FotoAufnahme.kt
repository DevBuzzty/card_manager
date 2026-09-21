package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Fotomodus (Modus "einzeln", Nutzerentscheid 21.09.2026): ein Knopfdruck nimmt eine kurze Serie
 * in voller Sensor-Aufloesung auf und wertet sie mit derselben Erkennung aus wie der Live-Scan.
 *
 * Warum Fotos statt Live-Bilder: im Live-Scan laeuft jedes Bild durch die ganze Kette, deshalb
 * steht die Analyse auf 1080p -- der Versuch mit 2880x2160 brach am 20.09. die Erkennung ein
 * (ueber acht Sekunden bis zur Buchung) und heizte das Geraet. Ein Foto kostet nur, wenn gedrueckt
 * wird. So bekommt die Auflagenzeile (in der Halterung 21 Bildpunkte hoch, zu 32 % gelesen) die
 * volle Aufloesung, ohne dass die Kamera im Hintergrund dauerhaft rechnet.
 *
 * Warum eine Serie: GRUEN verlangt den Set-Code auf zwei Bildern fehlerfrei (ScanConfidence). Das
 * bleibt so -- ein einzelnes verlesenes Foto soll kein falsches Gruen erzeugen koennen.
 */
class FotoAufnahme(private val pipeline: CardPipeline) {

    /** Was eine Serie ergab -- genau die Argumente, die ScanCapture fuer eine Karte erwartet. */
    data class Ergebnis(
        val passcode: Int,
        val evidence: List<String>,
        val frames: List<String>,
        val editionTexts: List<String>,
    )

    /**
     * Nimmt [anzahl] Fotos nacheinander auf, erkennt je Foto die groesste Karte und sammelt die
     * Belege des Seriensiegers. `null`, wenn auf keinem Foto eine Karte zu finden war.
     *
     * Jedes Foto wird sofort ausgewertet und freigegeben, bevor das naechste kommt -- ein Foto in
     * voller Aufloesung ist als Bild rund 50 MB.
     */
    suspend fun serie(capture: ImageCapture, executor: Executor, anzahl: Int = 3): Ergebnis? {
        val t0 = System.currentTimeMillis()
        val jeFoto = ArrayList<Pair<FotoAuswahl.Kandidat?, Detection?>>(anzahl)
        var groesse = "-"
        var ersterRahmen: Bitmap? = null
        for (i in 0 until anzahl) {
            val bild = aufnehmen(capture, executor)
            groesse = "${bild.width}x${bild.height}"
            val dets = withContext(Dispatchers.Default) {
                // Dieselbe Pipeline wie der Live-Scan. Im Fotomodus ist die Live-Analyse zwar gar
                // nicht an die Kamera gebunden, aber ein letzter Lauf kann beim Umschalten noch
                // unterwegs sein -- die Pipeline ist nicht fuer zwei gleichzeitige Laeufe gebaut.
                synchronized(pipeline) { pipeline.process(bild, null) }
            }
            val gewaehlt = dets
                .map { d -> d to FotoAuswahl.Kandidat(d.passcode, (d.box.x2 - d.box.x1) * (d.box.y2 - d.box.y1)) }
                .let { paare -> FotoAuswahl.groesste(paare.map { it.second })?.let { g -> paare.first { it.second == g } } }
            jeFoto.add(gewaehlt?.second to gewaehlt?.first)
            if (i == 0) ersterRahmen = bild else bild.recycle()
        }

        val sieger = FotoAuswahl.sieger(jeFoto.map { it.first })
        val dauer = System.currentTimeMillis() - t0
        if (sieger == null) {
            val foto = ersterRahmen?.let { ScanLog.photo(it, "foto-leer-$t0") }
            ScanLog.line("Foto", "serie=$anzahl groesse=$groesse dauer=${dauer}ms erkannt=- foto=$foto")
            ersterRahmen?.recycle()
            return null
        }
        ersterRahmen?.recycle()

        // Nur die Belege der Fotos, die auch wirklich den Sieger zeigten -- ein verlesenes Foto
        // einer anderen Karte darf dessen Set-Code-Abstimmung nicht mitbestimmen.
        val belege = SetCodeEvidence()
        var treffer = 0
        for ((kandidat, det) in jeFoto) {
            if (kandidat?.passcode == sieger && det != null) {
                belege.record(sieger, det.zoneTexts, det.legacyText)
                treffer++
            }
        }
        val frames = belege.rawTexts(sieger)
        ScanLog.line("Foto", "serie=$anzahl groesse=$groesse dauer=${dauer}ms erkannt=$sieger auf=$treffer/$anzahl")
        return Ergebnis(sieger, belege.setCodeCandidates(sieger) + frames, frames, belege.editionTexts(sieger))
    }

    private suspend fun aufnehmen(capture: ImageCapture, executor: Executor): Bitmap =
        suspendCancellableCoroutine { k ->
            capture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        val roh = image.toBitmap()
                        val grad = image.imageInfo.rotationDegrees
                        // Die Erkennung erwartet ein aufrechtes Bild -- wie MlScanAnalyzer es selbst dreht.
                        val aufrecht = if (grad == 0) roh else Bitmap.createBitmap(
                            roh, 0, 0, roh.width, roh.height, Matrix().apply { postRotate(grad.toFloat()) }, true,
                        ).also { if (it !== roh) roh.recycle() }
                        k.resume(aufrecht)
                    } catch (e: Throwable) {
                        k.resumeWithException(e)
                    } finally {
                        image.close()
                    }
                }

                override fun onError(e: ImageCaptureException) {
                    k.resumeWithException(e)
                }
            })
        }
}
