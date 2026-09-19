package com.example.yugiohscanner.ml

import java.util.Locale

/**
 * Sprache einer Karte aus ihrem gelesenen TEXT statt aus der kleinen Region im Set-Code (19.09.2026).
 *
 * Das Scan-Protokoll zeigte: die Region ("EN"/"DE" in BLGG-EN135) steht oft nur in einem einzigen,
 * verstuemmelten Bild, der Kartentext dagegen ist gross und steht in jedem Bild -- und die OCR liest ihn
 * ohnehin schon mit ("auf den Friedhof | 2000 oder weniger", "ent to the GY: You can"). Gezaehlt werden
 * typische Woerter beider Sprachen ueber ALLE Bilder einer Karte; entschieden wird nur bei klarem
 * Vorsprung, sonst null (dann bleibt es bei Set-Code-Region / verifiziertem Druck).
 * Japanisch liest der lateinische Texterkenner nicht -- bewusst ausgelassen (Nutzer: fast keine JP-Karten).
 */
object SprachHinweis {
    const val MIN_TREFFER = 3
    const val VORSPRUNG = 3.0

    private val DE = setOf(
        "karte", "karten", "fallenkarte", "zauberkarte", "effekt", "friedhof", "spielfeld", "beschwörung",
        "beschworen", "beschwören", "spezialbeschwörung", "spezialbeschwören", "deck", "hand",
        "der", "die", "das", "den", "dem", "des", "und", "oder", "wenn", "kannst", "du", "deine", "deinen",
        "deiner", "deines", "dein", "diese", "dieser", "diesen", "dieses", "eine", "einen", "einer", "eines",
        "ein", "auf", "von", "zu", "zum", "mit", "nicht", "weniger", "mehr", "als", "wird", "werden",
        "auflage", "zerstört", "zerstöre", "gegner", "gegners", "kontrollierst", "aktivieren", "aktiviert",
        "spielzug", "runde", "lege", "wähle", "füge", "hinzu", "kampf", "angriff",
    )
    private val EN = setOf(
        "card", "cards", "trap", "spell", "effect", "graveyard", "gy", "field", "summon", "summoned",
        "special", "deck", "hand", "the", "and", "or", "if", "when", "you", "your", "this", "that", "can",
        "of", "to", "from", "with", "not", "less", "more", "than", "is", "are", "edition", "destroyed",
        "destroy", "opponent", "opponent's", "control", "activate", "activated", "turn", "once", "per",
        "target", "add", "send", "banish", "battle", "attack", "while", "equal", "its", "it",
    )

    /** "DE", "EN" oder null (zu wenig Text / kein klarer Vorsprung). */
    fun aus(texte: List<String>): String? {
        var de = 0
        var en = 0
        for (t in texte) {
            for (w in t.lowercase(Locale.ROOT).split(Regex("[^\\p{L}']+"))) {
                if (w.length < 2) continue
                val inDe = w in DE
                val inEn = w in EN
                // Woerter in beiden Listen ("deck", "hand", "monster") zaehlen fuer keine Seite.
                if (inDe && !inEn) de++
                if (inEn && !inDe) en++
            }
        }
        return when {
            de >= MIN_TREFFER && de >= VORSPRUNG * en -> "DE"
            en >= MIN_TREFFER && en >= VORSPRUNG * de -> "EN"
            else -> null
        }
    }
}
