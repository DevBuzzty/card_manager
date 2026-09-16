package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.ml.ImportCard
import kotlinx.coroutines.test.runTest
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

    @Test fun `Import gelingt, nichts geloescht`() = runTest {
        val deleted = mutableListOf<Long>()
        val inserted = mutableListOf<Long>()
        val id = DecksRepository.createWithRollback(create = { 7L }, insertCards = { inserted.add(it) }, delete = { deleted.add(it) })
        assertEquals(7L, id)
        assertEquals(listOf(7L), inserted)
        assertTrue(deleted.isEmpty())
    }
}
