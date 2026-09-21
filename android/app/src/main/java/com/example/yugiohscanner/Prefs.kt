package com.example.yugiohscanner

import android.content.Context
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.SalesMath

object Prefs {
    private fun p(ctx: Context) = ctx.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
    fun defaultEdition(ctx: Context): String =
        p(ctx).getString("default_edition", null)?.takeIf { it in Valuation.EDITIONS } ?: "unknown"
    fun defaultCondition(ctx: Context): String =
        p(ctx).getString("default_condition", null)?.takeIf { it in Valuation.CONDITIONS } ?: "NM"
    fun setDefaultEdition(ctx: Context, v: String) = p(ctx).edit().putString("default_edition", v).apply()
    fun setDefaultCondition(ctx: Context, v: String) = p(ctx).edit().putString("default_condition", v).apply()

    /** Spec D4 §3. Der Schluessel `scan_mode` stammt aus Spec D §7a und wird hier weiterverwendet.
     *  Alles ausser dem wortwoertlichen "stapel" liest als "einzeln" -- ein unbekannter oder
     *  fehlender Wert darf niemals stillschweigend Mengen erhoehen. */
    fun scanMode(ctx: Context): String =
        if (p(ctx).getString("scan_mode", null) == "stapel") "stapel" else "einzeln"
    fun setScanMode(ctx: Context, v: String) =
        p(ctx).edit().putString("scan_mode", if (v == "stapel") "stapel" else "einzeln").apply()

    /**
     * Der Kamera-Zoom des Scanners, ueber Sitzungen hinweg gemerkt (20.09.2026).
     *
     * Warum das mehr ist als Bequemlichkeit: der digitale Zoom schneidet IM SENSOR zu und skaliert
     * auf die Analyse-Aufloesung. Der Sensor liefert deutlich mehr als die 1440x1920 eines
     * Analysebildes, die gezoomte Karte bekommt also ECHTE zusaetzliche Bildpunkte -- anders als
     * nachtraegliches Hochskalieren, das nur streckt, was schon da ist. Gemessen an 111 eigenen
     * Bildern: die Auflagenzeile ist in der Halterung 21 Bildpunkte hoch und wird zu 32 % gelesen,
     * auf einem nahen Foto 29 Bildpunkte und 89 %. Bisher gab es Zoom nur als Kniffgeste, die beim
     * Schliessen des Scanners verfiel -- der Nutzer haette ihn vor JEDEM Stapel neu einstellen
     * muessen.
     */
    fun zoom(ctx: Context): Float = p(ctx).getFloat("zoom", 1f)
    fun setZoom(ctx: Context, v: Float) = p(ctx).edit().putFloat("zoom", v).apply()

    /**
     * Ein gemerkter Zoom, eingepasst in das, was DIESE Kamera kann. Ein Wert aus den Einstellungen
     * ist kein Versprechen: ein anderes Geraet, eine andere Kamera oder ein kuenftig engerer
     * Bereich koennen ihn unerreichbar machen, und setZoomRatio wirft dann. Nicht endliche Werte
     * (NaN, Infinity) koennen aus einer beschaedigten Einstellungsdatei kommen und faenden sonst
     * ungeprueft den Weg in die Kamera.
     */
    fun zoomGeklemmt(wert: Float, min: Float, max: Float): Float {
        // Verdrehte Grenzen heissen: die Auskunft der Kamera ist unbrauchbar. Dann NICHT das
        // Minimum nehmen -- das koennte ueber dem echten Maximum liegen -- sondern gar nicht zoomen.
        if (min > max) return 1f
        if (!wert.isFinite()) return 1f.coerceIn(min, max)
        return wert.coerceIn(min, max)
    }

    /** Spec H1 §4: keep_per_card, ganze Zahl 1–99, ungültig oder fehlend -> 3 (Duplicates.keepPerCard). Kein Sync. */
    fun keepPerCard(ctx: Context): Int = Duplicates.keepPerCard(p(ctx).getString("keep_per_card", null))
    /** Speichert den normalisierten Wert und liefert ihn zurueck (fuer das Eingabefeld). */
    fun setKeepPerCard(ctx: Context, raw: String): Int =
        Duplicates.keepPerCard(raw).also { p(ctx).edit().putString("keep_per_card", it.toString()).apply() }

    /**
     * Spec H2 §9 / Abweichung 5: Preisvorschlag = Marktwert abzueglich Abschlag, auf 5 Cent
     * abgerundet, mindestens der Mindestpreis. Abschlag ganze Zahl 0–90 (Standard 5), Mindestpreis
     * 0,00–100,00 € (Standard 0,10 €). Beide gespeichert als Text, wie keep_per_card, kein Sync.
     */
    fun saleDiscount(ctx: Context): Int = SalesMath.normalizeDiscount(p(ctx).getString("sale_discount_percent", null))
    fun setSaleDiscount(ctx: Context, raw: String): Int =
        SalesMath.normalizeDiscount(raw).also { p(ctx).edit().putString("sale_discount_percent", it.toString()).apply() }

    fun saleMinCents(ctx: Context): Long = SalesMath.normalizeMinPrice(p(ctx).getString("sale_min_price", null))
    fun setSaleMinPrice(ctx: Context, raw: String): Long =
        SalesMath.normalizeMinPrice(raw)
            .also { p(ctx).edit().putString("sale_min_price", String.format(java.util.Locale.ROOT, "%.2f", it / 100.0)).apply() }

    /** Reine Verbindung ohne Context, fuer PrefsSaleTest. */
    internal fun suggestionFor(valueCents: Long?, rawDiscount: String?, rawMin: String?): Long? =
        SalesMath.suggestionCents(valueCents, SalesMath.normalizeDiscount(rawDiscount), SalesMath.normalizeMinPrice(rawMin))

    fun saleSuggestion(ctx: Context, valueCents: Long?): Long? =
        SalesMath.suggestionCents(valueCents, saleDiscount(ctx), saleMinCents(ctx))
}
