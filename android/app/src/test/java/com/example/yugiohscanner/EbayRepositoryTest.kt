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
    // Fixrunde 1, Zusatz zur Task-8-Vorlage: Pixel-Zwilling von listing-photos.cjs#orientBitmap. Dieselbe 2x3-Bitmap
    // und dieselben erwarteten Positionen wie listing-photos.test.cjs (Faelle 2, 3, 6, 8); 5 und 7 von Hand aus
    // denselben orientBitmap-Formeln abgeleitet (siehe Task-8-Fixrunde-1-Bericht fuer die Herleitung).
    // Reihenfolge row-major: (0,0)=A (1,0)=B / (0,1)=C (1,1)=D / (0,2)=E (1,2)=F -- Breite 2, Hoehe 3.
    private val A = 10; private val B = 11; private val C = 12; private val D = 13; private val E = 14; private val F = 15
    private val GRID = intArrayOf(A, B, C, D, E, F)
    @Test fun `orientPixels -- Pixel-Zwilling von orientBitmap, alle 8 Faelle`() {
        fun check(orientation: Int, wantW: Int, wantH: Int, want: List<Int>) {
            val (px, w, h) = PhotoScale.orientPixels(GRID, 2, 3, orientation)
            assertEquals("orientation $orientation", listOf(wantW, wantH, want), listOf(w, h, px.toList()))
        }
        check(1, 2, 3, listOf(A, B, C, D, E, F))
        check(2, 2, 3, listOf(B, A, D, C, F, E))
        check(3, 2, 3, listOf(F, E, D, C, B, A))
        check(4, 2, 3, listOf(E, F, C, D, A, B))
        check(5, 3, 2, listOf(A, C, E, B, D, F))
        check(6, 3, 2, listOf(E, C, A, F, D, B))
        check(7, 3, 2, listOf(F, D, B, E, C, A))
        check(8, 3, 2, listOf(B, D, F, A, C, E))
    }
}
