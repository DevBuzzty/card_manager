# Cardmarket-Scraper ohne Prüfbox – Design

Stand: 16.11.2026 · Status: Entwurf zur Freigabe

## Absicht

Der Nutzer soll **nie mehr selbst die Cloudflare-Prüfbox anklicken** müssen. Heute fragt die App beim Knopf-Lauf
nach, ob sie das versteckte Scraper-Fenster zeigen soll, und der Hintergrund-Abruf läuft alle 10 Minuten immer wieder in
Prüfungen. Die Prüfung wird **nicht** umgangen oder automatisch geklickt (Bot-Prüfung, Cardmarket-AGB; schon in
`2026-09-01-cardmarket-scraper-design.md:29` und Spec `2026-11-03-einzelscan-preis-design.md:48` ausgeschlossen).
Stattdessen braucht die App Cardmarket-Seiten fast nie mehr, und wenn eine Prüfung kommt, wartet sie still ab.

## Befund (Messung am 16.11.2026, nur lesend, Desktop-DB)

- 3909 lebende Drucke. 3542 haben `cm_product_id` und bekommen ihren Preis aus `price_guide_3.json` ohne Seitenaufruf
  (92 % der Nicht-KR-Drucke).
- **296 Nicht-KR-Drucke ohne ID** (288 `ambiguous`, 6 `no-candidate`, 2 `no-expansion`): zusammen ~133 €, nur 4 davon
  ≥ 5 €. 216 Commons, vor allem alte Sets mit Nachdrucken (PSV 57, LAVD 37, RA05 36, LODT 28, YGLD 26, LOB 21).
- **1st-Ed-Durchgang:** 1332 Kandidaten (unabhängig von `cm_product_id`), je 3 Seiten, ohne Backoff
  (`cardmarket-scraper.cjs:255ff`, kein `zaehler`). Nur 18 davon haben `price ≥ 5`.
- Poller an (`cm_auto_enabled=true`, `cm_auto_min_rank=2`), alle 10 min headless, 4 Basis-Karten + 2 1st-Ed-Drucke.
  Gescheiterte Seitenaufrufe stempeln nichts (`cardmarket-scraper.cjs:176`) → derselbe Druck kommt jeden Tick zuerst.
- Letzter erfolgreicher Scrape-Preis: 07.10.2026. Das Log `userData/cardmarket-scraper.log` wird bei jedem Lauf
  geleert (`:134`) und zählt keine Prüfungen.

## Ziele

1. Kein Dialog, kein sichtbares Fenster, keine Aufforderung zum Klicken – weder beim Hintergrund-Abruf noch beim Knopf.
2. Drucke unter 5 € lösen **nie** einen Cardmarket-Seitenaufruf aus (weder Basis noch 1. Auflage).
3. Drucke ohne eindeutige ID bekommen trotzdem einen Cardmarket-Euro-Preis: einen **Schätzpreis** aus
   `price_guide_3.json`, sichtbar als Schätzung markiert.
4. Drucke ab 5 € werden weiter automatisch druckgenau geholt, aber nach einer Prüfung mit langer Ruhe statt Dauerfeuer.
5. Messbar machen: ein Lauf-Protokoll, das Seiten und Prüfungen je Durchgang dauerhaft zählt.

## Nicht-Ziele

- Prüfung automatisch lösen, Fingerprint verschleiern, fremde Browser fernsteuern o. ä. (Anti-Ziel, s. o.).
- Nachdrucke über die Sprache eindeutig machen (DE nie in EN-only-25th-Sets) – eigener späterer Schritt, weil der
  EN-only-Status nicht belegt ist.
- Schätzpreis-Markierung in die Cloud / aufs Handy spiegeln (das Handy bekommt nur den Preis, wie bisher).
- Cloud-Funktionen (`resolve-cm-product`, `refresh-cardmarket-prices`) ändern.
- Manuelle Preis-Eingabe ändern (bleibt `price_locked = 2`, wird nie angefasst).

## Anti-Ziele (Fehlschlag, auch wenn es technisch läuft)

- Irgendein Weg, auf dem doch wieder ein Fenster aufgeht oder ein `confirm()` nach der Prüfung fragt.
- Ein Schätzpreis überschreibt einen echten druckgenauen Preis (Bulk mit ID, Scrape, manuell).
- Die Schwelle zieht so viele billige Drucke mit, dass der Abruf wieder dauernd läuft (Richtwert: mehr als ~50
  Basis-Kandidaten nach Abnahme 1 → Spanne vorher nach Seltenheit eingrenzen, siehe „Meine Entscheidungen“).

## Ansätze (besprochen)

- **A – Scraper nur ab 5 €, still mit Ruhezeiten (gewählt).** Unter 5 € Schätzpreis, darüber weiter automatisch
  druckgenau, Prüfung → Ruhe statt Dialog. Du klickst nie; ein teurer Preis kann sich um Tage verzögern.
- **B – Scraper ganz raus, Rest von Hand.** Null Cardmarket-Seiten in der App, dafür ~22 teure Drucke und jeder neue
  teure Druck per Hand (Link + Eingabefeld). Verworfen: dauerhafte Handarbeit.
- **Nur ruhiger machen (ohne Schwelle).** Verworfen: senkt Prüfungen, bringt sie nicht auf null.

## Design

### 1. Schätzpreis für Drucke ohne ID (Desktop-Bulk, neuer Schritt)

In `cardmarket-bulk.cjs` nach Schritt A/A2 (ID-Auflösung/Ableitung) und vor/neben B (`applyPrices`) ein Schritt
**„Spanne“**: Für jeden lebenden Nicht-KR-Druck mit `cm_product_id IS NULL`, `price_locked != 2`, für den der
vorhandene Resolver (`resolveProduct` in `cardmarket-bulk-parse.cjs`) `ambiguous` mit Kandidaten-`idProduct`s liefert
**und** der keinen gescrapten Preis hat (`cm_url IS NULL OR cm_estimate = 1` – ein Scrape-Preis ohne ID, z. B. die ~123
Drucke vom 02.10., bleibt geschützt, bis ein neuer Scrape ihn ersetzt):

- Aus `price_guide_3.json` die `trend`-Werte (> 0) aller Kandidaten holen; dabei den Sprachfaktor `cm_lang_factor`
  genauso anwenden wie `applyPrices`.
- `price` = **niedrigster** Trend (vorsichtige Bewertung; bei Commons sind die Versionen meist gleich billig).
- Neue Spalten (additive Migration in `database.cjs`): `cm_estimate INTEGER DEFAULT 0` (1 = Preis ist Schätzung),
  `cm_estimate_max REAL` (höchster Trend der Spanne), `cm_estimate_at DATETIME`. `price_locked = 1`.
  **`cm_updated_at` wird nicht gestempelt** – sonst wäre der Druck für den Scraper (7-Tage-Frist,
  `cardmarket-scraper.cjs:167-169`) immer „frisch“ und würde nie genau bepreist.
- Sobald ein Druck später eine echte oder abgeleitete `cm_product_id` bekommt (Bulk, Scrape) **oder ein Scrape ihm
  einen Preis schreibt (auch ohne ID)**, werden `cm_estimate = 0` und `cm_estimate_max = NULL` zurückgesetzt.
- `no-candidate` / `no-expansion` (8 Drucke): kein Schätzpreis, bleiben wie heute.

UI: Wo heute der Preis eines Drucks steht (Karten-Detail, Sammlungsliste), bei `cm_estimate = 1` ein dezentes
„≈“ bzw. „Schätzung“ mit Tooltip „Cardmarket-Spanne x,xx – y,yy €, genaue Version unbekannt“.

### 2. Wert-Schwelle für den Scraper

- Neues Setting `cm_scrape_min_eur`, Standard `5`.
- **Basis-Durchgang** (`runCardmarketScrape`): Kandidat nur, wenn `cm_product_id IS NULL` **und**
  `COALESCE(cm_estimate_max, price) >= cm_scrape_min_eur`. Der Raritäts-Filter (`minRank`) entfällt.
  Fehlt jeder Preis, ist der Druck kein Kandidat.
- **1st-Ed-Durchgang** (`runFirstEdPass`): Kandidat nur, wenn `COALESCE(cm_estimate_max, price) >= cm_scrape_min_eur`
  (dieselbe Regel wie Basis, zusätzlich zu den heutigen Bedingungen); Raritäts-Filter entfällt. Unter der Schwelle bleibt `cm_first_ed_factor` wie er ist (NULL → die
  Bewertung nimmt den normalen Preis, `valuation.js:18`).

### 3. Kein Dialog, keine Fenster – Prüfung bedeutet Ruhe

- Der Knopf-Lauf läuft genauso still wie der Poller (`headless`): kein `cm-challenge`-Ereignis, kein `confirm()`,
  kein `reveal-cm-window`. Die zugehörigen IPC-Kanäle und der Dialog in `CollectionList.jsx:78-81` entfallen.
- **Was zählt:** Als „Prüfung“ für die Ruhe-Regeln zählt nur ein **gescheiterter** Aufruf, also eine Prüfung, die sich
  im Headless-Warten (~10 s, `loadPage`) nicht von selbst gelöst hat. Das Protokoll zählt beides getrennt:
  `pruefungen_gesehen` und `pruefungen_gescheitert`.
- **Ruhe je Druck:** Scheitert ein Seitenaufruf an einer Prüfung, wird ein neuer Zeitstempel
  `cm_challenge_at` (Basis) bzw. `cm_first_ed_challenge_at` (1st-Ed) gesetzt; der Druck ist dann **3 Tage** kein Kandidat.
- **Ruhe für den ganzen Abruf:** Nach der ersten gescheiterten Prüfung bricht der Lauf ab (Basis **und** der
  anschließende 1st-Ed-Durchgang im selben Tick/Knopf-Lauf), und der Poller pausiert
  **6 Stunden** (Setting `cm_pause_until`). Der Knopf achtet auch auf diese Pause und meldet stattdessen
  „Cardmarket macht gerade eine Pause bis HH:MM“.
- Der 1st-Ed-Durchgang bekommt denselben Zähler/Backoff wie der Basis-Durchgang.

### 4. Lauf-Protokoll

`userData/cardmarket-scraper.log` wird nicht mehr geleert, sondern angehängt (bei > 1 MB in `.log.1` umbenennen).
Je Lauf eine Zusammenfassungszeile `{"type":"run", "at", "trigger":"poller|button", "pass":"base|firstEd",
"seiten", "pruefungen_gesehen", "pruefungen_gescheitert", "errors", "ms"}` zusätzlich zu den bisherigen `id-missed`/`no-match`-Zeilen.

### 5. Oberfläche Sammlung

Der Raritäts-Dropdown neben dem Cardmarket-Knopf entfällt; dafür steht dort „ab 5 €“ (fest, Setting ohne eigene UI).
Die Auto-Checkbox bleibt. Nach einem Lauf zeigt der Status z. B. „2 Preise geholt · 0 Prüfungen“ bzw. die Pause.

## Meine Entscheidungen (vom Nutzer nicht ausdrücklich beschlossen, korrigierbar)

- Schätzpreis = niedrigster Trend der Spanne; Schwelle prüft den **höchsten** Trend (lieber einmal zu viel laden als
  einen teuren Druck nie genau bepreisen). Weil `resolveProduct` Kandidaten nur nach Name + Expansion sammelt (nicht
  nach Seltenheit), kann ein Common in RA05/LAVD/LOB über eine teure Schwester-Version Kandidat werden. Das ist
  gewollt, solange Abnahme 1 höchstens ~50 Basis-Kandidaten ergibt; liegt sie darüber, grenzt der Builder die Spanne
  vorher nach Seltenheit ein (Lernwerte aus `deriveProduct` bzw. `printingRarities`) und meldet das.
- Ein alter Scrape-Preis ohne ID bleibt vor der Schätzung geschützt, ohne Verfallsfrist.
- Nur gescheiterte Prüfungen lösen Ruhe aus; sie stoppen den ganzen Lauf inkl. 1st-Ed-Durchgang.
- Die Schätzung stempelt eine eigene Spalte `cm_estimate_at`, nicht `cm_updated_at`.
- Ruhe 3 Tage je Druck, 6 Stunden für den ganzen Abruf.
- Knopf läuft ebenfalls still, ohne Fenster-Angebot.
- Raritäts-Schwelle fällt ganz weg zugunsten der Euro-Schwelle.
- Schätz-Markierung nur auf dem Desktop.

## Dem Builder überlassen

Spaltennamen im Detail, Ort der UI-Markierung, Rotationsgröße des Logs, Test-Aufteilung, ob der Spannen-Schritt in
`applyPrices` oder als eigene Funktion lebt.

## Abnahme

1. Vor dem Bauen gemessen und im Ledger festgehalten: Wie viele Drucke wären mit Regel 2 heute Basis- bzw.
   1st-Ed-Kandidaten (Erwartung: Größenordnung 4–30 bzw. ~18)?
2. Nach einem Bulk-Lauf haben alle `ambiguous`-Drucke ohne Scrape-Preis (`cm_url IS NULL`) und mit mindestens einem
   Kandidaten-Trend > 0 einen Preis mit `cm_estimate = 1` (Anzahl im Ledger); kein Druck mit ID, mit Scrape-Preis
   oder mit `price_locked = 2` hat `cm_estimate = 1`, und `cm_updated_at` ist durch die Schätzung unverändert.
3. Ein Knopf-Lauf und 24 h Poller öffnen kein Fenster und keinen Dialog; das Log zeigt Seiten und Prüfungen je Lauf.
4. Nach einer Prüfung: Poller-Pause 6 h im Log sichtbar, betroffener Druck 3 Tage nicht wieder geladen.
5. Bestehende Tests (`electron/*.test.cjs`, `src/utils/*.test.js`) grün, neue Tests für Spanne, Schwelle, Ruhe.
