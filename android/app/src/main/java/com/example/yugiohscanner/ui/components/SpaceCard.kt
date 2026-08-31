package com.example.yugiohscanner.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.SurfaceColor

// Dark rounded surface with a subtle violet border — the container for list rows
// and detail sections across the app.
@Composable
fun SpaceCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = SurfaceColor,
        border = BorderStroke(1.dp, Line),
        content = content,
    )
}
