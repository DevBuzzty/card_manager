package com.example.yugiohscanner.ui

// Flag emoji for a printing's language, shown in place of "[DE]/[EN]/[JP]" text labels.
fun langFlag(lang: String): String = when (lang) {
    "DE" -> "🇩🇪"
    "JP" -> "🇯🇵"
    "EN" -> "🇬🇧"
    else -> "🏳️"
}
