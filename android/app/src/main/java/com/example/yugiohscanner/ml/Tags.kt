package com.example.yugiohscanner.ml

import org.json.JSONArray

/**
 * Spec B1: Tags eines Exemplars. Die Spalte `card_copies.tags` ist Text und traegt ein JSON-Array.
 *
 * Die JavaScript-Fassung derselben Regeln steht in `desktop/src/utils/tags.js`. Dass es sie
 * zweimal gibt, ist Absicht -- beide Geraete lesen und schreiben dieselbe Spalte. Wer hier etwas
 * aendert, aendert dort mit, sonst entstehen Eintraege, die die andere Seite nicht wiederfindet.
 *
 * Wirft nie: der Inhalt der Spalte stammt aus der Cloud und kann alles sein. Eine kaputte Zelle
 * darf hoechstens "keine Tags" bedeuten, niemals eine leere Kartenansicht.
 */
object Tags {

    private fun key(t: String) = t.trim().lowercase()

    fun parse(text: String?): List<String> {
        val raw = runCatching { JSONArray(text ?: "") }.getOrNull() ?: return emptyList()
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for (i in 0 until raw.length()) {
            // opt(i) liefert bei Zahlen und Objekten kein String -- die fallen hier heraus.
            val item = raw.opt(i) as? String ?: continue
            val t = item.trim()
            if (t.isEmpty() || !seen.add(key(t))) continue
            out.add(t)
        }
        return out
    }

    /** Leere Liste -> null, nicht "[]": "keine Tags" hat in der Datenbank genau eine Darstellung. */
    fun serialize(list: List<String>): String? =
        if (list.isEmpty()) null else JSONArray(list).toString()

    fun add(list: List<String>, tag: String): List<String> {
        val t = tag.trim()
        if (t.isEmpty() || list.any { key(it) == key(t) }) return list
        return list + t
    }

    fun remove(list: List<String>, tag: String): List<String> =
        list.filterNot { key(it) == key(tag) }
}
