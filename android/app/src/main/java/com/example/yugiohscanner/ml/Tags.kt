package com.example.yugiohscanner.ml

import org.json.JSONArray
import org.json.JSONTokener

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

    /**
     * Zeichensatz von JavaScripts `String.prototype.trim()` (ECMA-262 WhiteSpace + LineTerminator),
     * ausdruecklich aufgezaehlt statt auf Character-Kategorien (`Character.isWhitespace()`)
     * gebaut -- die haengen von JVM-Version und ICU-Tabelle ab. Die tatsaechlichen Unterschiede zu
     * Kotlins eingebautem `trim()`: U+FEFF (Byte-Order-Zeichen) wird von JS beschnitten, von
     * Kotlin nicht; U+001C bis U+001F werden von Kotlin beschnitten, von JS nicht.
     */
    private val JS_TRIM_CHARS = charArrayOf(
        0x0009.toChar(), 0x000A.toChar(), 0x000B.toChar(), 0x000C.toChar(), 0x000D.toChar(),
        0x0020.toChar(),
        0x00A0.toChar(),
        0x1680.toChar(),
        0x2000.toChar(), 0x2001.toChar(), 0x2002.toChar(), 0x2003.toChar(), 0x2004.toChar(),
        0x2005.toChar(), 0x2006.toChar(), 0x2007.toChar(), 0x2008.toChar(), 0x2009.toChar(), 0x200A.toChar(),
        0x2028.toChar(), 0x2029.toChar(),
        0x202F.toChar(),
        0x205F.toChar(),
        0x3000.toChar(),
        0xFEFF.toChar()
    )

    private fun jsTrim(s: String) = s.trim(*JS_TRIM_CHARS)

    private fun key(t: String) = jsTrim(t).lowercase()

    fun parse(text: String?): List<String> {
        // Streng wie JSON.parse: ein gueltiges Array, danach hoechstens noch Leerraum.
        // JSONArray(...) allein waere hier zu nachsichtig -- sie liest bis zur schliessenden
        // Klammer und ignoriert Muell dahinter (z. B. "[\"a\"] extra" -> ["a"]), waehrend
        // JSON.parse in diesem Fall wirft und die JS-Fassung dann [] liefert. JSONTokener
        // erlaubt uns, nach dem Array selbst zu pruefen, ob noch etwas Bedeutsames folgt.
        val raw = runCatching {
            val tokener = JSONTokener(text ?: "")
            val value = tokener.nextValue() as? JSONArray ?: error("kein Array")
            if (tokener.nextClean().code != 0) error("Muell nach dem Array")
            value
        }.getOrNull() ?: return emptyList()
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for (i in 0 until raw.length()) {
            // opt(i) liefert bei Zahlen und Objekten kein String -- die fallen hier heraus.
            val item = raw.opt(i) as? String ?: continue
            val t = jsTrim(item)
            if (t.isEmpty() || !seen.add(key(t))) continue
            out.add(t)
        }
        return out
    }

    /** Leere Liste -> null, nicht "[]": "keine Tags" hat in der Datenbank genau eine Darstellung. */
    fun serialize(list: List<String>): String? =
        if (list.isEmpty()) null else JSONArray(list).toString()

    fun add(list: List<String>, tag: String): List<String> {
        val t = jsTrim(tag)
        if (t.isEmpty() || list.any { key(it) == key(t) }) return list
        return list + t
    }

    fun remove(list: List<String>, tag: String): List<String> =
        list.filterNot { key(it) == key(tag) }
}
