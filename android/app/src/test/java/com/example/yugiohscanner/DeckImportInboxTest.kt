package com.example.yugiohscanner

import com.example.yugiohscanner.ui.DeckImportInbox
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec E2 §6/§9: Share-Intent-Auswertung und Postfach ohne Geraet. */
class DeckImportInboxTest {
    @Test fun `nur ACTION_SEND mit text-plain und Text wird angenommen`() {
        val send = "android.intent.action.SEND"
        assertEquals("ydke://!!!", DeckImportInbox.sharedText(send, "text/plain", "ydke://!!!"))
        assertEquals("3 Raigeki", DeckImportInbox.sharedText(send, "text/plain; charset=utf-8", "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText("android.intent.action.MAIN", "text/plain", "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText(send, "image/png", "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText(send, null, "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText(send, "text/plain", "   "))
        assertEquals(null, DeckImportInbox.sharedText(send, "text/plain", null))
    }

    @Test fun `Postfach haelt den Text bis zum Herausnehmen, genau einmal`() {
        DeckImportInbox.take()
        DeckImportInbox.offer("ydke://!!!")
        assertEquals("ydke://!!!", DeckImportInbox.text.value)
        DeckImportInbox.offer("3 Raigeki")
        assertEquals("der neueste geteilte Text gilt", "3 Raigeki", DeckImportInbox.take())
        assertEquals(null, DeckImportInbox.text.value)
        assertEquals(null, DeckImportInbox.take())
    }
}
