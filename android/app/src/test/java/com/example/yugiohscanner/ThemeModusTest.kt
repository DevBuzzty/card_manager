package com.example.yugiohscanner

import com.example.yugiohscanner.ui.theme.themeMode
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/theme.test.js (resolveMode). */
class ThemeModusTest {
    @Test fun hellIstDieVorgabe() {
        assertEquals("light", themeMode(null, true))
        assertEquals("light", themeMode("quatsch", true))
        assertEquals("light", themeMode("light", true))
    }
    @Test fun dunkelUndSystem() {
        assertEquals("dark", themeMode("dark", false))
        assertEquals("dark", themeMode("system", true))
        assertEquals("light", themeMode("system", false))
    }
}
