package com.example.yugiohscanner.cloud

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Local SQLite store for the offline card catalog downloaded from Supabase Storage
 * (see [CatalogParser]). `CatalogRepository` is the only reader the rest of the app should use;
 * this class owns the schema and the atomic [importAll] write path.
 *
 * `printings.ord` preserves the parser's ordering (verified printings first) across the SQLite
 * round-trip: SQLite does not guarantee rows come back in insertion order, so every read orders
 * explicitly by `ord` — without it, "verified first" would be lost silently.
 */
class CatalogDb(context: Context) : SQLiteOpenHelper(context.applicationContext, "catalog.db", null, VERSION) {

    companion object {
        /**
         * Spec G3 §3: v2 bringt `sealed_products`. Spec E1 §5: v3 bringt `cards.cm_price`.
         * Spec E3 §3: v4 bringt `cards.ban_tcg`/`ban_ocg` und `card_aliases` (Artwork-Passcode -> Haupt-Passcode).
         * onUpgrade verwirft den alten Katalog, CatalogSync laedt neu (ein Katalog v5 ohne cm_price bleibt lesbar).
         */
        const val VERSION = 4

        /** Schema als Liste, damit ohne Geraet pruefbar ist, dass onUpgrade jede angelegte Tabelle verwirft. */
        internal val CREATE_STATEMENTS = listOf(
            """
            CREATE TABLE cards (
              id TEXT PRIMARY KEY, name_de TEXT, name_en TEXT, type TEXT, desc_de TEXT,
              atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
              image TEXT, image_small TEXT, cm_price REAL, ban_tcg TEXT, ban_ocg TEXT)
            """.trimIndent(),
            """
            CREATE TABLE printings (
              card_id TEXT NOT NULL, code TEXT NOT NULL, rarity TEXT NOT NULL,
              lang TEXT, verified INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL)
            """.trimIndent(),
            "CREATE INDEX printings_card_idx ON printings(card_id)",
            "CREATE INDEX cards_name_de_idx ON cards(name_de)",
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)",
            "CREATE TABLE sealed_products (cm_product_id INTEGER PRIMARY KEY, name TEXT, kind TEXT, trend REAL)",
            "CREATE INDEX sealed_products_name_idx ON sealed_products(name)",
            "CREATE TABLE card_aliases (alt_id TEXT PRIMARY KEY, card_id TEXT NOT NULL)",
        )

        internal val DROP_STATEMENTS = listOf(
            "DROP TABLE IF EXISTS printings",
            "DROP TABLE IF EXISTS cards",
            "DROP TABLE IF EXISTS meta",
            "DROP TABLE IF EXISTS sealed_products",
            "DROP TABLE IF EXISTS card_aliases",
        )
    }

    init {
        // WAL: [importAll] holds a multi-second write transaction, and readers (scan, search,
        // detail, settings, the first-run banner) hit the same file meanwhile. Without WAL the
        // default journal mode blocks them until the import commits — up to
        // SQLiteDatabaseLockedException. With WAL a reader sees the previous catalog throughout
        // and never waits on the writer.
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        CREATE_STATEMENTS.forEach { db.execSQL(it) }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        DROP_STATEMENTS.forEach { db.execSQL(it) }
        onCreate(db)
    }

    /**
     * Replaces the whole catalog with [parsed] in a single transaction. If anything throws
     * partway through, [SQLiteDatabase.endTransaction] rolls back everything since
     * [SQLiteDatabase.setTransactionSuccessful] is only reached on full success — the previous
     * catalog (including its `meta.version`) is left completely untouched. `meta.version` is
     * written last, so a reader can never observe a new version number paired with incomplete
     * card/printing rows.
     */
    fun importAll(parsed: ParsedCatalog) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("printings", null, null)
            db.delete("cards", null, null)
            db.delete("sealed_products", null, null)
            db.delete("card_aliases", null, null)

            val cardValues = ContentValues()
            val printingValues = ContentValues()
            for (card in parsed.cards) {
                cardValues.clear()
                cardValues.put("id", card.id)
                cardValues.put("name_de", card.nameDe)
                cardValues.put("name_en", card.nameEn)
                cardValues.put("type", card.type)
                cardValues.put("desc_de", card.descDe)
                cardValues.put("atk", card.atk)
                cardValues.put("def", card.def)
                cardValues.put("level", card.level)
                cardValues.put("race", card.race)
                cardValues.put("attribute", card.attribute)
                cardValues.put("image", card.image)
                cardValues.put("image_small", card.imageSmall)
                if (card.cmPrice == null) cardValues.putNull("cm_price") else cardValues.put("cm_price", card.cmPrice)
                // Spec E3 §3: Banlist je Karte (null = uneingeschraenkt).
                if (card.banTcg == null) cardValues.putNull("ban_tcg") else cardValues.put("ban_tcg", card.banTcg)
                if (card.banOcg == null) cardValues.putNull("ban_ocg") else cardValues.put("ban_ocg", card.banOcg)
                db.insertOrThrow("cards", null, cardValues)

                card.printings.forEachIndexed { index, printing ->
                    printingValues.clear()
                    printingValues.put("card_id", card.id)
                    printingValues.put("code", printing.code)
                    printingValues.put("rarity", printing.rarity)
                    printingValues.put("lang", printing.lang)
                    printingValues.put("verified", if (printing.verified) 1 else 0)
                    printingValues.put("ord", index)
                    db.insertOrThrow("printings", null, printingValues)
                }
            }

            // Spec G3 §3: Sealed-Produktliste in derselben Transaktion (doppelte IDs ersetzen einander).
            val sealedValues = ContentValues()
            for (p in parsed.sealedProducts) {
                sealedValues.clear()
                sealedValues.put("cm_product_id", p.cmProductId)
                sealedValues.put("name", p.name)
                sealedValues.put("kind", p.kind)
                if (p.trend == null) sealedValues.putNull("trend") else sealedValues.put("trend", p.trend)
                db.insertWithOnConflict("sealed_products", null, sealedValues, SQLiteDatabase.CONFLICT_REPLACE)
            }

            // Spec E3 §3: Artwork-Zuordnung in derselben Transaktion.
            val aliasValues = ContentValues()
            for ((alt, main) in parsed.aliases) {
                aliasValues.clear()
                aliasValues.put("alt_id", alt)
                aliasValues.put("card_id", main)
                db.insertWithOnConflict("card_aliases", null, aliasValues, SQLiteDatabase.CONFLICT_REPLACE)
            }

            // Spec E3 §3/§7: Baudatum ("Banlist-Stand") und ob der Katalog Ban-/Artwork-Felder traegt; version zuletzt.
            val metaValues = ContentValues()
            metaValues.put("key", "built_at")
            metaValues.put("value", parsed.builtAt)
            db.insertWithOnConflict("meta", null, metaValues, SQLiteDatabase.CONFLICT_REPLACE)
            metaValues.clear()
            metaValues.put("key", "legality")
            metaValues.put("value", if (parsed.hasLegality) "1" else "0")
            db.insertWithOnConflict("meta", null, metaValues, SQLiteDatabase.CONFLICT_REPLACE)
            metaValues.clear()
            metaValues.put("key", "version")
            metaValues.put("value", parsed.version.toString())
            db.insertWithOnConflict("meta", null, metaValues, SQLiteDatabase.CONFLICT_REPLACE)

            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** The version of the currently-imported catalog, or 0 if none has ever been imported. */
    fun version(): Int = meta("version")?.toIntOrNull() ?: 0

    /** Spec E3: Wert aus `meta` (z. B. "built_at", "legality"), null ohne Eintrag. */
    fun meta(key: String): String? {
        readableDatabase.query("meta", arrayOf("value"), "key = ?", arrayOf(key), null, null, null).use { c ->
            if (c.moveToFirst()) return c.getString(0)
        }
        return null
    }

    fun cardCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM cards", null).use { c ->
            if (c.moveToFirst()) return c.getInt(0)
        }
        return 0
    }

    fun sealedProductCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM sealed_products", null).use { c ->
            if (c.moveToFirst()) return c.getInt(0)
        }
        return 0
    }
}
