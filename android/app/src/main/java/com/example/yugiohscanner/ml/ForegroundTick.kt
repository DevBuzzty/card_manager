package com.example.yugiohscanner.ml

import kotlinx.coroutines.delay

/**
 * Spec G2 §7 -- was beim Eintritt in den Vordergrund passiert: einmal `onEnter` (Preis-Alarme nachladen),
 * danach alle `periodMs` ein `tick` (der bestehende Abgleich). AppNav ruft das in
 * repeatOnLifecycle(STARTED) auf; jede Rueckkehr startet den Block und damit `onEnter` neu.
 */
object ForegroundTick {
    suspend fun run(onEnter: () -> Unit, tick: () -> Unit, periodMs: Long = 10_000) {
        onEnter()
        while (true) {
            tick()
            delay(periodMs)
        }
    }
}
