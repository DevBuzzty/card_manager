package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.FileSnapshotStore
import com.example.yugiohscanner.cloud.SnapshotCursors
import com.example.yugiohscanner.cloud.StoreSnapshot
import com.example.yugiohscanner.cloud.StoreSnapshotCodec
import com.example.yugiohscanner.cloud.SupabaseCloud
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.lang.reflect.Modifier
import java.nio.file.Files
import java.time.Instant
import java.util.Base64

/** Kaltstart-Zwischenspeicher: Binaerformat des gespeicherten Sammlungsstands. */
class StoreSnapshotCodecTest {

    // Jedes Feld mit einem Wert UNGLEICH seinem Standard -- sonst faellt ein vergessenes Feld nicht auf.
    private val fullCard = CardRow(
        id = "46986414", setCode = "LOB-DE005", language = "DE", name = "Dunkler Magier", imageUrl = "https://x/y.jpg",
        rarity = "Ultra Rare", quantity = 3, price = 12.5, type = "Normal Monster", desc = "Ä ö ü ß – „Zitat“",
        atk = 2500, def = 2100, level = 7, race = "Spellcaster", attribute = "DARK", deleted = true,
        updatedAt = "2026-09-24T10:00:00.123+00:00", priceLocked = 2, priceFirstEd = 30.0, cmFirstEdFactor = 1.8,
    )
    private val sparseCard = CardRow("1", "Unknown", "EN", null, null, null, 0, null)
    private val fullCopy = CopyRow(
        copyId = "c-1", cardId = "46986414", setCode = "LOB-DE005", language = "DE", rarity = "Ultra Rare",
        edition = "first", condition = "EX", deleted = true, containerId = "box-1", page = 2, slot = 7,
        tags = "[\"Tausch\"]", note = "Knick links", createdAt = "2026-09-01T08:00:00+00:00",
        updatedAt = "2026-09-24T10:00:00+00:00", forSale = true,
    )
    private val sparseCopy = CopyRow("c-2", "1", "Unknown", "EN", "Unknown", "unknown", "NM", false, null, null, null, null, null)
    private val fullContainer = ContainerRow("box-1", "Ordner A", "binder", 9, "#7C3AED", 3, true, "2026-09-24T10:00:00+00:00")
    private val sparseContainer = ContainerRow("box-2", "Box", "box", null, null, 0)

    private val snapshot = StoreSnapshot(
        account = "3f0c-user", savedAt = Instant.parse("2026-09-24T10:15:30.123Z"),
        cards = listOf(fullCard, sparseCard), copies = listOf(fullCopy, sparseCopy), containers = listOf(fullContainer, sparseContainer),
        cursors = SnapshotCursors("2026-09-24T10:00:00+00:00", "2026-09-24T10:05:00Z", null, "b", "c", null),
    )

    private fun roundTrip(s: StoreSnapshot): StoreSnapshot? {
        val out = ByteArrayOutputStream()
        StoreSnapshotCodec.encode(s, out)
        return StoreSnapshotCodec.decode(ByteArrayInputStream(out.toByteArray()))
    }

    @Test fun `alle Felder ueberstehen Schreiben und Lesen`() {
        assertEquals(snapshot, roundTrip(snapshot))
    }

    @Test fun `leerer Stand`() {
        val empty = snapshot.copy(cards = emptyList(), copies = emptyList(), containers = emptyList(), cursors = SnapshotCursors())
        assertEquals(empty, roundTrip(empty))
    }

    /** Waechter: ein neues Feld an einer Zeilenklasse muss in den Codec (und VERSION hoch), sonst ginge es beim Kaltstart verloren. */
    @Test fun `Codec kennt genau die Felder der Zeilenklassen`() {
        fun fields(c: Class<*>) = c.declaredFields.count { !Modifier.isStatic(it.modifiers) }
        assertEquals("CardRow: Feld ergaenzt? StoreSnapshotCodec anpassen und VERSION erhoehen", 20, fields(CardRow::class.java))
        assertEquals("CopyRow: Feld ergaenzt? StoreSnapshotCodec anpassen und VERSION erhoehen", 16, fields(CopyRow::class.java))
        assertEquals("ContainerRow: Feld ergaenzt? StoreSnapshotCodec anpassen und VERSION erhoehen", 8, fields(ContainerRow::class.java))
    }

    @Test fun `andere Version oder fremde Datei wird nicht gelesen`() {
        val out = ByteArrayOutputStream()
        StoreSnapshotCodec.encode(snapshot, out)
        val bytes = out.toByteArray()
        bytes[7] = (StoreSnapshotCodec.VERSION + 1).toByte()           // Versionsfeld (Bytes 4..7)
        assertNull(StoreSnapshotCodec.decode(ByteArrayInputStream(bytes)))
        assertNull(StoreSnapshotCodec.decode(ByteArrayInputStream("kein Stand".toByteArray() + ByteArray(8))))
    }

    @Test fun `Datei schreiben, lesen, abgeschnitten, loeschen`() {
        val dir = Files.createTempDirectory("kaltstart").toFile()
        try {
            val file = File(dir, "sammlung.bin")
            val store = FileSnapshotStore(file)
            assertNull("ohne Datei", store.read())
            store.write(snapshot)
            assertEquals(snapshot, store.read())
            assertEquals("keine Zwischendatei", listOf("sammlung.bin"), dir.list()!!.toList())

            file.writeBytes(file.readBytes().copyOf(40))                  // abgeschnitten
            assertNull("kaputte Datei liefert null statt zu werfen", store.read())

            store.write(snapshot)
            store.delete()
            assertNull(store.read())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun `Nutzer-ID aus dem Token`() {
        fun b64(s: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(s.toByteArray())
        val token = b64("{\"alg\":\"HS256\"}") + "." + b64("{\"sub\":\"3f0c-user\",\"role\":\"authenticated\"}") + ".sig"
        assertEquals("3f0c-user", SupabaseCloud.jwtSubject(token))
        assertNull(SupabaseCloud.jwtSubject("kaputt"))
        assertNull(SupabaseCloud.jwtSubject(b64("{}") + "." + b64("{\"role\":\"anon\"}") + ".x"))
    }
}
