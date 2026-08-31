package com.example.yugiohscanner.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import com.example.yugiohscanner.R

// Standard Google Fonts provider (Play Services). The certs array ships with
// androidx.compose.ui:ui-text-google-fonts. If the provider can't fetch a face
// (e.g. offline first run), Compose renders the system fallback until it's cached.
private val provider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs,
)

private val ChakraPetchGoogle = GoogleFont("Chakra Petch")
private val ManropeGoogle = GoogleFont("Manrope")
private val JetBrainsMonoGoogle = GoogleFont("JetBrains Mono")

// Chakra Petch — display / titles.
val ChakraPetch = FontFamily(
    Font(googleFont = ChakraPetchGoogle, fontProvider = provider, weight = FontWeight.Normal),
    Font(googleFont = ChakraPetchGoogle, fontProvider = provider, weight = FontWeight.Medium),
    Font(googleFont = ChakraPetchGoogle, fontProvider = provider, weight = FontWeight.SemiBold),
    Font(googleFont = ChakraPetchGoogle, fontProvider = provider, weight = FontWeight.Bold),
)

// Manrope — body / labels.
val Manrope = FontFamily(
    Font(googleFont = ManropeGoogle, fontProvider = provider, weight = FontWeight.Normal),
    Font(googleFont = ManropeGoogle, fontProvider = provider, weight = FontWeight.Medium),
    Font(googleFont = ManropeGoogle, fontProvider = provider, weight = FontWeight.SemiBold),
    Font(googleFont = ManropeGoogle, fontProvider = provider, weight = FontWeight.Bold),
)

// JetBrains Mono — numbers, prices, passcodes, set codes. Exposed for direct use.
val MonoFontFamily = FontFamily(
    Font(googleFont = JetBrainsMonoGoogle, fontProvider = provider, weight = FontWeight.Normal),
    Font(googleFont = JetBrainsMonoGoogle, fontProvider = provider, weight = FontWeight.Medium),
    Font(googleFont = JetBrainsMonoGoogle, fontProvider = provider, weight = FontWeight.Bold),
)

// Material3 typography: Chakra Petch for display/headline/title, Manrope for body/label.
val AppTypography: Typography = Typography().run {
    copy(
        displayLarge = displayLarge.copy(fontFamily = ChakraPetch),
        displayMedium = displayMedium.copy(fontFamily = ChakraPetch),
        displaySmall = displaySmall.copy(fontFamily = ChakraPetch),
        headlineLarge = headlineLarge.copy(fontFamily = ChakraPetch),
        headlineMedium = headlineMedium.copy(fontFamily = ChakraPetch),
        headlineSmall = headlineSmall.copy(fontFamily = ChakraPetch),
        titleLarge = titleLarge.copy(fontFamily = ChakraPetch),
        titleMedium = titleMedium.copy(fontFamily = ChakraPetch),
        titleSmall = titleSmall.copy(fontFamily = ChakraPetch),
        bodyLarge = bodyLarge.copy(fontFamily = Manrope),
        bodyMedium = bodyMedium.copy(fontFamily = Manrope),
        bodySmall = bodySmall.copy(fontFamily = Manrope),
        labelLarge = labelLarge.copy(fontFamily = Manrope),
        labelMedium = labelMedium.copy(fontFamily = Manrope),
        labelSmall = labelSmall.copy(fontFamily = Manrope),
    )
}
