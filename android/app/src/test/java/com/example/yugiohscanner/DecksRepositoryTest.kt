package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
}
