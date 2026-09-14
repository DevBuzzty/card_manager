# Spec G — Nachtrag: Aufteilung in G1–G4 und G1 „Preisverlauf & Bewegungen"

**Datum:** 2026-09-14
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-g-portfolio-pro-design.md`
**Grund:** Die Fassung vom 5. September entstand vor B, D4, dem Ladewege-Fix und dem Android-Zwischenspeicher. Mehrere Annahmen stimmen nicht mehr, einige Lücken waren nicht sichtbar, und der Umfang ist für einen Plan zu groß.

---

## 1. Was sich seit dem 5. September geändert hat

| Annahme in Spec G | Stand am 2026-09-14 |
|---|---|
| §5.3: `price_history` bekommt `variant`, PK-Migration nötig | **Bereits gebaut** (lokal `copies-schema.cjs`, Cloud `price_history_schema.sql`), `variant` ist im PK. Geschrieben wird nur `'base'`. Die PK-Migration entfällt. |
| §5.3: `cards.price_first_ed`, `cm_first_ed_updated_at` anlegen | **Bereits angelegt** (lokal `copies-schema.cjs`, Cloud `card_copies_schema.sql`); `price_first_ed` steht in `MIRROR_COLS`. Niemand schreibt sie. |
| §5.3: `sealed_value` an `portfolio_history`/`portfolio_snapshots` | **Bereits angelegt**, von keinem Schreiber gesetzt. |
| §4/§9: Bewegungen am Handy per RPC `portfolio_movers`, gewichtet mit Zustandsfaktoren in SQL | **Überholt.** Das Handy hält seit dem Zwischenspeicher Karten und Exemplare im Speicher (`CollectionStore`). Eine SQL-Gewichtung wäre die dritte, unmarkierte Kopie von `condition-factors.json`. Die RPC liefert nur noch Referenzpreise, gerechnet wird am Gerät (§4.3). |
| §11: „Desktop-SQL und RPC liefern dieselben Top-Listen" | **Entfällt** — es gibt nur noch eine Regel, als JS/Kotlin-Zwilling. |
| §8: Sealed „synchronisiert wie `card_copies`" | Am Desktop weiter ein Sync-Strom; am Handy genügt ein `ListCache` in `SideStores` (G3). |
| §7.1: „Preis-Alerts" | Die Desktop-Seite `Deals` heißt heute schon „Deals & Preis-Alerts" (Marktplatz-Angebote). Die Benennung klärt G2. |
| §7.4: „Default an, wenn Auto-Scraper an" | `cm_auto_enabled` existiert als Setting, hat aber keinen Schalter in `Settings.jsx`. Klärt G4. |

## 2. Neu entdeckte Lücken

1. **Quellenwechsel sind keine Marktbewegung.** In `price_history` mischen sich `ygoprodeck`, `cm_bulk`, `cm_scrape`, `cloud`, `manual`. Ein Printing, das von YGOPRODeck zu Cardmarket wechselt, springt ohne Marktbewegung. Regel in §4.2.
2. **Die erste Bewegung geht verloren.** `recordPrice` schreibt nur bei Änderung und nur den neuen Preis; seit Spec A wurde nichts vorab eingetragen. Ohne Gegenmaßnahme hat die erste Änderung kein „Damals". Lösung in §4.2 (Startzeile).
3. **Kurzer Verlauf.** Historie existiert seit 2026-09-05. 30-Tage-Bewegungen frühestens ab Oktober; Leerzustände müssen ehrlich sein.
4. **Desktop-Wertverlauf lückenhaft.** `portfolio_history` schreiben nur YGOPRODeck-Poller und „Alle aktualisieren", nicht Bulk-Lauf, Scraper und manueller Preis.
5. **Handy-Snapshot-Fehler.** `SnapshotsRepository.loadSnapshots` fragt `order=day.asc&limit=120` — ab 120 Tagen die *ältesten* Tage. Snapshots liegen nur in `remember`, Pull-to-refresh lädt sie nicht.
6. **Zwei Snapshot-Schreiber.** Desktop-Sync und Handy-Start schreiben beide `portfolio_snapshots` desselben Tages. Jede Änderung an der Gesamtsumme (G3 Sealed, G4 1st Ed) muss beide gleichzeitig umstellen.
7. **1st-Ed-Scraper ohne gesicherten Weg** zur Produktseite: Bulk-aufgelöste Printings haben `cm_product_id`, aber kein `cm_url`; `isFirstEd=Y` ist ungeprüft. G4 beginnt mit einem Messversuch.
8. **Sealed-Produktliste:** Katalog (wöchentlich, `CatalogDb`-Schema v2) oder Cloud-Tabelle aus `products_nonsingles_3.json` per Edge Function. Entscheidet G3.

## 3. Aufteilung und Reihenfolge

| Teil | Inhalt | Warum an dieser Stelle |
|---|---|---|
| **G1 Preisverlauf & Bewegungen** | dieser Nachtrag, §4 | Nutzt nur vorhandene Daten, fast ohne SQL; legt die Regeln fest (Quellenfamilie, Referenzpreis, Leerzustände), auf denen G2 aufbaut. |
| **G2 Preis-Alarme** | Spec G §5.4, §6.3, Alarm-Zeile, Start-Karte, Einstellungen | `global_move` ist eine Bewegung über einer Schwelle — gleiche Regel, gleiche Referenzabfrage. |
| **G3 Sealed-Bestand** | Spec G §5.1–5.2, §6.1, Sealed-Ansichten, `sealed_value` | Größter Umbau (Sync-Strom, Produktliste), unabhängig von G1/G2. |
| **G4 Erste-Auflage-Preis** | Spec G §6.2, §5.5, 1st-Ed-Anzeige | Höchstes Risiko (Cardmarket), ändert die Bewertung erneut — direkt nach G3, das die Gesamtsumme ohnehin anfasst. |

Nutzerentscheidung 2026-09-14: **G1 → G2 → G3 → G4.**

---

## 4. G1 — Preisverlauf & Bewegungen

### 4.1 Umfang

**Drin:** Preisverlauf pro Printing im Kartendetail (beide Geräte, 30 · 90 · 365 Tage, nur Linie „Basis"); Gewinner/Verlierer über 7 und 30 Tage auf Start (Top 3/3) und in Insights (Top 10/10); Aufteilung nach Wert und neu nach Binder; Wertverlauf-Reparaturen (§4.4); Insights als Unterseite von Start am Handy.

**Nicht drin:** Alarme (G2), Sealed und zweite Chart-Fläche (G3), 1st-Ed-Linie und -Preise (G4). Weiterhin ausgeschlossen: Kaufpreis, realisierte Gewinne, Push.

**Erfolgskriterium:** Eine Karte, deren Cardmarket-Trend sich in den letzten 7 Tagen bewegt hat, steht auf beiden Geräten mit demselben Δ € und Δ % in der Liste. Eine Karte, die nur von YGOPRODeck zu Cardmarket gewechselt hat, steht dort nicht.

### 4.2 Regel: was als Bewegung zählt

Reiner Helfer, **markierter Zwilling**: `desktop/electron/movers.cjs` ↔ `android/.../ml/Movers.kt`, Kopfkommentare nennen sich gegenseitig, beide gegen `docs/fixtures/portfolio/movers.json` getestet.

- **Jetzt** = `cards.price`.
- **Damals** = die letzte `price_history`-Zeile mit `variant = 'base'` und `day ≤ heute − N` (N ∈ {7, 30}). „Heute" ist das **UTC-Datum** auf allen Geräten.
- **Quellenfamilie:**
  - Damals aus `source`: `cm_bulk`, `cm_scrape`, `cloud` → `cm`; `ygoprodeck` → `ygo`; `manual` → `manual`; alles andere → unbekannt.
  - Jetzt aus `price_locked`: 1 → `cm`, 0 → `ygo`, 2 → `manual`.
  - Das Printing zählt nur, wenn beide Familien gleich und nicht `manual` (und nicht unbekannt) sind. Ein Hin-und-zurück-Wechsel innerhalb des Fensters wird bewusst nicht erkannt.
- **Ausgeschlossen:** kein Damals (nie als 0 % gezeigt); `price` null oder ≤ 0; Damals-Preis ≤ 0; keine lebenden Exemplare; Δ = 0 nach Rundung auf Cent.
- **Kennzahlen pro Printing:** `old`, `new`, `deltaUnit = new − old`, `pct = deltaUnit / old`, `weight = Σ conditionFactor(copy.condition)` über lebende Exemplare, `deltaHolding = deltaUnit × weight`, `copies` = Anzahl lebender Exemplare.
- **Listen:** Gewinner = `deltaHolding > 0` absteigend; Verlierer = `deltaHolding < 0` aufsteigend; bei Gleichstand nach Printing-Schlüssel; Top N.
- **Status** neben den Listen: `no_reference` (kein einziges eigenes Printing hat ein Damals) oder `ok`. Aus `no_reference` folgt der Text „Noch nicht genug Verlauf — Bewegungen erscheinen ab TT.MM." (TT.MM. = frühester Tag, an dem eine vorhandene Zeile alt genug wird).
- **Rarity-Fallback** beidseitig `'Unknown'`, wie in `price-history.cjs`.

**Startzeile gegen die verlorene erste Bewegung:** Beim ersten Start nach G1 schreibt der Desktop einmalig für jedes Printing mit lebenden Exemplaren, `price > 0` und **ohne** `base`-Zeile eine Zeile mit heutigem Tag, aktuellem Preis und `source` aus `price_locked` (1 → `cm_bulk`, 0 → `ygoprodeck`, 2 → `manual`). Geschützt durch Setting `price_history_seeded`; idempotent. Der normale Sync schiebt die Zeilen hoch. Kehrseite: 7-Tage-Bewegungen für bisher unbewegte Printings erst 7 Tage nach dem Einspielen.

### 4.3 Datenwege

**Desktop (lokal):**
- `get-movers(days)` — Referenzabfrage (je Printing letzte `base`-Zeile ≤ Stichtag) + `movers.cjs` gegen Karten und lebende Exemplare. Liefert `{ status, firstDay, winners, losers }` (Top 10; Start nimmt die ersten 3).
- `get-card-history({ id, set_code, language, rarity, days })` — `base`-Zeilen des Printings, maximal 365 Tage, plus die letzte Zeile vor dem Fenster (für den Stufenanfang).
- Beide Kanäle in `main.cjs` **und** `preload.cjs`.

**Handy:**
- Neue Cloud-RPC `public.price_reference(days integer)` (`security invoker`, `stable`, `grant execute … to authenticated`): `select distinct on (card_id, set_code, language, rarity) … where variant = 'base' and day <= current_date - days order by …, day desc`. Liefert Schlüssel, `day`, `price`, `source`. Keine Gewichtung, keine Familienregel im SQL.
- `cloud/PriceHistoryRepository.kt`: `reference(days)` (RPC-POST mit denselben Headern und `executeWithReauth` wie die übrigen Repositories) und `history(printing, days)` (REST auf `price_history`, gefiltert auf den Schlüssel).
- `SideStores`: zwei `ListCache` `reference7`, `reference30`. Neu geladen nur, wenn sich das UTC-Datum seit dem letzten Laden geändert hat (reiner Helfer, getestet), und bei Pull-to-refresh. **Seitenwechsel laden nicht.**
- `SideStores`: Chart-Zwischenspeicher pro Printing nach dem Vorbild der Deck-Karten-Caches, begrenzt auf die letzten 20 Printings. Zweites Öffnen zeigt sofort den gemerkten Stand und gleicht im Hintergrund ab.
- `MoversMemo` merkt das Ergebnis nach Identität über (Karten, Exemplare, Referenzliste) und rechnet auf `Dispatchers.Default`, wie `DashboardMemo`.

### 4.4 Wertverlauf reparieren

**Handy:**
- `SideStores.snapshots` als `ListCache`; Pull-to-refresh auf Start lädt ihn.
- Abfrage `order=day.desc&limit=1000`, am Gerät umgedreht. „Alles" = letzte 1.000 Tage.
- Das Schreiben des Tageswerts beim Start-Besuch bleibt (bewusst offen seit dem Zwischenspeicher); danach wird der heutige Punkt per `update {}` in den Cache eingetragen statt die Liste neu zu laden.

**Desktop:**
- Helfer `recordPortfolioValue(db)` mit der bestehenden 0,50-€-Schwelle ersetzt die zwei `INSERT INTO portfolio_history` in `main.cjs` und wird nach **jedem** Preisschreiber aufgerufen: YGOPRODeck-Poller, „Alle aktualisieren", Bulk-Lauf, Scraper, manueller Preis.

**Bewusst nicht angeglichen:** Desktop-Kurve aus lokaler `portfolio_history` (mehrere Punkte/Tag), Handy aus `portfolio_snapshots` (ein Punkt/Tag). Gesamt-Δ können um Cent abweichen; das Erfolgskriterium betrifft Bewegungen pro Printing.

### 4.5 Stufenlinie

Die Historie speichert nur Änderungen; ein Preis gilt bis zur nächsten Zeile. Reiner Helfer, **markierter Zwilling** `desktop/src/utils/priceSteps.js` ↔ `android/.../ml/PriceSteps.kt`, beide gegen `docs/fixtures/portfolio/price-steps.json`:
- Eingabe: Zeilen (aufsteigend), Fenster in Tagen, heute (UTC).
- Ausgabe: Stufenpunkte im Fenster; Anfangswert aus der letzten Zeile vor dem Fenster, falls vorhanden; letzter Wert bis heute verlängert; Wechselmarken an jedem Tag, an dem sich die Quellenfamilie gegenüber der Vorzeile ändert; Leerzustand `none` (0 Zeilen) oder `flat` (1 Zeile, mit Tag und Preis).

### 4.6 Ansichten Desktop

- **Start:** Karte **Bewegungen · 7 Tage** unter der Wert-Karte; Top 3 Gewinner links, Top 3 Verlierer rechts; Zeile = Miniatur, Name, Set-Code · Rarity, Δ € Bestand, Δ %; Klick → Karten-Panel; „Alle" → `/insights` Reiter Bewegungen.
- **Insights:** Reiter **Wert · Bewegungen · Aufteilung**.
  - Bewegungen: Umschalter 7 Tage · 30 Tage; Gewinner und Verlierer Top 10; Spalten Name, Printing, alt → neu, Δ € Bestand, Δ %, Exemplare; Zeilenklick → Panel.
  - Aufteilung: Umschalter **Anzahl · Wert**. Unter „Wert" Dimensionen Typ · Set · Rarity · Binder (mit Topf „Nicht einsortiert"), Kuchen + Liste. Die bisherigen Zählbalken bleiben unter „Anzahl".
  - Wert: „Top Performers" heißt **„Wertvollste Bestände"**, sonst unverändert.
- **Karten-Panel:** unter der Preiszeile jedes Printings `PriceHistoryChart` (recharts, Stufenlinie, Chips 30 · 90 · 365), gestrichelte senkrechte Linie mit „Quelle: Cardmarket" bzw. „Quelle: YGOPRODeck"/„Quelle: manuell" an Wechselmarken. Leer: „Noch kein Verlauf"; eine Zeile: „Seit TT.MM. unverändert 12,40 €".
- Neue Komponenten `PriceHistoryChart.jsx`, `MoversList.jsx` (von Start und Insights geteilt).

### 4.7 Ansichten Handy

- **Start:** Karte **Bewegungen · 7 Tage** direkt unter „Gesamtwert", Gewinner und Verlierer untereinander (je 3); Zeile = Name, Set-Code · Rarity, Δ € Bestand, Δ %; Tippen → Kartendetail; „Alle" → Insights. Die vier Aufteilungen (Rarity, Typ, Set, Attribut) ziehen nach Insights; an ihrer Stelle „Aufteilung ansehen →". „Teuerste Karten", Deals, Set-Fortschritt bleiben.
- **Insights:** neue Route `insights`, Unterseite von Start mit Zurück-Pfeil, kein Reiter in der unteren Leiste.
  - Bewegungen: Umschalter 7 Tage · 30 Tage, Top 10 je Liste, zusätzlich alt → neu und Exemplare.
  - Aufteilung: Umschalter **Anzahl · Wert** (Sortierung und Balkenlänge); Dimensionen Typ · Set · Rarity · Attribut · **Binder** (mit „Nicht einsortiert"). Die Binder-Aufteilung wird in `DashboardMemo` mitgerechnet.
- **Kartendetail:** unter der Preiszeile jedes Printings `ui/PriceHistoryChart.kt` (Canvas, Stil `ValueChart`, Chips 30 · 90 · 365), Wechselmarken und Leertexte wie am Desktop.
- **Keine Rechnung in der Komposition:** Bewegungen über `MoversMemo`, Aufteilungen über `DashboardMemo`, Stufen über `PriceSteps` im `remember` mit Identitätsschlüssel.

### 4.8 Lade-, Leer- und Fehlerzustände

| Lage | Anzeige |
|---|---|
| Referenzen laden erstmals | graue Platzhalterzeilen, nie „0,00 €" |
| `status = no_reference` | „Noch nicht genug Verlauf — Bewegungen erscheinen ab TT.MM." |
| Referenzen da, keine Bewegung | „Keine Bewegungen in 7 Tagen" bzw. „… 30 Tagen" |
| RPC fehlt / offline, nie geladen | „Bewegungen konnten nicht geladen werden — zum Aktualisieren ziehen" |
| RPC scheitert, alter Stand vorhanden | alter Stand + kleiner Hinweis (Verhalten von `ListCache`) |
| Chart lädt erstmals | „Verlauf lädt …" |
| Chart scheitert ohne Stand | „Verlauf nicht verfügbar" |

### 4.9 Tests

- **Zwilling Bewegungen** (`movers.cjs`, `Movers.kt`, Fixture `movers.json`): Familienwechsel, `manual`, unbekannte Quelle, kein Damals, Δ = 0, Stichtag genau heute − N, Gewichtung mit Zustandsfaktoren, gelöschte Exemplare, Rundung auf Cent, Gleichstand-Reihenfolge, Top N, `no_reference` + `firstDay`.
- **Zwilling Stufen** (`priceSteps.js`, `PriceSteps.kt`, Fixture `price-steps.json`): Fensterschnitt mit Anfangswert, Verlängerung bis heute, Wechselmarken, `none`, `flat`.
- **SQLite** (Electron-Node): Referenzabfrage (letzte Zeile ≤ Stichtag, `first` ignoriert), Startzeile (nur fehlende, Familie aus `price_locked`, ohne Preis keine, idempotent), `recordPortfolioValue` (Schwelle), `get-card-history` (Anfangszeile vor dem Fenster).
- **Kotlin:** Snapshot-Abfrage (desc, limit, Umkehr), Tageswechsel-Regel für Referenzen, `MoversMemo` merkt nach Identität, Chart-Cache-Grenze 20. Für jeden Schutz-Test Nachweis, dass er ohne den Schutz scheitert (`backgroundScope` wird von `advanceUntilIdle` nicht getrieben).
- Desktop-Lint bleibt bei genau 5 Fehlern.

### 4.10 Einspielen

1. Desktop-Build installieren — schreibt Startzeilen, Sync schiebt sie hoch.
2. Nutzer spielt `supabase/price_reference_rpc.sql` ein.
3. Nutzer spielt `supabase/price_history_seed.sql` ein (Absicherung; gleiche Regel wie §4.2, `on conflict do nothing`).
4. APK aufs Dev-Handy, Abnahme auf beiden Geräten.

Die Abnahme prüft 7 Tage mit echten Daten; 30 Tage und Leerzustände über Fixtures und den sichtbaren Hinweis „erscheinen ab TT.MM.".

### 4.11 Betroffene Dateien

**Desktop main:** neu `electron/movers.cjs` (+ Test), `electron/portfolio-value.cjs` (`recordPortfolioValue`, + Test), Startzeile in `electron/price-history.cjs` (+ Test); `main.cjs` (IPC, Preisschreiber rufen `recordPortfolioValue`, Startzeile beim Start), `preload.cjs`.
**Desktop renderer:** neu `src/utils/priceSteps.js` (+ Test), `src/components/PriceHistoryChart.jsx`, `src/components/MoversList.jsx`; geändert `Start.jsx`, `Insights.jsx`, `Portfolio.jsx` (Umbenennung), `Statistics.jsx` bzw. neue Wert-Aufteilung, `CardDetailPanel.jsx`.
**Supabase:** neu `price_reference_rpc.sql`, `price_history_seed.sql`.
**Android:** neu `ml/Movers.kt`, `ml/PriceSteps.kt`, `cloud/PriceHistoryRepository.kt`, `ui/InsightsScreen.kt`, `ui/MoversSection.kt`, `ui/PriceHistoryChart.kt` (+ Tests); geändert `CardRow.kt` (`priceLocked`), `CollectionRepository.kt` (Parse), `SideStores.kt`, `SnapshotsRepository.kt`, `StartScreen.kt`, `Dashboard.kt` (Binder-Aufteilung), `CardDetailScreen.kt`, `AppNav.kt`.
**Fixtures:** `docs/fixtures/portfolio/movers.json`, `docs/fixtures/portfolio/price-steps.json`.

### 4.12 Ergänzung nach dem Abschlussreview (2026-09-14)

- **Cloud-Verlauf zum Desktop.** Die tägliche Cloud-Aktualisierung schreibt `price_history`-Zeilen mit `source = 'cloud'`. Der Desktop holt sie im Sync-Zyklus ab (Schritt vor dem Push, `INSERT OR IGNORE`, Stichtag `sync_price_history_last_pull`, Helfer `mergeRemotePriceHistory`). Damit sehen beide Geräte dieselben Damals-Preise, auch nach Tagen ohne Desktop.
- **„Jetzt" am Desktop.** `cards.price` gleicht der Desktop weiter über seinen täglichen Bulk-Lauf an (30 s nach dem Start). Das Erfolgskriterium aus §4.1 gilt, sobald der Desktop nach dem letzten Preiswechsel einmal gelaufen ist.
- **Startzeilen normalisieren den Schlüssel** wie `recordPrice` (`set_code`/`rarity` leer oder NULL → `Unknown`, `language` leer oder NULL → `DE`), lokal und in `price_history_seed.sql`.
- **Sichtbare Rückfälle:** Gespeichertes `Unknown` bei Set-Code und Rarität heißt auf beiden Geräten „Unbekannt"; Δ % hat auf beiden Geräten ein deutsches Dezimalkomma.
- **Desktop-Chart:** Eine Stufenreihe mit weniger als zwei Punkten zeigt „Noch kein Verlauf" (wie am Handy).

## 5. Was unverändert gilt

Spec G §3 (Nicht-Ziele), §5.4–§5.5, §6, §7.2 Sealed, §7.3 Alarm-Zeile und 1st-Ed-Preiszeile, §7.4 und §8 gelten für G2–G4 fort, vorbehaltlich der dort anstehenden Nachträge und der Korrekturen in §1 dieses Dokuments.
