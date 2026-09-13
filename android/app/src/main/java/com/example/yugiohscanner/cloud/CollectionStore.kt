package com.example.yugiohscanner.cloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow

/** Die echte Netzquelle des Speichers: Supabase ueber die Repositories. */
object CloudStoreSource : StoreSource {
    override suspend fun loadCards(changedSince: String?) = CollectionRepository.fetchCards(changedSince)
    override suspend fun loadCopies(changedSince: String?) = CollectionRepository.fetchCopies(changedSince)
    override suspend fun loadContainers(changedSince: String?) = ContainersRepository.fetchContainers(changedSince)
}

/**
 * Der App-weite Speicher fuer Karten, Exemplare und Behaelter (Spec §3). Lebt so lange wie der
 * Prozess. Bildschirme lesen `state`; nach eigenen Schreibvorgaengen `awaitSync()`.
 */
object CollectionStore {
    private val core = CollectionStoreCore(CloudStoreSource, CoroutineScope(SupervisorJob() + Dispatchers.IO))

    val state: StateFlow<StoreState> get() = core.state
    val sync: StateFlow<SyncStatus> get() = core.sync

    fun startInitialLoad() = core.startInitialLoad()
    fun requestSync() = core.requestSync()
    suspend fun awaitSync() = core.awaitSync()
    fun clear() = core.clear()
}
