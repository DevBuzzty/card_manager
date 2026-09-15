package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.SealedValue
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.zip.GZIPInputStream

data class CatalogCard(
    val id: String,
    val nameDe: String,
    val nameEn: String,
    val type: String,
    val descDe: String,
    val atk: Int?,
    val def: Int?,
    val level: Int?,
    val race: String?,
    val attribute: String?,
    val image: String,
    val imageSmall: String,
    val printings: List<CatalogPrinting>
)

data class CatalogPrinting(
    val code: String,
    val rarity: String,
    val lang: String?,
    val verified: Boolean
)

/** Spec G3 §3 -- ein Sealed-Produkt aus `sealed_products` im Katalog; `trend` ist der Cardmarket-Trend beim Bau oder null. */
data class CatalogSealedProduct(
    val cmProductId: Long,
    val name: String,
    val kind: String,
    val trend: Double?,
)

data class ParsedCatalog(
    val version: Int,
    val builtAt: String,
    val cards: List<CatalogCard>,
    val sealedProducts: List<CatalogSealedProduct> = emptyList(),
)

object CatalogParser {
    fun parse(gzipped: ByteArray): ParsedCatalog {
        // Decompress the gzipped data
        val decompressed = GZIPInputStream(ByteArrayInputStream(gzipped)).use { input ->
            input.readBytes().decodeToString()
        }

        // Parse JSON
        val rootJson = JSONObject(decompressed)
        val version = rootJson.getInt("version")
        val builtAt = rootJson.getString("built_at")

        // Parse cards
        val cardsArray = rootJson.getJSONArray("cards")
        val cards = mutableListOf<CatalogCard>()

        for (i in 0 until cardsArray.length()) {
            try {
                val cardJson = cardsArray.getJSONObject(i)

                // Skip cards without id or image
                if (!cardJson.has("id") || cardJson.isNull("id") ||
                    !cardJson.has("image") || cardJson.isNull("image")) {
                    continue
                }

                val id = cardJson.getInt("id").toString()
                val nameDe = cardJson.getString("name_de")
                val nameEn = cardJson.getString("name_en")
                val type = cardJson.getString("type")
                val descDe = cardJson.getString("desc_de")
                val image = cardJson.getString("image")
                val imageSmall = cardJson.getString("image_small")

                // Read optional integers: use null if missing or null, not 0
                val atk = if (cardJson.has("atk") && !cardJson.isNull("atk"))
                    cardJson.getInt("atk") else null
                val def = if (cardJson.has("def") && !cardJson.isNull("def"))
                    cardJson.getInt("def") else null
                val level = if (cardJson.has("level") && !cardJson.isNull("level"))
                    cardJson.getInt("level") else null

                // Read optional strings
                val race = if (cardJson.has("race") && !cardJson.isNull("race"))
                    cardJson.getString("race") else null
                val attribute = if (cardJson.has("attribute") && !cardJson.isNull("attribute"))
                    cardJson.getString("attribute") else null

                // Parse printings and printings_verified
                val printings = mutableListOf<CatalogPrinting>()

                // Add verified printings first
                if (cardJson.has("printings_verified") && !cardJson.isNull("printings_verified")) {
                    val verifiedArray = cardJson.getJSONArray("printings_verified")
                    for (j in 0 until verifiedArray.length()) {
                        val printingJson = verifiedArray.getJSONObject(j)
                        val code = printingJson.getString("code")
                        val rarity = printingJson.getString("rarity")
                        val lang = if (printingJson.has("lang") && !printingJson.isNull("lang"))
                            printingJson.getString("lang") else null
                        printings.add(CatalogPrinting(code, rarity, lang, verified = true))
                    }
                }

                // Add unverified printings
                if (cardJson.has("printings") && !cardJson.isNull("printings")) {
                    val unverifiedArray = cardJson.getJSONArray("printings")
                    for (j in 0 until unverifiedArray.length()) {
                        val printingJson = unverifiedArray.getJSONObject(j)
                        val code = printingJson.getString("code")
                        val rarity = printingJson.getString("rarity")
                        printings.add(CatalogPrinting(code, rarity, lang = null, verified = false))
                    }
                }

                val card = CatalogCard(
                    id = id,
                    nameDe = nameDe,
                    nameEn = nameEn,
                    type = type,
                    descDe = descDe,
                    atk = atk,
                    def = def,
                    level = level,
                    race = race,
                    attribute = attribute,
                    image = image,
                    imageSmall = imageSmall,
                    printings = printings
                )
                cards.add(card)
            } catch (e: Exception) {
                // Skip broken cards and continue
                continue
            }
        }

        return ParsedCatalog(
            version = version,
            builtAt = builtAt,
            cards = cards,
            sealedProducts = parseSealedProducts(rootJson),
        )
    }

    /**
     * Spec G3 §3: fehlt der Schluessel (Katalog von vor G3), bleibt die Liste leer. Eintraege ohne gueltige
     * ID oder ohne Namen fallen weg; eine unbekannte Art wird "other", ein Trend <= 0 wird null.
     */
    internal fun parseSealedProducts(root: JSONObject): List<CatalogSealedProduct> {
        val arr = root.optJSONArray("sealed_products") ?: return emptyList()
        val out = mutableListOf<CatalogSealedProduct>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.isNull("cm_product_id") || o.isNull("name")) continue
            val id = o.optLong("cm_product_id", 0L)
            val name = o.optString("name")
            if (id <= 0L || name.isBlank()) continue
            val kind = o.optString("kind").takeIf { it in SealedValue.KIND_LABELS } ?: "other"
            val trend = if (o.isNull("trend")) null else o.optDouble("trend").takeIf { it > 0.0 }
            out.add(CatalogSealedProduct(id, name, kind, trend))
        }
        return out
    }
}
