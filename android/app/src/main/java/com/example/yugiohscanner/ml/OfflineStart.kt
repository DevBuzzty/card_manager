package com.example.yugiohscanner.ml

/**
 * Offline-Start am Handy (26.09.2026) -- reine Regeln, ohne Android. Scheitert die Anmeldung beim Start an der
 * Verbindung (nicht am Passwort), startet die App mit dem gespeicherten Stand des zuletzt angemeldeten Kontos und
 * versucht die Anmeldung im Hintergrund erneut.
 */
object OfflineStart {
    /** Meldung, wenn offline etwas geladen oder geschrieben werden soll (statt „Nicht eingeloggt“). */
    const val WRITE_OFFLINE = "Keine Verbindung – bitte erneut versuchen, sobald Internet da ist."

    /**
     * Konto, mit dem offline gestartet werden darf, oder null. Nur bei einem Verbindungsfehler und nur, wenn der
     * gespeicherte Stand zur heute eingetragenen E-Mail gehört (ein anderes Konto sieht nie fremde Daten).
     */
    fun account(networkError: Boolean, savedAccount: String?, savedEmail: String?, email: String): String? {
        if (!networkError || savedAccount.isNullOrBlank() || savedEmail.isNullOrBlank()) return null
        return if (savedEmail.trim().equals(email.trim(), ignoreCase = true)) savedAccount else null
    }

    /** Wartezeit vor dem n-ten erneuten Anmeldeversuch (0-basiert): 5 s, 10 s, 20 s, 40 s, danach 60 s. */
    fun retryDelayMs(attempt: Int): Long = minOf(60_000L, 5_000L shl minOf(attempt, 4))

    /** Hinweiszeile oben (SyncHint), `since` = Uhrzeit des gespeicherten Stands oder null. */
    fun hintText(since: String?): String =
        if (since != null) "Offline – Stand von $since, Änderungen erst wieder mit Internet" else "Offline – Änderungen erst wieder mit Internet"
}
