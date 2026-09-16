package com.example.yugiohscanner.ui

/**
 * Spec E2 Task 8 Fix 1: Ein-Lauf-Gatter fuer die Editor-Mutationen (+/-, entfernen, verschieben, hinzufuegen).
 * Ohne dieses Gatter kann ein Doppel-Tipp DecksRepository (setCount/moveOne/...) zweimal mit demselben, noch nicht
 * aktualisierten Kartenstand aufrufen, bevor der erste Lauf per refreshAndWait() fertig ist -- der zweite Aufruf
 * ueberschreibt dann statt draufzuzaehlen, und eine Kopie geht verloren oder wird verdoppelt (Review-Fund Task 8).
 * tryStart() liefert waehrend eines laufenden Vorgangs false (kein zweiter Start), finish() gibt danach frei.
 * Rein und synchron, damit ohne Coroutinen/Compose testbar.
 */
class InFlight {
    private var running = false

    fun tryStart(): Boolean {
        if (running) return false
        running = true
        return true
    }

    fun finish() { running = false }
}
