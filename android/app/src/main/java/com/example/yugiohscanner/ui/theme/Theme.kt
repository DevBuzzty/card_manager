package com.example.yugiohscanner.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val SpaceColorScheme = darkColorScheme(
    primary = Primary,
    onPrimary = Color.White,
    secondary = VioletSoft,
    onSecondary = Color.White,
    background = Background,
    onBackground = OnSurface,
    surface = SurfaceColor,
    onSurface = OnSurface,
    surfaceVariant = Line,
    onSurfaceVariant = Muted,
    outline = Line,
    error = ErrorColor,
    onError = Color.White,
)

private val SpaceShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SpaceColorScheme,
        typography = AppTypography,
        shapes = SpaceShapes,
        content = content,
    )
}
