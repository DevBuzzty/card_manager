package com.example.yugiohscanner.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.theme.rarityColor
import com.example.yugiohscanner.ui.theme.typeColor

// Small colored pill: tinted background + border, label in the accent color.
@Composable
private fun ChipPill(label: String, accent: Color) {
    val shape = RoundedCornerShape(50)
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = accent,
        modifier = Modifier
            .background(accent.copy(alpha = 0.16f), shape)
            .border(BorderStroke(1.dp, accent.copy(alpha = 0.5f)), shape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
fun RarityChip(rarity: String?) {
    if (rarity.isNullOrBlank()) return
    ChipPill(rarity, rarityColor(rarity))
}

@Composable
fun TypeChip(type: String?) {
    if (type.isNullOrBlank()) return
    ChipPill(type, typeColor(type))
}
