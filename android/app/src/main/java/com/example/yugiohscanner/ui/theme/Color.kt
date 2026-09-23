package com.example.yugiohscanner.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Spec I §6.1 -- Farbrollen, Werte gespiegelt aus docs/fixtures/design/tokens.json
// (DesignTokensTest.kt prueft die Gleichheit).
object AppColors {
    val light: Map<String, Color> = mapOf(
        "bg" to Color(0xFFF6F4EF), "surface" to Color(0xFFFFFDF8), "surface-2" to Color(0xFFF1EEE7),
        "line" to Color(0xFFE0DBD1), "text" to Color(0xFF1B1A17), "text-muted" to Color(0xFF6C675E),
        "accent" to Color(0xFF4B3F8F), "accent-fg" to Color(0xFFFFFFFF),
        "good" to Color(0xFF3F7D54), "warn" to Color(0xFF9A6B1F), "bad" to Color(0xFFA23B3B),
    )
    val dark: Map<String, Color> = mapOf(
        "bg" to Color(0xFF17181A), "surface" to Color(0xFF1D1F21), "surface-2" to Color(0xFF232528),
        "line" to Color(0xFF2E3134), "text" to Color(0xFFE9EAEC), "text-muted" to Color(0xFF9BA0A6),
        "accent" to Color(0xFF8B6AD6), "accent-fg" to Color(0xFF0F1013),
        "good" to Color(0xFF7FA88A), "warn" to Color(0xFFC9A36B), "bad" to Color(0xFFC07A7A),
    )
}

// Die frueheren Einzelkonstanten -- jetzt Ablesungen aus dem laufenden Schema (Theme.kt#AppTheme),
// damit Hell/Dunkel und der Umschalter auf jedem Bildschirm greifen, der sie schon verwendet.
// "good" und "warn" haben in Material3s ColorScheme keinen eigenen Platz, deshalb ueber
// LocalAppRoles (die elf Rollen selbst) statt ueber MaterialTheme.colorScheme.
val Background: Color @Composable get() = MaterialTheme.colorScheme.background
val SurfaceColor: Color @Composable get() = MaterialTheme.colorScheme.surface
val Line: Color @Composable get() = MaterialTheme.colorScheme.outline

val Primary: Color @Composable get() = MaterialTheme.colorScheme.primary

val OnSurface: Color @Composable get() = MaterialTheme.colorScheme.onSurface
val Muted: Color @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant

val ErrorColor: Color @Composable get() = MaterialTheme.colorScheme.error
val Good: Color @Composable get() = LocalAppRoles.current.getValue("good")
// Ersetzt das fruehere Gold: an jeder Stelle einzeln entschieden, ob "Preis" (-> Text/OnSurface)
// oder "Hinweis" (-> Warn) gemeint war (Spec I §6.2 Regel 3, Task-8-Bericht).
val Warn: Color @Composable get() = LocalAppRoles.current.getValue("warn")

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
