package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CacheState
import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.ml.SealedSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Spec G3 §8: Tageswert nur mit an diesem Start geladener Sealed-Liste. */
class SealedSnapshotTest {
    private val display = SealedItem("s1", 254469L, "Metal Raiders Booster Box", "display", 2, 499.25, "2026-09-15T05:00:03+00:00")

    @Test fun `noch nie geladen oder ladend ohne Stand - kein Tageswert`() {
        assertNull(SealedSnapshot.decide(10.0, CacheState()))
        assertNull(SealedSnapshot.decide(10.0, CacheState(value = null, loading = true)))
    }

    @Test fun `Ladefehler ohne Stand - kein Tageswert`() {
        assertNull(SealedSnapshot.decide(10.0, CacheState(value = null, error = "Sealed-Bestand laden fehlgeschlagen (404)")))
    }

    @Test fun `Ladefehler an diesem Start mit altem Stand - kein Tageswert`() {
        assertNull(SealedSnapshot.decide(10.0, CacheState(value = listOf(display), error = "Sealed-Bestand laden fehlgeschlagen (500)")))
    }

    @Test fun `geladen und leer - Kartenwert, sealed 0`() {
        assertEquals(SealedSnapshot.Values(10.0, 0.0), SealedSnapshot.decide(10.0, CacheState(value = emptyList())))
    }

    @Test fun `geladen - Karten plus Sealed`() {
        assertEquals(SealedSnapshot.Values(1008.5, 998.5), SealedSnapshot.decide(10.0, CacheState(value = listOf(display))))
    }
}
