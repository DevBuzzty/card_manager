# Ergebnis-Seite nach dem Einzelfoto + Euro-Preise je Druck – Design

Stand: 2026-10-04 · Status: Entwurf, mit dem Nutzer im Gespräch abgestimmt (Brainstorming 04.10.)

## 1. Ziel

Nach einem Einzelfoto sieht der Nutzer sofort, ohne weiteren Klick:

> „Das ist **Karte X**, **Seltenheit Y**, **1. Auflage**, ca. **Z €**“

dazu die Euro-Preise aller anderen Drucke der Karte. Der Einzelmodus dient **vor allem dem Wert-Prüfen**
(kaufen, tauschen, sortieren), **hin und wieder dem Aufnehmen** (Nutzer, 04.10.).

### Was der Nutzer gesagt hat
- Nach dem Foto fehlen Seltenheit und Auflage der fotografierten Karte.
- Die Preisansicht (€-Knopf) zeigt nur für einige Drucke einen Preis; oben steht ein einziger „Cardmarket-Trend der Karte“.
- Die Ansicht wirkt wie eine nackte Liste und soll schöner werden.

### Abgestimmte Entscheidungen (04.10.)
| Frage | Entscheidung |
|---|---|
| Hauptzweck Einzelmodus | Wert prüfen (a), selten aufnehmen (b) |
| Quelle der Euro-Preise für fremde Drucke | **tagesaktuell aus der Cloud** (B) |
| Umsetzung | **B2**: tägliche Preisdatei in Supabase Storage, Handy lädt sie 1×/Tag, danach offline |
| Grundlayout | **B**: eigene Ergebnis-Seite (ganzer Bildschirm) |
| Wann sie erscheint | **automatisch** nach jedem erkannten Einzelfoto |
| Übernahme in die Sammlung | **nur noch auf Knopfdruck** („In Sammlung +“) |
| Kamera-Bildschirm / Stapel-Liste neu gestalten | **eigener späterer Schritt**, nicht Teil dieser Spec |

## 2. Ist-Zustand (Befund 04.10.)

- Es gibt **keine Ergebnis-Seite**. Nach `fotoAusloesen` (`ui/ScanScreen.kt:521-547`) kommen nur Piepton/Blitz;
  `ScanCapture.onFoto` (`ui/ScanCapture.kt:388-399`) schickt die Karte sofort an den PC oder in „Prüfen & übernehmen“.
- Der €-Knopf (`ScanScreen.kt:803-825`) öffnet `KartenInfoSheet(passcode)` und übergibt **nur den Passcode** –
  erkannter Druck, Seltenheit, Auflage und Ampel gehen verloren.
- **Euro je Druck nur für eigene Drucke.** `KartenInfo.preiszeilen` (`ui/KartenInfo.kt:46-83`): eigener Druck → EUR,
  sonst YGOPRODeck-`set_price` (USD, nur EN-Drucke), sonst „–“. Katalog-Drucke tragen immer `price = 0.0`.
- „Cardmarket-Trend der Karte“ = `catalog.cards.cm_price`, ein **kartenweiter** YGOPRODeck-Wert, so alt wie der Katalog.

## 3. Datenfluss Euro-Preise je Druck

```
Cardmarket price_guide_3.json ──(05:00 UTC, Edge Function)──► Storage catalog/cm-prices.json.gz
                                                                         │ 1×/Tag
products_*.json + YGOPRODeck-Sets ──(PC, Katalog-Bau)──► Katalog: Druck → cm-Produkt(e)  │
                                                                         ▼
                                              Handy: Druck → Produkt → Trend  (offline)
```

### 3.1 Cloud: tägliche Preisdatei
- Die bestehende Edge Function `supabase/functions/refresh-cardmarket-prices` lädt `price_guide_3.json` bereits.
  Sie schreibt **zusätzlich** `cm-prices.json.gz` in den vorhandenen öffentlichen Storage-Bucket `catalog`
  (`desktop/electron/catalog-builder.cjs:16`, dort liegt auch der Katalog).
- Inhalt (kompakt): `{ "v": 1, "date": "YYYY-MM-DD", "p": { "<idProduct>": [trend, low] } }`; `trend` oder `low`
  `null`, wenn Cardmarket keinen Wert hat (`trend: 0` gilt wie im Desktop als „kein Trend“).
- Der Schritt ist **nie fatal** für die bestehende Preisaktualisierung der Sammlung (eigener try/catch, wie Schritt 1b Sealed).
- Kein neues SQL erwartet: Bucket existiert und ist öffentlich; die Funktion läuft mit Service-Role. Beim Bauen prüfen –
  falls doch eine Freigabe fehlt, liefert der Plan eine SQL-Datei, die der Nutzer im Dashboard einspielt
  (Agents rufen keine Edge Functions auf und spielen kein SQL ein).

### 3.2 PC: Zuordnung Druck → Cardmarket-Produkt im Katalog
- Cardmarket-Produkte sind sprachneutral: DE- und EN-Druck desselben Sets und derselben Seltenheit sind **ein** Produkt.
- Der Katalog-Bau (`desktop/electron/catalog-build.cjs`) ergänzt jeden Eintrag in `printings` und `printings_verified`
  additiv um `cm`:
  - eine Zahl = eindeutige idProduct,
  - ein Array = mögliche idProducts (mehrdeutig, Ansicht zeigt Spanne),
  - fehlt = keine Zuordnung.
- Zuordnung mit **denselben Regeln** wie der tägliche Bulk-Lauf: `resolveProduct`, danach `deriveProduct`
  (Set-Reihenfolge, ≥ 2 echte Vorbilder, Schutzregel „n verschiedene Seltenheiten“) aus `cardmarket-bulk-parse.cjs`.
  Echte IDs aus der eigenen Sammlung (`cards.cm_product_id`, nicht abgeleitet) haben Vorrang.
- Quelle der Produktlisten: der vorhandene Cache `userData/cardmarket/` des Bulk-Laufs.
- Der Katalog-Bau bleibt wie heute zeitgesteuert (`catalogDue`, `main.cjs:1396`).

### 3.3 Handy: Preisdatei laden und Preis je Druck
- Neues Repository (z. B. `cloud/CmPriceFile.kt`): lädt `cm-prices.json.gz` höchstens 1×/Tag (App-Start oder vor dem
  ersten Scan), speichert sie in `filesDir`, hält eine Map `idProduct → (trend, low)` im Speicher.
- **Preis je Druck, feste Reihenfolge** (Zwilling JS ↔ Kotlin, gemeinsames Fixture in `docs/fixtures/`):
  1. eigener Druck in der Sammlung mit Preis > 0 → dieser EUR-Preis (wie heute, inkl. KR-Preis aus k-tcg);
  2. sonst `cm` eindeutig und Trend vorhanden → Trend;
  3. sonst `cm` mehrdeutig → Spanne min–max der vorhandenen Trends („ca. 3–5 €“; nur ein Wert → dieser);
  4. sonst „–“.
- Der YGOPRODeck-USD-Richtwert entfällt in dieser Ansicht.
- KR-Drucke: nur Stufe 1 (eigene, k-tcg) – Cardmarket führt kein Koreanisch.

## 4. Ergebnis-Seite (Handy)

Abgenommene Entwürfe: `.superpowers/brainstorm/…/content/ergebnis-seite-detail.html` (sicher / unsicher).

- **Neuer Bildschirm** `ui/ScanErgebnisScreen.kt`, öffnet **automatisch** nach jedem erkannten Einzelfoto.
  Er bekommt das **ganze Scan-Ergebnis** (Karte, `match.selected`, `effectiveEdition` + Sicherheit, Ampel + Grund),
  nicht nur den Passcode.
- **Aufbau (von oben):**
  1. Leiste: „‹ Kamera“ · Ampelpunkt + Grund („sicher erkannt“ / „Seltenheit unsicher“).
  2. Kartenbild (antippen = groß), deutscher Name, englischer Name klein.
  3. Chips: Seltenheit (Akzent), Auflage (antippbar ▾: 1. Auflage / Unlimitiert / Limitiert), Flagge + Set-Code.
     Unsichere Werte gelb (`Warn`) mit „?“.
  4. Preisfeld: großer Preis des markierten Drucks, darunter „Cardmarket-Trend · ab {low} · Stand {Datum}“.
     Unsicher erkannt → Spanne der möglichen Drucke.
  5. „Du hast schon N× (Zustand, Auflage)“, wenn vorhanden.
  6. Hinweiszeile bei Unsicherheit: „Mehrere Seltenheiten möglich – tippe unten deinen Druck an.“
  7. „Alle Drucke“: Liste aller Drucke mit Preis nach §3.3; der erkannte/gewählte Druck umrandet und hinterlegt.
     Antippen = „das ist meiner“ → Chips und Preisfeld wechseln mit.
  8. Beim Scrollen: Preisverlauf (nur eigene Drucke, wie heute) und Kartentext.
  9. Feste Leiste unten: **„Nächste Karte“** (zurück zur Kamera) · **„In Sammlung +“** (Akzent).
- **Gestaltung:** nur vorhandene Tokens und Bausteine (`ui/theme/Color.kt`, `Type.kt`, `SpaceCard`, `RarityChip`,
  `SectionHeader`, `langFlag`, `PriceHistoryChart`); keine neuen Farben.
- **Übernahme:** Einzelfotos werden **nicht mehr automatisch** übernommen. „In Sammlung +“ übergibt genau den
  markierten Druck mit der gewählten Auflage über den bisherigen Weg: mit PC `sendScan(..., modus = "foto")`,
  ohne PC `stageScan` in „Prüfen & übernehmen“. Danach Rückmeldung (Snackbar) und zurück zur Kamera.
- **Stapel-Modus unverändert.** Der €-Knopf und `KartenInfoSheet` entfallen im Einzelmodus (die neue Seite ersetzt sie).

## 5. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Preisdatei nie geladen, kein Netz | nur eigene Preise; Hinweis „Preise werden beim nächsten Netz geladen“ |
| Preisdatei älter als 3 Tage | Stand sichtbar („Stand 01.10.“) |
| Druck ohne Cardmarket-Zuordnung | „–“ |
| Katalog ohne `cm`-Felder (alter Katalog) | wie „ohne Zuordnung“, kein Absturz |
| Erkennung ohne Druck (nur Passcode) | Seite öffnet, kein Druck markiert, Hinweis „tippe deinen Druck an“ |
| Edge-Function-Schritt scheitert | Sammlungspreise werden trotzdem aktualisiert; Handy nutzt die letzte Datei |

## 6. Tests

- **Zwilling Preis je Druck** (JS `desktop/src/utils/` ↔ Kotlin), Fixture `docs/fixtures/druck-preis.json`:
  alle vier Stufen, Spanne, KR, fehlende Datei.
- **Deno-Test** für das Erzeugen der Preisdatei (Format, `trend: 0` → null).
- **Node-Test** für die `cm`-Zuordnung im Katalog-Bau (eindeutig, mehrdeutig, abgeleitet, Vorrang echter Sammlungs-IDs).
- **Kotlin-Unit-Tests** für das Laden/Veralten der Preisdatei.
- **Abnahme am Gerät:** sichere Karte, unsichere Karte, Druck umwählen, Auflage umwählen, „In Sammlung +“ mit und ohne PC,
  Flugmodus. Nach dem Installieren App starten und `adb logcat -b crash` prüfen.

## 7. Nicht Teil dieser Spec

- Neugestaltung des Kamera-Bildschirms und der Liste „Prüfen & übernehmen“ (eigener Schritt).
- Auflagen-Erkennung bei Pendel-Karten (braucht 20–30 Fotos des Nutzers, eigener Schritt).
- Aufpreis 1. Auflage für fremde Drucke.
- Änderungen am Stapel-Modus.
