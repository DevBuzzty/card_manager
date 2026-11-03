# Einzelscan: Preis findet sich zuverlässig – Design

Stand: 2026-11-03 · Status: Entwurf, überarbeitet nach Review vom 03.11. (Ergebnis je Kritikpunkt in §14).
Grundlage: Ursachenanalyse (4 Analysen + Synthese vom 03.11.) und Nutzerentscheidungen vom 03.11.
Setzt voraus: Spec 2026-10-04 (Ergebnis-Seite + Preisdatei), Spec 2026-10-05 E1 (Muster Einzelabruf einer Edge Function mit Nutzer-JWT).
Umsetzung: **zwei Teams parallel** (Android, Server), ohne Absprache. Die Verträge dazwischen stehen vollständig in §5, §6 und §9;
die Dateien sind disjunkt verteilt (§12). Zeilennummern im Text beziehen sich auf Stand `d4da262`.

---

## 1. Ziel und Nicht-Ziele

Der Einzelmodus dient vor allem dem **Preis-Nachschlagen**. Nach einem Einzelfoto steht im Preisfeld der Ergebnis-Seite fast immer
eine Zahl. Woher sie kommt, ist immer erkennbar: dein Sammlungspreis, Cardmarket-Trend des Drucks, live zugeordnet, Spanne oder Richtwert „ab …“.
Ein „–“ erscheint nur, wenn es wirklich keinen Euro-Wert gibt, und dann mit Begründung.

### Befund (Analyse 03.11., Kurzfassung; Nummern = `synthesis.rootCauses` der Analyse)
| # | Ursache | Wirkung | Abschnitt |
|---|---|---|---|
| 1 | 83 % der Karten (12 082 / 14 597) haben im Katalog v11 keine verifizierten DE-Drucke. Nach 1,5 s Netz-Timeout gelten nur die EN-Katalogdrucke. `SetCodeMatch` Fall 1 setzt den gelesenen DE-Code zusammen (`SetCodeMatch.kt:333-340`). `ScanErgebnis.drucke()` übernimmt ihn nicht, also findet `kopfPreis` nichts und zeigt „–“, obwohl der EN-Zwilling darunter einen Trend hat | häufigster Fall, Erstscan | §3.1 |
| 2 | `fetchAllSets` blockiert in `async`-Kindern. `withTimeoutOrNull` kehrt erst nach den Netzaufrufen zurück, verwirft das Ergebnis und startet einen **zweiten** Abruf. Die Seite rechnet danach nie neu | verstärkt 1 | §4 |
| 3 | Kein Rückfall, wenn ein Druck keine `cm` hat: 6 159 + 650 Drucke, 632 Karten ganz ohne Preis. `CatalogCard.cmPrice` (14 070 Karten) bleibt ungenutzt | „–“ trotz bekannter Karte | §5, §6, §7 |
| 4 | Seltenheit muss wörtlich gleich sein. „Unknown“ (nur Konami kennt den DE-Code) und „Starfoil“ statt „Starfoil Rare“ passen nie, regionslose Codes (`LOB-005`) passen nicht auf `ohneRegion` | Netzpfad verliert Treffer | §3.2–§3.4 |
| 5 | Preisdatei: ein Versuch je Kaltstart, Fehler werden still verschluckt | selten, dann alles „–“ | §3.5 |
| 6 | Unbestätigt: Die APK auf dem Handy könnte älter sein als die Ergebnis-Seite vom 04.10. `versionCode = 1` fest, also nicht erkennbar | würde alles überdecken | §8.2, §11.5 |
| 7 | Katalog veraltet (v11 vom 04.10.), Alias-Passcodes ohne Katalogtreffer | wachsend für neue Sets; Alias selten | §8.1 (Alias), §11.7 (Katalog, außerhalb dieser Spec) |
| (Zusatz) | 26–27 % der Drucke haben nur eine Spanne (Median Faktor 12), weil Cardmarket-Arrays mehrdeutig sind (RA01, LAVD, LOB-G003). Analyse-Frage 7, kein eigener Rang | Qualität | §5.5 |

### Nutzerentscheidungen (03.11., verbindlich)
| Frage | Entscheidung |
|---|---|
| Kartenweiter Richtwert | **Ja.** Hat der Druck keinen eigenen Cardmarket-Preis, erscheint der kartenweite Cardmarket-Wert als **„ab X €“**, gekennzeichnet als „günstigster Druck“. Er gilt nie als Druckpreis und fließt nie in Valuation oder condition-factors |
| USD / TCGplayer | **Nein.** Nur EUR / Cardmarket |
| Wartezeit Einzelmodus | bis **4 s** statt 1,5 s. Druck und Preis werden nachträglich aktualisiert, wenn Netzdaten nachkommen. Eine **getippte Auswahl wird nie überschrieben**. Stapelmodus: 1,5 s, unverändert schnell |
| Umfang | Option A (Offline-Kette), C nur EUR-Richtwert, E klein (Alias, Versionsnummer), B (Netzabruf), D (Edge Function `resolve-cm-product` mit Disambiguierung, Cache-Tabelle, Android-Client) |

### Grundregeln, die überall gelten
- **Nie ein falscher Preis als druckgenau.** Ein Wert heißt nur dann „Cardmarket-Trend“ ohne Zusatz, wenn genau ein
  Cardmarket-Produkt zum Druck gehört.
- **Europäisch** heißt in dieser Spec: Sprache ∈ {DE, EN, FR, IT, ES, PT}. Nur europäische Drucke teilen sich ein Cardmarket-Produkt
  über Sprachgrenzen (gleicher `CodeKey`, gleiche Seltenheit). JP und KR fallen **nie** auf einen anderen Druck zurück, weder offline
  (§3.2) noch live (§6) noch im Kopf (§2.2).

### Nicht-Ziele
- USD-Preise, TCGplayer, YGOPRODeck-`set_price` (bleibt verworfen).
- Preisanzeige im Stapelmodus, Änderungen an Staging, Overlay oder Lichtschranke.
- Katalog-Neubau (v12) und dessen Verlagerung in die Cloud. Das ist eine betriebliche Begleitmaßnahme des Nutzers (§11.7), kein Code dieser Spec.
- Cardmarket-Website abfragen (Cloudflare 403, AGB). KR-Preise (Cardmarket führt kein Koreanisch).
- Änderungen an Valuation, Bewertungs-Zwillingen, `cards.price`, `cm_product_id` in der Cloud. Live-Zuordnungen werden **nur angezeigt**, nie in die Sammlung geschrieben.
- Änderungen am Format der Preisdatei `cm-prices.json.gz` und am Katalogformat.
- Desktop-Quellcode. Einzige Desktop-Datei ist ein neuer Fixture-Test (§9, §12).

---

## 2. Preis-Rangfolge auf der Ergebnis-Seite

### 2.1 Preis je Druck (`DruckPreis.fuer`, Zeile in „Alle Drucke“)
`fuer(eigenerPreis, cm, liveCm, trend)`. `liveCm` ist für nicht-europäische Zeilen immer leer (dafür sorgt `drucke()`, §3.1).
Feste Reihenfolge, die erste Stufe mit einem Wert gewinnt:

| Stufe | Bedingung | Ergebnis |
|---|---|---|
| 1 eigener Preis | eigener Sammlungsdruck mit Preis > 0 | `Fest(eur, SAMMLUNG)` |
| 2 Druck-Trend | `cm.size == 1` und `trend(cm[0]) > 0` | `Fest(eur, TREND)` |
| 3 Live-Trend | `liveCm.size == 1` und `trend(liveCm[0]) > 0` | `Fest(eur, LIVE)` |
| 4 mehrere Versionen | `basis` = `cm`, falls `cm.size ≥ 2`, sonst `liveCm`, falls `liveCm.size ≥ 2`, sonst weiter zu 5. `q` = TREND bei `cm`, LIVE bei `liveCm`. `werte` = Trends > 0 der IDs in `basis`, leer → weiter zu 5. **Jede** ID der `basis` hat einen Trend und alle sind gleich → `Fest(eur, q)`. Nur **ein** verschiedener Wert, aber nicht jede ID hat einen Trend → `Fest(eur, q, mehrdeutig = true)`. Sonst `Spanne(min, max, setOf(q))` | siehe links |
| 5 keiner | sonst | `Keiner` |

- Trend-Nachschlag: `trend(id) = Preisdatei.trend[id] ?: liveTrend[id]`. `liveTrend` sind die `prices[id][0]` der Live-Antwort (§5.2).
  Die lokale Datei geht vor, die Live-Antwort springt nur ein, wenn die Datei die ID nicht kennt oder fehlt.
- Stufe 3 steht vor Stufe 4: Eine eindeutige Live-Zuordnung schlägt ein mehrdeutiges Katalog-Array. Ein eindeutiger Katalog-Treffer
  mit Trend (Stufe 2) schlägt jede Live-Antwort.
- **Bewusste Änderung zu Spec 2026-10-04 §3.3:** Dort ergab ein mehrdeutiges Array mit nur einem bepreisten Produkt ein festes
  „Cardmarket-Trend“. Das ist nicht druckgenau (die anderen Versionen haben nur keinen Preis). Neu: `mehrdeutig = true`, Text „ca. …“
  (§2.4), im Kopf mit Zusatz „eine von mehreren Versionen“ (§2.3), ohne „ab low“.
- KR-Drucke: nur Stufe 1, wie bisher. JP-Drucke: Stufen 1, 2, 4 nur mit eigenem Katalog-`cm` (§3.2), nie Live.
- Der **Richtwert erscheint nie in einer Listenzeile**, nur im Kopf (§2.2). Sonst stünde neben jedem Druck derselbe zu niedrige Wert.
- Ist eine Zeile europäisch, ihr `liveKey` im Zustand SUCHT (§6.3) und ihr Preis `Keiner`, `Spanne` oder `Fest(mehrdeutig)`, steht rechts „…“
  statt des Preises.

### 2.2 Kopfpreis (`ScanErgebnis.kopfPreis`)
```kotlin
fun kopfPreis(drucke: List<Druck>, auswahl: String?, sicher: Boolean, keinTreffer: Boolean,
              kandidaten: Set<String>, richtwert: DruckPreis.Richtwert?, sprache: String? = null): DruckPreis.Preis
```
- `sprache` = `ScanSprache.fest` (Review-Nachtrag 2). Die Basis „alle“ in Zweig 2 und 3d ist **nicht** jede Zeile, sondern nur die
  Drucke der Scan-Sprache: Sprache der Auswahl (`gewaehlt.language`), sonst `sprache`; europäisch → alle europäischen Drucke,
  JP/KR → nur Drucke dieser Sprache, unbekannt (`null`) → alle Drucke. So landet nie ein EN-Preis im Kopf eines JP-Scans (§1).
- `sicher` = `gewaehlt || aktuell.confidence.light == GREEN`.
- `keinTreffer` = `aktuell.match.selected == null` (SetCodeMatch NO_MATCH). Eine Ersatz-Auswahl aus `ScanSprache.ersatzDruck`
  ändert daran nichts.
- `kandidaten` = Schlüssel (`ScanErgebnis.key`) aus `aktuell.match.candidates`, plus `auswahl`, falls nicht `null`.

```
gewaehlt = drucke[auswahl]
1. sicher und gewaehlt != null:
       gewaehlt.preis, falls nicht Keiner;  sonst richtwert;  sonst Keiner      (Unterzeile nennt den Grund, §2.3)
2. keinTreffer:
       spanneUeber(alle drucke der Scan-Sprache), falls nicht Keiner;  sonst richtwert;  sonst Keiner
3. sonst (unsicher):
   a) spanneUeber(drucke mit Schlüssel in kandidaten)
   b) sonst spanneUeber(Zwillinge ohne die Kandidaten selbst): Drucke d, für die es einen Kandidaten k in drucke gibt mit
        d und k europäisch, CodeKey.of(d.setCode) == CodeKey.of(k.setCode) != null,
        und (RarityNorm.gleich(d.rarity, k.rarity) oder RarityNorm.key einer der beiden == null)
   c) sonst richtwert
   d) sonst spanneUeber(alle drucke der Scan-Sprache)
   e) sonst Keiner
```
**`spanneUeber(preise)`** (in `DruckPreis`):
- Ignoriert `Richtwert` und `Keiner`. Werte: `Fest` → `eur`, `Spanne` → `min` und `max`. Keine Werte → `Keiner`.
- `min == max` → `Fest(min, quelle, mehrdeutig)`: `quelle` = die gemeinsame Quelle, wenn alle Beiträge dieselbe haben (bei Spannen:
  `quellen` mit genau diesem einen Element), sonst `TREND`. `mehrdeutig` = irgendein Beitrag war `Fest(mehrdeutig = true)`
  **oder** (Review-Nachtrag 2) mindestens ein übergebener Druck hatte keinen Wert (`Keiner`/`Richtwert`) – wie Stufe 4 von
  `DruckPreis.fuer`. Dann zeigt der Kopf „ca. …“ und „eine von mehreren Versionen“, nie einen scheinbar druckgenauen Trend. Die
  Kandidaten ohne Wert zählen in 3b nicht mit (ihre Zwillinge stehen für sie).
- Sonst `Spanne(min, max, quellen)`, `quellen` = Vereinigung der Quellen aller Beiträge.

Daraus folgt: Solange irgendein Druck der Liste einen Preis hat, fällt der Kopf bei unsicherer Erkennung oder ohne Treffer nie auf „–“.
Bei **sicherer** Erkennung zeigt er bewusst keinen fremden Druckpreis, sondern den Richtwert oder „–“ mit Begründung.

### 2.3 Anzeige-Texte im Preisfeld
Großer Wert `DruckPreis.text(kopf)` (`titleLarge`, fett; beim `Richtwert` Farbe `Muted`, nicht fett), darunter eine Zeile
`bodySmall`/`Muted`. Diese Zeile ist eine **reine Funktion** (Fixture `docs/fixtures/unterzeile.json`, §9.6):

```kotlin
fun unterzeile(kopf: DruckPreis.Preis, sicher: Boolean, abgeleitet: Boolean, low: Double?, standDatum: String?, heute: LocalDate,
               sucht: Boolean, nachladen: Boolean, preiseFehlen: Boolean, letzterFehler: String?, liveFehler: Boolean): String
```
Die Teile stehen in dieser Reihenfolge und sind mit „ · “ verbunden.

**Teil 1 (Quelle)** – immer vorhanden:
| Kopf | Teil 1 |
|---|---|
| `Fest(SAMMLUNG)` | „dein Sammlungspreis“ |
| `Fest(TREND)` | „Cardmarket-Trend“, mit `abgeleitet` „Cardmarket-Trend (Druck abgeleitet)“ |
| `Fest(LIVE)` | „Cardmarket-Trend (live zugeordnet)“, mit `abgeleitet` „Cardmarket-Trend (live zugeordnet, Druck abgeleitet)“ |
| `Fest(TREND\|LIVE, mehrdeutig)` | wie die Zeile darüber, dann „ · eine von mehreren Versionen“ |
| `Spanne` | Herkunft + Zusatz. Herkunft: `quellen ⊆ {TREND, LIVE}` → „Cardmarket-Trend“; `quellen == {SAMMLUNG}` → „Sammlungspreise“; gemischt → „Sammlung/Cardmarket“. Zusatz: `sicher` → „ · mehrere Versionen möglich“, sonst „ · Spanne der möglichen Drucke“ |
| `Richtwert` | `sicher` → „günstigster Druck der Karte (Cardmarket) – kein Preis für diesen Druck“, sonst „günstigster Druck der Karte (Cardmarket)“ |
| `Keiner` | „kein Cardmarket-Preis bekannt“ |

Danach, jeweils nur wenn zutreffend:
2. „ab {low} €“: wenn `sicher`, Kopf `Fest(TREND|LIVE)` ohne `mehrdeutig` und `low != null`.
3. `standText(standDatum, heute)` (zeigt wie bisher erst ab 3 Tagen Alter „Stand 04.10.“).
4. „Preis wird gesucht …“, wenn `sucht`. Sonst „Live-Suche nicht erreichbar“, wenn `liveFehler` und Kopf `Keiner` oder `Richtwert`.
5. „Drucke werden nachgeladen …“, wenn `nachladen`.
6. Wenn `preiseFehlen`: „Preise konnten nicht geladen werden – nächster Versuch beim nächsten Scan“, falls `letzterFehler != null`,
   sonst „Preise werden beim nächsten Netz geladen“.

**Eingaben der Unterzeile** (alle im Screen, Ableitung rein in `ScanErgebnis`):
- `abgeleitet` = Zweig 1 von §2.2 griff (sicher, `markiert != null`) **und** `markiert.abgeleitet` **und** `!gewaehlt`.
- `low`, `standDatum` = `ScanErgebnis.lowUndStand(kopf, markiert, sicher, preise, live, builtAt): Pair<Double?, String?>`:
  | Kopf | `low` | `standDatum` |
  |---|---|---|
  | `Fest(TREND)` aus Zweig 1, `markiert.cm.size == 1` (ID `i`) | `preise.low[i] ?: liveLow[i]` | `preise.datum`, wenn `preise.trend` `i` kennt, sonst `live.priceDate` |
  | `Fest(LIVE)` aus Zweig 1, `markiert.liveCm.size == 1` (ID `i`) | wie oben | wie oben |
  | übrige `Fest(TREND\|LIVE)` und `Spanne` | `null` | `preise?.datum ?: live.priceDate` |
  | `Richtwert(ausKatalog = true)` | `null` | Datumsteil von `CatalogRepository.builtAt()` |
  | `Richtwert(ausKatalog = false)` | `null` | `live.priceDate` |
  | `Fest(SAMMLUNG)`, `Keiner` | `null` | `null` |
- `sucht` = ein `liveKey` des markierten Drucks oder eines Kandidaten ist im Zustand SUCHT (§6.3).
- `nachladen` aus §4.3, `preiseFehlen` = `preise == null`, `letzterFehler` = `CmPriceFile.letzterFehler.value`,
  `liveFehler` = Zustand FEHLER (§6.3).

**Hinweisfläche** (Warn, wie heute). Bedingung neu: `!sicher || markiert == null || (markiert.abgeleitet && !gewaehlt)`. Text:
- `markiert == null` → „Druck nicht erkannt – tippe unten deinen Druck an.“ (wie heute)
- sonst `markiert.abgeleitet && !gewaehlt` → „Druck abgeleitet – Seltenheit und Preis stammen vom selben Druck in anderer Sprache.
  Tippe unten deinen Druck an, falls die Seltenheit nicht stimmt.“ (sprachneutral: der zusammengesetzte Druck kann DE, FR, IT, ES
  oder PT sein; die Seltenheit kommt aus `bestGroup.first()`, `SetCodeMatch.kt:336`)
- sonst „Mehrere Seltenheiten möglich – tippe unten deinen Druck an.“ (wie heute)

Damit sieht der Nutzer auch bei GRÜN, dass der Druck nur abgeleitet ist.

### 2.4 Datenmodell (Android, `ui/DruckPreis.kt`)
```kotlin
enum class Quelle { SAMMLUNG, TREND, LIVE }
sealed interface Preis
data class Fest(val eur: Double, val quelle: Quelle, val mehrdeutig: Boolean = false) : Preis {
    val ausSammlung get() = quelle == Quelle.SAMMLUNG
}
data class Spanne(val min: Double, val max: Double, val quellen: Set<Quelle> = setOf(Quelle.TREND)) : Preis
data class Richtwert(val eur: Double, val ausKatalog: Boolean) : Preis      // nur Kopf
object Keiner : Preis
fun fuer(eigenerPreis: Double?, cm: List<Int>, liveCm: List<Int>, trend: (Int) -> Double?): Preis
fun spanneUeber(preise: List<Preis>): Preis
fun text(p: Preis): String
```
`text`: `Fest` → „12,40 €“, `Fest(mehrdeutig)` → „ca. 4,20 €“, `Spanne` → „ca. 3,10–48,00 €“, `Richtwert` → „ab 0,09 €“, `Keiner` → „–“.
`Fest(eur, ausSammlung: Boolean)` und `Spanne(min, max)` mit zwei Feldern entfallen; Aufrufer und Tests ziehen auf `quelle`/`quellen` um
(heute u. a. `ScanErgebnisScreen.kt:158`, `DruckPreisTest`, `ScanErgebnisTest`).

---

## 3. Offline-Kette reparieren (Option A, nur Android)

### 3.1 Zusammengesetzter Druck kommt in die Liste
```kotlin
fun drucke(known: List<SetOption>, katalog: List<CatalogPrinting>, besitz: List<CardRow>, trend: (Int) -> Double?,
           zusatz: List<SetOption> = emptyList(), live: Map<String, CmResolveRepository.LiveCm> = emptyMap()): List<Druck>
fun zusatz(gewaehlterDruck: SetOption?, match: SetCodeMatch.MatchResult): List<SetOption>
```
- `zusatz` = `listOfNotNull(gewaehlterDruck) + listOfNotNull(match.selected) + match.candidates` (in dieser Reihenfolge).
  `gewaehlterDruck` ist die `SetOption` der letzten Tipp-Auswahl (§4.4).
- Jeder `zusatz`-Eintrag mit `setCode != "Unknown"`, dessen Schlüssel noch nicht aus `known` oder `besitz` stammt, wird eine eigene
  Zeile. Sie bekommt `abgeleitet = true`, wenn kein `known`-Eintrag denselben Set-Code (ignoreCase) trägt.
- **Reihenfolge der Liste:** erst die `zusatz`-Zeilen, dann `known` (Katalogreihenfolge), dann `besitz`. Der markierte abgeleitete
  Druck steht so oben.
- Zeilentext: „🇩🇪 MAMO-DE072 · Ultra Rare · abgeleitet“ („ · abgeleitet“ in `Muted`, `bodySmall`).
- `cm` einer `zusatz`-Zeile entsteht nach derselben Treffer-Kette wie jede andere Zeile (§3.2–3.4). Das ist genau der heute
  schon vorhandene, aber nie erreichte `ohneRegion`-Rückfall auf den EN-Zwilling.
- `liveCm` einer Zeile = `live[liveKey(setCode, rarity)]?.cm ?: emptyList()`, **nur wenn die Zeile europäisch ist** (§1). JP- und
  KR-Zeilen bekommen nie `liveCm`, auch wenn ihr `liveKey` gleich ist (`CodeKey.of("SD1-JP001") == CodeKey.of("SD1-EN001")`).
- `data class Druck` bekommt `abgeleitet: Boolean = false` und `liveCm: List<Int> = emptyList()`.
- „In Sammlung +“ verhält sich wie heute: Der markierte (auch abgeleitete) Druck geht als `match.selected` hinaus (§4.4, `uebernahme`).

### 3.2 Treffer-Kette Druck → Katalog-`cm`
Für eine Zeile `(code, rarity, lang)`, wenn `lang != KR`:
1. Katalogdruck mit gleichem Code (ignoreCase) und `RarityNorm.gleich(rarity, it.rarity)` und `cm` nicht leer.
2. Sonst, wenn `lang` europäisch ist: Katalogdruck mit `CodeKey.of(it.code) == CodeKey.of(code) != null`,
   gleicher Seltenheit laut `RarityNorm` und `cm` nicht leer.
3. Sonst, wenn `RarityNorm.key(rarity) == null` (unbekannte Seltenheit), gilt die Regel aus §3.4.
4. Sonst leer.

**`CodeKey.of(code)`** (neu `cloud/CodeKey.kt`, ersetzt das private `ohneRegion`; Twin mit Deno über `docs/fixtures/code-key.json`):
```
c = code.trim().uppercase()
m = ^([A-Z0-9]{2,6})-([A-Z]{1,2})?([A-Z]?\d{1,4})$     (Region jetzt optional -> LOB-005 passt)
kein Treffer -> null
nummer = gruppe3.trimStart('0'), leer -> "0"
-> gruppe1 + "-" + nummer                              (LOB-DE005 -> "LOB-5", SGX3-DEA10 -> "SGX3-A10", LOB-005 -> "LOB-5")
```
Der Ausdruck ist gierig: `[A-Z]{1,2}` nimmt bei `SGX3-DEA10` „DE“, `[A-Z]?\d` nimmt „A10“. Das entspricht dem heutigen Verhalten.

### 3.3 Seltenheits-Normalisierung `RarityNorm`
Neu `cloud/RarityNorm.kt` (Android), Twin `supabase/functions/_shared/rarity-norm.ts` (Server), gemeinsame Fixture
`docs/fixtures/rarity-norm.json` (§9.2).

```
key(raw: String?): String?
 1. s = raw ?: "";  "<!--" und "-->" entfernen;  trim
 2. n = s.lowercase(Locale.ROOT), nur [a-z0-9] behalten
 3. n in KEINE  -> null (unbekannt)
 4. n in ALIAS  -> ALIAS[n]
 5. sonst n
gleich(a, b) = key(a) != null && key(a) == key(b)
```
**KEINE** (keine Seltenheit): `""`, `unknown`, `unbekannt`, `new`, `reprint`, `newartwork`, `europeandebut`, `oceaniandebut`,
`europeanoceaniandebut`, `forcesmw`.

**ALIAS** (Kurzformen von Konami/eBay und Schreibvarianten aus Katalog v11):

| n | key | Herkunft |
|---|---|---|
| `n`, `c`, `normal` | `common` | Konami N/C |
| `r` | `rare` | Konami |
| `sr` | `superrare` | Konami |
| `ur` | `ultrarare` | Konami |
| `utr` | `ultimaterare` | Konami UtR |
| `scr`, `secret` | `secretrare` | Konami ScR |
| `gr`, `hr`, `holographicrare` | `ghostrare` | Konami GR/HR (OCG „Holographic“ = TCG „Ghost“) |
| `pscr` | `prismaticsecretrare` | Konami PScR |
| `cr` | `collectorsrare` | Konami CR, Katalog „Cr“ |
| `qcsr`, `qcscr` | `quartercenturysecretrare` | Konami |
| `20thsr`, `20thscr` | `20thsecretrare` | Konami |
| `slr` | `starlightrare` | eBay-Kurzform |
| `plscr` | `platinumsecretrare` | eBay-Kurzform |
| `starfoil` | `starfoilrare` | Katalog 49× „Starfoil“ neben 441× „Starfoil Rare“ |
| `shatterfoil` | `shatterfoilrare` | wie `cardmarket-parse.cjs` |
| `mosaic` | `mosaicrare` | Schreibvariante |
| `extrasecret` | `extrasecretrare` | Katalog 2× „Extra Secret“ |
| `duelterminalnormalrareparallelrare` | `duelterminalnormalparallelrare` | Katalog-Tippfehler (1×) |

Nicht zusammengelegt werden (eigene Cardmarket-Produkte): Short Print ≠ Common, Gold Secret ≠ Gold ≠ Premium Gold,
„Ultra Rare (Pharaoh's Rare)“ ≠ Ultra Rare, Duel-Terminal-Varianten ≠ normale Parallel-Varianten. Groß-/Kleinschreibung
(„PLatinum Secret Rare“) erledigt Schritt 2.

### 3.4 Unbekannte Seltenheit („Unknown“, leer)
Ist `RarityNorm.key(rarity) == null` und `lang` europäisch:
- `passend` = Katalogdrucke mit gleichem Code (ignoreCase) und `cm` nicht leer. Gibt es keine, dann die mit gleichem `CodeKey`.
- `cm` = Vereinigung aller `cm` in `passend`, sortiert, ohne Doppelte. Eine ID ergibt einen festen Preis, mehrere eine Spanne bzw.
  `Fest(mehrdeutig)` nach §2.1 Stufe 4.
- Die angezeigte Seltenheit bleibt „Unknown“. Der Schlüssel ändert sich nicht, weil Sammlungszeilen über ihn zugeordnet werden.

### 3.5 Preisdatei: Retry und sichtbare Fehler (`cloud/CmPriceFile.kt`)
- `aktualisieren(context, force)` liefert `enum class Lauf { AUS_DATEI, GELADEN, NICHT_FAELLIG, BESETZT, OFFLINE, HTTP_FEHLER, KAPUTT, SCHREIBFEHLER }`.
- **Reiner Kern** (unit-getestet, ohne Context/SharedPreferences):
  ```kotlin
  sealed interface Download { class Bytes(val b: ByteArray) : Download; data class Http(val code: Int) : Download; object Offline : Download }
  internal fun lauf(ausDateiGeladen: Boolean, faellig: Boolean, download: () -> Download,
                    parse: (ByteArray) -> Preise?, schreiben: (ByteArray) -> Boolean, setze: (Preise) -> Unit): Pair<Lauf, String?>
  ```
  `!faellig` → (`AUS_DATEI`, falls `ausDateiGeladen`, sonst `NICHT_FAELLIG`; Fehler `null`). `Offline` → `OFFLINE` „offline“.
  `Http(c)` → `HTTP_FEHLER` „HTTP c“. `Bytes`: `parse == null` → `KAPUTT` „Datei unlesbar“; `schreiben == false` → `SCHREIBFEHLER`
  „Speichern fehlgeschlagen“; sonst `setze(neu)`, `GELADEN`, Fehler `null`.
  Die Hülle `aktualisieren` macht `tryLock` (sonst `BESETZT`), liest die Datei, berechnet `faellig`, setzt `KEY_LAST` nur bei `GELADEN`
  und bildet `IOException` des Downloads auf `Offline` ab.
- Neu: `val letzterFehler: StateFlow<String?>`. Fehlertext aus dem Kern bei OFFLINE, HTTP_FEHLER, KAPUTT, SCHREIBFEHLER; `null` bei
  GELADEN, AUS_DATEI, NICHT_FAELLIG; unverändert bei BESETZT.
- Jeder Lauf mit Ergebnis ≠ NICHT_FAELLIG/BESETZT schreibt `ScanLog.line("Preise", "lauf=<Lauf> datum=<datum|-> fehler=<text|->")`
  und bei einem Fehler zusätzlich `android.util.Log.w("CmPriceFile", …)`.
- **Retry:** `ScanErgebnisScreen` ruft beim Öffnen `CmPriceFile.aktualisieren(context)` auf (`LaunchedEffect(pc)`). `tryLock` und `faellig`
  verhindern doppelte oder unnötige Downloads. `AppNav` bleibt unverändert (Start-Aufruf bleibt).

---

## 4. Netzabruf im Einzelmodus (Option B, nur Android)

### 4.1 Ein geteilter Abruf (`cloud/PrintingRepository.kt`)
```kotlin
private val laufend = java.util.concurrent.ConcurrentHashMap<String, Deferred<List<SetOption>>>()
internal var abruf: suspend (String) -> List<SetOption> = { fetchAllSets(it) }      // Naht für Tests
internal var scope: CoroutineScope = hintergrund                                    // Naht für Tests
internal var protokoll: (String, String) -> Unit = { t, m -> ScanLog.line(t, m) }   // Naht für Tests
internal var jetztMs: () -> Long = { System.nanoTime() / 1_000_000 }

fun fetchAllSetsGeteilt(passcode: String): Deferred<List<SetOption>> {
    laufend[passcode]?.let { return it }
    lateinit var neu: Deferred<List<SetOption>>
    neu = scope.async(start = CoroutineStart.LAZY) {
        val t0 = jetztMs()
        try {
            val l = try { abruf(passcode) } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
            protokoll("Drucke", "pc=$passcode geteilt n=${l.size} dauer=${jetztMs() - t0}ms")
            l
        } finally {
            laufend.remove(passcode, neu)            // zweistellig: entfernt nur den eigenen Eintrag
        }
    }
    val vorhanden = laufend.putIfAbsent(passcode, neu)
    if (vorhanden != null) { neu.cancel(); return vorhanden }   // nie gestartet, verworfen
    neu.start()
    return neu
}
```
- Das Deferred startet erst **nach** dem Eintragen (`LAZY`). Darum findet `remove(passcode, neu)` im `finally` den Eintrag immer, auch
  wenn der Abruf sofort fertig ist (Katalog-verifiziert, ScanCache, schneller Netzfehler). Danach ist die Map leer, und der nächste
  Aufruf startet neu. Ein zweiter Aufrufer während des Laufs bekommt das laufende Deferred.
- Der Job ruft `fetchAllSets(passcode)` auf, das wie heute den `ScanCache` schreibt. Ein Fehler ergibt eine leere Liste.
- **Kein Umbau auf suspendierendes OkHttp.** Damit eine Frist wirklich greift, genügt es, auf das Deferred im fremden `hintergrund`-Scope
  zu warten (dasselbe Muster wie `koreanNameKurz`, `PrintingRepository.kt:207-215`): Abgebrochen wird nur das Warten, der Abruf läuft
  weiter und füllt den Cache. Den geteilten Job bricht niemand ab.
- `client` bekommt `callTimeout(10, TimeUnit.SECONDS)` (`OkHttpClient.Builder()…build()`), damit kein Hintergrundjob an einem hängenden
  Aufruf festsitzt. Das gilt für alle Aufrufe des Clients, auch KR-Pfade; dort war bisher gar keine Gesamtfrist gesetzt.

### 4.2 `ScanResolver.resolve`
```kotlin
const val NETZ_WARTEN_STAPEL_MS = 1_500L
const val NETZ_WARTEN_EINZEL_MS = 4_000L
suspend fun resolve(pc, evidence, framesEvidence, editionTexts, defaultEdition,
                    netzWartenMs: Long = NETZ_WARTEN_STAPEL_MS, nachrechnen: Boolean = false): ResolvedScan?
```
- **Nähte für Tests** (Vorgaben = heutiges Verhalten):
  ```kotlin
  internal var katalogKarte: (String) -> CatalogCard? = { CatalogRepository.card(it) }
  internal var sucheKarte: suspend (String) -> CardRow? = { CardSearchRepository.search(it).firstOrNull() }
  internal var geteilt: (String) -> Deferred<List<SetOption>> = { PrintingRepository.fetchAllSetsGeteilt(it) }
  internal var krAusCache: (String) -> List<SetOption> = { PrintingRepository.cachedKoreanSets(it) }
  internal var protokoll: (String, String) -> Unit = { t, m -> ScanLog.line(t, m) }   // auch an logScanDecision durchgereicht
  internal var io: CoroutineDispatcher = Dispatchers.IO
  internal var rechnen: CoroutineDispatcher = Dispatchers.Default
  internal var hintergrund: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  internal var jetztMs: () -> Long = { System.nanoTime() / 1_000_000 }
  ```
  `logScanDecision` bekommt einen Parameter `protokoll` (Vorgabe `ScanLog::line`), weil `ScanLog.line` → `android.util.Log.i` in
  JVM-Tests wirft.
- Netzpfad (Karte ohne verifizierten Katalogblock):
  ```kotlin
  val d = geteilt(pc)
  val t0 = jetztMs()
  val netz = withTimeoutOrNull(netzWartenMs) {
      try { d.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
  }
  val dauer = jetztMs() - t0
  ```
  Kein `runCatching` um `await`: Es würde die `TimeoutCancellationException` und einen Abbruch des Aufrufers (Nutzer verlässt die
  Kamera) schlucken. `d` selbst wird nie abgebrochen (SupervisorJob, verworfene Deferreds werden nie zurückgegeben).
- **Rückfall auf die Katalogdrucke**, wenn `netz == null` (Frist) **oder** `netz` leer ist. Heute ergab ein schneller Netzfehler eine
  leere `knownSets`-Liste ohne Katalogdrucke. Rückfall = `RarityQuellen.ohneErfundeneRarity(katalogdrucke + krAusCache(pc))` wie heute.
- **Logzeilen** (Tag „Drucke“) mit gemessener Dauer:
  `"pc=$pc Netz ok n=${netz.size} dauer=${dauer}ms"`, `"pc=$pc Netz > ${netzWartenMs}ms dauer=${dauer}ms, Katalog-Drucke genutzt"`,
  `"pc=$pc Netz leer dauer=${dauer}ms, Katalog-Drucke genutzt"`.
- **Kein zweiter Abruf mehr:** `hintergrund.launch { fetchAllSets(pc) }` entfällt. `d` läuft weiter und füllt den Cache.
- **Stapelmodus ändert sich dadurch, ehrlich benannt:** (a) `resolve` kehrt nach höchstens 1,5 s wirklich zurück; heute wartete
  `withTimeoutOrNull` auf die blockierenden Aufrufe (Ursache 2), der Stapel wird also schneller. (b) Eine leere Netzantwort ergibt
  jetzt die Katalogdrucke statt einer leeren Liste. (c) Halb so viele Netzabrufe. Kommt das Netz innerhalb von 1,5 s, ist das
  Ergebnis gleich. `ScanCapture` bleibt bei den Vorgaben, also **1,5 s und ohne `verbessert`**.
- `ResolvedScan` bekommt `val verbessert: Deferred<ResolvedScan?>? = null`. Es ist nur dann nicht `null`, wenn `nachrechnen == true` ist
  **und** der Rückfall griff. Der Job (`hintergrund.async`) wartet auf `d` (gleicher try/catch wie oben). Ist das Ergebnis leer oder als
  Menge der Schlüssel `ScanErgebnis.key(setCode, rarity, language)` gleich den alten `knownSets`, liefert er `null`. Sonst rechnet er mit
  denselben `evidence`/`framesEvidence`/`editionTexts`/`defaultEdition` `SetCodeMatch.best` und `ScanConfidence.fromEvidence` neu
  (auf `rechnen`), schreibt `logScanDecision("nach", …)` und liefert ein neues `ResolvedScan` (gleiche `base`, gleicher `readSetCode`,
  `verbessert = null`).
- Aufrufer: `ScanScreen.fotoAusloesen` (`ScanScreen.kt:519`) übergibt `netzWartenMs = NETZ_WARTEN_EINZEL_MS, nachrechnen = true`.
  `ScanCapture` (`ScanCapture.kt:103`, `:286`) bleibt unverändert.

### 4.3 Seite rechnet neu (`ScanErgebnisScreen`)
**Zustand** (alle `remember(r)`, also nur beim Öffnen mit einem neuen `r` zurückgesetzt, **nie** durch `uebernimm`):
`aktuell` (Startwert `r`), `auswahl`, `auflage`, `gewaehlt`, `auflageGewaehlt`, `gewaehlterDruck: SetOption?` (neu, Start `null`),
`nachladen` (Start `r.verbessert != null`). Je `pc`: `katalog`, `katalogGeladen` (§6.1), `liveStand` (§6.3).

**Abgeleitete Werte** lesen `aktuell`, und ihre `remember`-Schlüssel enthalten jede Eingabe:
```kotlin
val drucke = remember(aktuell, katalog, besitz, preise, gewaehlterDruck, liveStand) {
    ScanErgebnis.drucke(aktuell.knownSets, katalog?.printings ?: emptyList(), besitz,
        { id -> preise?.trend?.get(id) ?: liveStand.trend(id) },
        ScanErgebnis.zusatz(gewaehlterDruck, aktuell.match), liveStand.ergebnisse)
}
```
`sicher`, `markiert`, `kopf`, `richtwert`, `unterzeile`, `liveBedarf` werden ohne `remember` bei jeder Komposition aus `drucke`/`aktuell`
berechnet (billig).

**Jede `r.`-Stelle der Datei** (Stand `d4da262`) und was daraus wird:
| Zeile | heute | neu |
|---|---|---|
| 49 | `pc = r.base.id` | bleibt `r` (`base` ist in `neu` identisch) |
| 59 | `drucke(r.knownSets, …)` mit `remember(katalog, besitz, preise)` | Block oben |
| 61-62 | Startwert `auswahl` aus `r.match.selected`, `ersatzDruck(…, r.knownSets)` | bleibt `r` (Startwert); nach dem Nachladen setzt `nachUebernahme` ihn aus `neu` (§4.4) |
| 64 | Startwert `auflage` aus `r.confidence.effectiveEdition` | bleibt `r` (Startwert), sonst §4.4 |
| 70 | `sicher` aus `r.confidence.light` | `aktuell.confidence.light` |
| 71 | `auflageUnsicher` aus `r.confidence.editionConfidence` | `aktuell.confidence.editionConfidence` |
| 73 | `kopfPreis(…, r.match.candidates)` | `kopfPreis(drucke, auswahl, sicher, aktuell.match.selected == null, kandidaten(aktuell, auswahl), richtwert)` |
| 74-75 | `r.base.imageUrl`, `r.base.name` | `aktuell.base…` (identisch, der Einheitlichkeit halber) |
| 85-91 | `onUebernehmen(ResolvedScan(r.base, r.knownSets, r.match.copy(…), r.confidence…, r.readSetCode))` | `onUebernehmen(ScanErgebnis.uebernahme(aktuell, markiert, auswahl, gewaehlt, auflage, auflageGewaehlt))` (§4.4) |
| 102 | Ampelfarbe aus `r.confidence.light` | `aktuell.confidence.light` |
| 109 | Grund aus `r.confidence.reason` | `aktuell.confidence.reason` |

**Nachladen:**
```kotlin
LaunchedEffect(r) {
    val d = r.verbessert ?: return@LaunchedEffect
    val neu = try { d.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
    nachladen = false
    if (neu != null) uebernimm(neu)
}
```
- **Keine eigene Frist.** Der geteilte Abruf ist sequenziell (Titel → YGOPRODeck → Konami-Suche plus bis zu 8 Detailseiten →
  3×3 lokalisierte Abrufe) und kann mit `callTimeout` 10 s je Aufruf deutlich über 15 s dauern. Die Seite wartet, solange sie offen ist.
  Schließt der Nutzer sie, wird nur das Warten abgebrochen, der Abruf füllt trotzdem den Cache. Die tatsächliche Dauer steht in der
  ScanLog-Zeile „geteilt … dauer=“ (§4.1).
- `nachladen == true` → Teil 5 der Unterzeile (§2.3). Liefert `verbessert` `null` (nichts Neues), verschwindet der Hinweis still.

### 4.4 Die Nutzerauswahl bleibt
Reine Logik in `ScanErgebnis` (unit-getestet):
```kotlin
data class Zustand(val auswahl: String?, val gewaehlt: Boolean, val gewaehlterDruck: SetOption?,
                   val auflage: String, val auflageGewaehlt: Boolean)
fun nachUebernahme(alt: Zustand, neu: ResolvedScan, festeSprache: String?): Zustand
fun beimTippen(alt: Zustand, d: Druck): Zustand
fun uebernahme(aktuell: ResolvedScan, markiert: Druck?, auswahl: String?, gewaehlt: Boolean,
               auflage: String, auflageGewaehlt: Boolean): ResolvedScan
```
- `uebernimm(neu)`: `aktuell = neu`, dann `Zustand = nachUebernahme(alt, neu, ScanSprache.fest)`.
- `nachUebernahme`: Nicht getippt (`!gewaehlt`) → `auswahl = startAuswahl(neu.match.selected, ersatzDruck(festeSprache, neu.knownSets))`.
  Getippt → `auswahl` und `gewaehlterDruck` unverändert. Auflage gewählt (`auflageGewaehlt`) → `auflage` bleibt, sonst
  `neu.confidence.effectiveEdition`. Ampel und Grund kommen über `aktuell` aus `neu`.
- `beimTippen(alt, d)` (vom `clickable` einer Zeile aufgerufen): `auswahl = key(d)`, `gewaehlt = true`,
  `gewaehlterDruck = SetOption(d.setCode, d.rarity, 0.0, d.language)`. Über `zusatz` (§3.1) bleibt die Zeile damit immer in der Liste,
  auch wenn die neuen `knownSets` sie nicht enthalten.
- `uebernahme` (für „In Sammlung +“): `druck` = Eintrag aus `aktuell.knownSets` mit Schlüssel `auswahl`, sonst
  `SetOption(markiert.setCode, markiert.rarity, 0.0, markiert.language)`, sonst `aktuell.match.selected`. `confidence` wie heute
  (`effectiveEdition = auflage`; getippt → GREEN ohne Grund; Auflage gewählt → `editionConfidence = HIGH`). Ergebnis
  `ResolvedScan(aktuell.base, aktuell.knownSets, aktuell.match.copy(selected = druck), conf, aktuell.readSetCode)` mit
  `verbessert = null`. **`price` der SetOption ist immer 0.0**; der Richtwert und jeder Live-Wert gehen nie hinaus (§7).

---

## 5. Edge Function `resolve-cm-product` (Option D, Server)

### 5.1 Datenquelle: Index-Datei im privaten Bucket
`refresh-cardmarket-prices` bekommt einen **eigenständigen Schritt „cm-index“**. Er läuft **nur** mit dem Body `{ "step": "cm-index" }`
(täglicher Zeitplan 05:20 UTC aus `supabase/cm_index_cron.sql`, erster Aufbau von Hand, §11.2). Der normale 05:00-Lauf (Body `{}`)
bleibt **unverändert** und baut keinen Index. So teilt sich der Index-Bau weder Speicher noch CPU mit Sammlungspreisen und Preisdatei.

`index.ts` liest nach der Secret-Prüfung den Body mit `jsonBody` (`_shared/http.ts`) und fragt `routeStep(body)` (rein, in
`cm_index.ts`): `"cm-index"` → `runCmIndexStep(deps)`, danach zurück, **bevor** Sammlung oder Preisführer geladen werden;
`"unknown"` (anderer nicht leerer `step`) → 400 `{ "error": "unknown step" }`; `"main"` (kein `step`) → alles wie heute.
`runCmIndexStep(deps)` steht in `cm_index.ts` und bekommt `fetch`, Cloud-Abfrage der `cards`, Upload und `env` injiziert
(`index.ts` reicht die echten Abhängigkeiten durch), damit `step_test.ts` den Ablauf ohne Netz prüft.

**Ablage:** privater Bucket **`cm-index`** (angelegt in `supabase/cm_resolve_schema.sql`, §5.4), Pfad `cm-index.json.gz`,
`upload(…, { contentType: "application/gzip", upsert: true })` mit dem Service-Rollen-Client. **Nicht** im öffentlichen Bucket `catalog`:
`real` und `learned` stammen aus der Cloud-Sammlung und verrieten, welche Drucke der Nutzer besitzt.

**Grenzen der Edge Function:** 256 MB Speicher, 2 s CPU je Aufruf, 150 s Wanduhr. Ein Abbruch wegen Speicher oder CPU
(HTTP 546 `WORKER_LIMIT`) lässt sich mit try/catch **nicht** abfangen; try/catch deckt nur Exceptions ab. Deshalb:
- Die Eingaben werden **nacheinander** geladen. Je Datei: `fetch` → `res.json()` → benötigte Felder in kompakte Strukturen übernehmen →
  Referenz auf das geparste Objekt verwerfen (`let`, danach `= null`), bevor die nächste Datei kommt. Reihenfolge: cardsets (klein),
  Nonsingles → `expansionIndex`, Singles → `s`, dann Cloud-`cards` → `real`.
- Größen (Analyse 03.11.): Singles 14,8 MB, Katalog v11 15,2 MB entpackt; Nonsingles nicht gemessen (Phasen-Log nennt die Anzahl). Die Node-Messwerte (~75 ms Parsen
  der Singles) gelten nicht 1:1 für die Edge-CPU; der Schritt hat aber einen eigenen Aufruf und damit das volle Budget.

**Eingaben:**
| Quelle | URL / Herkunft | Pflicht | Zweck |
|---|---|---|---|
| cardsets | `https://db.ygoprodeck.com/api/v7/cardsets.php` (Array `[{ set_code, set_name, … }]`) | **ja** | Präfix → Set-Namen |
| Nonsingles | `https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_3.json`, Liste unter dem Schlüssel **`products`** | **ja** | Expansions-Index (`buildExpansionIndex`) |
| Singles | `…/productList/products_singles_3.json`, Liste unter **`products`** | **ja** | Name → Produkte |
| echte IDs | Cloud `cards` (`cm_product_id is not null`, `deleted = false`, `language <> 'KR'`; Spalten `name`, `set_code`, `rarity`, `cm_product_id`), seitenweise wie Schritt 1 | nein | `real`, `learned`, `blocks` |
| Katalog | `catalog_versions` (`kind = 'catalog'`) → `url` → gzip-JSON, Format `cards[]` mit `printings[]` und `printings_verified[]`, je Druck `code`, `rarity`, `cm` (Zahl oder Array) | nein, **nur mit Secret `CM_INDEX_KATALOG=1`** | zusätzliche Stichproben für `blocks` (nur Drucke mit **einer** Zahl als `cm`) |

Alle Abrufe mit `User-Agent: UA` aus `index.ts`. **Plausibilität** (Konstanten in `cm_index.ts`): Singles ≥ `MIN_SINGLES = 50_000`,
Nonsingles ≥ `MIN_NONSINGLES = 1_000`, cardsets ≥ `MIN_CARDSETS = 500`, Präfixe in `x` ≥ `MIN_PREFIXES = 300`. Fehlt eine Pflichteingabe
(Netz, HTTP, JSON, fehlender Schlüssel `products`) oder ist sie unplausibel, wird **nichts hochgeladen**, der Index vom Vortag bleibt.
Fehlen die optionalen Eingaben, wird ohne sie gebaut (`stats.real = 0` bzw. `stats.catalog = false`).

**Format** `cm-index.json.gz` (gzip-JSON):
```json
{
  "v": 1,
  "date": "2026-11-03",
  "built_at": "2026-11-03T05:20:41Z",
  "s":      { "<normName>": [101789, 1012, 101790, 1013] },
  "x":      { "LOB": [1011, 1734] },
  "real":   { "LOB-1|blueeyeswhitedragon|ultrarare": 102800 },
  "learned":{ "1734|7|platinumsecretrare": { "4": 3 } },
  "blocks": { "1734": { "superrare": 741150, "ultrarare": 741201 } },
  "stats":  { "singles": 86843, "nonsingles": 0, "cardsets": 0, "names": 14618, "prefixes": 0, "real": 0, "catalog": false, "blockSamples": 0 }
}
```
- `s`: `normName(name)` → flaches Array `[idProduct, idExpansion, …]`, je Name nach `idProduct` aufsteigend.
- `x`: Schlüssel = **ganzer** `cardsets[].set_code` in Großbuchstaben (wie Desktop `buildIndexes`, `cardmarket-bulk.cjs:95-99`, ohne
  Split) → `expansionIdsFor(setNames dieses Schlüssels, expansionIndex)` aufsteigend. Leere Einträge fehlen. Nachgeschlagen wird mit
  `prefixOf(set_code)` = Teil vor dem ersten „-“, groß (wie Desktop `prefixOf`).
- `real`: `codeKey|normName(name)|RarityNorm.key(rarity)` → `cm_product_id`, `codeKey` = `CodeKey.of(set_code) ?: upper(trim(set_code))`
  (wie `code_key` des Caches, **mit Kartennummer**; Review-Nachtrag 2 – je Präfix bekämen fremde Artworks derselben Seltenheit,
  z. B. LDK2-K01/K02/K03, und Reprints hinter demselben Präfix die ID des einen besessenen Drucks). Zeilen mit unbekannter Seltenheit fallen weg.
  Zeigen mehrere Zeilen auf **verschiedene** IDs, fällt der Schlüssel ganz weg (Abweichung zum Desktop, dort gewinnt die letzte;
  bewusst vorsichtiger).
- `learned`: `learnRanks` über die `real`-Werte (Seltenheit als `RarityNorm.key`), Schlüssel `exp|n|rarityKey` → `{ rank: Anzahl }`.
- `blocks`: Stichproben = `real` (∪ Katalog-Einzel-`cm` nur mit `CM_INDEX_KATALOG=1`), je `{ prefix, rarityKey, idProduct }`
  (`prefix` = `prefixOf(codeKey)`), ohne KR,
  ohne unbekannte Seltenheit, doppelte `(idProduct, rarityKey)` einmal. Je Stichprobe die Expansion aus der Versionsgruppe von
  `idProduct` in `s`. Je Expansion und rarityKey zählt der untere Median der idProducts. Expansionen mit weniger als 2 verschiedenen
  rarityKeys fehlen.

**Antwort und Protokoll des Schritts:** Jede Phase schreibt eine Zeile `console.log("[cm-index]", "<phase>", <zahlen>)`
(cardsets, nonsingles, singles, real, katalog, upload). Erfolg: HTTP 200
`{ "step": "cm-index", "cmIndex": { "date", "names", "prefixes", "singles", "real", "catalog", "bytes" } }`. Fehler: HTTP 500
`{ "step": "cm-index", "cmIndex": { "error": "<text>" } }` und `console.error`. Nachweis im Betrieb über das Änderungsdatum der
Storage-Datei bzw. die Function-Logs (§11.2/§11.4), nicht über `net._http_response`.

### 5.2 Vertrag
`POST https://<projekt>.supabase.co/functions/v1/resolve-cm-product`. Deploy mit `--no-verify-jwt`. Die Funktion prüft selbst
`verifyUser` (wie `ebay-sold-prices`, über `serviceDeps().verifyUser` aus `_shared/supabase-deps.ts`).

Kopfzeilen: `Authorization: Bearer <Nutzer-JWT>`, `apikey: <anon key>`, `Content-Type: application/json`.

**Anfrage:**
```json
{
  "v": 1,
  "card_id": "89631139",
  "name_en": "Blue-Eyes White Dragon",
  "printings": [
    { "set_code": "LOB-DE001", "rarity": "Ultra Rare" },
    { "set_code": "RA01-DE008", "rarity": "Platinum Secret Rare" }
  ]
}
```
| Feld | Typ | Regel |
|---|---|---|
| `v` | Zahl | muss `1` sein |
| `card_id` | String | `^\d{1,10}$` |
| `name_en` | String, optional | Fehlt das Feld, ist es `null` oder nach `trim` leer, kommt der Name von YGOPRODeck. Sonst nach `trim` höchstens 200 Zeichen. **400** nur bei einem Nicht-String (außer `null`) oder > 200 Zeichen. Android lässt das Feld weg, statt `null` zu senden |
| `printings` | Array | 1–10 Einträge |
| `printings[].set_code` | String | nach `trim` 1–20 Zeichen, nicht „Unknown“ (ignoreCase) |
| `printings[].rarity` | String | 0–60 Zeichen. Leer oder „Unknown“ ist erlaubt (unbekannt) |

Unbekannte Felder werden ignoriert. Body kein JSON-Objekt → 400 `bad_request`.

**Antwort 200:**
```json
{
  "ok": true,
  "v": 1,
  "index_date": "2026-11-03",
  "price_date": "2026-11-03",
  "card": { "name_en": "Blue-Eyes White Dragon", "ab": 0.09, "ab_products": 41 },
  "results": [
    { "set_code": "LOB-DE001", "rarity": "Ultra Rare", "code_key": "LOB-1", "rarity_key": "ultrarare",
      "status": "resolved", "how": "unique", "reason": null, "cm": [102800], "cached": false },
    { "set_code": "RA01-DE008", "rarity": "Platinum Secret Rare", "code_key": "RA01-8", "rarity_key": "platinumsecretrare",
      "status": "ambiguous", "how": null, "reason": "no-model", "cm": [741197, 741198, 741199], "cached": true }
  ],
  "prices": { "102800": [12.5, 9.0], "741197": [0.89, 0.5], "741198": [3.2, null], "741199": [34.94, 30.0] }
}
```
| Feld | Typ | Bedeutung |
|---|---|---|
| `index_date` | String `YYYY-MM-DD` | `date` des benutzten Index |
| `price_date` | String \| null | `date` der Preisdatei, `null` wenn sie fehlt |
| `card.name_en` | String \| null | benutzter Name (Anfrage oder YGOPRODeck) |
| `card.ab` | Zahl \| null | kleinster Trend > 0 über **alle** Singles mit diesem `normName` (jede Expansion). `null` ohne Name, ohne Treffer oder ohne Preisdatei |
| `card.ab_products` | Zahl | Anzahl dieser Singles (0 ohne Name) |
| `results` | Array | je Anfrage-Eintrag genau einer, gleiche Reihenfolge |
| `results[].code_key` | String | `CodeKey.of(set_code) ?: set_code.trim().uppercase()` |
| `results[].rarity_key` | String | `RarityNorm.key(rarity) ?: ""` |
| `results[].status` | `"resolved"` \| `"ambiguous"` \| `"not_found"` | |
| `results[].how` | `"real"` \| `"unique"` \| `"derived"` \| `"blocks"` \| null | nur bei `resolved` |
| `results[].reason` | String \| null | `not_found`: `"kr"`, `"no-name"`, `"no-expansion"`, `"no-candidate"`. `ambiguous`: `"no-group"`, `"no-model"`, `"conflict"`, `"too-few"`, `"not-by-rarity"`, `"no-printings"`, `"rarity-unknown"`. `resolved`: `null` |
| `results[].cm` | Zahl[] | `resolved`: genau 1. `ambiguous`: ≥ 2 aufsteigend. `not_found`: leer |
| `results[].cached` | Boolean | aus `cm_resolve_cache` |
| `prices` | Objekt | `"<id>": [trend \| null, low \| null]` für jede ID in `results[].cm`, die in der Preisdatei steht |

**Fehler** (immer JSON `{ "ok": false, "code": …, "error": … }`, `error` auf Deutsch):
| HTTP | `code` | `error` | Fall |
|---|---|---|---|
| 405 | `method` | „Nur POST.“ | andere Methode |
| 401 | `auth` | „Nicht angemeldet.“ | `verifyUser` schlägt fehl |
| 400 | `bad_request` | „Anfrage ungültig: <feld>“ | Regelverstoß aus der Tabelle oben |
| 503 | `no_index` | „Cardmarket-Index fehlt.“ | `cm-index.json.gz` fehlt, ist unlesbar oder hat `v != 1` |
| 500 | `internal` | „Interner Fehler.“ | alles andere (Meldung nur in `console.error`) |

Fehlt **nur** die Preisdatei, ist das kein Fehler: `price_date = null`, `prices = {}`, `card.ab = null`.
Antworten des Gateways (z. B. 401 bei fehlendem `--no-verify-jwt`, 546 `WORKER_LIMIT`) haben kein Feld `ok`; der Client wertet sie als
Fehler (§6.2).

### 5.3 Auflösung je Druck (`resolve.ts`, rein, getestet)
**Twin-Port `supabase/functions/_shared/cm-parse.ts`** (aus `desktop/electron/cardmarket-bulk-parse.cjs`). Er exportiert einen **Kern auf
Ebene der Expansions-IDs**, die Desktop-Signaturen sind dünne Wrapper darüber:
```ts
export type Version = { idProduct: number; idExpansion: number };
export interface KernIndex {
  kandidaten(name: string): Version[];                     // alle Singles mit normName == name
  versionen(name: string, exp: number): number[] | undefined;   // aufsteigend, wie versionIndex.byKey
}
export type Learned = (groupKey: string) => Map<number, number> | undefined;
export function resolveForExp(cardName: string, expIds: Set<number>, ix: KernIndex): { idProduct: number | null; reason: string };
export function deriveForExp(p: { cardName: string; expIds: Set<number>; rarity: string; printingRarities?: string[] },
                             ix: KernIndex, learned: Learned, minSamples = 2): { idProduct: number | null; groupKey: string | null; reason: string };
export function cmForExp(p: { cardName; expIds; rarity; printingRarities?; realId? }, ix: KernIndex, learned: Learned): number | number[] | null;
// Wrapper mit Desktop-Signatur (setNames + expansionIndex), rufen expansionIdsFor -> Kern:
export function resolveProduct(...), deriveProduct(...), cmForPrinting(...);
export function buildExpansionIndex, buildSinglesIndex, buildVersionIndex, learnRanks, expansionIdsFor, expansionNameVariants,
       decodeEntities, tokenKey, versionsAreRarities, normName;
export function kernAusDesktop(ix: { singlesIndex; versionIndex }): KernIndex;
export function kernAusS(s: Record<string, number[]>, name: string): KernIndex;   // nur die Gruppen dieses Namens
```
- `reason`-Werte des Kerns sind **dieselben wie im Desktop**, einschließlich `needs-printings` (`printingRarities === undefined`) und
  `ambiguous` aus `resolveForExp`. Nach außen wird nur übersetzt (§5.3 Schritt 8).
- Die Fixture §9.3 prüft beide Wege: Desktop-Wrapper (Deno und Node) und Kern + Index aus `buildCmIndex` (Deno).

**Laden** (je Instanz, Modulspeicher, 1 h TTL; ein warmer Lauf lädt nicht neu):
- Index: `storage.from("cm-index").download("cm-index.json.gz")` mit dem Service-Rollen-Client, gzip über `DecompressionStream`,
  JSON. Fehlt die Datei, ist sie kaputt oder `v !== 1` → 503 `no_index`.
- Preisdatei: `storage.from("catalog").download("cm-prices.json.gz")` (Service-Rolle, kein CDN; ~1,8 MB entpackt, 88 157 Einträge am
  03.11.). Fehlt sie → `price_date = null`.
- `versionen`/`kandidaten` werden **je Anfrage nur für den `normName` der Anfrage** aus `s` gebaut (`kernAusS`), nie für ganz `s`.
- `learned` = Lookup in `index.learned` (Rang-Schlüssel als Zahl).

**YGOPRODeck** (`ygoprodeck.ts`): `GET https://db.ygoprodeck.com/api/v7/cardinfo.php?id=<card_id>` mit `AbortSignal.timeout(2500)`,
**höchstens einmal je Anfrage** und nur, wenn gebraucht (Name fehlt, oder Schritt 8/9 braucht Seltenheiten). Ergebnis:
`{ name: string | null, sets: { set_code, set_rarity }[] } | null`. HTTP 200 → Daten. HTTP 400 (YGOPRODeck: Karte unbekannt) →
`{ name: null, sets: [] }`. Timeout, Netzfehler, 5xx → `null` (= **Fremdfehler**). Modulspeicher je `card_id` nur für Nicht-`null`
(höchstens 500 Einträge, 24 h).

`printingRarities(prefix)` = für jedes `sets[i]` mit `prefixOf(set_code) == prefix`:
`RarityNorm.key(set_rarity) ?: ("?" + (set_rarity ?? "").trim().toLowerCase())`. Unbekannte Seltenheiten werden **nicht verworfen**,
sondern als eigener Wert gezählt: Der Desktop zählt in `versionsAreRarities` Rohwerte, zwei „Unknown“ sind dort ein Duplikat und
ergeben `not-by-rarity`; so auch hier. YGOPRODeck `null` → `printingRarities` = `null` (Fremdfehler).

**Ablauf einer Anfrage:**
```
A. Validierung (§5.2), Index laden (sonst 503), Preisdatei laden (optional).
B. Cache lesen: EINE Abfrage  select … from cm_resolve_cache where card_id = :id and code_key in (:keys)
   (keys = code_key aller Nicht-KR-Einträge), Zeilen im Speicher nach rarity_key zugeordnet.
C. je Eintrag:
 0. KR-Code (/-KR?[A-Z]?\d/i wie language-kr.cjs)                    -> not_found/kr
 1. Cache-Zeile gültig (§5.4) und name_norm == normName(name)        -> deren Ergebnis, cached = true
    (name wie Schritt 2, nur geholt, wenn eine Zeile zu prüfen ist; ohne Name gilt keine Zeile)
 2. name = trim(name_en), falls nicht leer, sonst ygo()?.name;  fehlt -> not_found/no-name
 3. prefix = prefixOf(set_code);  exp = Set(index.x[prefix] ?? []);  leer -> not_found/no-expansion
 4. rk = RarityNorm.key(rarity)
 5. rk != null und id = index.real[code_key|normName(name)|rk], die Karte steht in genau EINER Expansion von exp
    und id ∈ versionen(normName(name), diese Expansion)              -> resolved/real   (sonst weiter mit 6)
 6. r = resolveForExp(name, exp, kern):  no-candidate -> not_found/no-candidate;  resolved -> resolved/unique
 7. (ambiguous) rk == null                                           -> ambiguous/rarity-unknown, cm = alle (Schritt 10)
 8. d = deriveForExp({name, exp, rarity: rk}, kern, learned)         (printingRarities zunächst undefined)
    d.reason == "needs-printings": pr = printingRarities(prefix) (merken);
        pr == null -> Ergebnis ambiguous/no-printings, Fremdfehler
        sonst d = deriveForExp({…, printingRarities: pr}, …)
    d.reason == "derived"                                            -> resolved/derived
 9. BLOCKS_AKTIV: pr ??= printingRarities(prefix);  pr != null und Block-Regel (§5.5) eindeutig -> resolved/blocks
    (pr == null: Regel übersprungen, Ergebnis aus 8 als Fremdfehler markiert)
10. sonst ambiguous/<d.reason>, cm = alle Versionen der Karte in den Expansionen von exp, aufsteigend (wie cmForPrinting)
D. card.ab = Minimum Trend > 0 über kandidaten(normName(name)); ab_products = deren Anzahl. Ohne Name: null / 0.
E. prices für alle IDs in results[].cm, die in der Preisdatei stehen.
F. Cache schreiben: EIN Upsert aller cachebaren Ergebnisse (§5.4), nach Primärschlüssel entdoppelt (letzter gewinnt;
   Postgres lehnt doppelte Schlüssel in einem Upsert ab), onConflict "card_id,code_key,rarity_key".
```
- Nach außen erscheint `no-printings` nur bei YGOPRODeck-Fremdfehler. Liefert YGOPRODeck Daten ohne Druck dieses Präfixes, ist
  `pr = []` und das Ergebnis `not-by-rarity` (wie Desktop `cmForPrinting` mit `printingRarities || []`).
- Wird der Name aus YGOPRODeck gebraucht, liefert derselbe Abruf auch die Seltenheiten; ein zweiter Abruf entfällt.

### 5.4 Cache-Tabelle und privater Bucket (neu `supabase/cm_resolve_schema.sql`, idempotent)
```sql
-- supabase/cm_resolve_schema.sql -- Spec 2026-11-03 §5.4. Einspielen VOR dem Deploy von resolve-cm-product.
create table if not exists public.cm_resolve_cache (
  card_id     text not null,
  code_key    text not null,             -- CodeKey.of(set_code) ?: upper(set_code), z.B. 'LOB-1'
  rarity_key  text not null,             -- RarityNorm.key(rarity) ?: ''
  status      text not null check (status in ('resolved', 'ambiguous', 'not_found')),
  how         text check (how in ('real', 'unique', 'derived', 'blocks')),
  reason      text,
  cm          integer[] not null default '{}',
  index_date  date not null,
  checked_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name_norm   text not null default '',  -- normName des verwendeten Namens; Zeile gilt nur für denselben Namen
  primary key (card_id, code_key, rarity_key)
);
alter table public.cm_resolve_cache add column if not exists name_norm text not null default '';
create index if not exists cm_resolve_cache_updated_idx on public.cm_resolve_cache (updated_at);   -- für die Aufräumzeile §11.6
drop trigger if exists trg_cm_resolve_cache_updated_at on public.cm_resolve_cache;
create trigger trg_cm_resolve_cache_updated_at before insert or update on public.cm_resolve_cache
  for each row execute function public.set_updated_at();
alter table public.cm_resolve_cache enable row level security;
-- Keine Policy: Geräte lesen die Tabelle nie, nur die Funktion (Service-Rolle umgeht RLS). Diagnose im SQL-Editor.
drop policy if exists cm_resolve_cache_authenticated_read on public.cm_resolve_cache;
revoke all on public.cm_resolve_cache from anon, authenticated;

-- Privater Bucket für den Cardmarket-Index (enthält aus der Sammlung abgeleitete Daten). Ohne Storage-Policy:
-- nur die Service-Rolle (refresh-cardmarket-prices schreibt, resolve-cm-product liest) kommt heran.
insert into storage.buckets (id, name, public)
values ('cm-index', 'cm-index', false)
on conflict (id) do update set public = false;
```
- **Gültig:** `name_norm` = `normName` des Namens dieser Anfrage (Review-Nachtrag 2: `name_en` kommt vom Client und steht nicht im
  Schlüssel; ein falscher Name darf keine Zeile für korrekte Anfragen festschreiben, eine solche Zeile wird neu berechnet und
  überschrieben), **und** (`status = 'resolved'` und `checked_at` jünger als 30 Tage, **oder** `index_date` = aktuelles `index.date`).
  Alte Zeilen mit `''` gelten nie. Geschrieben wird `name_norm` = `normName` des tatsächlich verwendeten Namens.
- **Geschrieben** wird nur, was nicht auf einem Fremdfehler beruht: nie bei `kr`, `no-name`, `no-printings` oder einem in Schritt 9 als
  Fremdfehler markierten Ergebnis. Der Payload setzt `checked_at` (jetzt, ISO) und `index_date` **immer explizit**; sonst behielte der
  Update-Zweig des Upserts das alte `checked_at`.
- Fehlt die Tabelle (PostgREST `PGRST205` bzw. Postgres `42P01`), arbeitet die Funktion ohne Cache weiter (`cached = false`) und
  protokolliert das einmal je Instanz. **Jeder** andere Cache-Fehler (Lesen oder Schreiben) ist ebenfalls nie fatal (`console.error`).

### 5.5 Disambiguierung mehrdeutiger Arrays
Cardmarkets Dateien kennen **keine Seltenheit**. Druckgenau wird ein Array nur über die Reihenfolge der Versionen
(`idProduct` aufsteigend). Zwei Regeln:
1. **`deriveForExp`** (Desktop-Regel, Schritt 8): Gelernt wird aus `index.learned` (echte IDs der Cloud-Sammlung, ≥ 2 Vorbilder,
   alle einig, `versionsAreRarities`). Unverändert portiert.
2. **Block-Regel** (neu, nur Deno, Schritt 9; `blocks.ts`, rein). Cardmarket legt die Versionen eines Sets seltenheitsweise in Blöcken an
   (Kommentar in `cardmarket-bulk-parse.cjs:97-100`). Bedingungen:
   - Die Karte hat in genau **einer** Expansion `e` aus `exp` eine Versionsgruppe mit `n ≥ 2` IDs.
   - `printingRarities` hat genau `n` Einträge und `n` verschiedene (`versionsAreRarities`).
   - `index.blocks[e]` kennt einen Median für **jede** dieser Seltenheiten, und die Mediane sind paarweise verschieden.
   - Dann gilt: `ordnung` = `printingRarities` nach Median aufsteigend, `rang = ordnung.indexOf(rk)`, Ergebnis `ids[rang]`.
   - **Freigabe-Schranke:** Konstante `BLOCKS_AKTIV` in `resolve.ts`, Vorgabe `false`. Vor der Freigabe misst das Server-Team per
     Leave-one-out über alle `real`-Stichproben mit `n ≥ 2` (mindestens 100 Fälle). **Datenquelle:** eine **Kopie** der Desktop-DB
     (`%APPDATA%\yugioh-card-manager\cards.db` nach Scratchpad kopieren, nie das Original öffnen; dort nur Zeilen mit
     `COALESCE(cm_product_derived, 0) = 0`, also echte IDs), dazu lokal geladene `products_singles_3.json`, `products_nonsingles_3.json`
     und `cardsets.php`, ausgewertet mit `buildCmIndex` und `blocks.ts`. Das Wegwerf-Skript liegt im Scratchpad, nicht im Repo. Ergebnis
     im Ledger `docs/superpowers/ledgers/2026-11-03-einzelscan-preis/blocks-gegenprobe.md`. Erst bei **≥ 97 % richtig** wird
     `BLOCKS_AKTIV = true`. Ist keine Messung möglich (keine DB-Kopie, < 100 Fälle), steht im Ledger „nicht gemessen“, und die Regel bleibt
     aus. Mehrdeutige Drucke bleiben dann Spannen; das ist ein zulässiges Ergebnis.

Live-`cm` wird nie in `cards.cm_product_id` geschrieben. Desktop-Bulk und Scraper bleiben die einzigen Schreiber dort.

---

## 6. Android-Client (`cloud/CmResolveRepository.kt`, neu)

### 6.1 Wann wird gefragt
Nur auf der Ergebnis-Seite, nur wenn **online** (ConnectivityManager mit `NET_CAPABILITY_INTERNET`, wie `CatalogSync`), **angemeldet**
(neu `SupabaseCloud.angemeldet(): Boolean = accessToken != null`) und der Katalog-Lauf der Seite fertig ist:
```kotlin
var katalog by remember(pc) { mutableStateOf<CatalogCard?>(null) }
var katalogGeladen by remember(pc) { mutableStateOf(false) }
LaunchedEffect(pc) {
    katalog = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(pc) }.getOrNull() }
    katalogGeladen = true                     // auch bei null oder Fehler
}
```
`katalogDa = katalog != null` (Karte im Katalog gefunden; nicht `CatalogRepository.isReady()`).

```kotlin
fun liveBedarf(drucke: List<Druck>, auswahl: String?, kandidaten: Set<String>, katalogDa: Boolean,
               bekannt: (String) -> Boolean, trend: (Int) -> Double?): List<Druck>      // rein, getestet
```
- Reihenfolge: markierter Druck, dann Kandidaten, dann (**nur wenn `katalogDa == false`**) alle übrigen Drucke.
- Aufgenommen wird ein Druck nur, wenn **`language` europäisch** ist (JP und KR nie), `setCode != "Unknown"`, sein Preis nicht
  `Fest(SAMMLUNG)` ist, `cm.size != 1 || trend(cm[0]) == null` gilt (ein einzelnes Katalog-Produkt ohne Trend wird gefragt: die
  lokale Preisdatei kann fehlen oder die Katalog-ID veraltet sein) und `bekannt(liveKey)` falsch ist (Sitzungsspeicher).
- Doppelte (gleicher `liveKey`) zählen einmal. Höchstens **10**, das ist eine Anfrage.
- Tippt der Nutzer eine Zeile an, die diese Bedingungen erfüllt, wird sie einzeln abgefragt.

`liveKey(setCode, rarity) = (CodeKey.of(setCode) ?: setCode.trim().uppercase()) + "|" + (RarityNorm.key(rarity) ?: "")`.
Er entspricht `code_key|rarity_key` der Antwort; der Abgleich läuft über diese beiden Felder. Er enthält **keine Sprache**; die
Beschränkung auf europäische Zeilen (hier, in `drucke()` §3.1 und in §2.1) verhindert, dass ein JP-Druck einen EN-Wert bekommt.

**Wo die Anfrage läuft:** `LaunchedEffect(pc, katalogGeladen, bedarfSchluessel)` mit `bedarfSchluessel` = die `liveKey`s aus `liveBedarf`,
verbunden. Startet nur, wenn `katalogGeladen`, online, angemeldet, Bedarf nicht leer und `!CmResolveRepository.gesperrt(pc)`. Der
Effekt ruft `CmResolveRepository.anfragen(pc, katalog?.nameEn, bedarf)` auf. Das liefert ein `Deferred<Antwort?>` im **eigenen Scope
des Repositorys**: Verlässt der Nutzer die Seite, läuft die Anfrage zu Ende und füllt trotzdem den Sitzungsspeicher. Der Effekt wartet
(`try { await } catch (CancellationException) { throw } catch (Exception) { null }`) und setzt danach `liveStand = CmResolveRepository.stand(pc)`.

### 6.2 Aufruf
- Body: `internal fun requestBody(cardId: String, nameEn: String?, drucke: List<Pair<String, String>>): String` (rein; Paar = set_code,
  rarity; höchstens 10, Rest abgeschnitten). `name_en` wird **weggelassen**, wenn `nameEn` `null` oder leer ist (der Name in `CardRow`
  kann deutsch sein, darum nur `katalog?.nameEn`).
- POST `${SupabaseCloud.base()}/functions/v1/resolve-cm-product` mit `apikey`, `Authorization: Bearer ${SupabaseCloud.token()}`.
- Eigener Client: `SupabaseCloud.http().newBuilder().callTimeout(6, TimeUnit.SECONDS).build()`.
- **Reihenfolge der Auswertung:**
  1. HTTP **401** → einmal `SupabaseCloud.signIn()`, dann **einmal** wiederholen (Muster `executeWithReauth`), unabhängig vom Body.
  2. Danach `parseAntwort(body)`: `null` (kein JSON, kein boolesches Feld `ok`) → Fehler, egal welcher HTTP-Code (also auch Gateway-401
     nach der Wiederholung und 546). `ok: false` → Fehler mit `error`-Text. `ok: true` → Erfolg, egal welcher HTTP-Code.
- Naht für Tests: `internal var senden: suspend (body: String) -> Pair<Int, String?>` (HTTP-Code, Body), `internal var anmelden: suspend () -> Unit`,
  `internal var jetzt: () -> Long`.
- `internal fun parseAntwort(json: String): Antwort?` ist rein und wird gegen `docs/fixtures/cm-resolve/contract.json` getestet.

```kotlin
data class LiveCm(val status: String, val how: String?, val cm: List<Int>)        // status resolved|ambiguous|not_found
data class Antwort(val ok: Boolean, val fehler: String?, val indexDate: String?, val priceDate: String?,
                   val ab: Double?, val ergebnisse: Map<String, LiveCm>,          // Schlüssel liveKey (code_key|rarity_key)
                   val preise: Map<Int, Pair<Double?, Double?>>)
data class Stand(val ergebnisse: Map<String, LiveCm>, val preise: Map<Int, Pair<Double?, Double?>>,
                 val ab: Double?, val priceDate: String?) {
    fun trend(id: Int): Double? = preise[id]?.first
    fun low(id: Int): Double? = preise[id]?.second
    companion object { val LEER = Stand(emptyMap(), emptyMap(), null, null) }
}
```

### 6.3 Speicher und Zustände
- Sitzungsspeicher (Prozess, `ConcurrentHashMap`): `cardId|liveKey` → `LiveCm`, auch `not_found` und `ambiguous`. Je `cardId` außerdem
  `ab`, `priceDate` und `preise` (zusammengeführt). Kein Plattenspeicher. `stand(cardId): Stand`, `bekannt(cardId, liveKey)`.
- Fehler (Timeout, kein Body, kein `ok`, `ok: false`) werden nicht gespeichert. Dieselbe Karte wird danach **60 s** nicht erneut
  gefragt (`gesperrt(cardId)`, injizierte Uhr). Fehlerzustand **je Schlüssel** (Review-Nachtrag 2): ein Fehler fügt die Schlüssel
  seiner Anfrage hinzu, ein Erfolg entfernt nur die Schlüssel seiner Anfrage; die Sperre fällt erst, wenn kein Fehlschlüssel der
  Karte übrig ist. So löscht der Erfolg einer parallelen Anfrage nie Fehler und Sperre einer anderen.
- `laeuft(cardId): Set<String>` = `liveKey`s einer laufenden Anfrage.
- Zustand je `liveKey` auf der Seite: SUCHT (in `laeuft`), FERTIG (im Speicher), FEHLER (eine Anfrage mit diesem Schlüssel schlug
  fehl, seither keine erfolgreiche, und der Schlüssel ist nicht im Speicher).
  - SUCHT: europäische Zeile zeigt „…“ (§2.1), Unterzeile Teil 4 „Preis wird gesucht …“ (§2.3).
  - FERTIG: `liveStand` geht in `drucke()`, die Preise rechnen sich neu.
  - FEHLER: keine Anzeige außer dem bisherigen Preis. Ist der Kopf `Keiner` oder `Richtwert`, wird Teil 4 zu „Live-Suche nicht erreichbar“.
- Nach §4.3 (neue `knownSets`) wird `liveBedarf` neu berechnet. Schon Bekanntes kommt aus dem Speicher.
- Im Stapelmodus und auf anderen Bildschirmen gibt es keinen Aufruf.

---

## 7. Richtwert-Stufe (Option C, nur EUR)

```kotlin
val richtwert = liveStand.ab?.takeIf { it > 0 }?.let { DruckPreis.Richtwert(it, ausKatalog = false) }
    ?: katalog?.cmPrice?.takeIf { it > 0 }?.let { DruckPreis.Richtwert(it, ausKatalog = true) }
```
- **`live.ab` zuerst:** `card.ab` (§5.2) ist der kleinste Cardmarket-Trend aller Versionen der Karte aus der Preisdatei des Tages, also
  dieselbe Kennzahl wie jeder andere Trend auf der Seite und tagesaktuell. Er liegt nur vor, wenn für die Karte live gefragt wurde.
- **`CatalogCard.cmPrice` als Rückfall:** YGOPRODeck `card_prices[0].cardmarket_price` (EUR), Stand Katalogbau (v11: 04.10.), offline,
  für 14 070 von 14 597 Karten. Eine andere Kennzahl unter demselben Etikett; die Unterzeile nennt dafür das Katalogdatum (§2.3).
- Erscheint nur im Kopf (§2.2) und nur mit „ab“ und dem Quellen-Text (§2.3). Nie in einer Listenzeile.
- **Nie** in `CardRow.price`, `Valuation`, `condition-factors.json`, Preisverlauf oder „In Sammlung +“. Die Übernahme schickt wie
  heute keinen Preis mit (`uebernahme`, §4.4; getestet).

---

## 8. Alias-Auflösung und Versionsnummer (Option E klein, nur Android)

### 8.1 `CatalogRepository.card` / `printings`
- Neu `private fun kanonisch(passcode: String): String`: Steht der Passcode nicht in `cards`, wird `aliases(listOf(passcode))[passcode]`
  versucht. Ohne Treffer bleibt der Passcode.
- `card(passcode)` und `printings(passcode)` **lesen die Daten** unter `kanonisch(passcode)`. Das gelieferte `CatalogCard.id` bleibt der
  **angefragte** Passcode (`readCard(c).copy(id = passcode, printings = printings(passcode))`).
- Folgen je Aufrufer:
  | Aufrufer | Wirkung |
  |---|---|
  | `ScanResolver` (`base = catalogCard.toCardRow()`) | `base.id` unverändert = angefragter Passcode, auch im Stapel und auf OCR-Wegen ohne `HybridPipeline.canonical`. Buchungen landen unter derselben ID wie bisher; neu sind nur Name, Bild und Drucke vorhanden |
  | `ScanErgebnisScreen` (Besitzfilter `it.id == pc`) | unverändert |
  | `CardDetailScreen` (`card(cardId)`) | zeigt für eine Alias-ID jetzt die Katalogdaten statt nichts; ID unverändert |
  | `HybridPipeline.catalogKnows` | Ergebnis unverändert (prüfte Aliase schon), je unbekanntem Kandidaten eine SQLite-Abfrage mehr (PK-Zugriff, vernachlässigbar). `HybridPipeline.kt` wird nicht geändert |
  | `PrintingRepository.fetchAllSets` (`printings(pc)`) | eine Alias-ID mit verifiziertem Block nimmt jetzt den Katalogpfad |

### 8.2 `versionCode` / `versionName` (`android/app/build.gradle.kts`)
```kotlin
fun git(vararg a: String): String? = runCatching {
    providers.exec { commandLine("git", *a); isIgnoreExitValue = true }.standardOutput.asText.get().trim().ifEmpty { null }
}.getOrNull()
val buildZeit = java.time.LocalDateTime.now(java.time.ZoneOffset.UTC)
val buildTag = buildZeit.toLocalDate()
val tage = java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.of(2026, 1, 1), buildTag).toInt()
val minuteDesTages = buildZeit.hour * 60 + buildZeit.minute
val gitCount = git("rev-list", "--count", "HEAD")?.toIntOrNull() ?: 0
val gitSha = git("rev-parse", "--short=7", "HEAD") ?: "nogit"
val gitDirty = git("status", "--porcelain", "--untracked-files=no") != null
// defaultConfig:
versionCode = 1_000 + tage * 1_440 + minuteDesTages     // z.B. 442 412 am 03.11.2026 12:52 UTC, > altes 1
versionName = "${buildTag.toString().replace("-", ".")}-$gitCount-$gitSha" + if (gitDirty) "+" else ""   // "2026.11.03-1025-d4da262+"
```
- `versionCode` steigt mit der **Build-Uhrzeit** (UTC, minutengenau) und hängt nicht am Git-Zustand (Review-Nachtrag 2: die frühere
  Zahl „Commits von HEAD seit 00:00“ fiel nach Zweigwechsel, Squash oder `reset --soft` am selben Tag →
  `INSTALL_FAILED_VERSION_DOWNGRADE`). Zwei Builds in derselben Minute haben dieselbe Nummer (Neuinstallation erlaubt). Grenze
  2,1·10⁹ erst in rund 4000 Jahren. Nur eine zurückgestellte Uhr kann noch fallen; Abhilfe `adb install -r -d app-release.apk`
  (behält die Daten). Deinstallieren nur als letzter Ausweg (löscht lokale Daten; Sammlung kommt aus der Cloud zurück).
- Die Einstellungen zeigen schon „Version ${BuildConfig.VERSION_NAME}“, dort ist nichts zu tun.
- `ScanLog.start` schreibt als erste Zeile `ScanLog.line("App", "version=${BuildConfig.VERSION_NAME} code=${BuildConfig.VERSION_CODE}")`.
- Ohne `git` auf dem Build-Rechner: `gitCount = 0`, `nogit` (die Nummer selbst braucht kein git). `android/local.properties` bleibt unberührt.

---

## 9. Fixtures

Pfade relativ zur Repo-Wurzel. **Geteilte Fixtures gehören dem Server-Team.** Aufgabe **S0**: Das Server-Team legt sie als **erste
Aufgabe im Arbeitsbaum** an, mit genau dem Inhalt aus §9.1/§9.2/§9.4 (kein Commit, beide Teams arbeiten im selben Arbeitsbaum). Das
Android-Team liest nur diese Dateien. Solange sie fehlen, testet es mit einer Kopie aus dieser Spec **im Scratchpad**, nie unter
`docs/fixtures`.

### 9.1 `docs/fixtures/code-key.json` (geteilt: Kotlin `CodeKeyTest` ↔ Deno `code-key_test.ts`)
```json
{
  "_doc": "Spec 2026-11-03 §3.2 -- CodeKey.of: Praefix + Nummer ohne Region und fuehrende Nullen; null = Code ohne diese Grammatik.",
  "cases": [
    { "in": "LOB-DE005",   "key": "LOB-5" },
    { "in": "LOB-EN005",   "key": "LOB-5" },
    { "in": "lob-g005",    "key": "LOB-5" },
    { "in": "LOB-E003",    "key": "LOB-3" },
    { "in": "LOB-005",     "key": "LOB-5" },
    { "in": "SGX3-DEA10",  "key": "SGX3-A10" },
    { "in": "26DE-DEJ02",  "key": "26DE-J02" },
    { "in": "MAMO-DE072",  "key": "MAMO-72" },
    { "in": "RA01-DE000",  "key": "RA01-0" },
    { "in": " ra01-en008 ","key": "RA01-8" },
    { "in": "SD1-JP001",   "key": "SD1-1" },
    { "in": "B3-17",       "key": "B3-17" },
    { "in": "Unknown",     "key": null },
    { "in": "",            "key": null },
    { "in": "LOB DE005",   "key": null }
  ]
}
```

### 9.2 `docs/fixtures/rarity-norm.json` (geteilt: Kotlin `RarityNormTest` ↔ Deno `rarity-norm_test.ts`)
```json
{
  "_doc": "Spec 2026-11-03 §3.3 -- RarityNorm.key; null = unbekannt. Paare 'gleich' pruefen gleich(a, b).",
  "keys": [
    { "in": "Common", "key": "common" }, { "in": "C", "key": "common" }, { "in": "N", "key": "common" },
    { "in": "Rare", "key": "rare" }, { "in": "SR", "key": "superrare" }, { "in": "UR", "key": "ultrarare" },
    { "in": "UtR", "key": "ultimaterare" }, { "in": "ScR", "key": "secretrare" }, { "in": "GR", "key": "ghostrare" },
    { "in": "HR", "key": "ghostrare" }, { "in": "Holographic Rare", "key": "ghostrare" },
    { "in": "PScR", "key": "prismaticsecretrare" }, { "in": "CR", "key": "collectorsrare" }, { "in": "Cr", "key": "collectorsrare" },
    { "in": "Collector's Rare", "key": "collectorsrare" }, { "in": "QCSR", "key": "quartercenturysecretrare" },
    { "in": "Quarter Century Secret Rare", "key": "quartercenturysecretrare" }, { "in": "20thSR", "key": "20thsecretrare" },
    { "in": "Starfoil", "key": "starfoilrare" }, { "in": "Starfoil Rare", "key": "starfoilrare" },
    { "in": "Shatterfoil", "key": "shatterfoilrare" }, { "in": "Mosaic", "key": "mosaicrare" },
    { "in": "Extra Secret", "key": "extrasecretrare" }, { "in": "PLatinum Secret Rare", "key": "platinumsecretrare" },
    { "in": "Ultra Rare (Pharaoh's Rare)", "key": "ultrararepharaohsrare" }, { "in": "Ghost/Gold Rare", "key": "ghostgoldrare" },
    { "in": "Duel Terminal Normal Rare Parallel Rare", "key": "duelterminalnormalparallelrare" },
    { "in": "Common<!--", "key": "common" }, { "in": "Rare-->", "key": "rare" }, { "in": "Short Print", "key": "shortprint" },
    { "in": "Unknown", "key": null }, { "in": "", "key": null }, { "in": null, "key": null }, { "in": "New", "key": null },
    { "in": "Reprint", "key": null }, { "in": "New artwork", "key": null }, { "in": "European & Oceanian debut", "key": null },
    { "in": "force-SMW", "key": null }
  ],
  "gleich": [
    { "a": "Starfoil", "b": "Starfoil Rare", "gleich": true },
    { "a": "UR", "b": "Ultra Rare", "gleich": true },
    { "a": "Unknown", "b": "Unknown", "gleich": false },
    { "a": "Short Print", "b": "Common", "gleich": false },
    { "a": "Gold Rare", "b": "Gold Secret Rare", "gleich": false },
    { "a": "Ultra Rare (Pharaoh's Rare)", "b": "Ultra Rare", "gleich": false }
  ]
}
```

### 9.3 `docs/fixtures/cm-resolve/parse.json` (Server: Desktop `cardmarket-bulk-parse.cjs` ↔ Deno `_shared/cm-parse.ts`)
Twin-Prüfung, dass der Deno-Port dasselbe tut wie das Original. Struktur:
```json
{
  "_doc": "Spec 2026-11-03 §5.3 -- gelesen von desktop/electron/cm-resolve-fixture.test.cjs und supabase/functions/_shared/cm-parse_test.ts.",
  "files": {
    "singles":    [ { "idProduct": 1, "name": "Blue-Eyes White Dragon", "idExpansion": 10 } ],
    "nonsingles": [ { "idProduct": 900, "name": "Legend of Blue Eyes White Dragon Booster", "idExpansion": 10 } ],
    "cardsets":   [ { "set_code": "LOB", "set_name": "Legend of Blue Eyes White Dragon" } ]
  },
  "known": [ { "rarity": "Ultra Rare", "idProduct": 1 } ],
  "cases": [
    { "name": "eindeutig in einer Expansion", "fn": "cmForPrinting",
      "input": { "cardName": "Blue-Eyes White Dragon", "prefix": "LOB", "rarity": "Ultra Rare", "printingRarities": ["Ultra Rare"], "realId": null },
      "expect": 1 }
  ]
}
```
- `fn` ∈ `cmForPrinting` (Erwartung Zahl, Array oder `null`), `resolveProduct` (`{ "idProduct", "reason" }`), `deriveProduct`
  (`{ "idProduct", "reason" }`), `expansionNameVariants` (Array). `setNames` = `set_name` aller `files.cardsets` mit
  `set_code.toUpperCase() == prefix`. `learned` = `learnRanks(known, buildVersionIndex(files.singles))`.
- **Zwei Wege in Deno** (`cm-parse_test.ts`): (1) Desktop-Wrapper wie oben. (2) Kern: `buildCmIndex({ singles, nonsingles, cardsets,
  real: [] })` → `s`, `x`; `expIds = new Set(x[prefix])`, `kernAusS(s, normName(cardName))`, `learned` aus `known` über
  `learnRanks` mit `RarityNorm.key` → `resolveForExp`/`deriveForExp`/`cmForExp` gegen **dieselben** `expect`-Werte. Der Desktop-Test
  (`node --test`) prüft nur Weg 1 gegen das Original.
- Seltenheiten nur in kanonischer Schreibweise, damit Rohtext (Desktop) und `RarityNorm.key` (Deno) gleich ausgehen.
- **Pflichtfälle** (je mindestens einer): `realId` gewinnt; eindeutig; keine Expansion; kein Kandidat; mehrdeutig → abgeleitet
  (2 einige Vorbilder); mehrdeutig mit 1 Vorbild → `too-few` → Array; Vorbilder uneinig → `conflict`; Deck-Set mit doppelter Seltenheit
  → `not-by-rarity`; `deriveProduct` ohne `printingRarities` → `needs-printings`; Karte in zwei Expansionen desselben Präfixes →
  `no-group` → Array über beide; Set-Name mit HTML-Entity (`&apos;`); Token-Reihenfolge („Synchron Extreme Structure Deck“ =
  „Structure Deck: Synchron Extreme“); Sealed-Suffixe („… Mega Pack Booster“).

### 9.4 `docs/fixtures/cm-resolve/contract.json` (geteilt: Deno `handler_test.ts` ↔ Kotlin `CmResolveRepositoryTest`)
```json
{
  "_doc": "Spec 2026-11-03 §5.2 -- Vertrag resolve-cm-product. 'requests': Deno prueft Status/Code. 'responses': Kotlin parseAntwort.",
  "requests": [
    { "name": "gueltig", "body": { "v": 1, "card_id": "89631139", "name_en": "Blue-Eyes White Dragon",
        "printings": [ { "set_code": "LOB-DE001", "rarity": "Ultra Rare" } ] }, "status": 200 },
    { "name": "ohne name_en gueltig", "body": { "v": 1, "card_id": "89631139", "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 200 },
    { "name": "name_en null gueltig", "body": { "v": 1, "card_id": "89631139", "name_en": null, "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 200 },
    { "name": "name_en leer gueltig", "body": { "v": 1, "card_id": "89631139", "name_en": "   ", "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 200 },
    { "name": "name_en keine Zeichenkette", "body": { "v": 1, "card_id": "1", "name_en": 5, "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 400, "code": "bad_request" },
    { "name": "name_en zu lang", "body": { "v": 1, "card_id": "1", "name_en": { "_len": 201 }, "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 400, "code": "bad_request" },
    { "name": "falsche Version", "body": { "v": 2, "card_id": "1", "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 400, "code": "bad_request" },
    { "name": "card_id nicht numerisch", "body": { "v": 1, "card_id": "abc", "printings": [ { "set_code": "LOB-DE001", "rarity": "" } ] }, "status": 400, "code": "bad_request" },
    { "name": "keine Drucke", "body": { "v": 1, "card_id": "1", "printings": [] }, "status": 400, "code": "bad_request" },
    { "name": "elf Drucke", "body": { "v": 1, "card_id": "1", "printings": "11x" }, "status": 400, "code": "bad_request" },
    { "name": "Unknown-Code", "body": { "v": 1, "card_id": "1", "printings": [ { "set_code": "Unknown", "rarity": "" } ] }, "status": 400, "code": "bad_request" }
  ],
  "responses": [
    { "name": "ok mit resolved und ambiguous", "body": {
        "ok": true, "v": 1, "index_date": "2026-11-03", "price_date": "2026-11-03",
        "card": { "name_en": "Blue-Eyes White Dragon", "ab": 0.09, "ab_products": 41 },
        "results": [
          { "set_code": "LOB-DE001", "rarity": "Ultra Rare", "code_key": "LOB-1", "rarity_key": "ultrarare", "status": "resolved", "how": "unique", "reason": null, "cm": [102800], "cached": false },
          { "set_code": "RA01-DE008", "rarity": "Platinum Secret Rare", "code_key": "RA01-8", "rarity_key": "platinumsecretrare", "status": "ambiguous", "how": null, "reason": "no-model", "cm": [741197, 741198], "cached": true },
          { "set_code": "XXXX-DE001", "rarity": "", "code_key": "XXXX-1", "rarity_key": "", "status": "not_found", "how": null, "reason": "no-expansion", "cm": [], "cached": false }
        ],
        "prices": { "102800": [12.5, 9.0], "741197": [0.89, null] } },
      "expect": { "ok": true, "ab": 0.09, "priceDate": "2026-11-03",
        "ergebnisse": { "LOB-1|ultrarare": [102800], "RA01-8|platinumsecretrare": [741197, 741198], "XXXX-1|": [] },
        "preise": { "102800": [12.5, 9.0], "741197": [0.89, null] } } },
    { "name": "ohne Preisdatei", "body": { "ok": true, "v": 1, "index_date": "2026-11-03", "price_date": null,
        "card": { "name_en": null, "ab": null, "ab_products": 0 }, "results": [], "prices": {} },
      "expect": { "ok": true, "ab": null, "priceDate": null, "ergebnisse": {}, "preise": {} } },
    { "name": "Fehler", "body": { "ok": false, "code": "no_index", "error": "Cardmarket-Index fehlt." },
      "expect": { "ok": false, "fehler": "Cardmarket-Index fehlt." } },
    { "name": "Gateway-401 ohne ok", "body": { "code": 401, "message": "Invalid JWT" }, "expect": null },
    { "name": "kaputt", "raw": "<html>502</html>", "expect": null }
  ]
}
```
`"printings": "11x"` steht für elf gültige Einträge, `{ "_len": 201 }` für eine Zeichenkette aus 201 × „a“. Der Deno-Test baut sie daraus.

### 9.5 Nur-Deno: `docs/fixtures/cm-resolve/blocks.json` (Server)
Fälle der Block-Regel §5.5: `blocks`, `versionGroups` (je Expansion die IDs), `printingRarities`, `rk` → `idProduct | null` mit `reason`.
Pflichtfälle: eindeutige Ordnung, fehlender Median, gleiche Mediane, `n` ≠ Anzahl Seltenheiten, doppelte Seltenheit, zwei Expansionen.

### 9.6 Nur-Kotlin (Android-Team besitzt sie)
- **`docs/fixtures/druck-preis.json`** (bestehend) wird erweitert. Jeder Fall bekommt optional `"liveCm": [..]` (Vorgabe `[]`) und
  `"liveTrends": { "<id>": wert }` (Vorgabe `{}`; `trend` = `trends[id] ?: liveTrends[id]`). Bei `"art": "fest"` Pflichtfeld
  `"quelle": "sammlung" | "trend" | "live"` und optional `"mehrdeutig": true`, bei `"art": "spanne"` Pflichtfeld `"quellen": ["trend"]`
  bzw. `["live"]`. Die bestehenden Fälle bekommen `quelle`/`quellen` nachgetragen; Werte und Texte bleiben, **außer**
  „mehrdeutig, nur ein Wert“ → `"art": "fest", "eur": 4.2, "quelle": "trend", "mehrdeutig": true, "text": "ca. 4,20 €"` (bewusste
  Änderung, §2.1). `_doc` nennt Spec 2026-11-03 §2.1.
  Neue Pflichtfälle: Katalog-`cm` eindeutig mit Trend schlägt Live; Katalog-`cm` eindeutig ohne Trend, Live eindeutig mit Trend → live;
  Live eindeutig schlägt Katalog-Array; Katalog leer, Live mehrdeutig → Spanne live; Katalog-Array schlägt Live-Array; Live-Trend nur aus
  `liveTrends` (Datei kennt die ID nicht); mehrdeutig, alle bepreist und gleich → fest ohne `mehrdeutig`; mehrdeutig, zwei von drei
  bepreist und gleich → fest `mehrdeutig`.
- **`docs/fixtures/kopf-preis.json`** (neu): Fälle für §2.2 mit
  `drucke: [{ key, setCode, lang, rarity, preis: { art, eur | min/max, quelle | quellen, mehrdeutig? } }]`, `auswahl`, `sicher`,
  `keinTreffer`, `kandidaten`, `richtwert: { eur, ausKatalog } | null` → `expect: { art, eur | min/max, quelle? | quellen?, mehrdeutig?, text }`.
  Pflichtfälle: sicher mit Preis; sicher ohne Preis mit Richtwert („ab 0,09 €“); sicher ohne alles („–“); unsicher a/b/c/d/e je einmal;
  b) mit JP-Kandidat und EN-Zwilling → fällt auf c); keinTreffer ohne Auswahl, mit und ohne Preise; keinTreffer **mit** Ersatz-Auswahl
  (`auswahl` gesetzt, `sicher = false`) → trotzdem `spanneUeber(alle)`; der Fall aus Ursache 1 (abgeleiteter DE-Druck mit `cm` vom
  EN-Zwilling, sicher) → fester Trend; `spanneUeber`-Quellen: ein einzelner Sammlungspreis → `Fest(sammlung)`, Sammlung + Trend gleich →
  `Fest(trend)`, Sammlung + Trend verschieden → `Spanne(quellen [sammlung, trend])`, Trend + Live → `Spanne(quellen [trend, live])`.
- **`docs/fixtures/unterzeile.json`** (neu): Eingaben von `ScanErgebnis.unterzeile` (§2.3; `kopf` wie in `kopf-preis.json`,
  `heute` als Datum) → `expect` (String). Pflichtfälle: jede Zeile der Teil-1-Tabelle mindestens einmal (auch beide Richtwert-Texte und
  beide Spannen-Zusätze, drei Herkunftsarten); „ab low“ nur sicher und ohne `mehrdeutig`; Stand jünger/älter als 3 Tage; `sucht` vor
  `liveFehler`; `liveFehler` nur bei `Keiner`/`Richtwert`; `nachladen`; beide Preisdatei-Texte; `abgeleitet` bei TREND und LIVE.

---

## 10. Tests

**Android** (`cd android && JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew testDebugUnitTest`; nur ein Gradle-Lauf zur Zeit).
Alle Tests mit Zeitbezug laufen mit `runTest` und `StandardTestDispatcher(testScheduler)` in virtueller Zeit; die Nähte aus §4.1/§4.2/§6.2
werden in `@Before` gesetzt und in `@After` auf die Vorgaben zurückgesetzt.
- `DruckPreisTest`: erweiterte `druck-preis.json`. `spanneUeber` ignoriert `Richtwert`, Quellenregel. `text(Richtwert)` = „ab 0,09 €“,
  `text(Fest(mehrdeutig))` = „ca. …“.
- `KopfPreisTest` (neu): `kopf-preis.json`.
- `UnterzeileTest` (neu): `unterzeile.json`.
- `ScanErgebnisTest` (erweitert): zusammengesetzter Druck außerhalb von `known` kommt als `abgeleitet` an die Spitze und bekommt `cm`
  vom EN-Zwilling. Kandidaten nicht in `known`. Seltenheit „Unknown“ → Vereinigung der `cm` (eine bzw. mehrere IDs). „Starfoil“ trifft
  „Starfoil Rare“. `LOB-005` trifft `LOB-EN005`. KR weiterhin ohne `cm`. JP fällt nie auf EN zurück. **JP-Zeile mit gleichem `liveKey`
  wie ein EN-Eintrag der `live`-Map bekommt kein `liveCm`.** `gewaehlterDruck` bleibt in der Liste, auch wenn die neuen `knownSets` ihn
  nicht enthalten. `liveBedarf`: Reihenfolge, **ohne JP/KR**, ohne Unknown, ohne Sammlungspreis, `cm.size == 1` mit Trend nicht,
  `cm.size == 1` ohne Trend ja, höchstens 10, ohne Katalog alle (europäischen). `lowUndStand` (Tabelle §2.3). `nachUebernahme`
  (getippt/nicht getippt, Auflage gewählt/nicht). `beimTippen` setzt `gewaehlterDruck`. `uebernahme`: SetOption mit `price == 0.0`,
  auch bei Richtwert und Live-Preis; abgeleiteter Druck geht als `selected` hinaus; `verbessert == null`.
- `CodeKeyTest`, `RarityNormTest` (neu): geteilte Fixtures §9.1/§9.2.
- `CmResolveRepositoryTest` (neu): `parseAntwort` gegen `contract.json` (`responses`). `requestBody` (Felder, `name_en` weggelassen bei
  `null`/leer, höchstens 10). Über die Naht `senden`: 401 → `anmelden` → Wiederholung → Erfolg; 401 zweimal → Fehler; 546 ohne `ok` →
  Fehler; `ok: false` bei HTTP 200 → Fehler. Sitzungsspeicher, `laeuft`, 60-s-Sperre nach einem Fehler (injizierte Uhr).
- `CmPriceFileTest` (erweitert): reiner Kern `lauf` mit allen `Lauf`-Ergebnissen und Fehlertexten.
- `PrintingRepositoryGeteiltTest` (neu, Nähte `abruf`/`scope`/`protokoll`): zwei gleichzeitige `fetchAllSetsGeteilt` für denselben
  Passcode → **ein** Abruf; ein **sofort fertiger** Abruf hinterlässt keinen Eintrag; nach einem Fehler (leere Liste) startet der nächste
  Aufruf neu; `withTimeoutOrNull` um `await` kehrt nach der Frist zurück, während der Abruf weiterläuft und danach den Eintrag entfernt.
- `ScanResolverWartenTest` (neu, Nähte §4.2): Einzelmodus wartet bis 4 s, Stapel 1,5 s; nach Ablauf der Frist wirklich Rückfall auf
  Katalogdrucke (Logzeile „Netz > …“). Leere Netzantwort → Katalogdrucke. Abbruch des Aufrufers wird weitergereicht (kein Rückfall).
  `verbessert` nur mit `nachrechnen` und nach dem Rückfall; gleiche Schlüsselmenge → `null`; neue Drucke → neues `ResolvedScan`.
- **Abnahme am Gerät** (APK installieren, danach `adb logcat -b crash` prüfen):
  (1) Erstscan einer Karte ohne verifizierten Block mit DE-Code (z. B. Maxx C) → Kopf mit Preis, Zeile „abgeleitet“, Hinweis „Druck
  abgeleitet …“ auch bei GRÜN; sobald die ScanLog-Zeile „geteilt … dauer=“ erscheint, ggf. echter DE-Druck. Auswahl tippen, Nachladen
  ändert sie nicht.
  (2) Karte mit RA01-Druck → „Preis wird gesucht …“, danach Spanne, „ca. …“ oder fester Live-Preis.
  (3) Druck ohne `cm` (z. B. BNZ-G001) → Richtwert „ab … €“.
  (4) Flugmodus → kein „wird gesucht“, Richtwert aus dem Katalog mit Katalogdatum, Preisdatei-Hinweis korrekt.
  (5) Stapelmodus: ScanLog-Zeilen „Drucke … dauer=“ zeigen höchstens ~1 500 ms bis zum Rückfall bzw. die tatsächliche Netzdauer; keine
  sichtbare Verlangsamung.
  (6) Einstellungen zeigen die neue Version.
  (7) Ein JP-Druck (feste Sprache JP) zeigt nie „live zugeordnet“.

**Server** (`deno test` im jeweiligen Ordner, `deno` im PATH):
- `_shared/cm-parse_test.ts`: `parse.json` vollständig, beide Wege (§9.3).
- `_shared/rarity-norm_test.ts`, `_shared/code-key_test.ts`: geteilte Fixtures.
- `refresh-cardmarket-prices/cm_index_test.ts`: `buildCmIndex` (rein) mit Mini-Dateien: Format §5.1, `s` sortiert, `x` mit ganzem
  `set_code` als Schlüssel und ohne leere Einträge, `real`-Konflikt fällt weg, `learned`, `blocks` (unterer Median, Expansion mit nur einer
  Seltenheit fehlt), KR- und unbekannte Seltenheiten ausgeschlossen, ohne Katalog `stats.catalog = false`. Plausibilität: zu wenige
  Singles/Präfixe bzw. fehlender Schlüssel `products` → Fehler, kein Upload (Fake-Upload zählt Aufrufe).
- `refresh-cardmarket-prices/step_test.ts`: `routeStep` (`cm-index` / `unknown` / `main`, auch für kaputten Body). `runCmIndexStep`
  mit Fake-`fetch`/-Upload: lädt nie die Preisführer-URL, Dateien in der Reihenfolge cardsets → nonsingles → singles, Erfolgs- und
  Fehler-Body nach §5.1, kein Upload bei Pflichtfehler, optionale Eingaben fehlen → Upload mit `stats.real = 0`.
- `resolve-cm-product/handler_test.ts`: `contract.json` (`requests`), 405, 401, 503 bei fehlendem Index und bei `v != 1`, 500 ohne Details.
- `resolve-cm-product/resolve_test.ts`: Kette §5.3 mit Fake-Index, Fake-Preisdatei, Fake-YGOPRODeck (200, 400, Timeout → `no-printings`
  und nicht gecacht; höchstens ein Abruf je Anfrage; kein Abruf bei `name_en` ohne Bedarf) und Fake-Cache (gültig/abgelaufen, fehlende
  Tabelle `PGRST205`, Schreibfehler nicht fatal; **eine** Leseabfrage, **ein** Upsert, entdoppelt, `checked_at`/`index_date` im Payload).
  `card.ab`. `prices` nur für gelieferte IDs. Reihenfolge der `results` = Anfrage. `needs-printings` intern → nach Holen der Seltenheiten
  `derived` bzw. `not-by-rarity`.
- `resolve-cm-product/blocks_test.ts`: `blocks.json` (Funktion mit Parameter, unabhängig von `BLOCKS_AKTIV`).
- `deno check` für `index.ts` beider Funktionen.

**Desktop** (nur die neue Testdatei): `node --test desktop/electron/cm-resolve-fixture.test.cjs` (reine Logik, ohne Electron). Die
bestehenden `cardmarket-bulk-parse.test.cjs` bleiben grün.

---

## 11. Betrieb (macht der Nutzer; Agents deployen nicht, rufen keine Functions auf und spielen kein SQL ein)

1. **SQL:** `supabase/cm_resolve_schema.sql` im SQL-Editor einspielen (Tabelle, Trigger, RLS, privater Bucket `cm-index`). Voraussetzung
   `public.set_updated_at()` aus `schema.sql`.
2. **Index-Bau deployen:** `supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn`.
   Danach einmal den Index bauen (SQL-Editor; `x-cm-secret` nur, wenn `CM_TRIGGER_SECRET` gesetzt ist):
   ```sql
   select net.http_post(url := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices',
     headers := '{"Content-Type": "application/json", "x-cm-secret": "<geheimnis>"}'::jsonb,
     body := '{"step": "cm-index"}'::jsonb, timeout_milliseconds := 150000);
   ```
   **Prüfen:** Storage → Bucket `cm-index` → `cm-index.json.gz` mit heutigem Änderungsdatum; in den Function-Logs die Zeilen
   `[cm-index] …`, `names` ≈ 14 600. Fehlt die Datei, zeigen die Logs die Phase. **Abnahmepunkt:** Die Phase `cardsets` muss gelingen;
   schlägt sie fehl (YGOPRODeck aus Supabase nicht erreichbar), bitte melden, das Ergebnis kommt ins Ledger.
3. **Funktion deployen:** `supabase functions deploy resolve-cm-product --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn`
   (Deploy-Kommentar im `index.ts` wie bei `ebay-sold-prices`). Keine neuen Secrets. Ein neu gebauter Index wird in warmen Instanzen
   erst nach bis zu 1 h sichtbar (Modulspeicher-TTL); zum Testen genügt ein erneuter Deploy (kalter Start). Index und Preisdatei werden
   über die Storage-API mit Service-Rolle geladen, also ohne CDN-Verzögerung.
4. **Zeitplan:** `supabase/cm_index_cron.sql` einspielen (Job `refresh-cardmarket-cm-index`, täglich **05:20 UTC**, Body
   `{"step": "cm-index"}`, `timeout_milliseconds := 150000`, Platzhalter `"x-cm-secret": "<geheimnis>"` im Header, idempotent wie
   `price_alerts_cron.sql`). Der 05:00-Job bleibt unverändert. **Überwachung:** Änderungsdatum der Storage-Datei bzw. Function-Logs;
   `net._http_response` taugt dafür nur beim Job mit `timeout_milliseconds` (der alte 05:00-Job ohne diesen Wert zeigt dort nach 5 s
   einen Timeout statt des Bodys). `cron.job_run_details` zeigt nur, ob der Aufruf abgeschickt wurde.
5. **APK:** `./gradlew assembleRelease`, installieren (bei Ablehnung wegen Version: §8.2). In den Einstellungen steht
   „Version 2026.11.03-…“. Damit ist auch geklärt, ob das Handy die Ergebnis-Seite vom 04.10. überhaupt hatte (Ursache 6).
6. **Optional, gelegentlich:** `delete from public.cm_resolve_cache where updated_at < now() - interval '90 days';`
7. **Begleitmaßnahme, kein Teil dieser Spec:** Den Katalog-Neubau am PC wieder anstoßen (v11 ist vom 04.10.; Ursache 7). Neue Sets
   bekommen erst damit Katalog-`cm`. Bis dahin decken §5/§6 sie live ab.

Reihenfolge: 1 → 2 → 3 → 4, dann 5. Ohne 1–3 läuft die APK trotzdem: Die Live-Suche antwortet dann mit Fehler (`no_index`, 404 o. ä.),
die Seite zeigt „Live-Suche nicht erreichbar“, und alle Offline-Stufen (§3, §7) funktionieren.

---

## 12. Datei-Zuteilung (disjunkt, endgültig)

**Android-Team** (alle Pfade unter `android/app/src/main/java/com/example/yugiohscanner/`, wenn nicht anders angegeben):
| Datei | Änderung |
|---|---|
| `ui/DruckPreis.kt` | §2.1, §2.2 (`spanneUeber`), §2.4 |
| `ui/ScanErgebnis.kt` | §2.2 (`kopfPreis`), §2.3 (`unterzeile`, `lowUndStand`), §3.1, §3.2, §3.4, §4.4 (`Zustand`, `nachUebernahme`, `beimTippen`, `uebernahme`), §6.1 (`liveBedarf`, `liveKey`), `zusatz`, `kandidaten` |
| `ui/ScanErgebnisScreen.kt` | §2.3 (Anzeige, Hinweisfläche), §3.5 (Retry-Aufruf), §4.3, §4.4, §6.1 (Effekte), §6.3, §7 |
| `ui/ScanResolver.kt` | §4.2 (inkl. `ResolvedScan.verbessert`, Nähte, `logScanDecision`-Parameter) |
| `ui/ScanScreen.kt` | nur der `resolve`-Aufruf in `fotoAusloesen` (§4.2) |
| `cloud/PrintingRepository.kt` | §4.1 |
| `cloud/CodeKey.kt` (neu) | §3.2 |
| `cloud/RarityNorm.kt` (neu) | §3.3 |
| `cloud/CmPriceFile.kt` | §3.5 |
| `cloud/CmResolveRepository.kt` (neu) | §6 |
| `cloud/CatalogRepository.kt` | §8.1 |
| `cloud/SupabaseCloud.kt` | nur `angemeldet()` (§6.1) |
| `ml/ScanLog.kt` | Versionszeile (§8.2) |
| `android/app/build.gradle.kts` | §8.2 |
| `android/app/src/test/java/com/example/yugiohscanner/`: `DruckPreisTest.kt`, `KopfPreisTest.kt` (neu), `UnterzeileTest.kt` (neu), `ScanErgebnisTest.kt`, `CodeKeyTest.kt` (neu), `RarityNormTest.kt` (neu), `CmResolveRepositoryTest.kt` (neu), `CmPriceFileTest.kt`, `PrintingRepositoryGeteiltTest.kt` (neu), `ScanResolverWartenTest.kt` (neu) | §10 |
| `docs/fixtures/druck-preis.json`, `docs/fixtures/kopf-preis.json` (neu), `docs/fixtures/unterzeile.json` (neu) | §9.6 |

**Server-Team:**
| Datei | Änderung |
|---|---|
| `docs/fixtures/code-key.json`, `docs/fixtures/rarity-norm.json`, `docs/fixtures/cm-resolve/parse.json`, `docs/fixtures/cm-resolve/contract.json`, `docs/fixtures/cm-resolve/blocks.json` (alle neu) | §9.1–9.5, **S0 zuerst** (im Arbeitsbaum, ohne Commit) |
| `supabase/functions/_shared/cm-parse.ts` + `cm-parse_test.ts` (neu) | Port mit Kern §5.3 |
| `supabase/functions/_shared/rarity-norm.ts` + `rarity-norm_test.ts` (neu) | §3.3 |
| `supabase/functions/_shared/code-key.ts` + `code-key_test.ts` (neu) | §3.2 |
| `supabase/functions/refresh-cardmarket-prices/index.ts` | nur `step`-Weiche und `runCmIndexStep` (§5.1); der übrige Lauf unverändert |
| `supabase/functions/refresh-cardmarket-prices/cm_index.ts` + `cm_index_test.ts` + `step_test.ts` (neu) | `buildCmIndex` rein, Plausibilität, `routeStep`, `runCmIndexStep` mit injizierten Abhängigkeiten (§5.1) |
| `supabase/functions/resolve-cm-product/` (neu): `index.ts`, `handler.ts`, `resolve.ts`, `blocks.ts`, `index-file.ts`, `cache-store.ts`, `fake-cache-store.ts`, `ygoprodeck.ts`, `handler_test.ts`, `resolve_test.ts`, `blocks_test.ts` | §5.2–5.5 |
| `supabase/cm_resolve_schema.sql` (neu), `supabase/cm_index_cron.sql` (neu, Standard-Zeitplan) | §5.4, §11.4 |
| `supabase/README_cardmarket_cloud.md` | Abschnitt „cm-index und resolve-cm-product“ (§11) |
| `desktop/electron/cm-resolve-fixture.test.cjs` (neu) | Twin-Test §9.3 (Weg 1) |
| `docs/superpowers/ledgers/2026-11-03-einzelscan-preis/blocks-gegenprobe.md` (neu) | Messung §5.5 |

Keine Datei steht in beiden Listen. Nicht geändert werden: `desktop/electron/cardmarket-bulk-parse.cjs` (findet der Twin-Test dort einen
Fehler, entscheidet der Nutzer), `ui/AppNav.kt`, `ui/ScanCapture.kt`, `ui/CardDetailScreen.kt`, `ml/HybridPipeline.kt`,
`cloud/CatalogParser.kt`, `cloud/SetCodeMatch.kt`, `cloud/EbayRepository.kt`, `cloud/EbaySoldRepository.kt`, `supabase/schema.sql`,
`supabase/catalog_versions_schema.sql`.

**Schnittstellen zwischen den Teams:** nur der HTTP-Vertrag §5.2 (abgesichert durch `contract.json`), `code-key.json` und
`rarity-norm.json`. Das Android-Team kann gegen eine fehlende Funktion bauen (§11, letzter Absatz). Das Server-Team braucht keinen Android-Code.

---

## 13. Risiken und offene Punkte

- **Abgeleiteter Druck mit falscher Seltenheit:** Der Zwilling bestimmt Seltenheit und Preis. Gekennzeichnet als „abgeleitet“ mit
  Hinweis, auch bei GRÜN (§2.3). „In Sammlung +“ bucht ihn wie heute. Ob das so bleiben soll, ist eine offene Frage an den Nutzer
  (Analyse, Entscheidung 5).
- **Richtwert zu niedrig:** „günstigster Druck“ kann bei Secret/Starlight/alten G-Codes um ein Vielfaches danebenliegen (LOB-G001 bis 921 €).
  Deshalb nur im Kopf, nur mit „ab“ und Begründung, nie in der Liste oder in der Bewertung.
- **Disambiguierung bringt evtl. wenig:** `learned` stammt aus denselben Sammlungs-IDs, mit denen der Desktop die Katalog-Arrays schon
  nicht auflösen konnte. Den Mehrgewinn bringt nur die Block-Regel, und die ist bis zur Gegenprobe (≥ 97 %) aus. Mehrdeutige Arrays
  können also Spannen bleiben.
- **Zirkuläre Stichproben:** Cloud-`cm_product_id` ist teils selbst abgeleitet (`cm_product_derived` wird nicht gespiegelt; Desktop
  185/188 richtig), und Katalog-Einzel-`cm` stammen teils aus `deriveProduct`. Beide bestätigen damit das Rangmodell, das sie prüfen
  sollen. Darum: Katalog-Stichproben nur mit `CM_INDEX_KATALOG=1`, Gegenprobe nur mit echten Desktop-IDs (§5.5).
- **Namensabweichung Cardmarket ↔ YGOPRODeck:** Ergibt `no-candidate`, die Karte bleibt beim Richtwert.
- **Edge-Limits** (256 MB, 2 s CPU, 546 nicht abfangbar): Index-Bau als eigener Aufruf, Dateien nacheinander, Plausibilitätsschranke,
  alter Index bleibt bei Fehlern. `resolve-cm-product` parst je kaltem Start 1,4 MB Index und 1,8 MB Preisdatei.
- **Fremdabhängigkeit YGOPRODeck** (cardsets im Index-Bau; Name und `printingRarities` live): Erreichbarkeit aus Supabase ist ungeprüft
  (Abnahmepunkt §11.2). Live: 2,5 s Timeout, Fremdfehler werden nicht gecacht.
- **Wartezeit:** Bis 4 s nach dem Foto plus bis 6 s Live-Suche im Hintergrund. Die Seite erscheint nach höchstens 4 s, die Live-Suche
  blockiert nichts.
- **Nachträgliches Umspringen** von Druck und Preis kann irritieren. Es geschieht nur ohne Tipp-Auswahl und wird mit „Drucke werden
  nachgeladen …“ angekündigt.
- **Katalog veraltet** (v11): Außerhalb dieser Spec (§11.7). Live-Zuordnung und Richtwert überbrücken.
- **`versionCode` aus Datum:** Zwei Builds am selben Tag von verschiedenen Zweigen können fallen (§8.2, Abhilfe `adb install -r -d`).

---

## 14. Review-Nachtrag (03.11.)

Jeder Kritikpunkt wurde am Code (Stand `d4da262`) geprüft. Alle sind berechtigt; wo die Lösung vom Vorschlag abweicht, steht es dabei.

| # | Abschnitt | Ergebnis | Umsetzung / Begründung |
|---|---|---|---|
| 1 | §6.1/§6.2/§2.1 JP bekommt Live-EN | übernommen | `CodeKey.of("SD1-JP001") == "SD1-1"` bestätigt. Europäisch-Regel in §1, `liveBedarf` ohne JP/KR, `liveCm` nur europäisch (§3.1), „…“ nur europäisch (§2.1); Fixture-Fall `SD1-JP001`, Tests §10 |
| 2 | §4.1 Rennen putIfAbsent/finally | übernommen | `LAZY` + `putIfAbsent` + `remove(pc, neu)` wie vorgeschlagen, Code in §4.1; Tests „sofort fertig“ und „nach Fehler neu“ |
| 3 | §4.3 `remember`-Schlüssel | übernommen | Schlüssel vollständig, Tabelle aller `r.`-Stellen. Ergänzung: Zustandsvariablen bleiben `remember(r)`, sonst würde `uebernimm` die Auswahl zurücksetzen |
| 4 | §2.1 „mehrdeutig, nur ein Wert“ | übernommen | Stufe 2 `cm.size == 1`; `Fest(mehrdeutig = true)`, Text „ca. …“ bzw. „eine von mehreren Versionen“, kein „ab low“; Fixture geändert, als bewusste Änderung zu Spec 2026-10-04 §3.3 vermerkt |
| 5 | §2.2/§2.3 Quelle aus `spanneUeber` | übernommen | `Spanne.quellen`, Quellenregel für `Fest`, Herkunftstexte §2.3, Fälle in `kopf-preis.json` |
| 6 | §2.2 b) Zwillinge ohne Sprache | übernommen | b) nur europäisch; Fixture JP-Kandidat → c) |
| 7 | §2.3 Hinweis bei GRÜN, Text „Deutscher“ | übernommen, Text abweichend | Bedingung wie vorgeschlagen. Teil 1 „Cardmarket-Trend (Druck abgeleitet)“ statt „(vom englischen Druck)“, weil Seltenheit und `cm` nicht zwingend vom EN-Druck stammen (`bestGroup.first()`, CodeKey-Zwilling kann ein anderer europäischer Druck sein); Hinweistext sprachneutral |
| 8 | §4.1 OkHttpAwait | übernommen | gestrichen; nur `callTimeout(10 s)`. Begründung korrigiert (Warten auf Deferred im fremden Scope genügt, Muster `koreanNameKurz`); `runCatching` in `konamiGet`/`resolveYugipediaTitle` bestätigt |
| 9 | §4.2 `runCatching` um `await` | übernommen | try/catch mit Rethrow vorgeschrieben (§4.2, §4.3, §6.1); Test „nach Frist Rückfall“, „Abbruch weitergereicht“ |
| 10 | §10 (5) / §4.2 Stapel | übernommen | Logzeilen mit `dauer=`; Stapel-Änderungen (schneller, leeres Netz → Katalog, ein Abruf) ehrlich benannt |
| 11 | §8.1 Alias ändert `base.id` | übernommen, erste Variante | `CatalogCard.id` bleibt der angefragte Passcode, nur Daten kanonisch gelesen; Aufrufer-Tabelle in §8.1. Keine Folgeänderung an Besitzfilter oder Buchungs-IDs |
| 12 | §6.1 `katalogGeladen` | übernommen | Definition, `katalogDa = katalog != null`, Effekt-Schlüssel, Anfrage im Repository-Scope (läuft beim Verlassen weiter) |
| 13 | §2.1/§6.1 Filter `cm.size != 1` | übernommen (Filter erweitert) | `cm.size != 1 || trend(cm[0]) == null`, begründet mit fehlender lokaler Preisdatei und veralteten Katalog-IDs; Fixture-Fall bleibt erreichbar. `low`/Stand für LIVE in `lowUndStand` festgelegt |
| 14 | §7 Reihenfolge und Text | übernommen | `live.ab` vor Katalogwert (gleiche Kennzahl wie die Seite, tagesaktuell); Texte je sicher/unsicher |
| 15 | §2.2 NO_MATCH | übernommen | Parameter `keinTreffer = match.selected == null`; Fixture mit und ohne Ersatz-Auswahl |
| 16 | §10 Nähte | übernommen | Nähte in §4.1/§4.2/§6.2 konkret; zusätzlich `protokoll`-Naht, weil `ScanLog.line` → `Log.i` im JVM-Test wirft; `CmPriceFile`-Kern mit Ergebnis-Typ `Download` |
| 17 | §10 Testlücken | übernommen | `unterzeile` + `lowUndStand` rein mit Fixture; `uebernahme` rein (price 0.0); JP/KR-Ausschluss; Quellen; `beimTippen` |
| 18 | §4.3 15-s-Frist | übernommen | keine eigene Frist, wartet solange die Seite offen ist; Dauer im ScanLog; Abnahme (1) an der Logzeile |
| 19 | §1 Nummerierung | übernommen | Tabelle = Nummern der Analyse, „Katalog veraltet“ eigene Zeile (7), Spannen als Zusatz; §11.5 verweist richtig auf 6 |
| 20 | §8.2 versionCode fällt | übernommen | `versionCode` aus Builddatum + Commits des Tages, Commit-Zahl nur im `versionName`; Restfall mit `adb install -r -d` dokumentiert |
| 21 | §5.3/§9.3 Twin-Signaturen | übernommen | Kern auf Expansions-ID-Ebene, Desktop-Signaturen als Wrapper, Fixture über beide Wege |
| 22 | §5.1 Speicherlimit | übernommen | 256 MB genannt, Index-Bau als eigener Aufruf (05:20-Job Standard, `CM_INDEX_IN_MAIN` entfällt), Dateien nacheinander und verworfen. „guide freigeben“ erübrigt sich, weil der Schritt den Preisführer nie lädt |
| 23 | §5.1 Katalog nur für `blocks` | übernommen | Katalog nur mit `CM_INDEX_KATALOG=1`, Format genannt, Zirkularität in §13 |
| 24 | §5.2 `name_en: null` | übernommen | Regel festgelegt, Android lässt weg; contract-Fälle `null`, leer, Zahl, zu lang |
| 25 | §5.4 Fremdfehler gecacht, `checked_at` | übernommen | nicht cachen bei `no-printings`/Fremdfehler; `checked_at`, `index_date` explizit; eine Leseabfrage, ein Upsert (entdoppelt) |
| 26 | §5.3 `printingRarities` | übernommen | höchstens ein YGOPRODeck-Abruf, geholt bei `needs-printings` bzw. Block-Regel; interner Grund `needs-printings`, nach außen `no-printings` nur bei Fremdfehler; unbekannte Seltenheiten als eigener Wert gezählt (wie Desktop-Rohwerte) |
| 27 | §5.1 Teilausfälle | übernommen | Pflicht-/optionale Eingaben, Plausibilitätsschranken, kein Upload bei Fehlern, `UA`, Schlüssel `products`, Abnahmepunkt cardsets in §11.2 |
| 28 | §11.2/§11.4 Monitoring | übernommen | Prüfweg Storage-Datum/Function-Logs, Phasen-Logs, Body im step-Modus, `cm_index_cron.sql` mit `timeout_milliseconds := 150000` und Secret-Platzhalter. „Vor 2c loggen“ erübrigt sich durch den eigenen Aufruf |
| 29 | §5.1 öffentlicher Bucket | übernommen | privater Bucket `cm-index`, angelegt in `cm_resolve_schema.sql`, Zugriff nur per Service-Rolle |
| 30 | §5.5 Datenquelle Gegenprobe | übernommen | Kopie der Desktop-DB (echte IDs über `cm_product_derived = 0`), lokale Dateien, Skript im Scratchpad, sonst „nicht gemessen“ |
| 31 | §6.2 401-Reihenfolge | übernommen | erst Reauth bei HTTP 401, dann Body; Body ohne `ok` = Fehler; contract-Fall „Gateway-401 ohne ok“; Tests über Naht `senden` |
| 32 | §5.1 Schlüssel `x` | übernommen | ganzer `set_code` groß wie Desktop, Nachschlagen mit `prefixOf` |
| 33 | §9 S0 „erster Commit“ | übernommen | S0 im Arbeitsbaum ohne Commit; Android-Kopien nur im Scratchpad |
| 34 | §5.4 RLS/Aufräumen/Fehlercodes | übernommen | Select-Policy gestrichen (`revoke all`), Aufräumzeile §11.6, `PGRST205`/`42P01` genannt |
| 35 | §5.3 Laden/Größen/Verzögerung | übernommen, teils anders | Versionsgruppen nur für den angefragten Namen; `v != 1` → 503; Größe 1,8 MB korrigiert. Statt Cache-Buster: Index und Preisdatei per Storage-API mit Service-Rolle (kein CDN), Rest-Verzögerung ≤ 1 h Modul-TTL in §11.3 |

### Umsetzungs-Nachtrag Android, Schritt 1 (§2, §3, §7, §8; 03.11.)
| Abschnitt | Abweichung | Grund |
|---|---|---|
| §3.1 `drucke` | Parameter `live` fehlt noch, `Druck.liveCm` ist immer leer (markierte Stelle im Code) | `CmResolveRepository.LiveCm` entsteht erst mit §6 (Schritt 3); `DruckPreis.fuer` kann Live bereits vollständig (Fixture `druck-preis.json` mit Live-Fällen grün) |
| §2.3 `lowUndStand` | Signatur `(kopf, markiert, sicher, preise, builtAt, liveLow = { null }, livePriceDate = null)` statt `(…, live, builtAt)` | wie oben, `Stand` gibt es noch nicht; Schritt 3 reicht `live.low`/`live.priceDate` durch |
| §2.2 `kandidaten` | `kandidaten(match: MatchResult, auswahl)` statt `(aktuell: ResolvedScan, auswahl)` | rein testbar ohne `ScanConfidence.Result`; gleiche Regel |
| §2.3 Hinweisfläche | Text als reine Funktion `ScanErgebnis.hinweis(markiert, sicher, gewaehlt)`, dazu `ScanErgebnis.abgeleitet(…)` | unit-getestet statt nur im Screen |
| §3.5 Hülle | auch andere Ausnahmen des Downloads gelten als `Offline`; eine unerwartete Ausnahme der Hülle wird `OFFLINE` mit deren Meldung | `aktualisieren` warf vorher nie; `AppNav` ruft ohne try/catch |
| §8.1 | reiner Kern `CatalogRepository.kanonisch(pc, istKarte, alias)` + neuer Test `CatalogAliasTest.kt`; Alias-Abfrage in `runCatching` (Katalog vor E3 ohne `card_aliases`) | sonst ohne SQLite nicht testbar; alter Katalog darf `card()` nicht brechen |
| §8.2 | `java.time` per `import` statt voll qualifiziert | im Kotlin-Skript löst `java` auf die Gradle-Erweiterung auf (Kompilierfehler) |
| §4.4 (vorgezogen, minimal) | Screen setzt `gewaehlterDruck` direkt beim Tippen; `beimTippen`/`nachUebernahme`/`uebernahme` folgen in Schritt 2 | `zusatz(gewaehlterDruck, match)` aus §3.1 braucht den Zustand |
| Test-Helfer | `Fixtures.textOrNull` ergänzt | geteilte Fixtures (Server-Team) durften fehlen; die Tests laufen inzwischen gegen die echten Dateien |

### Umsetzungs-Nachtrag Server (§5, §9, §11; 03.11.)
| Abschnitt | Abweichung / Festlegung | Grund |
|---|---|---|
| §5.5 Block-Regel, Bedingung 1 | „genau eine Expansion“ heißt: genau eine Expansion aus `exp` hat **überhaupt** Versionen der Karte, und dort ist n ≥ 2 (wie `deriveForExp` „no-group“). Eine zweite Expansion mit nur einer Version sperrt die Regel | Die Version in der zweiten Expansion könnte genau die gesuchte Seltenheit sein. Die wörtliche Lesart würde sie übergehen |
| §5.5 / §9.5 `reason` der Block-Regel | `blocks`, `no-group`, `count-mismatch`, `duplicate-rarity`, `rarity-not-listed` (gesuchte Seltenheit fehlt in `printingRarities`), `no-median`, `equal-medians` | Die Spec nannte keine Werte. Sie sind nur intern und in `blocks.json` sichtbar, nach außen gilt weiter `ambiguous/<d.reason>` |
| §5.5 Freigabe | Gegenprobe gemessen: 7/32 richtig (21,9 %, 205 Fälle mit n ≥ 2). `BLOCKS_AKTIV` bleibt `false` | Ledger `blocks-gegenprobe.md` |
| §5.1 `s` | Singles ohne `idExpansion` fallen weg | In der Desktop-Logik wären sie als Expansion 0 nie auflösbar. So zählen sie auch nicht in `ab_products` |
| §5.1 `real` | Zusätzlich zum `language <> 'KR'` der Abfrage fallen Zeilen mit KR-Code (`/-KR?[A-Z]?\d/i`) weg | doppelte Sicherung, gleiche Regel wie Schritt C0 |
| §5.1 Ablauf | Die Plausibilität wird nach jeder Pflichtdatei geprüft (Abbruch vor dem nächsten Download), nicht erst am Ende | spart Netz und CPU im Fehlerfall. Das Ergebnis ist dasselbe: kein Upload |
| §5.2 `printings[].rarity` | Fehlt das Feld oder ist es kein String → 400 `printings[i].rarity`. `set_code` wird getrimmt weitergereicht, `rarity` roh | Die Vertragstabelle verlangt den Typ String. Android sendet das Feld immer |
| §10 Tests | Die Tests für `ygoprodeck.ts` und `index-file.ts` stehen in `resolve_test.ts` (keine neue Datei). Aufruf: `deno test --allow-read --node-modules-dir=none` | §12 nennt keine eigene Testdatei. Die `package.json` an der Repo-Wurzel lässt Deno sonst `node_modules` erwarten (Typprüfung von supabase-js schlägt fehl). Das gilt auch für die bestehenden Functions |

## 15. Messung (Server-Team, 03.11.)

Alle Daten wurden am 03.11. frisch geladen: Cardmarket `products_singles_3.json` (87 393), `products_nonsingles_3.json` (2 414), YGOPRODeck `cardsets.php` (1 036).
Dazu kommen Katalog v11 und die Preisdatei vom 03.11. Echte IDs: 3 041 Zeilen aus einer **Kopie** der Desktop-DB, daraus 2 713 `real`-Schlüssel. Die Kette ist §5.3, Schritte 3–10.
`printingRarities` stammen aus `printings` des Katalogs (YGOPRODeck `card_sets`).
Ausgewertet wurde mit `buildCmIndex`, `cm-parse.ts` und `blocks.ts` aus dem Repo (Skript im Scratchpad).

**Index:** 14 727 Namen, 417 Präfixe in `x`, 54 `learned`-Gruppen, 42 Expansionen in `blocks`.
JSON 1,50 MB, gzip 545 KB, Bau in Deno 0,27 s (Node-Rechner, nicht Edge-CPU).

| Katalog-Drucke (ohne KR) | Anzahl | eindeutig durch die Funktion (Block-Regel aus) | mit Block-Regel (nur hypothetisch) |
|---|---|---|---|
| ohne `cm`, unverifiziert | 6 159 | **75 (1,2 %)**, alle `unique`, alle mit Trend | 75 |
| ohne `cm`, verifiziert (DE) | 650 | **0** | 0 |
| `cm`-Array, unverifiziert | 12 138 | **0** | 18 (0,1 %) |
| `cm`-Array, verifiziert (DE) | 2 447 | **0** | 16 (0,7 %) |

Gründe, warum Drucke nicht eindeutig werden:
- **Ohne `cm`:** 6 462 von 6 809 sind `no-expansion`, 230 `no-candidate`, 42 `no-model`.
  `no-expansion` heißt: Für 6 394 dieser Drucke kennt YGOPRODeck den Set-Code, aber kein Cardmarket-Sealed-Produkt trägt einen passenden Namen.
  Die größten Präfixe: LCYW 401, LCJW 345, DR1 295, LCGX 289, SBC1 256, MP14 255, DR1–DR04 je ~250, MVP1 215, DT01–DT07 je ~100, PGL2/3, BPW2, JUMP, HA04–07.
  Weitere 68 Drucke haben einen Präfix ohne cardsets-Eintrag.
- **Arrays:** no-model 12 305, no-group 1 522, not-by-rarity 344, too-few 184, conflict 161, rarity-unknown 69.

**Einordnung:** Der Katalog v11 wurde mit derselben Desktop-Logik (`cmForPrinting`) gebaut. Die Funktion löst deshalb bei Katalog-Drucken fast nur das auf, was der Katalog auch schon hat.
Ihr Nutzen liegt woanders:
- Sie hängt nicht vom Katalog ab. Neue Sets erscheinen am Tag nach ihrem Cardmarket-Eintrag, etwa BETB und MAMS seit dem 04.10.
- Echte IDs aus der Cloud-Sammlung (`real`) gelten sofort.
- Sie liefert den tagesaktuellen Richtwert `card.ab` und Zwilling-Drucke, die der Katalog nicht kennt.

Die Lücke „ohne `cm`“ schließt sie **nicht**, weil die Ursache die Set-Namenszuordnung ist (Desktop-Logik unverändert portiert).
Eine Alias-Tabelle für Set-Namen (YGOPRODeck ↔ Cardmarket) wäre ein eigener Folgeschritt. Er gälte für Desktop und Server gemeinsam, also mit Twin-Fixture.
Bis dahin bleibt für diese Drucke der Richtwert (§7).

**Disambiguierung (§5.5):** `deriveForExp` trifft im Leave-one-out 124 von 127 Fällen (97,6 %; Desktop 185/188). Die Block-Regel trifft 7 von 32 (21,9 %) und bleibt deshalb aus.
Mehrdeutige Arrays bleiben Spannen. Damit tritt das Risiko aus §13 „Disambiguierung bringt evtl. wenig“ ein. Einzelheiten stehen im Ledger `docs/superpowers/ledgers/2026-11-03-einzelscan-preis/blocks-gegenprobe.md`.

### Umsetzungs-Nachtrag Android, Schritt 2 (§4; 03.11.)
| Abschnitt | Abweichung / Befund | Grund |
|---|---|---|
| §4.1 | Kein suspendierendes OkHttp (`call.cancel`/`suspendCancellableCoroutine`), obwohl der Arbeitsauftrag es nannte. Abbrechbar ist das **Warten** (`withTimeoutOrNull` um `await` im fremden Scope), der geteilte Abruf läuft weiter; dazu `callTimeout(10 s)` | so festgelegt in §4.1 und Review-Nachtrag #8 (OkHttpAwait gestrichen); Test „Frist um await …“ belegt es |
| §4.1 | `client` und `laufend` sind `internal` statt `private` | Test prüft `callTimeoutMillis == 10 000` und den leeren Eintrag nach Ende |
| §4.2 | Wirft das geteilte Deferred (nur über die Naht möglich, `fetchAllSetsGeteilt` selbst liefert bei Fehlern `emptyList()`), heißt die Logzeile „Netz leer …“ | §4.2 kennt nur die drei Zeilen ok / > Frist / leer; Fehler = leere Liste |
| §4.2 | `SetCodeMatch.best` + `ScanConfidence.fromEvidence` in einer privaten Hilfsfunktion `urteil`, für „erst“ und „nach“ auf `rechnen` | eine Stelle statt zwei; bleibt abseits des UI-Threads (Ledger `2026-09-17-stapel-lichtschranke/performance-2-roh.log`) |
| §4.3 | Zustand als **ein** `remember(r)`-Objekt `zustand: ScanErgebnis.Zustand` statt fünf Einzelvariablen; neue reine Hilfe `ScanErgebnis.start(r, festeSprache)` für den Startwert | `nachUebernahme`/`beimTippen` arbeiten auf `Zustand`; gleiche Semantik |
| §4.3 | `remember`-Schlüssel von `drucke` noch ohne `liveStand` | `liveStand` entsteht mit §6 in Schritt 3 |
| §4.4 `uebernahme` | `copy(price = 0.0)` gilt auch für den Rückfall `aktuell.match.selected`; der `knownSets`-Eintrag zur Auswahl wird jetzt auch ohne `markiert` genommen | „price ist immer 0.0“; Reihenfolge wie in §4.4 (vorher nur mit `markiert`) |
| Performance-Ledger Stapel | Die Spec verweist auf **kein** Performance-Ledger für den Stapelmodus. Relevant ist `docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/` (Hänger durch `SetCodeMatch.best` auf dem UI-Thread). Bedingung weiter erfüllt (`rechnen` = `Dispatchers.Default`). `ScanCapture` unverändert (1,5 s, ohne `nachrechnen`); gemessen wird erst bei der Abnahme §10 (5) an den Zeilen „Drucke … dauer=“ | nicht am Gerät gemessen |

### Umsetzungs-Nachtrag Android, Schritt 3 (§6, §7 Live; 03.11.)
| Abschnitt | Abweichung / Festlegung | Grund |
|---|---|---|
| §6.1/§6.3 | Neu `CmResolveRepository.version: StateFlow<Long>` (zählt Start und Ende jeder Anfrage). Die Seite liest `liveStand`, `laeuft` und die Fehlerschlüssel mit `remember(pc, version)` neu, statt `liveStand` nur nach dem `await` im Effekt zu setzen | Beim Start einer Anfrage ändern sich `laeuft` und damit `bedarfSchluessel`; der Effekt startet neu und bricht das alte Warten ab. Ohne Signal aus dem Repository käme die Antwort dann nie auf der Seite an |
| §6.1 | Im Screen zählt für `liveBedarf` ein **laufender** Schlüssel wie ein bekannter (`k in laeuft || bekannt`). `anfragen` filtert zusätzlich selbst bekannte und laufende Schlüssel und liefert sofort `null`, wenn nichts übrig bleibt oder die Karte gesperrt ist | sonst schickte ein Tipp während einer laufenden Anfrage dieselben Drucke noch einmal; ein Tipp fragt so nur die neue Zeile („einzeln abgefragt“) |
| §6.3 FEHLER | Zusatz-API `fehlgeschlagen(cardId): Set<String>` = Schlüssel der letzten Anfrage, falls sie fehlschlug (bei Erfolg geleert). FEHLER = Schlüssel darin und nicht im Speicher | „letzte Anfrage schlug fehl“ allein hätte auch nie gefragte Schlüssel als FEHLER gezählt |
| §2.1/§2.3 | Reine Helfer `ScanErgebnis.sucht`, `ScanErgebnis.liveFehler` (markierter Druck + Kandidaten, nur europäisch) und `ScanErgebnis.zeilenText` („…“) statt Logik im Screen | unit-getestet in `ScanErgebnisTest` |
| §6.1 `liveKey` | Kanonisch in `CmResolveRepository.liveKey`; `ScanErgebnis.liveKey` ruft sie auf | Repository braucht denselben Schlüssel für `laeuft`/Dedupe; eine Stelle statt zwei |
| §6.1 online | `CmResolveRepository.online(context)` (ConnectivityManager, `NET_CAPABILITY_INTERNET`) | §12 erlaubt keine weitere Datei |
| §6.2 | Wirft `anmelden` (Login scheitert) oder `senden` (Timeout, Netz, `token()` ohne Sitzung), ist das ein Fehler wie „kein Body“. `ok: false` ohne `error` → Text „Live-Suche fehlgeschlagen.“. `card.ab = null` einer späteren Antwort überschreibt einen bekannten Wert nicht (ebenso `price_date`) | Vertrag nennt diese Fälle nicht; Seite darf nie abstürzen |
| §6.2 | Zusätzliche Naht `scope` (Repository-Scope) und `protokoll`; ScanLog-Zeile `Live pc=… n=… ok treffer=…|fehler=… dauer=…ms` | Tests in virtueller Zeit; `ScanLog.line` wirft im JVM-Test (§14 #16) |
| §2.3 `lowUndStand` | Signatur aus Schritt 1 bleibt; der Screen reicht `liveStand::low` und `liveStand.priceDate` durch | keine Änderung an bestehenden Tests nötig, gleiche Semantik |
| §10 | Tests von `liveBedarf`, `liveKey`, `drucke(…, live)`, `sucht`/`liveFehler`, `zeilenText` in `ScanErgebnisTest`; `CmResolveRepositoryTest` gegen die echte `contract.json` (Server-Team, vorhanden) | wie §10 |

### Review-Nachtrag 2 (03.11., bestätigte Funde nach der Umsetzung)
| # | Abschnitt | Befund | Entscheidung |
|---|---|---|---|
| R2-1 | §5.1/§5.3 Schritt 5 | `real` war je Präfix geschlüsselt: ein fremdes Artwork derselben Seltenheit (LDK2-K01/K02/K03) oder ein Reprint hinter demselben Präfix (LOB/LOB 25th) bekam die ID des einen besessenen Drucks als druckgenauen Live-Preis, 30 Tage gecacht | Schlüssel `codeKey`/`normName`/`rk` (mit Nummer). `real` greift nur, wenn die Karte in genau einer Expansion des Präfixes steht und die ID dort eine ihrer Versionen ist. Tests `resolve_test.ts` „real: …“, `cm_index_test.ts` „zwei Nummern, gleiche Seltenheit“. Ein alter Index (Präfix-Schlüssel) trifft nie mehr und fällt auf Schritt 6 zurück |
| R2-2 | §2.2 | `spanneUeber` gab bei einem einzigen Wert unter mehreren Drucken einen scheinbar druckgenauen „Cardmarket-Trend“; Zweig 2/3d mischten Sprachen (EN-Preis im Kopf eines JP-Scans) | `mehrdeutig`, sobald ein beteiligter Druck keinen Wert hat („ca. …“); Basis „alle“ nur in der Scan-Sprache (neuer Parameter `sprache` = `ScanSprache.fest`); 3b ohne die Kandidaten selbst. Fixture `kopf-preis.json` angepasst („unsicher d)“ und „einzelner Sammlungspreis“ jetzt `ca.`) und um fünf Fälle ergänzt; `unterzeile.json` unverändert (reine Funktion des Kopfs) |
| R2-3 | §6.3 | Erfolg einer parallelen Live-Anfrage löschte Fehler und Sperre einer anderen fehlgeschlagenen Anfrage derselben Karte | Fehlerzustand je Schlüssel, Sperre fällt erst ohne Fehlschlüssel. Tests „ueberlappend …“ in `CmResolveRepositoryTest` |
| R2-4 | §5.4 | Cache-Vergiftung über `name_en`: Ergebnis mit fremdem Namen 30 Tage für alle gültig | Spalte `name_norm` (Schema idempotent per `add column if not exists`), Zeile gilt nur bei gleichem `normName`; abweichende Zeilen werden neu berechnet und überschrieben. Ohne `name_en` und mit Cache-Zeile kostet die Prüfung den YGOPRODeck-Abruf (höchstens einer je Anfrage) |
| R2-5 | §9.1/§9.2 | Kotlin-Twin-Tests `CodeKeyTest`/`RarityNormTest` übersprangen still (`assumeTrue`), wenn die geteilte Fixture fehlte | `Fixtures.text` (schlägt fehl); `Fixtures.textOrNull` entfällt |
| R2-6 | §8.2 | `versionCode` aus „Commits von HEAD seit 00:00“ fiel nach Zweigwechsel/Squash am selben Tag | minutengenaue Build-Uhrzeit (UTC), ohne Git-Anteil |
| R2-7 | §4.4 | „In Sammlung +“ setzt `price = 0.0`; `ScanCapture.uebernehmeFoto` verglich die ganze `SetOption` (inkl. Preis) und fand den Stapel-Eintrag desselben Drucks nicht mehr | Vergleich über `ScanErgebnis.gleicherDruck` (Code, Seltenheit, Sprache wie `key`); die 0.0-Garantie bleibt. `ScanCapture.kt` damit zusätzlich geändert (eine Zeile) |

### Nachtrag Set-Aliase (03.11., Folgeschritt zu §15)

Das ist der Folgeschritt, den §15 nennt: eine Alias-Tabelle YGOPRODeck-`set_name` → Cardmarket-`idExpansion`, gemeinsam für Desktop und Server, mit Twin-Fixture.
Die Einzelheiten, alle 130 Aliase mit Beleg und die Hinweise der Skeptiker stehen im Ledger `docs/superpowers/ledgers/2026-11-03-einzelscan-preis/set-aliase.md`.

| Punkt | Festlegung |
|---|---|
| Regel | `expansionIdsFor` (Desktop `cardmarket-bulk-parse.cjs`, Deno `_shared/cm-parse.ts`) prüft je `set_name` erst `normName`, dann Token-Schlüssel und erst ohne Treffer den Alias (`normName(decodeEntities(setName))`). Namens-Treffer haben Vorrang, und was heute trifft, bleibt gleich. Optionaler dritter Parameter `aliases` (Standard `SET_ALIASES`) für Tests |
| Daten | Twin-Fixture `docs/fixtures/cm-resolve/set-aliases.json` (`_kommentar`, `aliases[]` mit `setName`, `prefix`, `idExpansion`, `cmName`, `beleg`; sortiert nach `setName`). Spiegel: `desktop/electron/cm-set-aliases.json` (`electron-builder` packt `docs/` nicht) und `supabase/functions/_shared/cm-set-aliases.ts` (Edge-Bundles enthalten nur `supabase/functions/`). Die Gleichheit prüfen `cm-resolve-fixture.test.cjs` und `cm-parse_test.ts` |
| Reichweite | Desktop: Bulk-Refresh, Ableitung und Katalogbau (`makeCmLookup` → `attachCm`). Server: `cm-index` (`x[prefix]`) → `resolve-cm-product`. `idFromVersionRow` bleibt unverändert, weil sie Cardmarket-Expansion-Namen bekommt, nicht YGOPRODeck-Namen. Ein Alias je Präfix reicht, weil alle Aufrufer die Präfix-Union der `set_name`s übergeben |
| Auswahl | 130 Kandidaten aus dem Inhaltsabgleich (Kartennamen Katalog ↔ Cardmarket-Singles je Expansion, ohne OCG-Kopien und Schwester-Sets). Jeder wurde von zwei Skeptikern geprüft, alle sind bestätigt, keiner abgelehnt. 98 weitere ungelöste Sets (296 Drucke) haben keinen eindeutigen Kandidaten und bleiben ohne Alias |
| `parse.json` | 6 neue Fälle: Alias trifft, Alias mit Array, `&apos;` im Set-Namen, Namens-Treffer hat Vorrang, unbekanntes Set bleibt `no-expansion` |

**Messung** auf denselben Daten wie §15. „Vorher“ ist dieselbe Kette mit leerer Alias-Liste:

| | vorher | nachher |
|---|---|---|
| Präfixe in `x` (cm-index) | 417 | 547 (alte 417 identisch) |
| Katalog-Drucke ohne `cm` (6 809), eindeutig durch `resolve-cm-product` | 75 | **5 419** (davon 5 418 mit Trend) |
| davon unverifiziert / verifiziert DE | 75 / 0 | 4 934 / 485 |
| `cm`-Arrays (14 585) | unverändert | unverändert |
| Desktop-Katalogbau offline (ohne DB): Katalog-Drucke ohne `cm` | 6 809 | Zahl 5 419, Array 788, weiter ohne 602 |
| Drucke mit `cm`, deren Wert sich ändert | — | 0 |

Damit ist die in §15 beschriebene Lücke „ohne `cm`“ zu etwa 80 % geschlossen.
Ohne `cm` bleiben vor allem Sets ohne eindeutige Cardmarket-Expansion, Präfixe ohne cardsets-Eintrag und Namensvarianten einzelner Karten.
Varianten-Expansionen (Duelist League, WI26-Stempel, YCSW, 2007/2016-Doppelprodukte) liefern Spannen statt Einzel-IDs.
Wirksam wird das am Handy erst mit dem nächsten Katalogbau am Desktop und dem nächsten `cm-index`-Lauf nach dem Deploy. Beides macht der Nutzer (§11).

## Nachtrag Katalogbau: verifizierte Drucke erhalten

**Grund.** `runCatalogBuild` holte die verifizierten deutschen Drucke (`printings_verified`) bisher nur aus dem eigenen `api_cache` (`readVerified`: `wiki_parse:%` + `ygoprodeck:%`). Der kennt nur Karten, die genau dieser Rechner je bei Yugipedia nachgeschlagen hat. Gemessen am 03.11. an einer Kopie der PC-DB: 26 passende Cache-Zeilen, daraus 12 Karten mit 144 Drucken. Der zuletzt veröffentlichte Katalog v11 (auf einem anderen Rechner gebaut) trägt verifizierte DE-Drucke für 2.515 Karten (9.386 Drucke). Ein Bau von diesem PC hätte am Handy für über 2.500 Karten die echten DE-Codes gelöscht.

**Regel.** `mergeVerified` (`desktop/electron/catalog-build.cjs`) kombiniert die lokalen Funde mit denen des Vorgänger-Katalogs:
- Kennt der lokale Cache eine Karte, gilt für sie nur der lokale Stand. Er ersetzt den Vorgänger für diese Karte ganz, statt mit ihm vereinigt zu werden. So kann ein korrigierter Cache alte Fehler und von Yugipedia entfernte Drucke wirklich entfernen. Aus dem Vorgänger übernommen werden nur Karten ohne lokalen Fund (der eigentliche Zweck: Karten, die dieser PC nie nachgeschlagen hat).
- Übernommen werden nur Karten, die im neuen Bau noch vorkommen, und nur Einträge in der Form von `attachVerified`: deutscher Code (`-DE`/`-G<Ziffer>`, wie bei `readVerified`, also nie KR/EN), nicht leere Seltenheit, `lang` = `DE`. `cm` fällt weg, `attachCm` setzt es neu.
- Seltenheiten werden bereinigt (`saubereRarity`, lokal wie übernommen): Reste von Wiki-Kommentaren und Templates (`<!--`, `-->`, `{{`, `}}`, `|`, `<`) fallen weg. Bleibt keine echte Seltenheit übrig (`kenntRarity`), wird sie `Unknown`. Der verifizierte deutsche Code bleibt dabei erhalten, wie bei `readVerified`.
- Je Karte fällt ein `code|Unknown` weg, sobald derselbe Code auch eine bekannte Seltenheit hat.
- Reihenfolge: zuerst die lokalen Karten, danach die übernommenen in der Reihenfolge des Vorgängers. Innerhalb einer Karte bleibt die Reihenfolge der Quelle. Für saubere Einträge ist der Roundtrip verlustfrei. Gegen v11 geprüft: nur die 3 unten genannten Karten ändern sich, eine zweite Runde liefert dasselbe Ergebnis.

**Ablauf.** `loadPreviousCatalog` liest `catalog_versions` (`kind='catalog'`) und lädt die Datei aus dem Bucket `catalog`. Sie prüft `sha256`, falls eingetragen, entpackt sie mit gunzip und parst sie.
- Fehlt die Zeile, läuft der Bau ohne Übernahme weiter.
- Ist die Zeile da, aber Download, Prüfsumme oder Parsen scheitern, bricht der Bau mit dem Fehlercode `previous-catalog` ab. Dasselbe passiert, wenn `catalog_versions` nicht lesbar ist. In diesen Fällen wird nichts hochgeladen und keine Version verbucht.

Das Ergebnis meldet zusätzlich `verifiedCarried: { fromVersion, cards, printings }`. Die bestehenden Felder bleiben unverändert, `verified` zählt weiter nur die lokalen Funde. Die Statuszeile in den Einstellungen nennt die übernommenen Karten.

**Erwartung für v12 von diesem PC** (Kopie der PC-DB + v11, neu gerechnet nach der Bereinigung): 2.515 Karten mit 9.390 Drucken. Davon stammen 2.503 Karten mit 9.246 Drucken aus v11, die übrigen 12 Karten mit 144 Drucken sind lokal.

**Bereinigt beim Übernehmen (in v11 belegt):**
- Polymerization 24094653: `SGX2-DEA12`/`Common<!--` und `JUSH-DE014`/`Rare-->` werden zu `Common` bzw. `Rare` und fallen mit den schon vorhandenen richtigen Einträgen zusammen.
- Red-Eyes Black Dragon 74677422: `LOB-DE070`/`Ultra Rare-->` wird zu `Ultra Rare`.
- Mitsurugi no Miko, Wousu 76948970: `ALIN-DE091`/`Unknown` fällt weg, weil `ALIN-DE091`/`Common` existiert.

v11 allein ergibt damit 2.515 Karten mit 9.383 statt 9.386 Drucken, ohne Kommentar-Reste. `readVerified` selbst ist unverändert. Seine Reste werden in `mergeVerified` bereinigt, das jeder Bau durchläuft.
