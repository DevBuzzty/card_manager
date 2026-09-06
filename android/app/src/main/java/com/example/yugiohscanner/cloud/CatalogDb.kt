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
class CatalogDb(context: Context) : SQLiteOpenHelper(context.applicationContext, "catalog.db", null, 1) {

    init {
        // WAL: [importAll] holds a multi-second write transaction, and readers (scan, search,
        // detail, settings, the first-run banner) hit the same file meanwhile. Without WAL the
        // default journal mode blocks them until the import commits — up to
        // SQLiteDatabaseLockedException. With WAL a reader sees the previous catalog throughout
        // and never waits on the writer.
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE cards (
              id TEXT PRIMARY KEY, name_de TEXT, name_en TEXT, type TEXT, desc_de TEXT,
              atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
              image TEXT, image_small TEXT)
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE printings (
              card_id TEXT NOT NULL, code TEXT NOT NULL, rarity TEXT NOT NULL,
              lang TEXT, verified INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL)
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX printings_card_idx ON printings(card_id)")
        db.execSQL("CREATE INDEX cards_name_de_idx ON cards(name_de)")
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS printings")
        db.execSQL("DROP TABLE IF EXISTS cards")
        db.execSQL("DROP TABLE IF EXISTS meta")
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

            val metaValues = ContentValues()
            metaValues.put("key", "version")
            metaValues.put("value", parsed.version.toString())
            db.insertWithOnConflict("meta", null, metaValues, SQLiteDatabase.CONFLICT_REPLACE)

            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** The version of the currently-imported catalog, or 0 if none has ever been imported. */
    fun version(): Int {
        readableDatabase.query("meta", arrayOf("value"), "key = ?", arrayOf("version"), null, null, null).use { c ->
            if (c.moveToFirst()) return c.getString(0).toIntOrNull() ?: 0
        }
        return 0
    }

    fun cardCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM cards", null).use { c ->
            if (c.moveToFirst()) return c.getInt(0)
        }
        return 0
    }
}
