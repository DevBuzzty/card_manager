package com.example.yugiohscanner.cloud

import java.util.Locale

/**
 * Spec 2026-11-03 §3.3 -- Seltenheits-Normalisierung: Kurzformen (Konami/eBay) und Schreibvarianten des Katalogs
 * auf einen Schluessel; null = unbekannt ("Unknown", leer, Wiki-Marker wie "New"). Eigene Cardmarket-Produkte
 * (Short Print, Gold-Varianten, Pharaoh's Rare, Duel Terminal) werden nicht zusammengelegt.
 * Twin: supabase/functions/_shared/rarity-norm.ts, Fixture docs/fixtures/rarity-norm.json.
 */
object RarityNorm {
    private val KEINE = setOf(
        "", "unknown", "unbekannt", "new", "reprint", "newartwork", "europeandebut", "oceaniandebut",
        "europeanoceaniandebut", "forcesmw",
    )

    private val ALIAS = mapOf(
        "n" to "common", "c" to "common", "normal" to "common",
        "r" to "rare",
        "sr" to "superrare",
        "ur" to "ultrarare",
        "utr" to "ultimaterare",
        "scr" to "secretrare", "secret" to "secretrare",
        "gr" to "ghostrare", "hr" to "ghostrare", "holographicrare" to "ghostrare",
        "pscr" to "prismaticsecretrare",
        "cr" to "collectorsrare",
        "qcsr" to "quartercenturysecretrare", "qcscr" to "quartercenturysecretrare",
        "20thsr" to "20thsecretrare", "20thscr" to "20thsecretrare",
        "slr" to "starlightrare",
        "plscr" to "platinumsecretrare",
        "starfoil" to "starfoilrare",
        "shatterfoil" to "shatterfoilrare",
        "mosaic" to "mosaicrare",
        "extrasecret" to "extrasecretrare",
        "duelterminalnormalrareparallelrare" to "duelterminalnormalparallelrare",
    )

    private val nichtAlnum = Regex("[^a-z0-9]")

    fun key(raw: String?): String? {
        val s = (raw ?: "").replace("<!--", "").replace("-->", "").trim()
        val n = s.lowercase(Locale.ROOT).replace(nichtAlnum, "")
        if (n in KEINE) return null
        return ALIAS[n] ?: n
    }

    fun gleich(a: String?, b: String?): Boolean {
        val ka = key(a) ?: return false
        return ka == key(b)
    }
}
