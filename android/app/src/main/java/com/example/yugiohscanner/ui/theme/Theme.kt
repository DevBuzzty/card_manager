package com.example.yugiohscanner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// Spec I §6.1 -- die gerade aktiven elf Rollen (AppColors.light oder .dark). Fuer Good/Warn, die es
// in Material3s ColorScheme nicht gibt (Color.kt liest hierueber).
val LocalAppRoles = compositionLocalOf { AppColors.light }

// 'light' | 'dark' | 'system' -> tatsaechlicher Modus; alles Unbekannte faellt auf hell zurueck.
fun themeMode(setting: String?, systemDark: Boolean): String = when (setting) {
    "dark" -> "dark"
    "system" -> if (systemDark) "dark" else "light"
    else -> "light"
}

// Abschlussreview C4: JEDES Feld des ColorScheme steht auf einer Rolle -- sonst fielen Material-Bausteine
// (Dialoge: surfaceContainerHigh, Menues: surfaceContainer, gewaehlte Chips/Leisten-Indikator:
// secondaryContainer, Snackbar: inverseSurface ...) auf Materials eigenes Violett/Grau zurueck.
// DesignTokensTest prueft, dass jede Farbe ein Token-Wert ist; Ausnahmen stehen dort mit Namen.
internal fun schema(r: Map<String, Color>, dunkel: Boolean): ColorScheme {
    val gegen = if (dunkel) AppColors.light else AppColors.dark
    return (if (dunkel) darkColorScheme() else lightColorScheme()).copy(
        primary = r.getValue("accent"), onPrimary = r.getValue("accent-fg"),
        primaryContainer = r.getValue("surface-2"), onPrimaryContainer = r.getValue("text"),
        // Auf der getauschten Flaeche (inverseSurface = text) traegt der Akzent des Gegenmodus.
        inversePrimary = gegen.getValue("accent"),
        secondary = r.getValue("accent"), onSecondary = r.getValue("accent-fg"),
        // Restrunde 3: gewaehlte FilterChips/InputChips (und FilledTonalIconButton) tragen secondaryContainer --
        // auf surface-2 hoben sie sich nur mit ~1,1:1 von der Flaeche ab. Volle Akzentflaeche macht die Wahl deutlich.
        secondaryContainer = r.getValue("accent"), onSecondaryContainer = r.getValue("accent-fg"),
        tertiary = r.getValue("accent"), onTertiary = r.getValue("accent-fg"),
        tertiaryContainer = r.getValue("surface-2"), onTertiaryContainer = r.getValue("text"),
        background = r.getValue("bg"), onBackground = r.getValue("text"),
        surface = r.getValue("surface"), onSurface = r.getValue("text"),
        surfaceVariant = r.getValue("surface-2"), onSurfaceVariant = r.getValue("text-muted"),
        // Tonale Erhebung ohne Farbstich: die Toenung ist die Flaeche selbst.
        surfaceTint = r.getValue("surface"),
        inverseSurface = r.getValue("text"), inverseOnSurface = r.getValue("bg"),
        error = r.getValue("bad"), onError = r.getValue("accent-fg"),
        errorContainer = r.getValue("surface-2"), onErrorContainer = r.getValue("text"),
        outline = r.getValue("line"), outlineVariant = r.getValue("line"),
        surfaceBright = r.getValue("surface"), surfaceDim = r.getValue("surface-2"),
        surfaceContainerLowest = r.getValue("surface"), surfaceContainerLow = r.getValue("surface"),
        surfaceContainer = r.getValue("surface"),
        surfaceContainerHigh = r.getValue("surface-2"), surfaceContainerHighest = r.getValue("surface-2"),
        // scrim bleibt Materials Schwarz (Abdunkelung hinter Dialogen, keine Rolle).
    )
}

private val SpaceShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
)

@Composable
fun AppTheme(setting: String?, content: @Composable () -> Unit) {
    val dunkel = themeMode(setting, isSystemInDarkTheme()) == "dark"
    val roles = if (dunkel) AppColors.dark else AppColors.light
    CompositionLocalProvider(LocalAppRoles provides roles) {
        MaterialTheme(
            colorScheme = schema(roles, dunkel),
            typography = AppTypography,
            shapes = SpaceShapes,
            content = content,
        )
    }
}
