package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.atomic.AtomicLong

/**
 * Laesst `run` nie zweimal gleichzeitig laufen und verschmilzt Anforderungen (Spec §4.3): kommen
 * waehrend eines Laufs beliebig viele an, folgt GENAU EIN weiterer Lauf. So kommt eine eigene
 * Aenderung garantiert an (ihr Lauf beginnt nach dem Schreiben), ohne dass sich Anfragen stapeln.
 *
 * `run` behandelt seine Fehler selbst. Wirft es trotzdem, wird der Fehler hier geschluckt -- ein
 * Wartender, der nie zurueckkehrt, waere schlimmer als ein verschluckter Fehler.
 */
class Coalescer(private val scope: CoroutineScope, private val run: suspend () -> Unit) {
    private val mutex = Mutex()
    private val requested = AtomicLong(0)
    private val covered = MutableStateFlow(0L)

    fun request() {
        requested.incrementAndGet()
        scope.launch { drain() }
    }

    /** Wie request(), kehrt aber erst zurueck, wenn ein Lauf fertig ist, der NACH diesem Aufruf begann. */
    suspend fun requestAndWait() {
        val mine = requested.incrementAndGet()
        scope.launch { drain() }
        covered.first { it >= mine }
    }

    private suspend fun drain() {
        // Aeussere Schleife: eine Anforderung, die kam, nachdem der Laufende seine innere Schleife
        // verlassen, aber das Schloss noch nicht freigegeben hatte, wird hier nachgeholt.
        while (requested.get() > covered.value) {
            if (!mutex.tryLock()) return
            try {
                while (true) {
                    val target = requested.get()
                    if (covered.value >= target) break
                    try {
                        run()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        // siehe Klassenkommentar
                    }
                    covered.value = target
                }
            } finally {
                mutex.unlock()
            }
        }
    }
}
