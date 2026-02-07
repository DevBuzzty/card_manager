package com.example.yugiohscanner

import java.util.regex.Pattern

object CardCodeValidator {
    // Yu-Gi-Oh codes are 8 digits.
    // Regex matches 8 digits exactly, surrounded by word boundaries.
    private const val PASSCODE_REGEX = "\\b\\d{8}\\b"
    private val pattern = Pattern.compile(PASSCODE_REGEX)

    /**
     * Extracts the first valid 8-digit passcode from the given text.
     * Returns null if no valid passcode is found.
     */
    fun extractPasscode(text: String): String? {
        val matcher = pattern.matcher(text)
        return if (matcher.find()) {
            matcher.group()
        } else {
            null
        }
    }
}
