# „Supercharge"-Programm — Übersicht der Specs A–H

**Datum:** 2026-09-05
**Zweck:** Index und Reihenfolge für die acht am 2026-09-05 im Brainstorming abgesegneten Specs. Jedes Spec bekommt einen eigenen Implementierungsplan (`docs/superpowers/plans/`) und einen eigenen Umsetzungszyklus.

## Ausgangslage

Konkurrenzvergleich (Dragon Shield, Collectr, Neuron, YuScan, YGOPRODeck): die App liegt bei Preisen vorn (Cardmarket-Trend pro Printing, Wishlist→Deal-Watch), verliert aber bei Edition/Zustand, Organisation, Preisverlauf pro Karte, Sealed, Deckbuilder-Tiefe, Import, Verkauf und Bedienung (Sprachmix, „Mehr"-Rumpelkammer, kein Back-Stack, Entwickler-Details im Erststart).

## Die Specs

| Spec | Datei | Kern | Setzt voraus |
|---|---|---|---|
| **A** Datenmodell-Genauigkeit | `2026-09-05-spec-a-copies-edition-condition-design.md` | `card_copies` (UUID pro Exemplar) mit Edition + Zustand, `quantity` als Trigger-Cache, feste Zustandsfaktoren, `price_history`, Desktop-only-Migration, Chip-Bedienung ohne Pflichtdialog | – |
| **C** Navigation + Layout | `2026-09-05-spec-c-navigation-layout-design.md` | Gemeinsame Landkarte Start · Scannen · Sammlung (Karten · Binder · Wunschliste · Sets · Decks) · Deals; Navigation Compose + Hash-Router; Detail als Seitenpanel/Overlay-Route; Scan-Sheet; Login nur E-Mail/Passwort; Wortschatz Deutsch | – (zeigt A-Felder, wenn vorhanden) |
| **B** Organisation | `2026-09-05-spec-b-binder-organisation-design.md` | `containers` (Binder/Box/Deckbox), Standort Seite/Fach am Exemplar, Tags + Notiz, Einsortier-Modus mit Scanner, Binder-Ansicht als Seiten | A, C |
| **D** Scan-Flow | `2026-09-05-spec-d-scan-flow-design.md` | Offline-Katalog (+ Modell-Lieferung), sprachneutrales Set-Code-Matching, Ampel, Edition automatisch, **Speed-Scan-Modus**, layout-abhängige OCR-Zonen, OCR-Messkorb + Gate | A, C |
| **E** Deckbuilder Pro | `2026-09-05-spec-e-deckbuilder-pro-design.md` | Deck ↔ Deckbox, gebraucht/verfügbar/in der Box, Fehlende + Kosten → Wunschliste, Legalität (Banlist aus Katalog), Handsimulation, Import YDK/YDKE/Text/URL | A, B, C, D |
| **F** Import/Export | `2026-09-05-spec-f-import-export-design.md` | Profile Dragon Shield / YGOPRODeck / Card Dex / Generisch, Auflösung ohne Raten, Vorschau mit Ampel, Export in Fremdformate | A, B, D |
| **G** Portfolio Pro | `2026-09-05-spec-g-portfolio-pro-design.md` | Sealed-Bestand, Karten-Charts, Gewinner/Verlierer, Alerts auf eigene Karten, 1st-Edition-Aufschlag | A, B, C, D |
| **H** Verkaufen | `2026-09-05-spec-h-selling-design.md` | Duplikate über Playset mit Vorschlag, `for_sale` als Zustand am Exemplar | A, B, C, F |

## Empfohlene Reihenfolge

1. **A** — Fundament, jede spätere Ansicht zeigt Exemplare.
2. **C** — sichtbarer Umbau, mit A-Feldern im Kopf; Reihenfolge A→C, damit Panel/Sheets nur einmal gebaut werden.
3. **D** — Katalog + Speed-Scan (der größte Alltagsgewinn nach C). Voraussetzung: P1–P7 am Gerät verifizieren.
4. **B** — Binder + Einsortieren (nutzt D-Scan-Shell).
5. **G** — Portfolio Pro.
6. **E** — Deckbuilder Pro (braucht B-Deckbox, D-Banlist).
7. **F** — Import/Export.
8. **H** — Verkaufen.

D vor B ist die einzige Abweichung von der Buchstabenfolge: der Einsortier-Modus in B baut auf der Scan-Shell und der Katalog-Auflösung aus D auf.

## Querschnitts-Änderungen an A (in späteren Specs beschlossen)

Damit A nicht mehrfach migriert wird, sollten diese Spalten **schon im A-Plan** angelegt werden (leer, ohne UI):

| Spalte | Tabelle | Beschlossen in |
|---|---|---|
| `container_id`, `page`, `slot`, `tags`, `note` | `card_copies` | B §5.2 |
| `needs_review`, `review_reason` | `card_copies` | D §7a.3 |
| `for_sale` | `card_copies` | H §5 |
| `variant` (`base`/`first`) im PK | `price_history` | G §5.3 |
| `price_first_ed`, `cm_first_ed_updated_at` | `cards` | G §5.3 |
| `sealed_value` | `portfolio_history` / `portfolio_snapshots` | G §5.3 |

Alle sind additiv; nur `price_history.variant` ändert einen Primärschlüssel und gehört deshalb von Anfang an hinein.

## Gemeinsame Regeln (gelten für alle Specs)

- **Nie Pflichtdialoge im Scan-Fluss.** Standards setzen, Ampel zeigen, Nachprüfen-Liste statt Nachfrage.
- **Sync-Muster:** UUID-Schlüssel, `updated_at`-Cursor, Soft-Delete, Echo-Skip; Reihenfolge Cards → Containers → Copies → Sealed → Historien → Snapshot. Nie `DELETE`.
- **Cloud-SQL** spielt der User im Supabase-Dashboard ein; Migrationsdateien liegen unter `supabase/`.
- **Kein Settings-Sync.** Was beide Geräte gleich rechnen müssen, ist Konstante im Code oder liegt in der Cloud (Alert-Regeln).
- **Deutsche Set-Codes** nie aus englischen ableiten (DE-vs-G); sprachneutrales Matching liest die Region von der Karte.
- **Tests:** reine Funktionen mit JS- und Kotlin-Tests auf geteilten JSON-Fixtures (`docs/fixtures/`), SQLite-Tests mit dem Electron-Node-Trick, On-Device-Durchgänge als Abschluss jedes Plans.
- **Sprache:** Deutsch durchgehend, Wortschatz in Spec C §4.
