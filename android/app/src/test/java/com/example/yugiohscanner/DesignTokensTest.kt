package com.example.yugiohscanner

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import com.example.yugiohscanner.ui.theme.AppColors
import com.example.yugiohscanner.ui.theme.AppTypography
import com.example.yugiohscanner.ui.theme.Radius
import com.example.yugiohscanner.ui.theme.TypeScale
import com.example.yugiohscanner.ui.theme.schema
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

    // Abschlussreview A2: dieselbe contrast-Liste wie desktop/src/utils/theme.test.js, gerechnet mit
    // den tatsaechlich benutzten Werten aus AppColors (WCAG-Leuchtdichte).
    @Test
    fun jedesGeforderteKontrastpaarErreichtSeinenMindestwert() {
        val paare = JSONObject(Fixtures.text("docs/fixtures/design/tokens.json")).getJSONArray("contrast")
        val fehler = mutableListOf<String>()
        for (i in 0 until paare.length()) {
            val p = paare.getJSONObject(i)
            for ((modus, rollen) in listOf("light" to AppColors.light, "dark" to AppColors.dark)) {
                val r = kontrast(rollen.getValue(p.getString("fg")), rollen.getValue(p.getString("bg")))
                if (r < p.getDouble("min")) fehler += "${p.getString("fg")} auf ${p.getString("bg")} ($modus): ${"%.2f".format(r)}"
            }
        }
        assertEquals(emptyList<String>(), fehler)
    }

    // Abschlussreview A6 (Spec I §6.3): jeder Textstil des Themes hat gleich breite Ziffern.
    @Test
    fun jederTextstilHatTabellenziffern() {
        val t = AppTypography
        val stile = listOf(
            t.displayLarge, t.displayMedium, t.displaySmall, t.headlineLarge, t.headlineMedium, t.headlineSmall,
            t.titleLarge, t.titleMedium, t.titleSmall, t.bodyLarge, t.bodyMedium, t.bodySmall,
            t.labelLarge, t.labelMedium, t.labelSmall,
        )
        for (s in stile) assertEquals("tnum", s.fontFeatureSettings)
    }

    // Abschlussreview C4: jede Farbe des hellen und dunklen Schemas ist ein Token-Wert desselben Modus.
    // Benannte Ausnahmen: scrim (Materials Schwarz fuer die Abdunkelung) und inversePrimary (Akzent des
    // Gegenmodus, weil es auf inverseSurface = text steht).
    @Test
    fun jedeSchemaFarbeIstEinTokenWert() {
        for ((dunkel, rollen, gegen) in listOf(Triple(false, AppColors.light, AppColors.dark), Triple(true, AppColors.dark, AppColors.light))) {
            val farben = schemaFarben(schema(rollen, dunkel))
            assertTrue("Schema liefert zu wenige Felder: ${farben.keys}", farben.size >= 30)
            val erlaubt = rollen.values.map { it.value }.toSet()
            val fehler = mutableListOf<String>()
            for ((name, wert) in farben) {
                when (name) {
                    "scrim" -> continue
                    "inversePrimary" -> if (wert != gegen.getValue("accent").value) fehler += name
                    else -> if (wert !in erlaubt) fehler += name
                }
            }
            assertEquals("${if (dunkel) "dunkel" else "hell"}: Felder ohne Rolle", emptyList<String>(), fehler)
        }
    }

    // Alle Farb-Getter des ColorScheme (Color ist eine Wertklasse, auf der JVM also ein long-Getter mit
    // verziertem Namen wie getPrimary-0d7_KjU).
    private fun schemaFarben(s: ColorScheme): Map<String, ULong> =
        ColorScheme::class.java.methods
            .filter { it.name.startsWith("get") && it.parameterCount == 0 && it.returnType == java.lang.Long.TYPE }
            .associate { m ->
                val name = m.name.removePrefix("get").substringBefore('-').replaceFirstChar { it.lowercase() }
                name to (m.invoke(s) as Long).toULong()
            }

    private fun kontrast(a: Color, b: Color): Double {
        fun kanal(c: Float): Double { val v = c.toDouble(); return if (v <= 0.03928) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4) }
        fun lum(c: Color) = 0.2126 * kanal(c.red) + 0.7152 * kanal(c.green) + 0.0722 * kanal(c.blue)
        val (hi, lo) = listOf(lum(a), lum(b)).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun pruefe(modus: String, rollen: Map<String, Color>) {
        val erwartet = roles.keys().asSequence().associateWith { roles.getJSONObject(it).getString(modus) }
        assertEquals("Rollennamen", erwartet.keys.sorted(), rollen.keys.sorted())
        for ((name, wert) in erwartet) {
            assertEquals("$modus/$name", wert, hex(rollen.getValue(name)))
            // Fixrunde 1, Punkt 10: jede Rolle muss volldeckend sein -- eine transparente Rolle
            // wuerde je nach darunterliegender Flaeche einen anderen Farbton ergeben als den
            // geprueften Hex-Wert.
            assertEquals("$modus/$name alpha", 1f, rollen.getValue(name).alpha)
        }
    }

    // Spec I §6.3 (I2 Task 11) -- Schrift und Ecken gegen tokens.json#typo/#radius (Zwilling: theme.test.js, Tailwind).
    @Test
    fun schriftgroessenUndEckenStimmenMitDerTokenDateiUeberein() {
        val tok = JSONObject(Fixtures.text("docs/fixtures/design/tokens.json"))
        val sizes = tok.getJSONObject("typo").getJSONObject("sizes")
        assertEquals(sizes.getInt("titel"), TypeScale.TITEL)
        assertEquals(sizes.getInt("abschnitt"), TypeScale.ABSCHNITT)
        assertEquals(sizes.getInt("zeile"), TypeScale.ZEILE)
        assertEquals(sizes.getInt("neben"), TypeScale.NEBEN)
        assertEquals(sizes.getInt("nebenKlein"), TypeScale.NEBEN_KLEIN)
        val erlaubt = sizes.keys().asSequence().map { sizes.getInt(it).toFloat() }.toSet()
        val t = AppTypography
        listOf(t.displayLarge, t.displayMedium, t.displaySmall, t.headlineLarge, t.headlineMedium, t.headlineSmall,
            t.titleLarge, t.titleMedium, t.titleSmall, t.bodyLarge, t.bodyMedium, t.bodySmall,
            t.labelLarge, t.labelMedium, t.labelSmall).forEach { st ->
            assertTrue("${st.fontSize} ist keine der vier Groessen", st.fontSize.value in erlaubt)
            assertEquals(FontFamily.Default, st.fontFamily)
        }
        val radius = tok.getJSONObject("radius")
        assertEquals(radius.getInt("feld"), Radius.FELD)
        assertEquals(radius.getInt("flaeche"), Radius.FLAECHE)
    }
}
