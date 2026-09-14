package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.UtcDay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Spec G1 §4.3: eine ListCache, die hoechstens einmal pro UTC-Tag laedt. Referenzpreise aendern sich
 * praktisch nur mit dem Datum; Seitenwechsel rufen ensureFresh() und laden deshalb nicht erneut.
 * Pull-to-refresh nimmt refreshAndWait(). Ein gescheitertes Laden setzt den Tag nicht -- der naechste
 * Besuch versucht es wieder.
 */
class DailyListCache<T>(
    scope: CoroutineScope,
    private val today: () -> String = UtcDay::today,
    loader: suspend () -> T,
) {
    @Volatile private var loadedDay: String? = null

    private val cache = ListCache(scope) {
        val d = today()
        val v = loader()
        loadedDay = d
        v
    }

    val state: StateFlow<CacheState<T>> get() = cache.state

    fun ensureFresh() {
        val s = cache.state.value
        if (!s.loading && (s.value == null || loadedDay != today())) cache.refresh()
    }

    suspend fun refreshAndWait() = cache.refreshAndWait()

    fun clear() {
        loadedDay = null
        cache.clear()
    }
}
