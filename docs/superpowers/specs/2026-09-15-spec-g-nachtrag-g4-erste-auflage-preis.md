# Spec G — Nachtrag G4: Erste-Auflage-Preis

**Datum:** 2026-09-15
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-g-portfolio-pro-design.md` §5.3 (Faktor-Spalte), §5.5, §6.2, §7.3 (1st-Ed-Linie, Preiszeile), §7.4 (Schalter), §8 (Spiegel-Spalten), §10, §11, §12
**Setzt voraus:** G1 (gemergt `4a1ab8b`), G2 (gemergt `554d731`), G3 (gemergt `82d689e`), Echo-Push-Fix (gemergt `6490ec4`).
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-15).

---

## 1. Was sich gegenüber Spec G ändert

| Spec G | G4 |
|---|---|
| §6.2 `price_first_ed` = Ab-Preis mit Filter `isFirstEd=Y` | **Aufschlag als Faktor:** `cm_first_ed_factor` = max(1, Ab mit Filter ÷ Ab ohne Filter); `price_first_ed` = round(price × Faktor, 2). Grund: Ab-Preis und Trend sind verschiedene Preisarten (MAMO-DE020: Trend 73,85 €, Ab mit Filter 58,00 €) — wörtlich umgesetzt wäre die Erste Auflage *weniger* wert. |
| §6.2 `price_history` mit `variant='first'` | **Entfällt.** Eine Zeile nur beim wöchentlichen Scrape, während der Basispreis täglich wandert, ergäbe eine irreführende Treppe. `variant` bleibt im Schema. |
| §7.3 zweite Chart-Linie „Erste Auflage" | **Entfällt** (folgt aus der Zeile oben). |
| §6.2 Produktseite „bekannt über `cm_product_id` bzw. `cm_url`" | Produkt-Link wird bei jedem Durchgang von der Versions-Seite gelesen; keine neue URL-Spalte. |
| §6.2 nur Printings des Basis-Scrapers | Auch Bulk-aufgelöste Printings (`cm_product_id` gesetzt) sind Kandidaten. |
| (nicht vorgesehen) | `price_first_ed` wird von **Triggern** (SQLite und Postgres) aus `price` × Faktor nachgeführt — kein Preisschreiber muss angefasst werden. |
| §7.4 Schalter „Erste-Auflage-Preise scrapen" | **Kein Schalter.** Der Durchgang läuft immer mit dem Cardmarket-Scraper (Auto oder Knopf). |
| §5.5 Bewertung nur als Formel | Regel als markierter Zwilling in vier Fassungen mit gemeinsamer JSON-Fixture. |

**Befunde des Code-Abgleichs (2026-09-15):**
- `cards.price_first_ed` und `cm_first_ed_updated_at` existieren lokal (`copies-schema.cjs`) und in der Cloud (`card_copies_schema.sql`); `price_first_ed` steht in `MIRROR_COLS`. Niemand schreibt sie.
- `price_history.variant` ist im PK; geschrieben wird nur `'base'`; `price-reference.cjs`, `price_reference_rpc.sql` und `evaluate-price-alerts` lesen ausdrücklich nur `base`.
- Das Handy erkennt die Edition beim Scan (`ml/EditionEvidence.kt`).
- Die Bewertung kennt die Edition nirgends. Preis × Zustandsfaktor steht in `valuation.cjs` (`valueOf`, `totalValue`), `copies.cjs#listContainers`, `collection-query.cjs`, `movers.cjs`, `src/utils/valuation.js`, `src/utils/breakdown.js`, `BinderView.jsx`, `CardDetailPanel.jsx`; Handy `cloud/Valuation.kt`, `Dashboard.kt`, `BinderPageScreen.kt`, `BindersScreen.kt`, `ml/BinderBreakdown.kt`, `ml/Movers.kt`, `CardDetailScreen.kt`. Das Handy-Kartenmodell liest `price_first_ed` nicht.
- `cm_auto_enabled` hat seinen Schalter in `CollectionList.jsx`, nicht in den Einstellungen. Beim Nutzer: an, `cm_auto_min_rank = 1`.
- **Bestand (lokale DB, nur gelesen):** 7.441 lebende Exemplare — 1× `first` (MAMO-DE020 Ultra Rare, `cm_product_id` 904608), 1× `limited`, 7.439× `unknown` (Übernahme bei Spec A, 5.–8. September).

**Messversuch Cardmarket (2026-09-15, eingebauter Browser, nichts geschrieben):**

| Produktseite MAMO V1 Ultra Rare | Angebote | Ab (Infokasten) | Trend |
|---|---|---|---|
| ohne Filter | 37/50 First Edition | 55,00 € | 72,33 € |
| `?isFirstEd=Y` | 50/50 First Edition | 58,00 € | 72,33 € |
| `?isFirstEd=N` | 36, 0 First Edition | 55,00 € | 72,33 € |

- `isFirstEd=Y` filtert die Angebote, und der „Ab"-Wert im Infokasten (`.info-list-container`) folgt dem Filter. Trend und Durchschnitte bleiben produktweit.
- Die Versions-Seite (`/Cards/{Name}/Versions`) liefert pro Printing den Link `/Products/Singles/{Expansion}/{Karte}[-V{n}-{Rarity}]`.
- Nach etwa acht schnellen Aufrufen ohne Pause kam die Cloudflare-Prüfung („Nur einen Moment…").

## 2. Umfang

**Drin:** 1st-Ed-Durchgang im Scraper, Faktor-Spalte lokal und in der Cloud, Trigger auf beiden Seiten, editionsbewusste Bewertung an allen Wert-Stellen (Desktop und Handy), Preiszeile im Karten-Detail.

**Nicht drin:**
- Edition für den Altbestand erfassen (Werkzeug „Printing auf 1st Ed setzen", Nachscan). G4 wirkt zunächst nur auf neu gescannte oder von Hand umgestellte Exemplare.
- 1st-Ed-Verlauf, zweite Chart-Linie, 1st-Ed-Alarme und -Bewegungen.
- Sprach- oder Zustandsfilter auf Cardmarket (der Basis-Trend ist ebenfalls sprachübergreifend).
- Neuer Einstellungs-Schalter.

## 3. Preisregel

```
factor         = fromFirst > 0 && fromAll > 0 ? max(1, round4(fromFirst / fromAll)) : null
price_first_ed = factor != null && price != null ? round2(price × factor) : null
```

- `fromAll` = Ab-Preis der Produktseite ohne Filter, `fromFirst` = mit `?isFirstEd=Y`.
- `fromAll` fehlt oder ist 0 → wie „kein Treffer" (nichts schreiben).
- `fromFirst` fehlt (kein Angebot mit Filter) → `factor = NULL`, `price_first_ed = NULL`, `cm_first_ed_updated_at` gesetzt.
- Der Faktor ist per Konstruktion ≥ 1; die Untergrenze schützt gegen Parser- oder Timing-Ausreißer.

## 4. Scraper-Durchgang „Erste Auflage"

**Ort:** `cardmarket-scraper.cjs`, neue exportierte Funktion für den zweiten Durchgang; aufgerufen im Poller (`startCardmarketPoller`) und im manuellen Lauf (IPC des Knopfs „Cardmarket") **nach** dem Basis-Durchgang, im selben `cmRunning`-Schutz, mit demselben Fenster-Muster und derselben Drossel (2–4 s pro Seite). Poller: höchstens **2 Kandidaten** pro Lauf; manuell ohne Grenze.

**Kandidaten** (reine, getestete SQL-/Filter-Funktion): Printings mit
- mindestens einem lebenden Exemplar `edition = 'first'` (Exemplar und Printing `deleted = 0`),
- `rarityRank(rarity) >= minRank` (Poller: `cm_auto_min_rank`, manuell: gewählte Schwelle),
- `COALESCE(price_locked, 0) != 2`,
- `cm_first_ed_updated_at` NULL oder älter als 7 Tage (manuell mit `force` ignoriert, wie der Basis-Durchgang),
- unabhängig von `cm_product_id`.
Reihenfolge: ältestes `cm_first_ed_updated_at` zuerst.

**Pro Kandidat drei Seiten:**
1. Versions-Seite über `resolveUrl(name)`. Die bestehende Auswahl (Set-Code-Präfix ↔ Symbol-Code, bei mehreren Rarity, günstigster; sonst `matchRow` über den Set-Namen) wählt die Zeile; `EXTRACT_JS` liefert zusätzlich den `href` des Produkt-Links. Die Auswahl wird dafür in einen gemeinsamen reinen Helfer gezogen, den Basis- und 1st-Ed-Durchgang nutzen.
2. Produktseite ohne Filter → `fromAll`.
3. Produktseite `?isFirstEd=Y` → `fromFirst`.

**Lesen:** Reiner Parser `parseFromPrice(infoPairs)` über die `dt`/`dd`-Paare des Infokastens, Label „From" oder „Ab", Zahl im Format `1.234,56 €`. Die DOM-Extraktion liefert nur die Paare; der Parser ist mit HTML-/Paar-Fixtures getestet.

**Schreiben:**
- Treffer: `UPDATE cards SET cm_first_ed_factor = ?, cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE <4-Spalten-Schlüssel>`; `price_first_ed` setzt der Trigger (§5).
- Kein Angebot mit Filter: `cm_first_ed_factor = NULL`, Zeitstempel gesetzt.
- Cloudflare-Prüfung, kein Treffer auf der Versions-Seite, kein Produkt-Link, `fromAll` fehlt: nichts schreiben; der nächste Lauf versucht es wieder.
- Keine `price_history`-Zeile.
- Nach mindestens einem geschriebenen Faktor: `recordPortfolioValue(db)` und `price-update` wie beim Basis-Durchgang.

## 5. Nachführen per Trigger (Zwilling)

**SQLite** (`copies-schema.cjs`, additive Migration): Spalte `cards.cm_first_ed_factor REAL`; Trigger `AFTER UPDATE OF price, cm_first_ed_factor ON cards` und `AFTER INSERT ON cards`, der `price_first_ed = CASE WHEN factor IS NOT NULL AND price IS NOT NULL THEN ROUND(price * factor, 2) END` setzt, nur wenn sich der Wert unterscheidet (kein Endlos-Stempeln, `IS NOT` statt `!=` wegen NULL). Einmaliges Nachrechnen beim Migrieren.

**Postgres** (neue Datei `supabase/cards_first_ed_factor.sql`): `alter table public.cards add column if not exists cm_first_ed_factor numeric`; `BEFORE INSERT OR UPDATE`-Trigger, der `NEW.price_first_ed` genauso setzt; einmaliges Nachrechnen.

Beide Trigger tragen einen Zwillings-Kommentar mit Verweis auf den anderen. SQLite ist automatisch getestet; die Cloud-Fassung prüft der Nutzer in der Abnahme per SELECT.

**Sync:** `cm_first_ed_factor` kommt in `MIRROR_COLS` (Push-Payload und lokale Spiegel-INSERTs in `sync.cjs`). `price_first_ed` bleibt darin. `applyRemoteRow` bleibt unverändert (Preise fließen Desktop → Cloud; der Cloud-Lauf setzt `price`, der Cloud-Trigger rechnet den 1st-Ed-Preis mit demselben Faktor).

**Das Rundungsverhalten** beider Seiten ist für positive Werte „kaufmännisch" (SQLite `ROUND`, Postgres `round(numeric, 2)`); die Fixture enthält einen Fall auf ,xx5.

## 6. Bewertung (Zwilling in vier Fassungen)

Regel: `copyValue = conditionFactor(copy.condition) × unitPrice(card, copy)`, mit
`unitPrice = copy.edition == 'first' && card.price_first_ed != null ? card.price_first_ed : (card.price ?? 0)`.

| Fassung | Ort |
|---|---|
| JS main | `valuation.cjs`: `unitPrice(card, copy)`, `valueOf(card, copies)` editionsbewusst, `unitPriceCaseSql(cardAlias, copyAlias)` für SQL |
| SQL | aus `unitPriceCaseSql`: `CASE WHEN cp.edition = 'first' AND c.price_first_ed IS NOT NULL THEN c.price_first_ed ELSE COALESCE(c.price, 0) END` |
| JS Renderer | `src/utils/valuation.js`: `unitPrice`, `valueOf` |
| Kotlin | `cloud/Valuation.kt`: `unitPrice(card, copy)`, `valueOf`; Kartenmodell liest `price_first_ed` |

Gemeinsame Fixture `docs/fixtures/valuation/first-ed.json`: first mit `price_first_ed`, first ohne (fällt auf `price`), unlimited/unknown/limited mit gesetztem `price_first_ed` (ignoriert), Zustand × Edition, `price` NULL, Rundungsfall. Alle drei Test-Suiten (main, Renderer, Kotlin) und ein SQL-Test über `totalValue` lesen sie.

**Umgestellt:** Desktop `valueOf`, `totalValue` (→ Gesamtwert, `recordPortfolioValue`, `syncSnapshot`), `listContainers`, `collection-query.cjs` (Faktorsumme → Summe aus `unitPrice × Faktor`), `breakdown.js`, `BinderView.jsx`, `CardDetailPanel.jsx`; Handy `Valuation.valueOf`, `Dashboard.kt` (Gesamtwert und Tageswert), `BinderPageScreen.kt`, `BindersScreen.kt`, `BinderBreakdown.kt`, `CardDetailScreen.kt`. Desktop- und Handy-Tageswert werden im selben Zug umgestellt (G1 Lücke 6).

**Bleibt beim Basispreis:** `movers.cjs`/`Movers.kt`, `price-reference`, Preis-Alarme — sie vergleichen Marktpreise eines Printings. Die Veränderung auf Start stammt aus den Tageswerten und enthält den Aufschlag automatisch.

## 7. Anzeige

- **Karten-Detail (Desktop `CardDetailPanel.jsx`, Handy `CardDetailScreen.kt`):** Preiszeile bei gesetztem `price_first_ed`: „Basis 73,85 € · 1st Ed 77,87 € (×1,05)"; sonst unverändert. Gruppenwerte rechnen über `valueOf` automatisch mit dem 1st-Ed-Preis.
- Kein Hinweis bei „keine Angebote mit Filter".
- Sammlung, Binder, Start, Insights: keine UI-Änderung, nur Werte.
- Kein neuer Schalter; der Auto-Schalter bleibt in der Sammlung.

## 8. Einspiel-Reihenfolge

1. Nutzer spielt `supabase/cards_first_ed_factor.sql` ein — **vor** dem Installer, sonst scheitert jeder Push an der unbekannten Spalte.
2. Installer (nicht aus einem Junction-Worktree bauen).
3. APK (unabhängig; `price_first_ed` existiert in der Cloud bereits).
Keine Edge Function ändert sich, kein Deploy.

## 9. Fehlerfälle

- Cloudflare-Prüfung → nichts geschrieben, nächster Lauf.
- Versions-Seite ohne passende Zeile oder ohne Produkt-Link → nichts geschrieben.
- `fromAll` fehlt oder 0 → nichts geschrieben.
- Kein Angebot mit Filter → Faktor NULL, Basispreis gilt, 7 Tage Ruhe.
- Letztes 1st-Ed-Exemplar umgestellt oder gelöscht → Faktor bleibt stehen, wirkt nicht mehr (nur `first`-Exemplare nutzen ihn), Printing fällt aus den Kandidaten.
- `price` wird NULL → `price_first_ed` NULL.
- Cardmarket ändert Filterparameter oder Infokasten → nur der 1st-Ed-Durchgang fällt aus (eigener try/catch), Basis-Durchgang unberührt.

## 10. Tests

- `parseFromPrice`: „From", „Ab", Tausenderpunkt, fehlend, andere Labels ignoriert.
- Faktor-Helfer: Untergrenze 1, Rundung auf 4 Stellen, `fromAll` 0/NULL, `fromFirst` NULL.
- Produkt-Link-Auswahl (gemeinsamer Helfer): Einzelzeile ohne Rarity, mehrere mit Rarity, Fallback über Set-Namen — die bestehenden Basis-Fälle bleiben grün.
- Kandidatenauswahl: Edition, Schwelle, `price_locked = 2`, 7-Tage-Frist, `force`, Bulk-Printing zählt, gelöschte Exemplare zählen nicht, Reihenfolge.
- SQLite-Trigger: Preis ändern, Faktor setzen, Faktor leeren, Preis NULL, INSERT mit Faktor, kein Neustempeln bei gleichem Wert (Schutz-Test muss ohne die Bedingung scheitern).
- Bewertungs-Fixture: JS main, JS Renderer, Kotlin; SQL über `totalValue` und `listContainers`.
- Sync: Push-Payload enthält `cm_first_ed_factor`.
- Durchgang mit gestubbtem Fenster: Treffer, kein Angebot mit Filter, Challenge — geschriebene Spalten je Fall.

## 11. Abnahme

1. SQL eingespielt; Installer und APK installiert.
2. Desktop: „Cardmarket" drücken → MAMO-DE020 bekommt `cm_first_ed_factor` und `price_first_ed`; Karten-Detail zeigt „Basis … · 1st Ed … (×…)".
3. Gesamtwert am Desktop steigt um (1st-Ed-Preis − Basispreis) × Zustandsfaktor des Exemplars.
4. Nach dem Sync: Handy-Detail zeigt dieselbe Preiszeile, Handy-Gesamtwert gleich dem Desktop.
5. Nutzer-SELECT in der Cloud: Faktor und `price_first_ed` wie am Desktop; `price` testweise von Hand ändern → `price_first_ed` zieht nach; zurücksetzen.
6. Ein unlimited-Exemplar desselben Printings (falls vorhanden) bleibt beim Basispreis.

## 12. Risiken

- **Cardmarket-Markup** (Infokasten, Filter) ändert sich → Durchgang isoliert, Ausfall betrifft nur 1st-Ed-Preise.
- **Cloudflare** bei vielen Kandidaten → Poller-Grenze 2 pro Lauf; Challenge im Hintergrund still überspringen.
- **Geringe Wirkung heute** (ein Exemplar) — bewusst; Nutzen wächst mit Edition-Erkennung beim Scan.
- **Ab-Preis-Rauschen:** Ein einzelnes billiges Angebot ohne Filter kann den Faktor verzerren; die 7-Tage-Frist glättet nicht. Akzeptiert für G4; Beobachtung in der Abnahme.
