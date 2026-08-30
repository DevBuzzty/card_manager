package com.example.yugiohscanner.ml

/**
 * Stabilises live detections across frames. Associates each detection to a track by IoU;
 * a track confirms (emitted once) after the same passcode has been seen [need] times.
 * Tracks not matched in a frame are dropped so a card leaving + re-entering re-scans.
 */
class BoxTracker(private val need: Int = 3, private val iouThresh: Float = 0.4f) {

    private data class Track(
        var box: Box,
        val votes: HashMap<Int, Int> = HashMap(),
        var emitted: Boolean = false,
    )

    private val tracks = ArrayList<Track>()

    /** Feed one frame's detections; returns the detections that JUST reached confirmation. */
    fun update(dets: List<Detection>): List<Detection> {
        val newlyConfirmed = ArrayList<Detection>()
        val matched = BooleanArray(tracks.size)

        for (d in dets) {
            var best = -1
            var bestIoU = iouThresh
            for (i in tracks.indices) {
                val u = iou(d.box, tracks[i].box)
                if (u >= bestIoU) { bestIoU = u; best = i }
            }
            val tr = if (best >= 0) { matched[best] = true; tracks[best] }
                     else Track(d.box).also { tracks.add(it) }
            tr.box = d.box
            val c = (tr.votes[d.passcode] ?: 0) + 1
            tr.votes[d.passcode] = c
            if (!tr.emitted && c >= need) { tr.emitted = true; newlyConfirmed.add(d) }
        }

        // Drop tracks not seen this frame. `matched` is sized to the pre-loop track count,
        // so tracks added this frame (index >= matched.size) are never removed — correct.
        for (m in matched.indices.reversed()) if (!matched[m]) tracks.removeAt(m)

        return newlyConfirmed
    }

    private fun iou(a: Box, b: Box): Float {
        val ix1 = maxOf(a.x1, b.x1); val iy1 = maxOf(a.y1, b.y1)
        val ix2 = minOf(a.x2, b.x2); val iy2 = minOf(a.y2, b.y2)
        val iw = maxOf(0f, ix2 - ix1); val ih = maxOf(0f, iy2 - iy1)
        val inter = iw * ih
        val union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
        return if (union <= 0f) 0f else inter / union
    }
}
