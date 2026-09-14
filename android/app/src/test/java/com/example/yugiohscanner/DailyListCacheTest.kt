package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.DailyListCache
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec G1 §4.3: Referenzpreise einmal pro UTC-Tag; Seitenwechsel (ensureFresh) laden sonst nicht. */
@OptIn(ExperimentalCoroutinesApi::class)
class DailyListCacheTest {
    @Test fun `am selben Tag nur einmal, am naechsten Tag erneut`() = runTest {
        var day = "2026-09-20"
        var n = 0
        val c = DailyListCache(this, { day }) { n++; listOf(n) }
        c.ensureFresh(); advanceUntilIdle()
        c.ensureFresh(); advanceUntilIdle()
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(1, n)
        day = "2026-09-21"
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(2, n)
        assertEquals(listOf(2), c.state.value.value)
    }

    @Test fun `gescheitertes Laden wird beim naechsten Aufruf wiederholt`() = runTest {
        var fail = true
        var n = 0
        val c = DailyListCache(this, { "2026-09-20" }) { n++; if (fail) throw RuntimeException("offline"); listOf(1) }
        c.ensureFresh(); advanceUntilIdle()
        assertEquals("offline", c.state.value.error)
        fail = false
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(2, n)
        assertEquals(listOf(1), c.state.value.value)
    }

    @Test fun `nach clear wird trotz gleichem Tag neu geladen`() = runTest {
        var n = 0
        val c = DailyListCache(this, { "2026-09-20" }) { n++; listOf(n) }
        c.ensureFresh(); advanceUntilIdle()
        c.clear()
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(2, n)
    }
}
