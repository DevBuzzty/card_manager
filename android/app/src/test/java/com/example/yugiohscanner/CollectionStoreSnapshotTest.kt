package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionStoreCore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Fetched
import com.example.yugiohscanner.cloud.SnapshotCursors
import com.example.yugiohscanner.cloud.StoreSnapshot
import com.example.yugiohscanner.cloud.StoreSnapshotStore
import com.example.yugiohscanner.cloud.StoreSource
import com.example.yugiohscanner.cloud.StoreState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

/** Kaltstart-Zwischenspeicher im Speicher-Kern: sofort Ready aus dem Geraet, dann nur Delta. */
@OptIn(ExperimentalCoroutinesApi::class)
class CollectionStoreSnapshotTest {

    private val t0 = "2026-09-13T12:00:00+00:00"
    private val now = Instant.parse("2026-09-24T10:00:00Z")

    private fun copy(id: String, updatedAt: String = t0) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = false, containerId = null, page = null,
        slot = null, tags = null, note = null, updatedAt = updatedAt,
    )

    private class FakeSource : StoreSource {
        var copies: suspend (String?) -> List<CopyRow> = { emptyList() }
        val calls = mutableListOf<String>()
        override suspend fun loadCards(changedSince: String?) = Fetched(emptyList<CardRow>(), null).also { calls += "cards:$changedSince" }
        override suspend fun loadCopies(changedSince: String?) = Fetched(copies(changedSince), null).also { calls += "copies:$changedSince" }
        override suspend fun loadContainers(changedSince: String?) = Fetched(emptyList<ContainerRow>(), null).also { calls += "containers:$changedSince" }
    }

    private class MemoryStore(var snap: StoreSnapshot? = null) : StoreSnapshotStore {
        var writes = 0
        var deletes = 0
        override fun read() = snap
        override fun write(snapshot: StoreSnapshot) { writes++; snap = snapshot }
        override fun delete() { deletes++; snap = null }
    }

    private fun saved(account: String = "u1", savedAt: Instant = now.minusSeconds(3600), copies: List<CopyRow> = listOf(copy("gespeichert"))) =
        StoreSnapshot(account, savedAt, emptyList(), copies, emptyList(), SnapshotCursors(copiesStamp = "2026-09-20T08:00:00+00:00"))

    private fun ready(store: CollectionStoreCore) = store.state.value as StoreState.Ready

    @Test fun `passender Stand ist sofort Ready, danach nur Delta ab seinem Stichtag`() = runTest {
        val src = FakeSource()
        src.copies = { since -> if (since == null) error("kein vollstaendiges Laden erwartet") else listOf(copy("neu", "2026-09-24T09:00:00+00:00")) }
        val disk = MemoryStore(saved())
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { "u1" }, clock = { now })
        store.loadInitial()
        assertEquals("sofort aus dem Geraet", listOf("gespeichert"), ready(store).copies.map { it.copyId })
        assertEquals("letzter Abgleich = Zeitpunkt des Stands", now.minusSeconds(3600), store.sync.value.lastSuccess)
        advanceUntilIdle()
        assertTrue("Delta ab gespeichertem Stichtag − 60 s: ${src.calls}", src.calls.contains("copies:2026-09-20T07:59:00Z"))
        assertFalse(src.calls.contains("copies:null"))
        assertEquals(listOf("gespeichert", "neu"), ready(store).copies.map { it.copyId })
        assertEquals("geaenderter Stand wird wieder gespeichert", listOf("gespeichert", "neu"), disk.snap!!.copies.map { it.copyId })
    }

    @Test fun `Stand eines anderen Kontos wird nicht gezeigt`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("cloud")) }
        val disk = MemoryStore(saved(account = "fremd"))
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { "u1" }, clock = { now })
        store.loadInitial()
        assertEquals(listOf("cloud"), ready(store).copies.map { it.copyId })
        assertTrue(src.calls.contains("copies:null"))
        advanceUntilIdle()
        assertEquals("ueberschrieben mit dem eigenen Konto", "u1", disk.snap!!.account)
    }

    @Test fun `zu alter Stand wird vollstaendig neu geladen`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("cloud")) }
        val disk = MemoryStore(saved(savedAt = now.minus(Duration.ofDays(15))))
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { "u1" }, maxSnapshotAge = Duration.ofDays(14), clock = { now })
        store.loadInitial()
        assertEquals(listOf("cloud"), ready(store).copies.map { it.copyId })
    }

    @Test fun `ohne Konto weder lesen noch schreiben`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("cloud")) }
        val disk = MemoryStore(saved())
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { null }, clock = { now })
        store.loadInitial()
        advanceUntilIdle()
        assertEquals(listOf("cloud"), ready(store).copies.map { it.copyId })
        assertEquals(0, disk.writes)
    }

    @Test fun `vollstaendiges Laden wird gespeichert, Stichtage inklusive`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val disk = MemoryStore()
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { "u1" }, clock = { now })
        store.loadInitial()
        advanceUntilIdle()
        assertEquals(listOf("a"), disk.snap!!.copies.map { it.copyId })
        assertEquals(t0, disk.snap!!.cursors.copiesStamp)
        assertEquals(now, disk.snap!!.savedAt)
    }

    @Test fun `Abgleich ohne Aenderung schreibt nicht`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val disk = MemoryStore()
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { "u1" }, clock = { now })
        store.loadInitial()
        advanceUntilIdle()
        val before = disk.writes
        store.awaitSync()                                  // liefert dieselbe Zeile erneut
        advanceUntilIdle()
        assertEquals(before, disk.writes)
    }

    @Test fun `Abmelden loescht den Stand, danach wird nichts mehr geschrieben`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val disk = MemoryStore()
        val store = CollectionStoreCore(src, this, snapshots = { disk }, account = { "u1" }, clock = { now })
        store.loadInitial()
        advanceUntilIdle()
        store.clear()
        advanceUntilIdle()
        assertNull(disk.snap)
        assertEquals(1, disk.deletes)
        assertEquals(StoreState.Empty, store.state.value)
    }

    @Test fun `kaputter Speicher faellt auf vollstaendiges Laden zurueck`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("cloud")) }
        val broken = object : StoreSnapshotStore {
            override fun read(): StoreSnapshot? = throw RuntimeException("kaputt")
            override fun write(snapshot: StoreSnapshot) = throw RuntimeException("voll")
            override fun delete() {}
        }
        val store = CollectionStoreCore(src, this, snapshots = { broken }, account = { "u1" }, clock = { now })
        store.loadInitial()
        advanceUntilIdle()
        assertEquals(listOf("cloud"), ready(store).copies.map { it.copyId })
    }
}
