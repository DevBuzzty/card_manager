package com.example.yugiohscanner

import android.content.Context
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.Duplicates

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

    /** Spec H1 §4: keep_per_card, ganze Zahl 1–99, ungültig oder fehlend -> 3 (Duplicates.keepPerCard). Kein Sync. */
    fun keepPerCard(ctx: Context): Int = Duplicates.keepPerCard(p(ctx).getString("keep_per_card", null))
    /** Speichert den normalisierten Wert und liefert ihn zurueck (fuer das Eingabefeld). */
    fun setKeepPerCard(ctx: Context, raw: String): Int =
        Duplicates.keepPerCard(raw).also { p(ctx).edit().putString("keep_per_card", it.toString()).apply() }
}
