package com.example.yugiohscanner.ml

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

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

    /**
     * Untergrenze der naechsten Delta-Abfrage: `max(Stichtag, serverStart) − 60 s`, ohne beides ab 1970.
     *
     * `serverStart` ist die Serverzeit (HTTP-`Date`) der ersten Seite des letzten ERFOLGREICHEN
     * Abgleichs dieser Tabelle. Ohne ihn rueckte die Untergrenze nur mit neueren Zeilen vor: nach
     * einem Stapel-Schreibvorgang kaeme die Minute vor dem Stichtag bei jedem 10-s-Abgleich erneut.
     * Die Ueberlappungsgarantie bleibt: eine Transaktion, die kuerzer als 60 s ist und vor
     * `serverStart − 60 s` stempelte, war bei jener Abfrage schon sichtbar (also geliefert); eine,
     * die danach stempelte, liegt `>= serverStart − 60 s` und faengt die neue Untergrenze.
     * Der `Date`-Header hat nur Sekunden und ist abgerundet -- das verschiebt nur nach frueher, also sicher.
     */
    fun lowerBound(cursor: String?, serverStart: String?): String {
        val latest = listOfNotNull(cursor?.let(::parse), serverStart?.let(::parse)).maxOrNull() ?: return EPOCH
        return latest.minusSeconds(OVERLAP_SECONDS).toString()
    }

    /** HTTP-`Date` (RFC 1123, z. B. `Sun, 13 Sep 2026 17:05:02 GMT`) als `Instant.toString()`; `null` bei fehlend/kaputt. */
    fun parseHttpDate(header: String?): String? {
        if (header == null) return null
        return try {
            ZonedDateTime.parse(header, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toString()
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
