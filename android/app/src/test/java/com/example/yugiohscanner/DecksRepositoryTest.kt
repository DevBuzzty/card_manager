package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.AddCopyPlan
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.ml.ImportCard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Spec E1 §3/§9 -- Deck liest container_id, Deckkarte liest deck_id, Unique-Verletzung wird zur deutschen Meldung. */
class DecksRepositoryTest {
    @Test fun `Deck liest container_id, null und fehlend werden null`() {
        assertEquals(Deck(1, "Labrynth", "box-rot"), DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"Labrynth","container_id":"box-rot"}""")))
        assertEquals(Deck(2, "Tenpai", null), DecksRepository.parseDeck(JSONObject("""{"id":2,"name":"Tenpai","container_id":null}""")))
        assertEquals(Deck(3, "Alt", null), DecksRepository.parseDeck(JSONObject("""{"id":3,"name":"Alt"}""")))
    }

    @Test fun `Deckkarte liest deck_id`() {
        assertEquals(
            DeckCard(7, "14558127", "Aschblüte", null, 3, "main", deckId = 1),
            DecksRepository.parseCard(JSONObject("""{"id":7,"deck_id":1,"card_id":"14558127","name":"Aschblüte","image_url":null,"count":3,"section":"main"}""")),
        )
    }

    @Test fun `Unique-Verletzung wird zur deutschen Meldung`() {
        val body = """{"code":"23505","details":"Key (container_id)=(box-rot) already exists.","hint":null,"message":"duplicate key value violates unique constraint \"decks_container_unique\""}"""
        assertEquals("Diese Deckbox gehört schon zu einem anderen Deck", DecksRepository.containerErrorMessage(409, body))
        assertEquals("Deckbox zuordnen fehlgeschlagen (403): nein", DecksRepository.containerErrorMessage(403, "nein"))
    }

    @Test fun `Deck liest notes, null und fehlend werden null`() {
        assertEquals(
            Deck(4, "Import", null, "Nicht übernommen beim Import:\nJinzu"),
            DecksRepository.parseDeck(JSONObject("""{"id":4,"name":"Import","container_id":null,"notes":"Nicht übernommen beim Import:\nJinzu"}""")),
        )
        assertEquals(null, DecksRepository.parseDeck(JSONObject("""{"id":5,"name":"Leer","notes":null}""")).notes)
        assertEquals(null, DecksRepository.parseDeck(JSONObject("""{"id":6,"name":"Alt"}""")).notes)
    }

    // Spec E3 §4/§8: fehlt die Spalte format (SQL nicht eingespielt) oder steht Unbekanntes darin -> TCG.
    @Test fun `Deck liest format, fehlend und unbekannt werden tcg`() {
        assertEquals("ocg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":"ocg"}""")).format)
        assertEquals("free", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":"free"}""")).format)
        assertEquals("tcg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A"}""")).format)
        assertEquals("tcg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":null}""")).format)
        assertEquals("tcg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":"goat"}""")).format)
    }

    private fun dc(id: Long, cardId: String, count: Int, section: String) = DeckCard(id, cardId, null, null, count, section)

    // Spec E3 §5: "Hinzufügen" erhoeht die bestehende Zeile statt eine neue anzulegen; die 4. Kopie ist blockiert.
    @Test fun `Hinzufuegen erhoeht die bestehende Zeile im selben Abschnitt`() {
        val cards = listOf(dc(7, "46986414", 1, "main"), dc(8, "46986414", 1, "side"))
        assertEquals(AddCopyPlan.Increment(7, 2), DecksRepository.addCopyPlan(cards, "46986414", "main", "tcg", null))
        assertEquals(AddCopyPlan.Increment(8, 2), DecksRepository.addCopyPlan(cards, "46986414", "side", "tcg", null))
        assertEquals(AddCopyPlan.Insert, DecksRepository.addCopyPlan(cards, "55144522", "main", "tcg", null))
        assertEquals(AddCopyPlan.Insert, DecksRepository.addCopyPlan(listOf(dc(9, "46986414", 1, "side")), "46986414", "main", "tcg", null))
    }

    @Test fun `Hinzufuegen blockiert die vierte Kopie ueber Abschnitte und Artworks, im Format Frei nie`() {
        val cards = listOf(dc(7, "46986414", 2, "main"), dc(8, "46986415", 1, "side"))
        val aliases = mapOf("46986415" to "46986414")
        assertEquals(AddCopyPlan.Blocked, DecksRepository.addCopyPlan(cards, "46986414", "main", "tcg", aliases))
        assertEquals(AddCopyPlan.Blocked, DecksRepository.addCopyPlan(cards, "46986415", "side", "ocg", aliases))
        assertEquals(AddCopyPlan.Increment(7, 3), DecksRepository.addCopyPlan(cards, "46986414", "main", "tcg", null))
        assertEquals(AddCopyPlan.Increment(7, 3), DecksRepository.addCopyPlan(cards, "46986414", "main", "free", aliases))
    }

    @Test fun `Import-Karten als ein JSON-Array mit Katalogbild`() {
        val rows = DecksRepository.importCardsJson(
            42,
            listOf(ImportCard("14558127", "Asche-Blüte & Freudiger Frühling", 3, "main"), ImportCard("27204311", "Nibiru, das Urwesen", 2, "side")),
            mapOf("14558127" to "https://img/14558127.jpg"),
        )
        assertEquals(2, rows.length())
        val first = rows.getJSONObject(0)
        assertEquals(42L, first.getLong("deck_id"))
        assertEquals("14558127", first.getString("card_id"))
        assertEquals("https://img/14558127.jpg", first.getString("image_url"))
        assertEquals(3, first.getInt("count"))
        assertEquals("main", first.getString("section"))
        val second = rows.getJSONObject(1)
        assertTrue("ohne Katalogbild image_url null", second.isNull("image_url"))
        assertEquals("side", second.getString("section"))
    }

    @Test fun `Import scheitern die Karten, wird das leere Deck geloescht und der Fehler weitergereicht`() = runTest {
        val deleted = mutableListOf<Long>()
        val error = runCatching {
            DecksRepository.createWithRollback(
                create = { 42L },
                insertCards = { throw RuntimeException("Karten anlegen fehlgeschlagen (400): kaputt") },
                delete = { deleted.add(it) },
            )
        }.exceptionOrNull()
        assertEquals("Karten anlegen fehlgeschlagen (400): kaputt", error?.message)
        assertEquals(listOf(42L), deleted)
    }

    // F5: bricht der Nutzer waehrend "Anlegen" ab (System-Zurueck), ist der umgebende Scope schon abgebrochen,
    // wenn der Rueckbau anlaeuft -- ohne NonCancellable wuerde `delete` an seinem eigenen Suspension-Punkt
    // (hier withContext) sofort abgebrochen und nie ausgefuehrt; das leere Deck bliebe stehen.
    @Test fun `Abbruch nach dem Insert -- Rueckbau laeuft trotzdem`() = runTest {
        val deleted = mutableListOf<Long>()
        val job = launch {
            DecksRepository.createWithRollback(
                create = { 9L },
                insertCards = {
                    coroutineContext[Job]?.cancel()
                    throw CancellationException("abgebrochen")
                },
                delete = { id -> withContext(Dispatchers.Default) { deleted.add(id) } },
            )
        }
        job.join()
        assertEquals(listOf(9L), deleted)
    }

    @Test fun `Import gelingt, nichts geloescht`() = runTest {
        val deleted = mutableListOf<Long>()
        val inserted = mutableListOf<Long>()
        val id = DecksRepository.createWithRollback(create = { 7L }, insertCards = { inserted.add(it) }, delete = { deleted.add(it) })
        assertEquals(7L, id)
        assertEquals(listOf(7L), inserted)
        assertTrue(deleted.isEmpty())
    }
}
