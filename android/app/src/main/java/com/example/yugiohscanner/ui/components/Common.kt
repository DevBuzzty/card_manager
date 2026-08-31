package com.example.yugiohscanner.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import com.example.yugiohscanner.ui.theme.ChakraPetch
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted

// Section label: Chakra Petch, muted, letter-spaced.
@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.titleSmall.copy(
            fontFamily = ChakraPetch,
            letterSpacing = 1.5.sp,
        ),
        color = Muted,
        modifier = modifier,
    )
}

// Monetary value: JetBrains Mono, gold, "%.2f €"; null renders as "—".
@Composable
fun ValueText(euros: Double?, modifier: Modifier = Modifier, style: TextStyle? = null) {
    val base = style ?: MaterialTheme.typography.bodyMedium
    Text(
        text = if (euros == null) "—" else "%.2f €".format(euros),
        style = base.copy(fontFamily = MonoFontFamily),
        color = Gold,
        modifier = modifier,
    )
}
