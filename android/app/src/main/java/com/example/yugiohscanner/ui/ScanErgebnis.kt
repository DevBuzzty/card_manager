package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.CmPriceFile
import com.example.yugiohscanner.cloud.CmResolveRepository
import com.example.yugiohscanner.cloud.CodeKey
import com.example.yugiohscanner.cloud.RarityNorm
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ml.ScanSprache
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Spec 2026-10-04 §4, Spec 2026-11-03 §2/§3 -- reine Logik der Ergebnis-Seite (Compose-frei, unit-getestet). */
object ScanErgebnis {
    /**
     * [abgeleitet]: Zeile stammt aus `zusatz` (z. B. von SetCodeMatch zusammengesetzter DE-Code), ohne bekannten Druck mit
     * diesem Set-Code (Spec 2026-11-03 §3.1). [liveCm]: Live-Zuordnung (§6), nur fuer europaeische Zeilen.
     */
    data class Druck(
        val setCode: String, val rarity: String, val language: String,
        val cm: List<Int>, val anzahl: Int, val preis: DruckPreis.Preis, val eigeneZeile: CardRow?,
        val abgeleitet: Boolean = false, val liveCm: List<Int> = emptyList(),
    )

    fun key(setCode: String, rarity: String, language: String) =
        "${setCode.uppercase()}|${rarity.lowercase()}|${language.uppercase()}"

    /** Spec 2026-11-03 §1: nur diese Sprachen teilen sich ein Cardmarket-Produkt ueber Sprachgrenzen. */
    private val europaeisch = setOf("DE", "EN", "FR", "IT", "ES", "PT")
    fun europaeisch(language: String) = language.uppercase() in europaeisch

    /** Spec 2026-11-03 §3.1: Tipp-Auswahl, erkannter Druck, Kandidaten -- in dieser Reihenfolge. */
    fun zusatz(gewaehlterDruck: SetOption?, match: SetCodeMatch.MatchResult): List<SetOption> =
        listOfNotNull(gewaehlterDruck) + listOfNotNull(match.selected) + match.candidates

    /** Spec 2026-11-03 §2.2: Schluessel der Kandidaten plus Auswahl. */
    fun kandidaten(match: SetCodeMatch.MatchResult, auswahl: String?): Set<String> =
        match.candidates.map { key(it.setCode, it.rarity, it.language) }.toSet() + listOfNotNull(auswahl)

    /**
     * Spec 2026-11-03 §3.2/§3.4 -- Katalog-`cm` eines Drucks: gleicher Code + gleiche Seltenheit (RarityNorm), sonst
     * (europaeisch) gleicher CodeKey + gleiche Seltenheit; bei unbekannter Seltenheit die Vereinigung aller `cm` des
     * Codes (sonst des CodeKeys). KR nie, JP nur mit eigenem Code.
     */
    internal fun katalogCm(code: String, rarity: String, lang: String, katalog: List<CatalogPrinting>): List<Int> {
        if (lang.equals("KR", true)) return emptyList()
        val eu = europaeisch(lang)
        val ck = CodeKey.of(code)
        fun gleicherKey(p: CatalogPrinting) = ck != null && CodeKey.of(p.code) == ck
        katalog.firstOrNull { it.code.equals(code, true) && RarityNorm.gleich(rarity, it.rarity) && it.cm.isNotEmpty() }?.let { return it.cm }
        if (eu) katalog.firstOrNull { gleicherKey(it) && RarityNorm.gleich(rarity, it.rarity) && it.cm.isNotEmpty() }?.let { return it.cm }
        if (eu && RarityNorm.key(rarity) == null) {
            val passend = katalog.filter { it.code.equals(code, true) && it.cm.isNotEmpty() }
                .ifEmpty { katalog.filter { gleicherKey(it) && it.cm.isNotEmpty() } }
            return passend.flatMap { it.cm }.distinct().sorted()
        }
        return emptyList()
    }

    /**
     * Alle Drucke der Karte: erst die `zusatz`-Zeilen, die nicht aus known/besitz stammen (abgeleitet, falls kein bekannter
     * Druck den Set-Code traegt), dann die bekannten (Katalog-Reihenfolge), dann eigene, die fehlen. KR nie mit Cardmarket.
     * [live]: Live-Zuordnungen (§6) je [liveKey]; `liveCm` bekommen nur europaeische Zeilen (§3.1).
     */
    fun drucke(known: List<SetOption>, katalog: List<CatalogPrinting>, besitz: List<CardRow>, trend: (Int) -> Double?,
               zusatz: List<SetOption> = emptyList(), live: Map<String, CmResolveRepository.LiveCm> = emptyMap()): List<Druck> {
        val out = LinkedHashMap<String, Druck>()
        fun nimm(code: String, rarity: String, lang: String, abgeleitet: Boolean = false) {
            val k = key(code, rarity, lang)
            if (k in out) return
            val eigen = besitz.filter {
                it.setCode.equals(code, true) && (it.rarity ?: "Unknown").equals(rarity, true) && it.language.equals(lang, true)
            }
            val cm = katalogCm(code, rarity, lang, katalog)
            val liveCm = if (europaeisch(lang)) live[liveKey(code, rarity)]?.cm ?: emptyList() else emptyList()
            val mitPreis = eigen.firstOrNull { (it.price ?: 0.0) > 0 }
            out[k] = Druck(code, rarity, lang, cm, eigen.sumOf { it.quantity },
                DruckPreis.fuer(mitPreis?.price, cm, liveCm, trend), mitPreis ?: eigen.firstOrNull(), abgeleitet, liveCm)
        }
        val herkunft = known.map { key(it.setCode, it.rarity, it.language) }.toSet() +
            besitz.map { key(it.setCode, it.rarity ?: "Unknown", it.language) }
        zusatz.filter { !it.setCode.equals("Unknown", true) && key(it.setCode, it.rarity, it.language) !in herkunft }
            .forEach { z -> nimm(z.setCode, z.rarity, z.language, abgeleitet = known.none { it.setCode.equals(z.setCode, true) }) }
        known.forEach { nimm(it.setCode, it.rarity, it.language) }
        besitz.forEach { nimm(it.setCode, it.rarity ?: "Unknown", it.language) }
        return out.values.toList()
    }

    /** Spec 2026-11-03 §6.1 -- Schluessel der Live-Suche, gleich `code_key|rarity_key` der Antwort. */
    fun liveKey(setCode: String, rarity: String): String = CmResolveRepository.liveKey(setCode, rarity)

    /**
     * Spec 2026-11-03 §6.1 -- welche Drucke live gefragt werden: markierter, dann Kandidaten, dann (nur ohne Katalogkarte) alle
     * uebrigen. Nur europaeisch, nicht "Unknown", kein Sammlungspreis, kein einzelnes Katalog-Produkt mit Trend, nicht schon
     * [bekannt] (Sitzungsspeicher). Gleicher liveKey einmal, hoechstens 10 (= eine Anfrage).
     */
    fun liveBedarf(drucke: List<Druck>, auswahl: String?, kandidaten: Set<String>, katalogDa: Boolean,
                   bekannt: (String) -> Boolean, trend: (Int) -> Double?): List<Druck> {
        fun k(d: Druck) = key(d.setCode, d.rarity, d.language)
        val reihe = drucke.filter { k(it) == auswahl } + drucke.filter { k(it) != auswahl && k(it) in kandidaten } +
            (if (katalogDa) emptyList() else drucke.filter { k(it) != auswahl && k(it) !in kandidaten })
        val out = LinkedHashMap<String, Druck>()
        for (d in reihe) {
            if (!europaeisch(d.language) || d.setCode.trim().equals("Unknown", true)) continue
            if ((d.preis as? DruckPreis.Fest)?.quelle == DruckPreis.Quelle.SAMMLUNG) continue
            if (d.cm.size == 1 && trend(d.cm[0]) != null) continue
            val lk = liveKey(d.setCode, d.rarity)
            if (lk in out || bekannt(lk)) continue
            out[lk] = d
            if (out.size == CmResolveRepository.MAX_DRUCKE) break
        }
        return out.values.toList()
    }

    /** liveKeys des markierten Drucks und der Kandidaten, nur europaeisch (Spec 2026-11-03 §2.3 `sucht`, §6.3). */
    private fun relevanteLiveKeys(drucke: List<Druck>, auswahl: String?, kandidaten: Set<String>): Set<String> =
        drucke.filter { europaeisch(it.language) && key(it.setCode, it.rarity, it.language).let { k -> k == auswahl || k in kandidaten } }
            .map { liveKey(it.setCode, it.rarity) }.toSet()

    /** Spec 2026-11-03 §2.3/§6.3 -- Zustand SUCHT fuer den markierten Druck oder einen Kandidaten ([laeuft] = laufende liveKeys). */
    fun sucht(drucke: List<Druck>, auswahl: String?, kandidaten: Set<String>, laeuft: Set<String>): Boolean =
        relevanteLiveKeys(drucke, auswahl, kandidaten).any { it in laeuft }

    /** Spec 2026-11-03 §6.3 -- Zustand FEHLER: Schluessel war in der fehlgeschlagenen letzten Anfrage und ist nicht im Speicher. */
    fun liveFehler(drucke: List<Druck>, auswahl: String?, kandidaten: Set<String>, fehlgeschlagen: Set<String>,
                   bekannt: (String) -> Boolean): Boolean =
        relevanteLiveKeys(drucke, auswahl, kandidaten).any { it in fehlgeschlagen && !bekannt(it) }

    /** Spec 2026-11-03 §2.1 -- Preistext einer Listenzeile; "…", solange eine europaeische Zeile ohne festen Preis live gesucht wird. */
    fun zeilenText(d: Druck, laeuft: Set<String>): String {
        val offen = d.preis is DruckPreis.Keiner || d.preis is DruckPreis.Spanne || (d.preis as? DruckPreis.Fest)?.mehrdeutig == true
        return if (offen && europaeisch(d.language) && liveKey(d.setCode, d.rarity) in laeuft) "…" else DruckPreis.text(d.preis)
    }

    fun startAuswahl(selected: SetOption?, ersatz: SetOption?): String? {
        val s = selected ?: ersatz ?: return null
        if (s.setCode.equals("Unknown", true)) return null
        return key(s.setCode, s.rarity, s.language)
    }

    /** Spec 2026-11-03 §4.4 -- Auswahl-Zustand der Ergebnis-Seite; ueberlebt das Nachladen (`uebernimm`). */
    data class Zustand(val auswahl: String?, val gewaehlt: Boolean, val gewaehlterDruck: SetOption?,
                       val auflage: String, val auflageGewaehlt: Boolean)

    /** Startzustand fuer ein frisch geoeffnetes Ergebnis (nichts getippt). */
    fun start(r: ResolvedScan, festeSprache: String?): Zustand =
        Zustand(startAuswahl(r.match.selected, ScanSprache.ersatzDruck(festeSprache, r.knownSets)), false, null,
            r.confidence.effectiveEdition, false)

    /**
     * Spec 2026-11-03 §4.4 -- nach dem Nachladen ([neu]): eine getippte Auswahl und eine gewaehlte Auflage bleiben, sonst
     * folgen sie dem neuen Ergebnis. Ampel und Grund kommen ueber `aktuell` aus [neu].
     */
    fun nachUebernahme(alt: Zustand, neu: ResolvedScan, festeSprache: String?): Zustand {
        val auswahl = if (alt.gewaehlt) alt.auswahl
            else startAuswahl(neu.match.selected, ScanSprache.ersatzDruck(festeSprache, neu.knownSets))
        val auflage = if (alt.auflageGewaehlt) alt.auflage else neu.confidence.effectiveEdition
        return alt.copy(auswahl = auswahl, auflage = auflage)
    }

    /** Spec 2026-11-03 §4.4 -- Tipp auf eine Zeile; ueber `zusatz` (§3.1) bleibt sie danach immer in der Liste. */
    fun beimTippen(alt: Zustand, d: Druck): Zustand =
        alt.copy(auswahl = key(d.setCode, d.rarity, d.language), gewaehlt = true,
            gewaehlterDruck = SetOption(d.setCode, d.rarity, 0.0, d.language))

    /**
     * Spec 2026-11-03 §4.4/§7 -- Ergebnis fuer "In Sammlung +": bekannter Druck mit Schluessel [auswahl], sonst der
     * markierte (auch abgeleitete), sonst der erkannte. `price` ist immer 0.0 -- weder Richtwert noch Live- oder
     * Netzpreis gehen hinaus.
     */
    fun uebernahme(aktuell: ResolvedScan, markiert: Druck?, auswahl: String?, gewaehlt: Boolean,
                   auflage: String, auflageGewaehlt: Boolean): ResolvedScan {
        val druck = (aktuell.knownSets.firstOrNull { key(it.setCode, it.rarity, it.language) == auswahl }
            ?: markiert?.let { SetOption(it.setCode, it.rarity, 0.0, it.language) }
            ?: aktuell.match.selected)?.copy(price = 0.0)
        var conf = aktuell.confidence.copy(effectiveEdition = auflage)
        if (gewaehlt) conf = conf.copy(light = ScanConfidence.Light.GREEN, reason = null)
        if (auflageGewaehlt) conf = conf.copy(editionConfidence = EditionEvidence.Confidence.HIGH)
        return ResolvedScan(aktuell.base, aktuell.knownSets, aktuell.match.copy(selected = druck), conf, aktuell.readSetCode)
    }

    /**
     * Spec 2026-11-03 §2.2 -- Kopfpreis. Sicher: Preis der Auswahl, sonst Richtwert, sonst Keiner (nie ein fremder
     * Druckpreis). Ohne Treffer: Spanne ueber alle, sonst Richtwert. Unsicher: Kandidaten > europaeische Zwillinge
     * (gleicher CodeKey, gleiche oder unbekannte Seltenheit) > Richtwert > alle > Keiner.
     * "Alle" (Zweig 2 und 3d, Review-Nachtrag 2): nur Drucke der Scan-Sprache -- Sprache der Auswahl, sonst [sprache]
     * (`ScanSprache.fest`); europaeisch -> alle europaeischen Drucke, JP/KR -> nur Drucke dieser Sprache, unbekannt -> alle.
     */
    fun kopfPreis(drucke: List<Druck>, auswahl: String?, sicher: Boolean, keinTreffer: Boolean,
                  kandidaten: Set<String>, richtwert: DruckPreis.Richtwert?, sprache: String? = null): DruckPreis.Preis {
        fun k(d: Druck) = key(d.setCode, d.rarity, d.language)
        fun nichtKeiner(p: DruckPreis.Preis) = p.takeIf { it !is DruckPreis.Keiner }
        val gewaehlt = drucke.firstOrNull { k(it) == auswahl }
        if (sicher && gewaehlt != null) return nichtKeiner(gewaehlt.preis) ?: richtwert ?: DruckPreis.Keiner
        val spr = gewaehlt?.language ?: sprache
        val basis = when {
            spr == null -> drucke
            europaeisch(spr) -> drucke.filter { europaeisch(it.language) }
            else -> drucke.filter { it.language.equals(spr, true) }
        }
        val alle = DruckPreis.spanneUeber(basis.map { it.preis })
        if (keinTreffer) return nichtKeiner(alle) ?: richtwert ?: DruckPreis.Keiner
        val kand = drucke.filter { k(it) in kandidaten }
        nichtKeiner(DruckPreis.spanneUeber(kand.map { it.preis }))?.let { return it }
        val zwillinge = drucke.filter { d ->
            val ck = CodeKey.of(d.setCode)
            europaeisch(d.language) && ck != null && kand.any { c ->
                europaeisch(c.language) && CodeKey.of(c.setCode) == ck &&
                    (RarityNorm.gleich(d.rarity, c.rarity) || RarityNorm.key(d.rarity) == null || RarityNorm.key(c.rarity) == null)
            }
        }
        // Die Kandidaten selbst hatten keinen Wert (3a); ihre Zwillinge stehen fuer sie, zaehlen also nicht als "ohne Preis".
        nichtKeiner(DruckPreis.spanneUeber(zwillinge.filter { it !in kand }.map { it.preis }))?.let { return it }
        return richtwert ?: nichtKeiner(alle) ?: DruckPreis.Keiner
    }

    /**
     * Review-Nachtrag 2 (03.11.) -- derselbe Druck fuer das Handy-Staging (`ScanCapture.uebernehmeFoto`): Code, Seltenheit
     * und Sprache wie [key]; `price` (nach [uebernahme] immer 0.0) und `verified` zaehlen nicht.
     */
    fun gleicherDruck(a: SetOption?, b: SetOption?): Boolean =
        if (a == null || b == null) a == null && b == null
        else key(a.setCode, a.rarity, a.language) == key(b.setCode, b.rarity, b.language)

    /** Spec 2026-11-03 §2.3: Zweig 1 des Kopfs griff, der markierte Druck ist abgeleitet und nicht getippt. */
    fun abgeleitet(markiert: Druck?, sicher: Boolean, gewaehlt: Boolean): Boolean =
        sicher && markiert != null && markiert.abgeleitet && !gewaehlt

    /** Spec 2026-11-03 §2.3 -- Text der Hinweisflaeche, null = keine Flaeche. */
    fun hinweis(markiert: Druck?, sicher: Boolean, gewaehlt: Boolean): String? = when {
        markiert == null -> "Druck nicht erkannt – tippe unten deinen Druck an."
        markiert.abgeleitet && !gewaehlt -> "Druck abgeleitet – Seltenheit und Preis stammen vom selben Druck in anderer Sprache. " +
            "Tippe unten deinen Druck an, falls die Seltenheit nicht stimmt."
        !sicher -> "Mehrere Seltenheiten möglich – tippe unten deinen Druck an."
        else -> null
    }

    /**
     * Spec 2026-11-03 §2.3 -- `low` ("ab …") und Datum des Preisstands fuer die Unterzeile. Live-Werte ([liveLow],
     * [livePriceDate]) springen nur ein, wenn die lokale Preisdatei die ID nicht kennt.
     */
    fun lowUndStand(kopf: DruckPreis.Preis, markiert: Druck?, sicher: Boolean, preise: CmPriceFile.Preise?, builtAt: String?,
                    liveLow: (Int) -> Double? = { null }, livePriceDate: String? = null): Pair<Double?, String?> {
        val zweig1 = sicher && markiert != null
        fun mitId(id: Int): Pair<Double?, String?> =
            (preise?.low?.get(id) ?: liveLow(id)) to (if (preise?.trend?.containsKey(id) == true) preise.datum else livePriceDate)
        return when (kopf) {
            is DruckPreis.Fest -> when {
                kopf.quelle == DruckPreis.Quelle.SAMMLUNG -> null to null
                zweig1 && kopf.quelle == DruckPreis.Quelle.TREND && markiert!!.cm.size == 1 -> mitId(markiert.cm[0])
                zweig1 && kopf.quelle == DruckPreis.Quelle.LIVE && markiert!!.liveCm.size == 1 -> mitId(markiert.liveCm[0])
                else -> null to (preise?.datum ?: livePriceDate)
            }
            is DruckPreis.Spanne -> null to (preise?.datum ?: livePriceDate)
            is DruckPreis.Richtwert -> null to (if (kopf.ausKatalog) builtAt?.substringBefore('T')?.take(10) else livePriceDate)
            DruckPreis.Keiner -> null to null
        }
    }

    /** Spec 2026-11-03 §2.3 -- Zeile unter dem grossen Preis; Teile mit " · " verbunden. Fixture docs/fixtures/unterzeile.json. */
    fun unterzeile(kopf: DruckPreis.Preis, sicher: Boolean, abgeleitet: Boolean, low: Double?, standDatum: String?, heute: LocalDate,
                   sucht: Boolean, nachladen: Boolean, preiseFehlen: Boolean, letzterFehler: String?, liveFehler: Boolean): String {
        val teile = ArrayList<String>()
        fun cardmarket(q: DruckPreis.Quelle) = when {
            q == DruckPreis.Quelle.LIVE && abgeleitet -> "Cardmarket-Trend (live zugeordnet, Druck abgeleitet)"
            q == DruckPreis.Quelle.LIVE -> "Cardmarket-Trend (live zugeordnet)"
            abgeleitet -> "Cardmarket-Trend (Druck abgeleitet)"
            else -> "Cardmarket-Trend"
        }
        teile += when (kopf) {
            is DruckPreis.Fest -> when {
                kopf.quelle == DruckPreis.Quelle.SAMMLUNG -> "dein Sammlungspreis"
                kopf.mehrdeutig -> cardmarket(kopf.quelle) + " · eine von mehreren Versionen"
                else -> cardmarket(kopf.quelle)
            }
            is DruckPreis.Spanne -> {
                val herkunft = when {
                    kopf.quellen.all { it != DruckPreis.Quelle.SAMMLUNG } -> "Cardmarket-Trend"
                    kopf.quellen == setOf(DruckPreis.Quelle.SAMMLUNG) -> "Sammlungspreise"
                    else -> "Sammlung/Cardmarket"
                }
                herkunft + if (sicher) " · mehrere Versionen möglich" else " · Spanne der möglichen Drucke"
            }
            is DruckPreis.Richtwert ->
                if (sicher) "günstigster Druck der Karte (Cardmarket) – kein Preis für diesen Druck" else "günstigster Druck der Karte (Cardmarket)"
            DruckPreis.Keiner -> "kein Cardmarket-Preis bekannt"
        }
        if (sicher && kopf is DruckPreis.Fest && !kopf.ausSammlung && !kopf.mehrdeutig && low != null) teile += "ab ${DruckPreis.eur(low)} €"
        standText(standDatum, heute)?.let { teile += it }
        if (sucht) teile += "Preis wird gesucht …"
        else if (liveFehler && (kopf is DruckPreis.Keiner || kopf is DruckPreis.Richtwert)) teile += "Live-Suche nicht erreichbar"
        if (nachladen) teile += "Drucke werden nachgeladen …"
        if (preiseFehlen) teile += if (letzterFehler != null) "Preise konnten nicht geladen werden – nächster Versuch beim nächsten Scan"
            else "Preise werden beim nächsten Netz geladen"
        return teile.joinToString(" · ")
    }

    /** Spec §5: Stand der Preisdatei erst ab 3 Tagen Alter anzeigen. */
    fun standText(datum: String?, heute: LocalDate): String? {
        val d = runCatching { LocalDate.parse(datum ?: return null) }.getOrNull() ?: return null
        if (ChronoUnit.DAYS.between(d, heute) < 3) return null
        return "Stand %02d.%02d.".format(d.dayOfMonth, d.monthValue)
    }
}
