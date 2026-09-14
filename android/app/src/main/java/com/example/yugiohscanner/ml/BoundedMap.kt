package com.example.yugiohscanner.ml

/** Kleiner Zwischenspeicher mit Obergrenze: der am laengsten nicht benutzte Eintrag faellt heraus (Spec G1 §4.3). */
class BoundedMap<K, V>(private val max: Int) {
    private val map = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>?): Boolean = size > max
    }

    fun getOrPut(key: K, create: () -> V): V = synchronized(map) {
        map[key] ?: create().also { map[key] = it }
    }

    fun values(): List<V> = synchronized(map) { map.values.toList() }
    fun clear() = synchronized(map) { map.clear() }
    val size: Int get() = synchronized(map) { map.size }
}
