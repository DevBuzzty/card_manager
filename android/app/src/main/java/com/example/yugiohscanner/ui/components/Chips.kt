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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

// Neutral pill: keine Rarity-/Typ-Farbe mehr (Fixrunde 1, Punkt 1 -- Spec §6.2 Regel 3: Seltenheit
// und Typ sind Spielfarben nur am Kartenbild, nicht als Text-/Flaechenfarbe). Seltenheit darf fett
// gesetzt sein, das ist die einzige erlaubte Unterscheidung.
@Composable
private fun ChipPill(label: String, bold: Boolean = false) {
    val shape = RoundedCornerShape(50)
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = if (bold) FontWeight.Bold else null,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, shape)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
fun RarityChip(rarity: String?) {
    if (rarity.isNullOrBlank()) return
    ChipPill(rarity, bold = true)
}

@Composable
fun TypeChip(type: String?) {
    if (type.isNullOrBlank()) return
    ChipPill(type)
}
