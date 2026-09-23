package com.example.yugiohscanner

import androidx.compose.ui.graphics.Color
import com.example.yugiohscanner.ui.theme.AppColors
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/theme.test.js -- dieselbe Datei docs/fixtures/design/tokens.json. */
class DesignTokensTest {
    private val roles = JSONObject(Fixtures.text("docs/fixtures/design/tokens.json")).getJSONObject("roles")

    private fun hex(c: Color): String {
        val v = c.value.toULong() shr 32
        return "#%06x".format((v and 0xFFFFFFu).toLong())
    }

    @Test
    fun helleFassungStimmtMitDerTokenDateiUeberein() = pruefe("light", AppColors.light)

    @Test
    fun dunkleFassungStimmtMitDerTokenDateiUeberein() = pruefe("dark", AppColors.dark)

    private fun pruefe(modus: String, rollen: Map<String, Color>) {
        val erwartet = roles.keys().asSequence().associateWith { roles.getJSONObject(it).getString(modus) }
        assertEquals("Rollennamen", erwartet.keys.sorted(), rollen.keys.sorted())
        for ((name, wert) in erwartet) assertEquals("$modus/$name", wert, hex(rollen.getValue(name)))
    }
}
