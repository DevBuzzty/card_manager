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
import java.time.Duration
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
    suspend fun loadCards(changedSince: String?): Fetched<CardRow>
    suspend fun loadCopies(changedSince: String?): Fetched<CopyRow>
    suspend fun loadContainers(changedSince: String?): Fetched<ContainerRow>
}

/** Zeilen einer Abfrage plus Serverzeit (HTTP-`Date` der ersten Seite, `Instant`-Form) oder `null`. */
data class Fetched<T>(val rows: List<T>, val serverTime: String?)

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
    // Kaltstart-Zwischenspeicher: wo der Stand auf dem Geraet liegt (null = keiner) und fuer welches
    // Konto gerade geladen wird (JWT `sub`; null = unbekannt, dann weder lesen noch schreiben).
    private val snapshots: () -> StoreSnapshotStore? = { null },
    private val account: () -> String? = { null },
    private val maxSnapshotAge: Duration = Duration.ofDays(14),
    private val clock: () -> Instant = Instant::now,
) {
    private val _state = MutableStateFlow<StoreState>(StoreState.Empty)
    val state: StateFlow<StoreState> = _state.asStateFlow()

    private val _sync = MutableStateFlow(SyncStatus())
    val sync: StateFlow<SyncStatus> = _sync.asStateFlow()

    /** Je Tabelle: Stichtag (spaetester gelieferter `updated_at`) und Serverzeit des letzten Erfolgs (Spec §4.3). */
    private data class TableCursor(val stamp: String? = null, val serverStart: String? = null) {
        fun lowerBound() = SyncCursor.lowerBound(stamp, serverStart)

        /** Nach Erfolg. Fehlt der Header, bleibt der alte `serverStart` -- er ist frueher, also sicher. */
        fun advance(f: Fetched<out Any>, stamps: List<String?>) =
            TableCursor(SyncCursor.advance(stamp, stamps), f.serverTime ?: serverStart)
    }

    private data class Cursors(
        val cards: TableCursor = TableCursor(),
        val copies: TableCursor = TableCursor(),
        val containers: TableCursor = TableCursor(),
    ) {
        fun toSnapshot() = SnapshotCursors(
            cards.stamp, cards.serverStart, copies.stamp, copies.serverStart, containers.stamp, containers.serverStart,
        )

        companion object {
            fun of(s: SnapshotCursors) = Cursors(
                TableCursor(s.cardsStamp, s.cardsServer),
                TableCursor(s.copiesStamp, s.copiesServer),
                TableCursor(s.containersStamp, s.containersServer),
            )
        }
    }

    private val lock = Any()
    private var generation = 0L
    private var cursors = Cursors()

    private val deltas = Coalescer(scope) { runDelta() }
    // Schreiben verschmilzt wie der Abgleich: kommen waehrend eines Schreibens neue Staende, wird
    // danach genau einmal der neueste geschrieben.
    private val writes = Coalescer(scope) { writeSnapshot() }

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
        // Kaltstart-Zwischenspeicher: passt ein gespeicherter Stand zu diesem Konto, gilt er sofort als
        // Ready; der Delta-Abgleich holt danach nur, was sich seit seinen Stichtagen geaendert hat.
        if (restoreSnapshot(gen)) {
            requestSync()
            return
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
                    cards = TableCursor().advance(cards, cards.rows.map { it.updatedAt }),
                    copies = TableCursor().advance(copies, copies.rows.map { it.updatedAt }),
                    containers = TableCursor().advance(containers, containers.rows.map { it.updatedAt }),
                )
                _state.value = StoreState.Ready(
                    cards = DeltaMerge.cards(emptyList(), cards.rows),
                    copies = DeltaMerge.copies(emptyList(), copies.rows),
                    containers = DeltaMerge.containers(emptyList(), containers.rows),
                )
                _sync.value = SyncStatus(lastSuccess = clock(), failing = false)
            }
            writes.request()
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
        // Abmelden/Kontowechsel: der gespeicherte Stand gehoert zum alten Konto.
        snapshots()?.let { store -> scope.launch { runCatching { store.delete() } } }
    }

    /** Laedt den gespeicherten Stand, wenn er zu Konto, Alter und Generation passt. Wirft nie. */
    private fun restoreSnapshot(gen: Long): Boolean {
        val store = snapshots() ?: return false
        val acc = account() ?: return false
        val snap = runCatching { store.read() }.getOrNull() ?: return false
        if (snap.account != acc) return false
        val age = Duration.between(snap.savedAt, clock())
        if (age.isNegative || age > maxSnapshotAge) return false
        synchronized(lock) {
            if (gen != generation) return false
            cursors = Cursors.of(snap.cursors)
            _state.value = StoreState.Ready(snap.cards, snap.copies, snap.containers)
            // "Zuletzt abgeglichen" ist der Zeitpunkt des gespeicherten Stands -- SyncHint nennt ihn,
            // falls der folgende Abgleich scheitert.
            _sync.value = SyncStatus(lastSuccess = snap.savedAt, failing = false)
        }
        return true
    }

    /** Schreibt den aktuellen Stand samt Stichtagen; nichts, solange nicht Ready oder ohne Konto. Wirft nie. */
    private fun writeSnapshot() {
        val store = snapshots() ?: return
        val acc = account() ?: return
        val (gen, snap) = synchronized(lock) {
            val r = _state.value as? StoreState.Ready ?: return
            generation to StoreSnapshot(acc, clock(), r.cards, r.copies, r.containers, cursors.toSnapshot())
        }
        runCatching {
            // Nach dem Abmelden (neue Generation) nichts mehr schreiben.
            if (synchronized(lock) { gen == generation }) store.write(snap)
        }
    }

    private suspend fun runDelta() {
        val (gen, cur) = synchronized(lock) {
            if (_state.value !is StoreState.Ready) return
            generation to cursors
        }
        try {
            val (cards, copies, containers) = coroutineScope {
                val c = async { source.loadCards(cur.cards.lowerBound()) }
                val cp = async { source.loadCopies(cur.copies.lowerBound()) }
                val ct = async { source.loadContainers(cur.containers.lowerBound()) }
                Triple(c.await(), cp.await(), ct.await())
            }
            val changed = synchronized(lock) {
                if (gen != generation) return
                val now = _state.value as? StoreState.Ready ?: return
                // Gleiche Listen -> gleiches Ready -> StateFlow gibt nichts aus.
                _state.value = StoreState.Ready(
                    cards = DeltaMerge.cards(now.cards, cards.rows),
                    copies = DeltaMerge.copies(now.copies, copies.rows),
                    containers = DeltaMerge.containers(now.containers, containers.rows),
                )
                cursors = Cursors(
                    cards = cur.cards.advance(cards, cards.rows.map { it.updatedAt }),
                    copies = cur.copies.advance(copies, copies.rows.map { it.updatedAt }),
                    containers = cur.containers.advance(containers, containers.rows.map { it.updatedAt }),
                )
                _sync.value = SyncStatus(lastSuccess = clock(), failing = false)
                _state.value !== now
            }
            // Nur bei geaenderten Daten schreiben: die gespeicherten Stichtage gehoeren dann zu genau
            // diesem Stand. Ohne Aenderung fragt ein Kaltstart ab dem aelteren Stichtag -- das liefert
            // hoechstens schon bekannte Zeilen, die DeltaMerge wirkungslos einarbeitet.
            if (changed) writes.request()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            synchronized(lock) {
                if (gen == generation) _sync.value = _sync.value.copy(failing = true)
            }
        }
    }
}
