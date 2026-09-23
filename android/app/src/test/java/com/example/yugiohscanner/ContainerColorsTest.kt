package com.example.yugiohscanner

import androidx.compose.ui.graphics.toArgb
import com.example.yugiohscanner.ui.COLOR_PRESETS
import com.example.yugiohscanner.ui.DEFAULT_COLOR_HEX
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** ZWILLING von desktop/src/utils/containerColors.test.js -- dieselbe Datei docs/fixtures/design/container-colors.json. */
class ContainerColorsTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/design/container-colors.json"))

    @Test
    fun voreinstellungenStimmenMitDerFixtureUeberein() {
        val erwartet = fix.getJSONArray("presets").let { a -> (0 until a.length()).map { a.getString(it) } }
        assertEquals(erwartet, COLOR_PRESETS.map { "#%06X".format(0xFFFFFF and it.toArgb()) })
    }

    @Test
    fun vorgabefarbeIstDieDerFixture() {
        assertEquals(fix.getString("default"), DEFAULT_COLOR_HEX)
        assertTrue(COLOR_PRESETS.map { "#%06X".format(0xFFFFFF and it.toArgb()) }.contains(DEFAULT_COLOR_HEX))
    }
}
