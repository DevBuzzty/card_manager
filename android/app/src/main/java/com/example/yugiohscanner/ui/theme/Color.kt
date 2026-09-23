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

// Rarity-/Typ-Farben (rarityColor/typeColor) sind mit Fixrunde 1 (Punkt 1) entfallen: ihr einziger
// Verbraucher war RarityChip/TypeChip, die jetzt neutral sind (Spec §6.2 Regel 3 -- Seltenheit/Typ
// nur als Spielfarbe am Kartenbild, nicht als Text-/Chip-Farbe; ein Kartenbild-Verbraucher existiert
// in dieser App nicht). Von meiner Aenderung verwaist, deshalb entfernt statt liegen gelassen.
