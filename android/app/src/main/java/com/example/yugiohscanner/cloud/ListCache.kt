package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class CacheState<T>(val value: T? = null, val loading: Boolean = false, val error: String? = null)

/**
 * Speicher fuer eine kleine Liste ohne `updated_at` (Spec §8): der letzte Stand bleibt sichtbar,
 * neu geladen wird immer vollstaendig im Hintergrund. Anforderungen verschmelzen wie im
 * CollectionStore (Coalescer) -- nach einem eigenen Schreibvorgang kommt `refreshAndWait()`
 * garantiert mit dem neuen Stand zurueck.
 */
class ListCache<T>(scope: CoroutineScope, private val loader: suspend () -> T) {
    private val _state = MutableStateFlow(CacheState<T>())
    val state: StateFlow<CacheState<T>> = _state.asStateFlow()

    private val lock = Any()
    private var generation = 0L
    private val runs = Coalescer(scope) { runOnce() }

    fun refresh() = runs.request()

    /** Wirft nie; ein Fehler steht danach in `state.error`. */
    suspend fun refreshAndWait() = runs.requestAndWait()

    /** Laedt nur, wenn noch nie ein Wert da war und gerade nichts laeuft. */
    fun ensureLoaded() {
        val s = _state.value
        if (s.value == null && !s.loading) refresh()
    }

    /** Aendert den Wert lokal, ohne zu laden (z. B. ein weggetippter Deal-Treffer). */
    fun update(transform: (T) -> T) {
        synchronized(lock) {
            val v = _state.value.value ?: return
            _state.value = _state.value.copy(value = transform(v))
        }
    }

    fun clear() {
        synchronized(lock) {
            generation++
            _state.value = CacheState()
        }
    }

    private suspend fun runOnce() {
        val gen = synchronized(lock) {
            _state.value = _state.value.copy(loading = true)
            generation
        }
        try {
            val v = loader()
            synchronized(lock) { if (gen == generation) _state.value = CacheState(value = v) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            synchronized(lock) { if (gen == generation) _state.value = _state.value.copy(loading = false) }
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _state.value = _state.value.copy(loading = false, error = e.message ?: "Laden fehlgeschlagen")
            }
        }
    }
}
