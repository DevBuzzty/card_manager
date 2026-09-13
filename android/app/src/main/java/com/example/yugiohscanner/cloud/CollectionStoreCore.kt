package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.DeltaMerge
import com.example.yugiohscanner.ml.SyncCursor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

/** Datenzustand des Speichers (Spec §3.1). */
sealed interface StoreState {
    data object Empty : StoreState
    data object Loading : StoreState
    data class Failed(val message: String) : StoreState
    data class Ready(
        val cards: List<CardRow>,
        val copies: List<CopyRow>,
        val containers: List<ContainerRow>,
    ) : StoreState
}

/**
 * Abgleichstatus, GETRENNT vom Datenzustand: ein erfolgreicher Abgleich ohne Aenderung setzt
 * `lastSuccess` neu, darf aber den Datenfluss nicht beruehren -- sonst zeichnete jede Seite alle 10 s neu.
 */
data class SyncStatus(val lastSuccess: Instant? = null, val failing: Boolean = false)

/**
 * Netzseite des Speichers. `changedSince == null`: vollstaendig, nur lebende Zeilen (Karten mit
 * Menge > 0). Sonst: alle Zeilen mit `updated_at >= changedSince`, AUCH geloeschte -- nur so
 * verschwinden sie lokal.
 */
interface StoreSource {
    suspend fun loadCards(changedSince: String?): List<CardRow>
    suspend fun loadCopies(changedSince: String?): List<CopyRow>
    suspend fun loadContainers(changedSince: String?): List<ContainerRow>
}

/**
 * Der Speicher selbst, ohne Bindung an das Netz -- testbar mit einer nachgebauten Quelle. Das
 * App-weite Exemplar ist `CollectionStore`.
 *
 * Generation: `clear()` erhoeht sie. Jeder Lade- oder Abgleichlauf merkt sich die Generation beim
 * Start und uebernimmt sein Ergebnis nur, wenn sie noch gilt (Spec §4.4) -- ein Lauf aus der Zeit
 * vor dem Abmelden kann nichts zurueckschreiben.
 */
class CollectionStoreCore(
    private val source: StoreSource,
    private val scope: CoroutineScope,
    private val clock: () -> Instant = Instant::now,
) {
    private val _state = MutableStateFlow<StoreState>(StoreState.Empty)
    val state: StateFlow<StoreState> = _state.asStateFlow()

    private val _sync = MutableStateFlow(SyncStatus())
    val sync: StateFlow<SyncStatus> = _sync.asStateFlow()

    private data class Cursors(val cards: String? = null, val copies: String? = null, val containers: String? = null)

    private val lock = Any()
    private var generation = 0L
    private var cursors = Cursors()

    private val deltas = Coalescer(scope) { runDelta() }

    fun startInitialLoad() {
        scope.launch { loadInitial() }
    }

    /** Vollstaendiges Laden. Tut nichts, solange schon geladen wird oder alles da ist. */
    suspend fun loadInitial() {
        val gen = synchronized(lock) {
            val s = _state.value
            if (s is StoreState.Loading || s is StoreState.Ready) return
            _state.value = StoreState.Loading
            generation
        }
        try {
            val (cards, copies, containers) = coroutineScope {
                val c = async { source.loadCards(null) }
                val cp = async { source.loadCopies(null) }
                val ct = async { source.loadContainers(null) }
                Triple(c.await(), cp.await(), ct.await())
            }
            synchronized(lock) {
                if (gen != generation) return
                cursors = Cursors(
                    cards = SyncCursor.advance(null, cards.map { it.updatedAt }),
                    copies = SyncCursor.advance(null, copies.map { it.updatedAt }),
                    containers = SyncCursor.advance(null, containers.map { it.updatedAt }),
                )
                _state.value = StoreState.Ready(
                    cards = DeltaMerge.cards(emptyList(), cards),
                    copies = DeltaMerge.copies(emptyList(), copies),
                    containers = DeltaMerge.containers(emptyList(), containers),
                )
                _sync.value = SyncStatus(lastSuccess = clock(), failing = false)
            }
        } catch (e: CancellationException) {
            synchronized(lock) {
                if (gen == generation && _state.value is StoreState.Loading) _state.value = StoreState.Empty
            }
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _state.value = StoreState.Failed(e.message ?: "Laden fehlgeschlagen")
            }
        }
    }

    fun requestSync() = deltas.request()

    /** Wartet auf einen Abgleich, der nach dem Aufruf beginnt. Wirft nie (ausser bei Abbruch). */
    suspend fun awaitSync() = deltas.requestAndWait()

    fun clear() {
        synchronized(lock) {
            generation++
            cursors = Cursors()
            _state.value = StoreState.Empty
            _sync.value = SyncStatus()
        }
    }

    private suspend fun runDelta() {
        val (gen, cur) = synchronized(lock) {
            if (_state.value !is StoreState.Ready) return
            generation to cursors
        }
        try {
            val (cards, copies, containers) = coroutineScope {
                val c = async { source.loadCards(SyncCursor.lowerBound(cur.cards)) }
                val cp = async { source.loadCopies(SyncCursor.lowerBound(cur.copies)) }
                val ct = async { source.loadContainers(SyncCursor.lowerBound(cur.containers)) }
                Triple(c.await(), cp.await(), ct.await())
            }
            synchronized(lock) {
                if (gen != generation) return
                val now = _state.value as? StoreState.Ready ?: return
                // Gleiche Listen -> gleiches Ready -> StateFlow gibt nichts aus.
                _state.value = StoreState.Ready(
                    cards = DeltaMerge.cards(now.cards, cards),
                    copies = DeltaMerge.copies(now.copies, copies),
                    containers = DeltaMerge.containers(now.containers, containers),
                )
                cursors = Cursors(
                    cards = SyncCursor.advance(cur.cards, cards.map { it.updatedAt }),
                    copies = SyncCursor.advance(cur.copies, copies.map { it.updatedAt }),
                    containers = SyncCursor.advance(cur.containers, containers.map { it.updatedAt }),
                )
                _sync.value = SyncStatus(lastSuccess = clock(), failing = false)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _sync.value = _sync.value.copy(failing = true)
            }
        }
    }
}
