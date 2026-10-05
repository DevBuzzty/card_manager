# Spec G — Nachtrag G4b: Robuster Erste-Auflage-Faktor

**Datum:** 2026-10-05
**Ändert:** `docs/superpowers/specs/2026-09-15-spec-g-nachtrag-g4-erste-auflage-preis.md` §2 („Nicht drin": Sprach-/Zustandsfilter), §3 (Preisregel), §4 (Seiten pro Kandidat, Lesen, Schreiben), §9, §10, §12 (Ab-Preis-Rauschen)
**Setzt voraus:** G4 (gemergt `bf3115c`).
**Status:** Entwurf vom Nutzer im Chat abgesegnet (2026-10-05); Spec zur Durchsicht.

---

## 1. Anlass

Karten-Detail Red-Eyes Black Dragon **SDJ-G001** Ultra Rare (DE): „Basis 8,09 € · 1st Ed 76,86 € (×9,50)".
Der G4-Faktor ist `Ab-Preis mit isFirstEd=Y ÷ Ab-Preis ohne Filter` — zwei **Minima** über alle Sprachen und Zustände. Ein einzelnes teures 1st-Ed-Angebot (wenige Angebote) oder ein einzelnes Billigangebot ohne Filter (z. B. PO, andere Sprache) treibt den Faktor beliebig hoch. G4 §12 hat das als Risiko „Ab-Preis-Rauschen" akzeptiert; G4b behebt es.

## 2. Was sich gegenüber G4 ändert

| G4 | G4b |
|---|---|
| Zähler: Ab-Preis `?isFirstEd=Y` | Robuster Wert aus den **Angeboten** von `?isFirstEd=Y` + Sprach- und Zustandsfilter |
| Nenner: Ab-Preis **ohne** Filter (enthält die 1st-Ed-Angebote selbst) | Robuster Wert aus den Angeboten von `?isFirstEd=N` + **dieselben** Filter |
| Sprach-/Zustandsfilter „nicht drin" (§2) | **Drin:** Sprache des Printings, Zustand EX oder besser |
| Ab-Preis aus dem Infokasten (`parseFromPrice`) | Angebotspreise aus der Angebotsliste (neue DOM-Extraktion + reiner Parser) |
| Faktor = max(1, Verhältnis) | Faktor = min(10, max(1, Verhältnis)), nur bei **≥ 3 Angeboten je Seite** |
| Kein Angebot mit Filter → Faktor NULL | Zu wenige Angebote auf **einer** Seite → Faktor NULL (§4) |
| 3 Seiten pro Kandidat (Versionen, ohne Filter, Y) | Weiterhin 3 Seiten (Versionen, N, Y) — keine Mehrlast für Cardmarket |

**Unverändert:** Spalten (`cm_first_ed_factor`, `cm_first_ed_updated_at`, `price_first_ed`), SQLite- und Postgres-Trigger (`price × Faktor`), Sync (`MIRROR_COLS`), Bewertungs-Zwillinge (`unitPrice`/`valueOf` in vier Fassungen), Preiszeile (`firstEdLine`), Kandidatenauswahl (G4 §4), Poller-Grenze 2 pro Lauf, Drossel 2–4 s, Handy, Cloud, Edge Functions. **Kein SQL einspielen, keine APK.**

## 3. Messversuch (Task 1, vor jedem Code)

Im Scraper-Fenster der Desktop-App (kommt durch Cloudflare; der eingebaute Browser der Entwicklungsumgebung nicht), ohne zu schreiben, an **SDJ-G001 Ultra Rare** und **MAMO-DE020 Ultra Rare** (`cm_product_id` 904608):

1. Produktseite mit `?isFirstEd=N` und `?isFirstEd=Y` laden; das rohe HTML nur ins (nicht eingecheckte) Ledger, die Ausgabe von `OFFERS_JS` als JSON-Fixture nach `desktop/electron/fixtures/cm-offers-*.json` (enthält keine Verkäufernamen).
2. Klären und im Ledger festhalten:
   - Selektoren der Angebotszeilen und je Zeile: Preis, Zustand, Sprache, Erste-Auflage-Markierung.
   - Ob die URL-Parameter `language=<id>` und `minCondition=<n>` serverseitig filtern, und die Zuordnung Sprach-Code → Cardmarket-Id (mindestens DE, EN, FR, IT, ES, PT) und Zustand → Zahl (MT 1 … PO 7 erwartet).
   - Sortierung der Liste (erwartet: Preis aufsteigend) und wie viele Zeilen ohne Nachladen sichtbar sind.
3. Ergebnis entscheidet die Filter-Umsetzung:
   - **Parameter filtern serverseitig** → Filter in die URL (`firstEdOffersUrl(product, 'Y'|'N', lang)`), der Parser filtert trotzdem nach (Schutz, falls Cardmarket den Parameter still ignoriert).
   - **Parameter wirken nicht** → nur `isFirstEd` in die URL, Sprache und Zustand filtert der Parser aus den Zeilen.
   Beide Wege enden im selben reinen Parser; nur die URL unterscheidet sich.

Kommt bei der Messung heraus, dass die Angebotsliste nicht lesbar ist (z. B. nur per Nachladen), stoppt die Umsetzung und der Nutzer entscheidet neu.

## 4. Preisregel

```
offers(page)  = Angebote der Seite mit sprache == printing.language und zustand ∈ {MT, NM, EX}
robust(page)  = |offers| >= 3 ? median(die bis zu 5 günstigsten offers) : null
ratio         = robust(Y) / robust(N)
factor        = robust(N) != null && robust(Y) != null ? clamp(round4(ratio), 1, 10) : null
price_first_ed = Trigger, unverändert: factor != null && price != null ? round2(price × factor) : null
```

- **Median der bis zu 5 günstigsten:** Bei 3 oder 4 Angeboten der Median dieser 3/4 (bei gerader Anzahl Mittel der beiden mittleren), ab 5 der Median der 5 günstigsten. Ein einzelner Ausreißer nach unten (Nenner) oder oben (Zähler) verschiebt den Wert nicht mehr.
- **Mindestanzahl 3 je Seite.** Weniger → `factor = NULL` → die 1. Auflage wird mit dem Basispreis bewertet. Lieber kein Aufschlag als ein erfundener; diese Lücke soll später die eBay-Spec („zuletzt verkauft") füllen.
- **Untergrenze 1** wie in G4 (1st Ed nie weniger wert als Basis).
- **Obergrenze 10:** Sicherheitsnetz gegen Parser- und Datenfehler. Echte Aufschläge (z. B. frühe 1st-Ed-Sets) können hoch sein; darum keine niedrigere Grenze.
- **Sprache:** `cards.language` (DE, EN, …) über eine feste Zuordnung auf Cardmarket. Sprachen ohne Cardmarket-Gegenstück (z. B. KR, Preise kommen aus k-tcg) → Printing ist **kein Kandidat** (Filter in `firstEdCandidates`).
- **Zustand EX oder besser:** Schlechtere Zustände drücken sonst den Nenner; der Zustandsfaktor des eigenen Exemplars wird ohnehin separat angewendet.
- Angebotspreise sind Stückpreise; die Menge pro Zeile spielt keine Rolle.

**Plausibilitäts-Beispiel (MAMO-DE020, Messung G4):** Ab N 55,00 €, Ab Y 58,00 € → bisher ×1,05; G4b soll in derselben Größenordnung landen. SDJ-G001 muss deutlich unter ×9,50 fallen oder mangels Angeboten NULL werden.

## 5. Umsetzung

**`cardmarket-parse.cjs` (rein, getestet):**
- `CM_LANGUAGE_IDS` (Code → Cardmarket-Id/Sprachname, laut Messung), `GOOD_CONDITIONS = ['MT','NM','EX']`.
- `parseOffers(rows)` → `[{ price, condition, language }]`; Preis über das bestehende `parseEuro`; Zeilen ohne lesbaren Preis fallen weg.
- `robustLow(offers, { language, minCount = 3, take = 5 })` → Zahl oder `null`.
- `firstEdFactor(robustN, robustY)` ersetzt die G4-Fassung: `robustN` fehlt/0 oder `robustY` fehlt → `{ write: true, factor: null }`; sonst `{ write: true, factor: clamp(round4(Y/N), 1, 10) }`. (Kein `write: false` mehr für „Nenner fehlt": zu wenig Angebote ist ein gültiges Ergebnis, kein Fehler — siehe §6.)
- `firstEdUrl` wird zu `offersUrl(product, firstEd /* 'Y'|'N' */, language)`.
- `parseFromPrice` bleibt nur, solange der Basis-Durchgang es nutzt; sonst entfernen.

**`cardmarket-scraper.cjs`:**
- Neues `OFFERS_JS` (DOM → rohe Zeilen-Objekte, keine Logik) nach den gemessenen Selektoren; `readOffers` in `deps` wie `readInfoPairs`.
- `runFirstEdPass`: Versions-Seite wie bisher → Produktseite **N** → `robustLow` → Produktseite **Y** → `robustLow` → `firstEdFactor` → schreiben. Pausen wie bisher.
- `firstEdCandidates`: zusätzlich `language` mit Cardmarket-Gegenstück.

**`copies-schema.cjs` (einmalige Migration, neue Funktion `resetFirstEdFactorsOnce(db)`, aufgerufen in `database.cjs` nach `reconcileCopies`, wo `settings` sicher existiert):** `UPDATE cards SET cm_first_ed_updated_at = NULL WHERE cm_first_ed_updated_at IS NOT NULL`, abgesichert über einen Merker in `settings` (`first_ed_factor_v2_reset = 1`), damit sie genau einmal läuft. Die alten Faktoren bleiben bis zur Neuberechnung stehen (keine Lücke im Gesamtwert); der Poller rechnet 2 pro Lauf nach, der Knopf „Cardmarket" alle auf einmal.

## 6. Fehlerfälle

| Fall | Schreiben |
|---|---|
| Cloudflare-Prüfung, Exception | nichts; nächster Lauf |
| keine Versionszeile / kein Produkt-Link | nur Zeitstempel (wie G4-Ruling) |
| Seite N oder Y geladen, aber < 3 passende Angebote | `factor = NULL` + Zeitstempel → Basispreis, 7 Tage Ruhe |
| Angebotstabelle auf einer der beiden Seiten **nicht vorhanden** (Markup geändert?) | Faktor **unverändert**, nur Zeitstempel (wie G4-Ruling, sonst belegt der Kandidat dauerhaft die Poller-Plätze), `errors++` und Log-Zeile — ein Markup-Bruch setzt so nie still Faktoren auf NULL |
| Tabelle vorhanden, aber leer (es gibt schlicht keine passenden Angebote) | gilt als „< 3 Angebote" → `factor = NULL` + Zeitstempel |
| Verhältnis > 10 | Faktor 10 + Log-Zeile mit beiden Werten (Beobachtung) |
| Sprache ohne Cardmarket-Gegenstück | kein Kandidat |

## 7. Tests

- `parseOffers`: Preisformate, fehlender Preis, unbekannter Zustand/Sprache.
- `robustLow`: 0/2 Angebote → null; genau 3; gerade Anzahl (4) → Mittel; > 5 nimmt nur die 5 günstigsten; Ausreißer unten/oben verschiebt nicht; Sprach- und Zustandsfilter.
- `firstEdFactor`: Untergrenze 1, Obergrenze 10, Rundung 4 Stellen, Nenner/Zähler null.
- `offersUrl`: Y/N, mit/ohne Sprachparameter (je nach Messergebnis).
- `parseOffers` gegen die beim Messversuch im echten Fenster erzeugte `OFFERS_JS`-Ausgabe (JSON-Fixtures; die Tests laufen mit `ELECTRON_RUN_AS_NODE`, also ohne DOM — `OFFERS_JS` selbst bleibt reine Extraktion ohne Logik und wird im Messversuch und in der Abnahme live geprüft).
- `runFirstEdPass` mit gestubbtem Fenster (bestehende `cardmarket-first-ed.test.cjs` anpassen): Treffer, zu wenige Angebote → NULL + Stempel, beide Listen leer → nichts geschrieben, Challenge, Obergrenze.
- `firstEdCandidates`: KR fällt heraus.
- Migration: setzt Zeitstempel einmal zurück, zweiter Start lässt sie stehen; Faktoren bleiben.
- Bestehende Bewertungs-, Trigger- und Sync-Tests bleiben unverändert grün.

## 8. Einspiel-Reihenfolge

Nur Installer (nicht aus einem Junction-Worktree bauen). Kein SQL, keine Edge Function, keine APK.

## 9. Abnahme

1. Installer installiert; App startet, Migration läuft (Zeitstempel zurückgesetzt).
2. Knopf „Cardmarket" → 1st-Ed-Durchgang läuft durch.
3. **SDJ-G001:** Faktor plausibel (Nutzer vergleicht mit Cardmarket: Angebote DE, EX+, mit/ohne 1. Auflage) oder keine 1st-Ed-Zeile mehr (zu wenig Angebote).
4. **MAMO-DE020:** Faktor in der Größenordnung von G4 (~×1,05).
5. Gesamtwert ändert sich entsprechend; nach dem Sync zeigt das Handy dieselbe Preiszeile.

## 10. Nicht drin

- eBay „zuletzt verkauft" als zweite Quelle bzw. Ausweichquelle — eigene Spec, wartet auf die Freischaltung von `buy.marketplace.insights`.
- Grund-Anzeige bei fehlendem Faktor („zu wenig Angebote") — bräuchte eine gespiegelte Spalte und Handy-Änderungen; kommt mit der eBay-Spec.
- Sprach-/Zustandsfilter für den **Basis**-Preis (Trend bleibt sprachübergreifend).
- 1st-Ed-Verlauf, -Alarme.

## 11. Risiken

- **Markup der Angebotsliste** ändert sich → §6 verhindert stilles Nullsetzen; Durchgang bleibt isoliert vom Basis-Durchgang.
- **Seltene Drucke** bekommen häufiger keinen Faktor als bisher → bewusst (konservativ); eBay soll das später auffangen.
- **Lazy-Load:** Liefert die Seite weniger als 5 Zeilen ohne Nachladen, reicht das trotzdem (sortiert nach Preis, wir brauchen nur die günstigsten).
- **Cloudflare:** gleiche Seitenzahl wie G4, also kein zusätzliches Risiko.
