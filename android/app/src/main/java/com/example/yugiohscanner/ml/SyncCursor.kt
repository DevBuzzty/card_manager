package com.example.yugiohscanner.ml

import java.time.Instant
import java.time.OffsetDateTime

/**
 * Der Stichtag des Delta-Abgleichs (Spec §4.3): der spaeteste `updated_at`, den der SERVER geliefert
 * hat -- nie die Uhr des Handys. Verglichen wird als Zeitpunkt; PostgreSQL kuerzt Sekundenbruchteile
 * (".7" statt ".700000"), und eine Zeichenkette mit anderem Versatz waere falsch geordnet.
 *
 * Die Untergrenze einer Abfrage liegt 60 s vor dem Stichtag: eine Transaktion stempelt mit ihrem
 * BEGINN, wird aber erst beim Ende sichtbar. Ohne Ueberlappung ginge eine solche Zeile verloren --
 * genau an dieser Grenze lag ein frueherer Fehler im PC-Sync. Doppelt gelieferte Zeilen schaden
 * nicht, weil DeltaMerge sie wirkungslos einarbeitet.
 */
object SyncCursor {
    const val OVERLAP_SECONDS = 60L
    const val EPOCH = "1970-01-01T00:00:00Z"

    fun parse(s: String): Instant = OffsetDateTime.parse(s).toInstant()

    /** Form fuer Abfragen: `Instant.toString()`, also mit `Z` -- ein `+` in der URL hiesse Leerzeichen. */
    fun normalize(s: String): String = parse(s).toString()

    fun advance(current: String?, delivered: List<String?>): String? {
        var best = current
        var bestAt = current?.let(::parse)
        for (s in delivered) {
            if (s == null) continue
            val at = parse(s)
            if (bestAt == null || at.isAfter(bestAt)) {
                best = s
                bestAt = at
            }
        }
        return best
    }

    fun lowerBound(cursor: String?): String =
        if (cursor == null) EPOCH else parse(cursor).minusSeconds(OVERLAP_SECONDS).toString()
}
