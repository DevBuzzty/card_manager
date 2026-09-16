package com.example.yugiohscanner.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.getAndUpdate

/**
 * Spec E2 §6: Postfach fuer geteilten Text (Share-Ziel). MainActivity legt den Text ab, AppNav fuehrt -- erst nach dem
 * Login -- zu den Decks, DecksScreen nimmt ihn heraus und oeffnet die Import-Vorschau. Prozessweit, damit der Text
 * einen Login ueberlebt.
 */
object DeckImportInbox {
    private val pending = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = pending

    fun offer(text: String) { pending.value = text }

    /** Nimmt den Text heraus (danach null), damit er genau einmal eine Vorschau oeffnet. */
    fun take(): String? = pending.getAndUpdate { null }

    /**
     * Nur ACTION_SEND mit text/plain und nicht leerem EXTRA_TEXT; keine Dateien. Reine Funktion mit den Intent-Werten,
     * damit ohne Geraet testbar ("android.intent.action.SEND" = Intent.ACTION_SEND).
     */
    fun sharedText(action: String?, mimeType: String?, extraText: CharSequence?): String? {
        if (action != "android.intent.action.SEND") return null
        if (mimeType == null || !mimeType.startsWith("text/plain")) return null
        return extraText?.toString()?.takeIf { it.isNotBlank() }
    }
}
