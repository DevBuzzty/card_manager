package com.example.yugiohscanner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
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

private fun schema(r: Map<String, Color>, dunkel: Boolean) = (if (dunkel) darkColorScheme() else lightColorScheme()).copy(
    primary = r.getValue("accent"), onPrimary = r.getValue("accent-fg"),
    secondary = r.getValue("accent"), onSecondary = r.getValue("accent-fg"),
    background = r.getValue("bg"), onBackground = r.getValue("text"),
    surface = r.getValue("surface"), onSurface = r.getValue("text"),
    surfaceVariant = r.getValue("surface-2"), onSurfaceVariant = r.getValue("text-muted"),
    outline = r.getValue("line"), error = r.getValue("bad"), onError = r.getValue("accent-fg"),
)

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
