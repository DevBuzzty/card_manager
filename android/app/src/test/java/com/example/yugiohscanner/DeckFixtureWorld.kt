package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.printingKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * Spec E1 -- liest die "world" der Deck-Fixtures (docs/fixtures/decks/coverage.json, fill-box.json) in die Typen des
 * Handys. Ein Exemplar mit printing_deleted bekommt KEINE CardRow (der Speicher fuehrt nur lebende Printings).
 */
class DeckFixtureWorld(world: JSONObject) {
    val containers: List<ContainerRow> = world.getJSONArray("containers").objects().map {
        ContainerRow(it.getString("container_id"), it.getString("name"), it.getString("kind"), null, null, 0, deleted = it.getBoolean("deleted"))
    }
    val decks: List<Deck> = world.getJSONArray("decks").objects().map {
        Deck(it.getLong("id"), it.getString("name"), if (it.isNull("container_id")) null else it.getString("container_id"))
    }
    val copies: List<CopyRow> = world.getJSONArray("copies").objects().map {
        CopyRow(
            it.getString("copy_id"), it.getString("card_id"), it.getString("set_code"), "DE", it.optString("rarity", "Common"),
            it.optString("edition", "unknown"), it.optString("condition", "NM"), it.getBoolean("deleted"),
            containerId = if (it.isNull("container_id")) null else it.getString("container_id"),
            page = if (it.isNull("page")) null else it.optInt("page"),
            slot = if (it.isNull("slot")) null else it.optInt("slot"),
            tags = null, note = null,
        )
    }
    val cards: List<CardRow> = world.getJSONArray("copies").objects()
        .filter { !it.getBoolean("printing_deleted") }
        .map {
            CardRow(
                it.getString("card_id"), it.getString("set_code"), "DE", null, null, it.optString("rarity", "Common"), 1,
                if (it.isNull("price")) null else it.optDouble("price"),
                priceFirstEd = if (it.isNull("price_first_ed")) null else it.optDouble("price_first_ed"),
            )
        }
        .distinctBy { it.printingKey() }

    companion object {
        fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

        fun deckCards(arr: JSONArray): List<DeckCard> = arr.objects().mapIndexed { i, o ->
            DeckCard(i.toLong(), o.getString("card_id"), null, null, o.getInt("count"), o.getString("section"))
        }

        fun prices(o: JSONObject?): Map<String, Double?> =
            o?.keys()?.asSequence()?.associateWith { if (o.isNull(it)) null else o.getDouble(it) } ?: emptyMap()
    }
}
