# Koreanische Karten (KR) – Design

Datum: 2026-10-01 · Status: Entwurf, vom Nutzer im Gespräch abschnittsweise bestätigt

## 1. Ziel

Koreanische Karten sollen als eigene Sprache **KR** erfasst werden können – überall, wo heute
sprachspezifische Kartendaten gezogen werden: Set-Codes (z. B. `CORI-KR001`) in der Auswahl beim
Scannen und Bearbeiten, Flagge, Filter, Sprachnamen in Angeboten/Exporten. KR-Karten zeigen
zusätzlich ihren **koreanischen Namen**. Der Preis ist der TCG-Trendpreis mal einem einstellbaren
**KR-Faktor** (Standard 50 %).

### Nutzerentscheidungen

| Frage | Entscheidung |
|---|---|
| Umfang | **B**: Erfassung als KR + koreanischer Name in der Anzeige. Kein koreanischer Kartentext, keine Suche nach koreanischen Namen. |
| Erkennung beim Scannen | Beides: Modus **Automatisch** (Region `-KR`/`-K` im Set-Code) und **feste Sprache** per Schalter. |
| Schalter nach Neustart | Springt auf **Auto** zurück. |
| Preis | TCG-Trendpreis × KR-Faktor, Standard **50 %**, am PC einstellbar. |
| Speicherort koreanischer Name | Neue Spalte `name_ko` (lokal + Cloud, synchronisiert). |

### Ist-Zustand (Ausgangslage)

- Die App kennt pro Zeile nur die Sprachen DE, EN, JP. Jede andere Region – auch `KR` – wird zu
  **EN** zusammengelegt (`android/.../ml/RegionToken.kt` `language()`, `PrintingRepository.fetchSets`).
- JP ist als Zusatzsprache eingebaut: Set-Codes aus Yugipedia `jp_sets`, Fandom `jp_sets` und
  Konami (`request_locale=ja`), parallel abgefragt (`desktop/electron/api-handler.cjs`
  `fetchSetsUnion`, `android/.../cloud/PrintingRepository.kt` `localizedUnion`).
- `language` hat weder in SQLite noch in Postgres eine Wert-Sperre. `'KR'` braucht keine Migration.
- Quellen geprüft am 2026-10-01 (Beispiel Dark Magician):
  - Yugipedia: `ko_name` (블랙 매지션), `kr_sets` mit `SYE-KR001; Starter Deck: Yugi Evolution; Super Rare`
    sowie alte Einbuchstaben-Codes `LOB-K005`.
  - Konami (`request_locale=ko`): Seitentitel trägt den koreanischen Namen, `card_number`-Zeilen
    liefern `QCAC-KR018` usw.

### Nicht im Umfang

Koreanischer Kartentext; Suche nach koreanischen Namen; eigene Sprachen für FR/IT/SP/PT (bleiben EN);
automatisches Umschreiben bestehender EN-Zeilen, die eigentlich koreanisch sind (geht von Hand);
koreanische Texterkennung (Hangul-OCR); KR im Offline-Katalog des Handys.

## 2. Datenquellen & Speicherung

### 2.1 KR-Set-Codes

Neue Funktion nach dem JP-Muster, auf PC und Handy:

- PC: `fetchKoreanSets(passcode)` in `api-handler.cjs` = `fetchSetsUnion(passcode, 'kr', 'ko')`;
  IPC `fetch-korean-sets` in `main.cjs` + `preload.cjs` (`window.api.fetchKoreanSets`).
- Handy: `localizedUnion(title, cid, "kr", "KR")` in `PrintingRepository`, parallel zu DE/JP; die
  Konami-Locale ergibt sich aus dem Tag (`DE→de`, `JP→ja`, `KR→ko`).
- Filter „gehört zu KR“: Region-Infix `KR` oder altes einzelnes `K` direkt vor der Nummer –
  `/-(KR|K(?=\d))/i`. Beispiele: `CORI-KR001` ✓, `LOB-K005` ✓, `DOOD-EN001` ✗, `SYE-KR001` ✓.
  Dieser Filter ist Zwillingslogik (JS + Kotlin) und wird über eine gemeinsame Fixture geprüft.
- Jeder Treffer trägt `language = 'KR'`.

### 2.2 Koreanischer Name

- Neue nullable Spalte `name_ko TEXT` an `cards`: SQLite-Migration in `database.cjs` (additiv),
  Postgres-Migration `supabase/cards_name_ko_lang_factor.sql`, Sync-Feld in `sync.cjs` und im
  Android-Cloud-Modell.
- Befüllt wird sie, wenn eine KR-Zeile angelegt wird (PC oder Handy) und `name_ko` noch leer ist.
  Quelle: Yugipedia `| ko_name = …` aus dem ohnehin geladenen Wikitext; fällt der aus, der
  Konami-Seitentitel (Text vor ` | `). Kein Treffer → `NULL`, kein Fehler.
- Nur KR-Zeilen bekommen `name_ko`; andere Sprachen bleiben `NULL`.

## 3. Scanner (Handy)

### 3.1 Modus „Automatisch“ (Standard)

- `RegionToken.KNOWN` erhält `K`. `RegionToken.language()` bildet `KR` und `K` auf **`KR`** ab
  (statt EN). Alle übrigen Regeln bleiben.
- Die Liste der bekannten Drucke für den Abgleich enthält die KR-Drucke aus 2.1. Liest der Scanner
  `CORI-KR001`, wird der echte KR-Druck gewählt (bestehende Fälle 1–3 in `SetCodeMatch.best`).
- `SprachHinweis` bleibt DE/EN (Hangul ist nicht lesbar). Er kann KR weder bestätigen noch
  überstimmen. Liefert er DE/EN, gewinnt er wie bisher nur, wenn es in der besten Gruppe einen
  Druck dieser Sprache gibt.

### 3.2 Feste Sprache

- Chip im Scanner: **Sprache: Auto · DE · EN · KR · JP**. Ist eine feste Sprache gewählt, ist der
  Chip hervorgehoben sichtbar.
- Zustand lebt nur im Speicher (ViewModel/Prozess). Beim App-Neustart gilt wieder **Auto**.
- `SetCodeMatch.best(…, festeSprache: String? = null)`: Ist `festeSprache` gesetzt, wird nach dem
  Prefix+Nummer-Abgleich **vor** SprachHinweis und Region entschieden:
  1. Drucke der besten Gruppe mit `language == festeSprache` → verifizierte zuerst, der erste gewinnt
     (`MATCHED`).
  2. Keiner vorhanden → Code zusammensetzen: `"$prefix-$region$number"` mit der Standardregion der
     Sprache (`DE→DE`, `EN→EN`, `KR→KR`, `JP→JP`), Seltenheit aus der Gruppe, `verified = false`,
     `language = festeSprache` (`MATCHED`).
  - Prefix+Nummer nicht erkannt → unverändert `NO_MATCH`.
- Die Kartenerkennung (Artwork) ist vom Schalter unberührt.

### 3.3 PC

Scans kommen mit ihrer Sprache an. Die Set-Auswahl in `StagingArea.jsx` und `CardDetailPanel.jsx`
lädt zusätzlich `fetchKoreanSets` und zeigt eine KR-Gruppe. Kein Scanner-Schalter am PC.

## 4. Preis

Vorbild: `cm_first_ed_factor` (Faktor pro Zeile, synchronisiert, Cloud rechnet).

- Einstellung am PC: `settings.kr_price_factor`, Standard `0.5`, unter Einstellungen → Preise
  (Eingabe in Prozent, 1–100).
- Neue nullable Spalte `cm_lang_factor REAL` an `cards` (SQLite + Postgres + Sync). KR-Zeilen tragen
  den Faktor; alle anderen `NULL` (= 1).
- Jede Preisquelle multipliziert beim Schreiben mit `COALESCE(cm_lang_factor, 1)` und rundet auf
  2 Nachkommastellen:
  - PC: `cardmarket-bulk.cjs` (Trend), `cardmarket-scraper.cjs`, YGOPRODeck-Poller in `main.cjs`
    (`startPricePoller`) sowie Erstpreis beim Anlegen.
  - Cloud: `apply_cardmarket_prices` setzt `price = round(trend * coalesce(cm_lang_factor, 1), 2)`;
    `price_history` erhält denselben Wert.
- `price` enthält damit bereits den KR-Preis. Bewertung, Portfolio, Verkaufen, Duplikate usw. bleiben
  **unverändert** (keine Änderung an den fünf Bewertungs-Zwillingen).
- Faktor geändert → alle lebenden KR-Zeilen mit `price_locked ≠ 2`: `price = round(price / alt * neu, 2)`,
  `cm_lang_factor = neu`; danach normaler Sync.
- KR-Zeile am Handy angelegt → `cm_lang_factor = 0.5` (Standard aus der Fixture
  `docs/fixtures/language/kr.json`). Der PC setzt beim nächsten Sync-Pull seinen eingestellten Wert
  und rechnet den Preis wie oben um.
- `price_locked = 2` (manuell) wird nie angefasst.
- Rein koreanische Sets ohne Cardmarket-Gegenstück bleiben ohne Preis (manuell setzbar).
- Kartendetail (PC + Handy): bei KR-Zeilen mit Faktor der Hinweis „KR-Faktor 50 %“ neben dem Preis.

## 5. Oberfläche

**PC:** Flagge 🇰🇷 (`Flag.jsx`, gezeichnet); Sprachfilter DE · EN · KR · JP (`CollectionFilters.jsx`);
KR-Gruppe in der Set-Auswahl; `name_ko` unter dem Hauptnamen in Kartendetail/Kartenkopf;
Sprachnamen `KR: 'Koreanisch'` in `listing-text.cjs`, `src/utils/listingText.js`,
`supabase/functions/_shared/listing-text.ts`; `KR: 'Korean'` in `export-formats.cjs` (Dragon Shield)
und `supabase/functions/_shared/ebay-map.ts`; Einstellung KR-Preisfaktor.

**Handy:** Flagge in `LangFlag.kt`; `"KR" to "Koreanisch"` in `ListingText.kt`; KR-Gruppe in der
Set-Auswahl; `name_ko` in der Kartenansicht; Sprach-Chip im Scanner.

## 6. Tests

- Fixture `docs/fixtures/language/kr.json`: Region→Sprache (`KR`,`K`→KR; `G`,`DE`→DE; `FR`,`EN`→EN;
  `JP`,`JA`→JP), KR-Code-Filter (positive/negative Beispiele aus 2.1), Faktor-Anwendung
  (Trend × Faktor, Rundung, `NULL`→1), Standardfaktor 0.5. Gelesen von JS-Tests (PC) und Kotlin-Tests.
- Handy: `SetCodeMatchTest` – feste Sprache KR mit vorhandenem KR-Druck; feste Sprache KR ohne
  KR-Druck → zusammengesetzt `CORI-KR001`, unverifiziert; Auto-Modus mit gelesener Region `KR`;
  feste Sprache schlägt SprachHinweis. `RegionTokenTest` – `K` und `KR` → KR.
- PC: `api-handler`-Filter für `kr_sets`; `ko_name`-Extraktion; Migration der zwei Spalten;
  Faktor-Anwendung in Bulk/Poller; Faktoränderung rechnet KR-Zeilen um, lässt `price_locked = 2` in Ruhe;
  Sync überträgt `name_ko`/`cm_lang_factor`.
- Cloud: `apply_cardmarket_prices` mit Faktor (SQL-Prüfabfrage im Migrations-Skript).
- Bestehende Suiten bleiben grün (PC `node --test`, Electron-Tests, `gradlew testDebugUnitTest`);
  Lint ohne neue Fehler.

## 7. Abnahme am Gerät

1. Echte koreanische Karte im Modus **Auto** scannen → Zeile `language = KR`, `-KR`-Code.
2. Dieselbe Karte im Modus **KR** → KR.
3. App neu starten → Chip steht auf Auto; eine deutsche Karte wird DE.
4. Am PC: 🇰🇷-Flagge, koreanischer Name, Preis = Trend × 50 % mit Hinweis; Filter KR zeigt die Karte.
5. Faktor am PC auf 60 % ändern → Preis rechnet um und erscheint nach Sync am Handy.

## 8. Reihenfolge der Einführung

1. Supabase-Migration (`name_ko`, `cm_lang_factor`, neue `apply_cardmarket_prices`) **vor** dem neuen
   PC-Installer und der neuen APK – sonst scheitert jeder Push mit den neuen Feldern.
2. PC-Installer.
3. APK.
