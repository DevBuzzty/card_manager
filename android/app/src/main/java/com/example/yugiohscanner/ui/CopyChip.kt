package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Warn

// "NM · Unbek." chip; tap opens the two rows (Zustand, Edition). Warn when off the standard.
@Composable
fun CopyChip(edition: String, condition: String, onChange: (edition: String, condition: String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val std = edition == "unknown" && condition == "NM"
    val tint = if (std) Muted else Warn
    Box {
        Text(
            "$condition · ${Valuation.EDITION_LABELS[edition] ?: edition}",
            style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = tint,
            modifier = Modifier
                .border(1.dp, tint.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                .background(tint.copy(alpha = if (std) 0.08f else 0.15f), RoundedCornerShape(8.dp))
                .clickable { open = true }
                .padding(horizontal = 8.dp, vertical = 5.dp),
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text("Zustand", style = MaterialTheme.typography.labelSmall, color = Muted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            Row(Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Valuation.CONDITIONS.forEach { c ->
                    FilterChip(selected = c == condition, onClick = { onChange(edition, c) }, label = { Text(c, fontFamily = MonoFontFamily) })
                }
            }
            Text("Edition", style = MaterialTheme.typography.labelSmall, color = Muted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Valuation.EDITIONS.forEach { e ->
                    FilterChip(selected = e == edition, onClick = { onChange(e, condition); open = false }, label = { Text(Valuation.EDITION_LABELS[e] ?: e) })
                }
            }
        }
    }
}
