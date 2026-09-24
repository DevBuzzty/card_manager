package com.example.yugiohscanner.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

// Spec I §6.3 -- eine Schriftfamilie: die Systemschrift. Frueher Chakra Petch/Manrope/JetBrains Mono ueber die
// Google-Fonts-Schnittstelle; der Name MonoFontFamily bleibt fuer die bestehenden Aufrufer (Set-Codes, Preise)
// und loest auf dieselbe Familie auf -- gleich breite Ziffern kommen aus TNUM, nicht aus einer Monospace-Schrift.
val MonoFontFamily: FontFamily = FontFamily.Default

// Spec I §6.3 -- Zahlen mit gleicher Ziffernbreite (wie tabular-nums am PC), damit Preisspalten
// nicht zappeln. Gilt fuer jeden Textstil des Themes.
internal const val TNUM = "tnum"

/**
 * Spec I §6.3 -- vier Groessen (docs/fixtures/design/tokens.json#typo): Ueberschrift 22, Abschnitt 17, Zeile 15,
 * Nebensache 13/12; Zeilenhoehe 1,5. ZWILLING: DesignTokensTest prueft diese Tabelle gegen die Token-Datei.
 */
object TypeScale {
    const val TITEL = 22
    const val ABSCHNITT = 17
    const val ZEILE = 15
    const val NEBEN = 13
    const val NEBEN_KLEIN = 12
}

private fun TextStyle.size(sizeSp: Int, lineHeight: Float = 1.5f) = copy(
    fontFamily = FontFamily.Default,
    fontSize = sizeSp.sp,
    lineHeight = (sizeSp * lineHeight).sp,
    fontFeatureSettings = TNUM,
)

// Material3-Stile auf die vier Groessen abgebildet -- die Regel gilt so an EINER Stelle fuer alle Bildschirme.
val AppTypography: Typography = Typography().run {
    copy(
        displayLarge = displayLarge.size(TypeScale.TITEL, 1.3f),
        displayMedium = displayMedium.size(TypeScale.TITEL, 1.3f),
        displaySmall = displaySmall.size(TypeScale.TITEL, 1.3f),
        headlineLarge = headlineLarge.size(TypeScale.TITEL, 1.3f),
        headlineMedium = headlineMedium.size(TypeScale.TITEL, 1.3f),
        headlineSmall = headlineSmall.size(TypeScale.TITEL, 1.3f),
        titleLarge = titleLarge.size(TypeScale.TITEL, 1.3f),
        titleMedium = titleMedium.size(TypeScale.ABSCHNITT),
        titleSmall = titleSmall.size(TypeScale.ABSCHNITT),
        bodyLarge = bodyLarge.size(TypeScale.ZEILE),
        bodyMedium = bodyMedium.size(TypeScale.ZEILE),
        bodySmall = bodySmall.size(TypeScale.NEBEN),
        labelLarge = labelLarge.size(TypeScale.NEBEN),
        labelMedium = labelMedium.size(TypeScale.NEBEN),
        labelSmall = labelSmall.size(TypeScale.NEBEN_KLEIN),
    )
}
