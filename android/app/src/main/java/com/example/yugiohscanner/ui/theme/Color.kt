package com.example.yugiohscanner.ui.theme

import androidx.compose.ui.graphics.Color

// Desktop "space" palette (from tailwind.config.js), mapped to Compose colors.
val Background = Color(0xFF121212)   // space-black
val SurfaceColor = Color(0xFF1E1E1E) // space-charcoal (cards / sheets)
val Line = Color(0xFF2C2440)         // subtle border / track

val Primary = Color(0xFF9D00FF)      // space-violet
val VioletSoft = Color(0xFFB957FF)   // soft accent

val OnSurface = Color(0xFFE0E0E0)    // space-white
val Muted = Color(0xFF9A90B0)        // ink-muted (secondary text)

val ErrorColor = Color(0xFFFF5D6C)   // crit
val Good = Color(0xFF39D98A)
val Gold = Color(0xFFF5C542)         // warn / value

// Rarity accents.
val RarityCommon = Color(0xFF8A8594)
val RarityRare = Color(0xFF6DB4E8)
val RaritySuper = Color(0xFFE8C76D)
val RarityUltra = Color(0xFFF5C542)
val RaritySecret = Color(0xFFFF5DB1)

// Type / frame accents.
val TypeMonster = Color(0xFFE8944A)
val TypeSpell = Color(0xFF1DA891)
val TypeTrap = Color(0xFFC4568A)

// Case-insensitive "contains" matching, most-specific first; sensible default.
fun rarityColor(rarity: String?): Color {
    val r = rarity?.lowercase() ?: return RarityCommon
    return when {
        r.contains("secret") -> RaritySecret
        r.contains("ultra") -> RarityUltra
        r.contains("super") -> RaritySuper
        r.contains("rare") -> RarityRare
        r.contains("common") -> RarityCommon
        else -> RarityCommon
    }
}

fun typeColor(type: String?): Color {
    val t = type?.lowercase() ?: return TypeMonster
    return when {
        t.contains("spell") -> TypeSpell
        t.contains("trap") -> TypeTrap
        else -> TypeMonster
    }
}
