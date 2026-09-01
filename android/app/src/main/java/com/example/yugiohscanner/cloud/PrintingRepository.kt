package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder

data class SetOption(val setCode: String, val rarity: String, val price: Double, val language: String = "EN")

// Looks up all real printings of a passcode across languages. We UNION several real sources
// (never guessing codes — the region infix varies DE/G):
//   * EN / international : YGOPRODeck (with prices)
//   * DE and JP          : Fandom wiki + Yugipedia ({lang}_sets blocks) + Konami's official DB
// Konami is authoritative and catches niche printings (e.g. Speed Duel "SGX3-DEA10") the wikis
// miss. Mirrors the desktop app.
object PrintingRepository {
    private val client = OkHttpClient()
    private const val UA = "YGOScanner/1.0 (card collection app)"
    private const val KONAMI_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    private const val KONAMI = "https://www.db.yugioh-card.com/yugiohdb/card_search.action"
    // Konami prints rarity as an abbreviation; map the common ones to the wikis' full spelling so
    // identical printings from the two source kinds de-duplicate cleanly.
    private val KONAMI_RARITY = mapOf(
        "N" to "Common", "C" to "Common", "R" to "Rare", "SR" to "Super Rare", "UR" to "Ultra Rare",
        "UtR" to "Ultimate Rare", "ScR" to "Secret Rare", "HR" to "Holographic Rare", "GR" to "Ghost Rare",
        "PScR" to "Prismatic Secret Rare", "CR" to "Collector's Rare",
        "QCSR" to "Quarter Century Secret Rare", "20thSR" to "20th Secret Rare"
    )

    // Every printing across languages, tagged [DE]/[EN]/[JP]. German first (collection is German-first).
    // The independent lookups run CONCURRENTLY (the phone has no request cache, so parallelism is
    // what keeps this fast) — total latency ≈ the slowest source, not the sum.
    suspend fun fetchAllSets(passcode: String): List<SetOption> = coroutineScope {
        val enD = async(Dispatchers.IO) { runCatching { fetchSets(passcode) }.getOrDefault(emptyList()) }
        val titleD = async(Dispatchers.IO) { resolveYugipediaTitle(passcode) }
        val en = enD.await()
        val title = titleD.await()
        val enCodes = en.map { it.setCode }
        // The Konami cid is resolved+validated once and reused for both locales.
        val cid = if (title != null && enCodes.isNotEmpty()) konamiValidCid(title, enCodes) else null

        val deD = async(Dispatchers.IO) { localizedUnion(title, cid, "de", "DE") }
        val jpD = async(Dispatchers.IO) { localizedUnion(title, cid, "jp", "JP") }

        val seen = HashSet<String>()
        (deD.await() + en + jpD.await()).filter { seen.add("${it.setCode}|${it.rarity}") }
    }

    // A code is German if its region infix is DE (incl. Speed Duel DES/DEA) or the old German "G"
    // (e.g. TP1-G015). Japanese = JP-region or region-less OCG (B3-17); anything with a foreign TCG
    // region infix is neither. Wikis sometimes mislabel a foreign code (DOOD-EN001) into a de_sets
    // block, so we keep only codes that really belong to the requested language.
    private val germanCode = Regex("""-DE|-G\d""", RegexOption.IGNORE_CASE)
    private val foreignForJp = Regex("""-(EN|DE|FR|IT|PT|SP|KR|AE|EU)\d""", RegexOption.IGNORE_CASE)

    // Union of the two wikis + Konami for one language. tag = "DE"/"JP", wikiLang = "de"/"jp".
    // The three sources run concurrently.
    private suspend fun localizedUnion(title: String?, cid: String?, wikiLang: String, tag: String): List<SetOption> = coroutineScope {
        if (title == null) return@coroutineScope emptyList()
        val fandomD = async(Dispatchers.IO) { parseWikiSets("https://yugioh.fandom.com/api.php", title, wikiLang, tag) }
        val yugiD = async(Dispatchers.IO) { parseWikiSets("https://yugipedia.com/api.php", title, wikiLang, tag) }
        val konamiD = async(Dispatchers.IO) { if (cid != null) konamiDetail(cid, if (tag == "JP") "ja" else "de", tag) else emptyList() }
        val collected = fandomD.await() + yugiD.await() + konamiD.await()
        val belongs: (String) -> Boolean =
            if (tag == "DE") { c -> germanCode.containsMatchIn(c) } else { c -> !foreignForJp.containsMatchIn(c) }
        val seen = HashSet<String>()
        collected.filter { belongs(it.setCode) && seen.add("${it.setCode}|${it.rarity}") }
    }

    // English/international printings from YGOPRODeck.
    suspend fun fetchSets(passcode: String): List<SetOption> = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("https://db.ygoprodeck.com/api/v7/cardinfo.php?id=$passcode")
            .get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("YGOPRODeck (${resp.code})")
            val data = JSONObject(text).optJSONArray("data") ?: return@withContext emptyList()
            if (data.length() == 0) return@withContext emptyList()
            val sets = data.getJSONObject(0).optJSONArray("card_sets") ?: return@withContext emptyList()
            val seen = HashSet<String>()
            val out = ArrayList<SetOption>()
            for (i in 0 until sets.length()) {
                val s = sets.getJSONObject(i)
                val code = s.optString("set_code", "")
                val rarity = s.optString("set_rarity", "")
                if (code.isBlank()) continue
                if (!seen.add(code)) continue
                val price = s.optString("set_price", "0").toDoubleOrNull() ?: 0.0
                out.add(SetOption(code, rarity, price, "EN"))
            }
            out
        }
    }

    // Fetch a wiki page's `{lang}_sets` block. Two interchangeable formats:
    //   A) "SET-CODE; Set Name; Rarity[,Rarity]"          (semicolon lines)
    //   B) "{{Card table set|SET-CODE|Set Name|Rarity}}"  (pipe template)
    // No price available -> 0.0.
    private suspend fun parseWikiSets(apiBase: String, title: String, lang: String, tag: String): List<SetOption> = withContext(Dispatchers.IO) {
        val parseReq = Request.Builder()
            .url("$apiBase?action=parse&page=${URLEncoder.encode(title, "UTF-8")}&prop=wikitext&format=json")
            .header("User-Agent", UA).get().build()
        val wikitext = client.newCall(parseReq).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext emptyList()
            JSONObject(resp.body?.string() ?: "")
                .optJSONObject("parse")?.optJSONObject("wikitext")?.optString("*", "")
                ?: return@withContext emptyList()
        }

        val block = Regex("""\|\s*${lang}_sets\s*=\s*([\s\S]*?)\n\s*(?:\||\}\})""").find(wikitext)
            ?: return@withContext emptyList()
        val tableTmpl = Regex("""\{\{\s*Card table set\s*\|([^}]*)\}\}""", RegexOption.IGNORE_CASE)
        val out = ArrayList<SetOption>()
        for (raw in block.groupValues[1].split("\n")) {
            val line = raw.trim()
            if (line.isEmpty()) continue

            val code: String
            val rarityField: String
            val tmpl = tableTmpl.find(line)
            if (tmpl != null) {
                // Format B: {{Card table set|CODE|Set Name|Rarity}}
                val a = tmpl.groupValues[1].split("|").map { it.trim() }
                code = a.getOrElse(0) { "" }
                rarityField = a.getOrElse(2) { "" }.ifEmpty { "Common" }
            } else {
                // Format A: CODE; Set Name; Rarity[,Rarity]
                val parts = line.split(";")
                if (parts.size < 3) continue
                code = parts[0].trim()
                rarityField = parts[2].trim()
            }
            if (code.isEmpty()) continue
            for (rarity in rarityField.split(",").map { it.trim() }.filter { it.isNotEmpty() }) {
                out.add(SetOption(code, rarity, 0.0, tag))
            }
        }
        out
    }

    // Konami official DB: a name search can return several cards (e.g. "Mirage Dragon" matches 3),
    // so pick the candidate whose EN printings actually overlap YGOPRODeck's — that both validates
    // the card and avoids injecting a wrong card's codes.
    private suspend fun konamiValidCid(englishName: String, ygoEnCodes: List<String>): String? = coroutineScope {
        val checked = konamiCids(englishName)
            .map { cid -> async(Dispatchers.IO) { cid to konamiDetail(cid, "en", "EN").map { it.setCode } } }
            .awaitAll()
        checked.firstOrNull { (_, codes) -> codes.any { it in ygoEnCodes } }?.first
    }

    private suspend fun konamiCids(name: String): List<String> = withContext(Dispatchers.IO) {
        val html = konamiGet("$KONAMI?ope=1&sess=1&rp=20&keyword=${URLEncoder.encode(name, "UTF-8")}&stype=1&request_locale=en")
            ?: return@withContext emptyList()
        Regex("""cid=(\d+)""").findAll(html).map { it.groupValues[1] }.distinct().take(8).toList()
    }

    // Read a card's printing list for a locale ('de'|'ja'|'en'). Each row has a card number + a
    // rarity abbreviation (<p>C</p> etc.).
    private suspend fun konamiDetail(cid: String, locale: String, tag: String): List<SetOption> = withContext(Dispatchers.IO) {
        val html = konamiGet("$KONAMI?ope=2&cid=$cid&request_locale=$locale") ?: return@withContext emptyList()
        val codeRe = Regex("""class="card_number">\s*([^<]+?)\s*<""")
        val rarRe = Regex("""class="lr_icon[^"]*">\s*<p>\s*([^<]*?)\s*</p>""")
        val out = ArrayList<SetOption>()
        for (row in html.split("class=\"t_row")) {
            val code = codeRe.find(row)?.groupValues?.get(1)?.trim() ?: continue
            if (code.isEmpty()) continue
            val abbr = rarRe.find(row)?.groupValues?.get(1)?.trim() ?: ""
            out.add(SetOption(code, KONAMI_RARITY[abbr] ?: abbr.ifEmpty { "Common" }, 0.0, tag))
        }
        out
    }

    private fun konamiGet(url: String): String? = runCatching {
        val req = Request.Builder().url(url)
            .header("User-Agent", KONAMI_UA)
            .header("Accept-Language", "de-DE,de;q=0.9,en;q=0.8").get().build()
        client.newCall(req).execute().use { if (it.isSuccessful) it.body?.string() else null }
    }.getOrNull()

    // Resolve a passcode to its wiki page title (= the card's English name). Yugipedia's passcode
    // redirects are incomplete, so if the redirect misses, fall back to YGOPRODeck's name.
    private suspend fun resolveYugipediaTitle(passcode: String): String? = withContext(Dispatchers.IO) {
        // 1) passcode -> title via Yugipedia redirect
        runCatching {
            val req = Request.Builder()
                .url("https://yugipedia.com/api.php?action=query&titles=$passcode&redirects&format=json")
                .header("User-Agent", UA).get().build()
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val pages = JSONObject(resp.body?.string() ?: "")
                        .optJSONObject("query")?.optJSONObject("pages")
                    val keys = pages?.keys()
                    if (keys != null && keys.hasNext()) {
                        val key = keys.next().toString()
                        if (key != "-1") {
                            val t = pages.getJSONObject(key).optString("title", "")
                            if (t.isNotBlank()) return@withContext t
                        }
                    }
                }
            }
        }
        // 2) fallback: English card name from YGOPRODeck
        runCatching {
            val req = Request.Builder()
                .url("https://db.ygoprodeck.com/api/v7/cardinfo.php?id=$passcode")
                .get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val data = JSONObject(resp.body?.string() ?: "").optJSONArray("data")
                if (data == null || data.length() == 0) null
                else data.getJSONObject(0).optString("name", "").ifBlank { null }
            }
        }.getOrNull()
    }
}
