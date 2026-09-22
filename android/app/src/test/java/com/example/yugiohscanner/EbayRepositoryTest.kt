package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.EbayRepository
import com.example.yugiohscanner.cloud.ListingPhoto
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.PhotoScale
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class EbayRepositoryTest {
    @Test fun `Stand lesen -- ohne Zeile null, ohne Tokens`() {
        assertNull(EbayRepository.parseStatus("[]"))
        val s = EbayRepository.parseStatus("""[{"environment":"sandbox","connected":true,"refresh_expires_at":"2028-03-23T00:00:00+00:00","has_payment_policy":true,"payment_policy_name":"PayPal","has_fulfillment_policy":false,"fulfillment_policy_name":null,"has_return_policy":true,"return_policy_name":"Keine","has_location":true,"location_key":"ygo-default","last_run_at":"2026-09-22T12:00:00+00:00","last_run_summary":"1 eingestellt","last_error":null}]""")!!
        assertEquals(listOf("sandbox", "PayPal", "ygo-default"), listOf(s.environment, s.paymentPolicyName, s.locationKey))
        assertEquals(false, s.hasFulfillmentPolicy)
        val r = EbayRepository.parseRunInfo("""[{"environment":"sandbox","last_run_at":"x","last_run_summary":"1 eingestellt","last_error":null}]""")!!
        assertEquals(listOf("x", "1 eingestellt", null), listOf(r.lastRunAt, r.summary, r.lastError))
    }
    @Test fun `eBay-Zeilen und Fotos blaettern ueber 1000 per Schluessel`() = runBlocking {
        assertEquals("or" to "(listing_id.gt.\"l9\")", EbayRepository.rowsPageParams("l9").last())
        assertEquals("deleted" to "eq.false", EbayRepository.photosPageParams(null)[1])
        // Zusatz zur Task-8-Vorlage: die Fake-Fetch-Funktion unten blaettert selbst per `after`, unabhaengig vom
        // Rueckgabewert von photosPageParams -- ohne diese eigene Zeile waere das Fehlen des `or`-Filters
        // unbemerkt gruen (siehe Bericht). Gleiche Form wie die rowsPageParams-Pruefung oben.
        assertEquals("or" to "(photo_id.gt.\"p00500\")", EbayRepository.photosPageParams("p00500").last())
        val all = (1..1500).map { "p%05d".format(it) }
        var pages = 0
        val got = KeysetPager.all(1000) { after: String? ->
            pages++
            EbayRepository.photosPageParams(after)
            val from = if (after == null) 0 else all.indexOf(after) + 1
            all.subList(from, minOf(from + 1000, all.size))
        }
        assertEquals(listOf(1500, 2), listOf(got.size, pages))
    }
    @Test fun `Zeilen lesen -- Menge null oder Zahl`() {
        val r = EbayRepository.parseRows("""[{"listing_id":"l1","environment":"sandbox","state":"online","item_url":"https://sandbox.ebay.de/itm/I2","error":null,"published_qty":2},{"listing_id":"l2","environment":"sandbox","state":"wartet","item_url":null,"error":null,"published_qty":null}]""")
        assertEquals(listOf(2, null), r.map { it.publishedQty })
        assertEquals("online", r[0].row().state)
    }
    private fun ph(id: String, sort: Int, deleted: Boolean = false) = ListingPhoto(id, "l1", "l1/$id.jpg", sort, deleted)
    @Test fun `Fotos je Angebot sortiert, Reihenfolge nur geaenderte, fremde Menge abgelehnt`() {
        val cur = listOf(ph("b", 1), ph("a", 0), ph("c", 2), ph("x", 0, deleted = true))
        assertEquals(listOf("a", "b", "c"), EbayRepository.photosOf(cur, "l1").map { it.photoId })
        val live = EbayRepository.photosOf(cur, "l1")
        assertEquals(listOf("c" to 0, "a" to 2), EbayRepository.reorderPatches(live, listOf("c", "b", "a")))
        assertThrows(IllegalArgumentException::class.java) { EbayRepository.reorderPatches(live, listOf("c", "b")) }
        val body = JSONObject(EbayRepository.photoInsertBody("u1", "l1", "l1/u1.jpg", 3))
        assertEquals(listOf("u1", "l1", "l1/u1.jpg", 3), listOf(body.getString("photo_id"), body.getString("listing_id"), body.getString("path"), body.getInt("sort")))
    }
    @Test fun `Fotoregeln wie am PC`() {
        assertEquals(1600 to 1200, PhotoScale.scaleSize(4000, 3000))
        assertEquals(533 to 1600, PhotoScale.scaleSize(1000, 3000))
        assertEquals(800 to 600, PhotoScale.scaleSize(800, 600))
        assertEquals(2, PhotoScale.sampleSize(4000, 3000))
        assertEquals(1, PhotoScale.sampleSize(3000, 2000))
        val seen = ArrayList<Int>()
        assertEquals(400_000, PhotoScale.encodeUnder({ q -> seen += q; ByteArray(if (q == 65) 400_000 else 700_000) }).size)
        assertEquals(listOf(85, 75, 65), seen)
        assertEquals(600_000, PhotoScale.encodeUnder({ ByteArray(600_000) }).size)
        assertEquals(listOf(90, 180, 270, 0), listOf(6, 3, 8, 1).map { PhotoScale.rotationForExif(it) })
        assertEquals("l1/u1.jpg", PhotoScale.photoPath("l1", "u1"))
        assertEquals("https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/u1.jpg",
            PhotoScale.publicUrl("https://proj.supabase.co/rest/v1", "l1/u1.jpg"))
    }
    // Zusatz zur Task-8-Vorlage (siehe PhotoScale.kt-Kopfkommentar): volle EXIF-Ausrichtung inkl. Spiegelung fuer
    // alle 8 Tag-Werte, wie listing-photos.cjs#orientBitmap am PC (2/4/5/7 spiegeln zusaetzlich waagrecht).
    @Test fun `EXIF-Transformation fuer alle 8 Faelle, Spiegelung wie am PC`() {
        val want = mapOf(
            1 to PhotoScale.ExifTransform(0, false), 2 to PhotoScale.ExifTransform(0, true),
            3 to PhotoScale.ExifTransform(180, false), 4 to PhotoScale.ExifTransform(180, true),
            5 to PhotoScale.ExifTransform(90, true), 6 to PhotoScale.ExifTransform(90, false),
            7 to PhotoScale.ExifTransform(270, true), 8 to PhotoScale.ExifTransform(270, false),
        )
        for ((o, t) in want) assertEquals("orientation $o", t, PhotoScale.exifTransform(o))
        assertEquals(PhotoScale.ExifTransform(0, false), PhotoScale.exifTransform(0))
    }
}
