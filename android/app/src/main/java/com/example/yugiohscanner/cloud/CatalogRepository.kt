package com.example.yugiohscanner.cloud

import android.content.Context
import android.database.Cursor
import com.example.yugiohscanner.ml.CatalogNameRow
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.LegalityCatalog
import com.example.yugiohscanner.ml.LegalityInfo

/**
 * Read-only access to the local offline catalog ([CatalogDb]). This is the only way the rest of
 * the app should read catalog data — writes go through [CatalogDb.importAll] (Task 7).
 */
object CatalogRepository {
    private var db: CatalogDb? = null

    /** Call once (e.g. Activity onCreate). Safe to call repeatedly. */
    fun init(context: Context) {
        if (db != null) return
        db = CatalogDb(context.applicationContext)
    }

    /** True once a catalog has been imported at least once. */
    fun isReady(): Boolean = version() > 0

    /** Version of the imported catalog, or 0 if none. Uses the shared connection — callers
     *  (e.g. the settings screen) must not open a second [CatalogDb] on the same file. */
    fun version(): Int = db?.version() ?: 0

    /** Number of cards in the imported catalog, or 0 if none. Shared connection, see [version]. */
    fun cardCount(): Int = db?.cardCount() ?: 0

    /** Anzahl der Sealed-Produkte im importierten Katalog; 0 ohne Katalog oder mit Katalog von vor G3. */
    fun sealedProductCount(): Int = db?.sealedProductCount() ?: 0

    fun card(passcode: String): CatalogCard? {
        val database = db?.readableDatabase ?: return null
        val card = database.query(
            "cards", null, "id = ?", arrayOf(passcode), null, null, null
        ).use { c -> if (c.moveToFirst()) readCard(c) else null } ?: return null
        return card.copy(printings = printings(passcode))
    }

    fun printings(passcode: String): List<CatalogPrinting> {
        val database = db?.readableDatabase ?: return emptyList()
        val result = mutableListOf<CatalogPrinting>()
        database.query(
            "printings",
            arrayOf("code", "rarity", "lang", "verified"),
            "card_id = ?",
            arrayOf(passcode),
            null, null, "ord"
        ).use { c ->
            while (c.moveToNext()) {
                result.add(
                    CatalogPrinting(
                        code = c.getString(0),
                        rarity = c.getString(1),
                        lang = if (c.isNull(2)) null else c.getString(2),
                        verified = c.getInt(3) != 0
                    )
                )
            }
        }
        return result
    }

    /**
     * Case-insensitive substring search over the German and English names. `%`, `_` and `\` in
     * [name] are escaped so user input can never widen the LIKE pattern (e.g. a literal search
     * for "100%" must not match everything).
     */
    fun search(name: String, limit: Int = 50): List<CatalogCard> {
        val database = db?.readableDatabase ?: return emptyList()
        val pattern = "%${escapeLike(name)}%"
        val results = mutableListOf<CatalogCard>()
        database.rawQuery(
            "SELECT * FROM cards WHERE name_de LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\' LIMIT ?",
            arrayOf(pattern, pattern, limit.toString())
        ).use { c ->
            while (c.moveToNext()) {
                results.add(readCard(c))
            }
        }
        return results.map { it.copy(printings = printings(it.id)) }
    }

    /** Spec G3 §3: SQL und Argumente der Sealed-Suche -- rein, damit die Escape-Regel ohne SQLite testbar ist. */
    internal fun sealedSearchQuery(name: String, limit: Int = 50): Pair<String, Array<String>> =
        "SELECT cm_product_id, name, kind, trend FROM sealed_products WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?" to
            arrayOf("%${escapeLike(name.trim())}%", limit.toString())

    /** Name enthaelt Suchtext (escaptes LIKE wie [search]), max. [limit], sortiert nach Name. */
    fun searchSealed(name: String, limit: Int = 50): List<CatalogSealedProduct> {
        val database = db?.readableDatabase ?: return emptyList()
        if (name.isBlank()) return emptyList()
        val (sql, args) = sealedSearchQuery(name, limit)
        val results = mutableListOf<CatalogSealedProduct>()
        database.rawQuery(sql, args).use { c ->
            while (c.moveToNext()) {
                results.add(
                    CatalogSealedProduct(
                        cmProductId = c.getLong(0),
                        name = c.getString(1) ?: "",
                        kind = c.getString(2) ?: "other",
                        trend = if (c.isNull(3)) null else c.getDouble(3),
                    )
                )
            }
        }
        return results
    }

    /** Spec E1 §5: SQL und Argumente fuer die Katalogpreise mehrerer Passcodes -- rein, damit ohne SQLite testbar. */
    internal fun cmPriceQuery(ids: List<String>): Pair<String, Array<String>> =
        "SELECT id, cm_price FROM cards WHERE id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /**
     * Katalogpreis je Passcode; fehlt der Passcode, steht er nicht in der Map (gilt als "ohne Preis"). In Bloecken zu
     * 500, weil SQLite hoechstens 999 Parameter annimmt. Aufrufer lesen abseits des Hauptthreads.
     */
    fun cmPrices(ids: Collection<String>): Map<String, Double?> {
        val database = db?.readableDatabase ?: return emptyMap()
        val out = HashMap<String, Double?>()
        for (chunk in ids.distinct().chunked(500)) {
            val (sql, args) = cmPriceQuery(chunk)
            database.rawQuery(sql, args).use { c ->
                while (c.moveToNext()) out[c.getString(0)] = if (c.isNull(1)) null else c.getDouble(1)
            }
        }
        return out
    }

    /** Spec E2 §4: SQL fuer den Import -- rein, damit ohne SQLite testbar. ids null = alle Karten, ohne Bild. */
    internal fun importRowsQuery(ids: List<String>?): Pair<String, Array<String>> =
        if (ids == null) "SELECT id, name_de, name_en, type, NULL FROM cards" to emptyArray()
        else "SELECT id, name_de, name_en, type, image FROM cards WHERE id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /**
     * Spec E2 §4: Namen und Typ fuer die Namensaufloesung -- mit [ids] nur diese Passcodes (samt Bild, in Bloecken zu 500),
     * mit null alle Karten ohne Bild. Die Liste lebt nur waehrend des Imports. Aufrufer lesen abseits des Hauptthreads.
     */
    fun importRows(ids: Collection<String>?): List<CatalogNameRow> {
        val database = db?.readableDatabase ?: return emptyList()
        val out = ArrayList<CatalogNameRow>()
        val chunks: List<List<String>?> = ids?.distinct()?.chunked(500) ?: listOf(null)
        for (chunk in chunks) {
            val (sql, args) = importRowsQuery(chunk)
            database.rawQuery(sql, args).use { c ->
                while (c.moveToNext()) {
                    out.add(CatalogNameRow(c.getString(0), c.getString(1), c.getString(2), c.getString(3), if (c.isNull(4)) null else c.getString(4)))
                }
            }
        }
        return out
    }

    /** Spec E3 §3: SQL der Artwork-Zuordnung mehrerer Passcodes -- rein, damit ohne SQLite testbar. */
    internal fun aliasesQuery(ids: List<String>): Pair<String, Array<String>> =
        "SELECT alt_id, card_id FROM card_aliases WHERE alt_id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /** Spec E3 §4: SQL der Legalitaetsdaten mehrerer Haupt-Passcodes -- rein, damit ohne SQLite testbar. */
    internal fun legalityQuery(ids: List<String>): Pair<String, Array<String>> =
        "SELECT id, name_de, name_en, type, ban_tcg, ban_ocg FROM cards WHERE id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /** Spec E3 §3: Artwork-Passcode -> Haupt-Passcode fuer die [ids], die Artworks sind (Bloecke zu 500). Ohne Katalog leer. */
    fun aliases(ids: Collection<String>): Map<String, String> {
        val database = db?.readableDatabase ?: return emptyMap()
        val out = HashMap<String, String>()
        for (chunk in ids.distinct().chunked(500)) {
            val (sql, args) = aliasesQuery(chunk)
            database.rawQuery(sql, args).use { c -> while (c.moveToNext()) out[c.getString(0)] = c.getString(1) }
        }
        return out
    }

    /** Spec E3 §7: Baudatum des importierten Katalogs ("Banlist-Stand"), null ohne Katalog. */
    fun builtAt(): String? = db?.meta("built_at")

    /**
     * Spec E3 §4: Legalitaetsdaten fuer die Deckkarten-Passcodes [ids] -- Zuordnung und die Hauptkarten mit Name, Typ und
     * Banlist. null ohne Katalog oder mit einem Katalog von vor E3 (meta.legality != "1") -> "Katalog fehlt – Banlist
     * unbekannt". Aufrufer lesen abseits des Hauptthreads.
     */
    fun legalityCatalog(ids: Collection<String>): LegalityCatalog? {
        val helper = db ?: return null
        if (!isReady() || helper.meta("legality") != "1") return null
        val database = helper.readableDatabase
        val aliases = aliases(ids)
        val cards = HashMap<String, LegalityInfo>()
        for (chunk in ids.map { DeckImport.canonicalPasscode(it, aliases) }.distinct().chunked(500)) {
            val (sql, args) = legalityQuery(chunk)
            database.rawQuery(sql, args).use { c ->
                while (c.moveToNext()) {
                    fun s(i: Int) = if (c.isNull(i)) null else c.getString(i)
                    cards[c.getString(0)] = LegalityInfo(s(1)?.takeIf { it.isNotEmpty() } ?: s(2)?.takeIf { it.isNotEmpty() }, s(3), s(4), s(5))
                }
            }
        }
        return LegalityCatalog(aliases, cards, helper.meta("built_at"))
    }

    private fun escapeLike(input: String): String =
        input.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    private fun readCard(c: Cursor): CatalogCard {
        fun idx(col: String) = c.getColumnIndexOrThrow(col)
        fun intOrNull(col: String): Int? {
            val i = idx(col)
            return if (c.isNull(i)) null else c.getInt(i)
        }
        fun strOrNull(col: String): String? {
            val i = idx(col)
            return if (c.isNull(i)) null else c.getString(i)
        }
        return CatalogCard(
            id = c.getString(idx("id")),
            nameDe = c.getString(idx("name_de")),
            nameEn = c.getString(idx("name_en")),
            type = c.getString(idx("type")),
            descDe = c.getString(idx("desc_de")),
            atk = intOrNull("atk"),
            def = intOrNull("def"),
            level = intOrNull("level"),
            race = strOrNull("race"),
            attribute = strOrNull("attribute"),
            image = c.getString(idx("image")),
            imageSmall = c.getString(idx("image_small")),
            printings = emptyList(),
            cmPrice = c.getColumnIndex("cm_price").takeIf { it >= 0 && !c.isNull(it) }?.let { c.getDouble(it) },
        )
    }
}
