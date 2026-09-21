# Spec H3a — Angebote (halbautomatisch)

**Datum:** 2026-09-21
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (Brainstorming 2026-09-21)
**Teil von:** Programm H. H3 wird geteilt: **H3a Angebote halbautomatisch (dieses Dokument)**, danach **H3b eBay über die offizielle API** (eigenes Brainstorming). Aufteilung von H: `2026-09-17-spec-h-nachtrag-h1-duplikate-verkaufsliste.md` §1.
**Setzt voraus:** A (Exemplare, Soft-Delete), H1 (Verkaufsliste, `for_sale`), H2 (Verkäufe, Kanäle `sale_channels`, `book_sale`, Preisvorschlag, Rechen-Zwillinge, Sync-Muster), E3 (`catalogMainId`/englischer Katalogname), Cardmarket-Scraper (`cards.cm_url`).
**Nicht Teil von H3a:** automatisches Einstellen, Ändern oder Beenden auf einem Marktplatz, Abholen von Verkäufen (→ H3b für eBay). Cardmarket und Kleinanzeigen bleiben dauerhaft halbautomatisch (Cardmarket nimmt keine API-Anträge an, Kleinanzeigen hat keine öffentliche API).

---

## 1. Problem

Wer Karten auf Cardmarket, Kleinanzeigen oder eBay anbietet, tippt Titel, Beschreibung und Preis von Hand und weiß später nicht mehr, welche Karte wo und zu welchem Preis steht. Wird eine Karte auf einem Kanal verkauft, bleibt die Anzeige auf dem anderen stehen.

## 2. Ziel

- **Angebot als Zustand:** Die App merkt sich, welche Exemplare auf welchem Kanal zu welchem Preis angeboten sind.
- **Vorbereiten:** Titel, Beschreibung, Preis (Vorschlag aus H2), Link zum Einstellen und Kartenbilder, damit das Einstellen von Hand schnell geht.
- **Verkauft → Buchung:** Aus einem Angebot wird mit einem Schritt ein H2-Verkauf. Andere Angebote derselben Karten werden aufgeräumt, und die App erinnert daran, sie auch auf dem Marktplatz herauszunehmen.
- Beide Geräte.

## 3. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| H3 geteilt: H3a halbautomatisch zuerst, H3b eBay-API danach | eBay zuerst; nur halbautomatisch | Kleinerer Teil zuerst und sofort für alle Kanäle nutzbar; H3b baut auf den Angeboten auf (Nutzer) |
| Angebote mit Status, als eigene Tabellen `listings` + `listing_items` | Nur Vorbereitung ohne Speicher; Spalten am Exemplar; Angebote als Verkäufe mit Status | Nutzer will sehen, was wo steht; Konvolute und mehrere Kanäle je Exemplar gehen nur mit eigenen Tabellen; H2-Auswertungen bleiben sauber (Nutzer: Ansatz A) |
| Ein Angebot = beliebig viele Exemplare | Genau ein Exemplar | Konvolute (Kleinanzeigen), Menge > 1 (Cardmarket) (Nutzer) |
| Vorbereiten liefert Titel + Beschreibung, Preis, Link und Kartenbilder | — | Nutzer (alle vier gewählt) |
| Beide Geräte, voller Umfang; am Handy über das Android-Teilen-Menü | Anlegen nur am PC | Nutzer |
| Dasselbe Exemplar darf in mehreren aktiven Angeboten stecken, mit Hinweis | Nur ein Angebot je Exemplar | Mehrfach-Einstellen ist beim Privatverkauf üblich (Nutzer) |
| Kanäle = `sale_channels` aus H2 | Eigene Kanal-Liste | Ein Kanal-Begriff für Angebot und Verkauf; eigene Kanäle gehen automatisch |

## 4. Datenmodell

### 4.1 SQLite (Desktop) — additive Migration, neues `listings-schema.cjs`

```sql
CREATE TABLE IF NOT EXISTS listings (
  listing_id   TEXT PRIMARY KEY,            -- UUID
  channel_id   TEXT NOT NULL,               -- sale_channels.channel_id
  channel_name TEXT NOT NULL,               -- Name beim Anlegen (Momentaufnahme wie sales.channel_name)
  title        TEXT,
  description  TEXT,
  price        REAL NOT NULL CHECK (price > 0),   -- Angebotspreis GESAMT (§5.5: nie 0 €)
  status       TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','verkauft','beendet')),
  listed_on    TEXT NOT NULL,               -- 'YYYY-MM-DD', lokales Datum, ohne Uhrzeit (wie sales.sold_on)
  sale_id      TEXT,                        -- gesetzt, wenn über "Verkauft" gebucht (§7.1)
  external_url TEXT,                        -- Link der echten Anzeige, optional
  note         TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listing_items (
  listing_id TEXT NOT NULL,
  copy_id    TEXT NOT NULL,
  -- Momentaufnahme beim Anlegen, wie sale_items (H2-Abweichung 1): Anzeige ohne lebendes Exemplar
  card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL, rarity TEXT NOT NULL,
  edition TEXT NOT NULL, condition TEXT NOT NULL, name TEXT, image_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted    INTEGER NOT NULL DEFAULT 0,     -- 1 = Position herausgenommen
  PRIMARY KEY (listing_id, copy_id)
);
```

`updated_at`-Trigger für beide Tabellen wie `trg_sales_updated`. **Keine** Änderung an `card_copies`.

### 4.2 Supabase

Neue Datei `supabase/listings_schema.sql` (vom Nutzer einzuspielen, vor dem neuen PC-Build): dieselben Tabellen (Postgres-Typen `date`, `numeric(12,2)`, `boolean`, `timestamptz`), `set_updated_at`-Trigger, RLS „authenticated all" wie die Verkaufstabellen. **Keine** neue Datenbankfunktion: Angebote schreiben betrifft je Aktion eine Tabelle, das Handy schreibt per REST. „Verkauft" nutzt `book_sale` aus H2.

### 4.3 Abgleich

Zwei neue Ströme in `sync.cjs`, gebaut wie die H2-Ströme (`SALES_STREAMS`): Echo-Sperre, gezogene Zeilen mit Obergrenze (Fix I2), jede Tabelle für sich abgesichert (fehlt die Cloud-Tabelle, laufen die anderen Ströme weiter), Reihenfolge nach den Verkaufs-Strömen. Renderer-Ereignis `listings-changed`. Handy lädt beide Tabellen seitenweise (Schlüssel-Blättern wie H2, PostgREST liefert höchstens 1000 Zeilen).

## 5. Anlegen und Vorbereiten

### 5.1 Einstieg (beide Geräte)
- **Verkaufsliste:** Exemplare anhaken → „Angebot erstellen" (dieselben Häkchen wie „Verkauft buchen").
- **Exemplar-Sheet:** „Anbieten…" für ein Exemplar.

### 5.2 Dialog
Kanal (lebende `sale_channels`), Datum (heute), Preis (vorbelegt: Summe der Preisvorschläge nach H2 §9; ohne jeden Vorschlag leer), Titel, Beschreibung, Link der Anzeige (optional), Notiz.
Knöpfe: „Titel kopieren", „Beschreibung kopieren", „Zum Einstellen öffnen", „Bilder", „Angebot speichern".
Anlegen setzt bei allen Exemplaren `for_sale = 1` (H1).

### 5.3 Texte (reine Regel, Zwilling JS/Kotlin, §10)
- **Titel, eine Karte:** `Yu-Gi-Oh! <Name> <Set-Code> <Rarität> <Auflage> <Zustand> <Sprache>`, z. B. „Yu-Gi-Oh! Dunkler Magier LOB-DE005 Ultra Rare 1. Auflage NM" — mit „Deutsch" wären es 67 Zeichen, das Kürzen (unten) lässt es deshalb weg. Auflage: „1. Auflage" / „Limitiert"; `unlimited` und `unknown` entfallen. Sprache ausgeschrieben (DE Deutsch, EN Englisch, FR Französisch, IT Italienisch, SP Spanisch, PT Portugiesisch, JP Japanisch). Unbekannte Angaben (Set-Code `Unknown`, leere Rarität) entfallen.
- **Titel, Konvolut** (mehrere verschiedene Drucke): `Yu-Gi-Oh! Konvolut <n> Karten – <Name1>, <Name2>, …` in der Reihenfolge der Beschreibung.
- **Mehrere gleiche Exemplare** (ein Druck, gleicher Zustand/Auflage): Titel wie „eine Karte" mit vorangestelltem `<n>× `.
- **Kürzen:** höchstens 65 Zeichen; gekürzt wird an der letzten Wortgrenze davor, bei Konvoluten mit „…". Der Dialog zeigt einen Zähler „n/65".
- **Beschreibung:** je Gruppe eine Zeile im Format der F1-Verkaufsliste („2× Name – Set – Rarität – Auflage – Zustand"), Leerzeile, „Preis: 12,50 €", Leerzeile, „Privatverkauf, keine Garantie oder Rücknahme."
- **Cardmarket:** kein Titel und keine Beschreibung. Der Dialog zeigt die Eintragwerte: Produkt (Name + Set-Code), Menge, Sprache, Zustand (MT…PO), „1. Auflage" ja/nein, Preis je Stück (= Angebotspreis / Menge, auf Cent).

### 5.4 Cardmarket-Aufteilung
Ein Cardmarket-Angebot ist immer genau eine Gruppe (gleicher Druck, Zustand, Sprache, Auflage). Eine gemischte Auswahl wird **vor dem Speichern** in ein Angebot je Gruppe geteilt, mit Hinweis „wird zu 3 Cardmarket-Angeboten". Der vorbelegte Preis je Angebot ist die Vorschlags-Summe der Gruppe.

### 5.5 Links („Zum Einstellen öffnen", im Browser)
- **Cardmarket:** `cards.cm_url` des Drucks, wenn bekannt (PC). Sonst die Cardmarket-Suche `https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString=<englischer Name> <Set-Code>`; ohne englischen Namen nur der Set-Code.
- **Kleinanzeigen:** `https://www.kleinanzeigen.de/p-anzeige-aufgeben.html`.
- **eBay:** `https://www.ebay.de/sl/sell` (bis H3b).
- **Eigene Kanäle:** kein Link (Knopf ausgeblendet).

### 5.6 Bilder
- **PC:** Katalogbilder (`image_url`, je Druck einmal) in `Bilder\Yu-Gi-Oh Angebote\<Titel, dateinamen-sicher>\` speichern, danach den Ordner im Explorer öffnen.
- **Handy:** Bilder in den App-Cache laden und über das Android-Teilen-Menü teilen.
- Nicht ladbare Bilder werden übersprungen: „3 von 4 Bildern gespeichert". Hinweis im Dialog: „Käufer erwarten oft eigene Fotos."

### 5.7 Prüfungen
Mindestens ein Exemplar; alle lebend und unverkauft (`deleted = 0`, `sold_in IS NULL`); Preis > 0 (ein Angebot für 0 € gibt es nicht — ein Verkauf für 0 € (Tausch) bleibt in H2 erlaubt); Kanal lebt; Datum `YYYY-MM-DD`. Steckt ein Exemplar schon in einem anderen aktiven Angebot: Hinweis „auch auf <Kanal> eingestellt", kein Fehler.

## 6. Übersicht „Angebote"

- **Ort:** neuer Chip **„Angebote"** in Sammlung (neben „Duplikate", „Zum Verkauf"), beide Geräte.
- **Filter:** aktiv (Standard) · verkauft · beendet · alle; Kanal-Filter.
- **Zeile:** Kanal, Titel (bei Cardmarket: Produkt + Menge), Anzahl Karten, Preis, „seit N Tagen", Preis gegenüber heutigem Marktwert (`diffText` aus H2).
- **Marken:** „auch auf <Kanal>" (ein Exemplar in mehreren aktiven Angeboten), „Karte fehlt" (eine lebende Position, deren Exemplar nicht mehr lebt), „Preis unter Vorschlag" (Summe der heutigen Vorschläge ≥ 120 % des Angebotspreises), „Verkauf storniert" (verkauftes Angebot, dessen Verkauf storniert ist).
- **Sortierung:** `listed_on` absteigend, dann `created_at` absteigend, dann `listing_id`.
- **Kopf** (aktiv/alle): „8 Angebote · 34 Karten · 112,50 €" (nur aktive zählen).
- **Detail:** Positionen (Bild, Druck, Zustand, heutiger Marktwert), Kopieren, Bilder, Link der Anzeige öffnen/nachtragen, **Bearbeiten** (Preis, Titel, Text, Link, Notiz; Position herausnehmen; keine Karten hinzufügen), **Verkauft**, **Beenden**, **Erneut anbieten** (bei beendet/verkauft).
- **Überall sonst:** Verkaufsliste zeigt je Exemplar in aktiven Angeboten ein Kanal-Kürzel (feste Kanäle: Cardmarket „CM", eBay „EB", Kleinanzeigen „KA", Tausch „TA", Privat „PR"; eigene Kanäle: die ersten zwei Buchstaben des Namens in Großbuchstaben; gleiches Kürzel auf beiden Geräten); Kartenansicht zeigt „angeboten auf <Kanal> für <Preis>" am Exemplar; Start: „Angebote: 8 aktiv".

## 7. Verkauft, Beenden, Aufräumen

### 7.1 Verkauft
Öffnet den H2-Buchungsdialog, vorbelegt: Kanal des Angebots, Preis = Angebotspreis, Karten = lebende Positionen, alle angehakt. Im Dialog abwählbar (Teilverkauf).
- **Alles verkauft:** `status = 'verkauft'`, `sale_id` gesetzt.
- **Teilverkauf:** verkaufte Positionen `deleted = 1`, Angebot bleibt aktiv. Cardmarket: `price = Stückpreis × Rest` (Stückpreis = alter Preis / alte Menge, auf Cent; Zwilling §10). Andere Kanäle: Preis bleibt, Hinweis „Preis für die übrigen Karten anpassen?" mit Sprung ins Bearbeiten.
- Gebucht wird über den normalen H2-Weg (PC `bookSale`, Handy `book_sale`); der Buchungspreis ist, was im Dialog steht.

### 7.2 Aufräumen nach **jedem** Verkauf (reine Regel `cleanupAfterSale`, Zwilling §10)
Für jedes verkaufte Exemplar: in allen anderen **aktiven** Angeboten die Position herausnehmen (`deleted = 1`); ein Angebot ohne lebende Position wird `beendet`. Ergebnis: Liste der betroffenen Angebote (Kanal, Titel, `external_url`) für die Erinnerung „Auch dort herausnehmen: …".
- **PC:** in derselben Transaktion wie `bookSale` — gilt auch für Buchungen direkt aus der Verkaufsliste ohne Angebot.
- **Handy:** direkt nach erfolgreichem `book_sale` per REST. Scheitert dieser Schritt, bleibt der Verkauf gültig; die Angebote zeigen dann „Karte fehlt".
- **Anderes Gerät:** räumt nicht nach; die Marke „Karte fehlt" fängt es auf, Antippen räumt (§8).

### 7.3 Beenden
`status = 'beendet'`; Positionen und `for_sale` bleiben unverändert.

### 7.4 Erneut anbieten
Neues Angebot, vorbelegt mit Kanal, Titel, Beschreibung, Preis und den noch lebenden, unverkauften Exemplaren des alten.

### 7.5 Storno in H2
Ein verkauftes Angebot, dessen Verkauf storniert wurde, bleibt `verkauft`, zeigt „Verkauf storniert" und bietet „Erneut anbieten". Es wird nicht still wieder aktiv (die echte Anzeige ist in der Regel weg).

## 8. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Handy ohne Netz | Anlegen, Bearbeiten, Verkauft, Beenden gesperrt, Hinweis + „Erneut versuchen" (Sperre wie H2-Abweichung 4). |
| Exemplar inzwischen gelöscht/verkauft (anderes Gerät) | Position „Karte fehlt", Angebot mit Marke; Antippen nimmt sie heraus, leeres Angebot → beendet. |
| Beide Geräte bearbeiten dasselbe Angebot | Jüngere Zeile gewinnt. Beendete/verkaufte Angebote nicht bearbeitbar; vor dem Speichern frisch laden (H2-Fix I2). |
| Kanal ausgeblendet | Alte Angebote zeigen `channel_name`; neue nur auf lebenden Kanälen. |
| Karte ohne Marktwert | Vorschlag „–"; Preis leer, muss vor dem Speichern eingetragen werden. |
| Cardmarket-Link unbekannt | Suche nach englischem Namen + Set-Code, ohne Namen nur Set-Code. |
| Bild lädt nicht | Überspringen, „3 von 4 Bildern gespeichert". |
| Titel zu lang | Kürzen an der Wortgrenze auf 65 Zeichen, Zähler. |
| Konvolut für Cardmarket | Aufteilen je Gruppe (§5.4). |

## 9. Betroffene Dateien

**Desktop:** `electron/listings-schema.cjs` (neu), `electron/listings.cjs` (neu: anlegen, bearbeiten, beenden, erneut anbieten, lesen, aufräumen), `electron/listing-text.cjs` (neu, Zwilling), `electron/sales.cjs` (`bookSale` ruft das Aufräumen in derselben Transaktion), `electron/database.cjs`, `electron/sync.cjs` (zwei Ströme), `electron/main.cjs` + `preload.cjs` (Kanäle, Bilder-Ordner, Link öffnen über `shell.openExternal`), `src/utils/listingText.js` (neu, Zwilling), `src/components/ListingDialog.jsx`, `ListingsList.jsx`, `ListingDetail.jsx` (neu), `ForSaleList.jsx`, `CopySheet.jsx`, `CollectionList.jsx` (Chip), `CardDetailPanel.jsx`, `Start.jsx`, `SaleDialog.jsx` (Vorbelegung aus Angebot, Teilverkauf).
**Android:** `cloud/Listing.kt`, `cloud/ListingsRepository.kt` (neu), `cloud/SideStores.kt`, `ml/ListingText.kt` (neu, Zwilling), `ui/ListingSheet.kt`, `ui/ListingsScreen.kt` (neu), `ui/SaleLists.kt`, `ui/CopySheet.kt`, `ui/CollectionScreen.kt` (Chip), `ui/CardDetailScreen.kt`, `ui/StartScreen.kt`, `ui/SaleSheet.kt` (Vorbelegung, Aufräumen nach `book_sale`).
**Cloud:** `supabase/listings_schema.sql` (neu).

## 10. Tests

- **Zwillinge JS/Kotlin gegen `docs/fixtures/listings/listings.json`:** Titel (eine Karte, n gleiche, Konvolut, unbekannte Angaben, Kürzen auf 65 an der Wortgrenze), Beschreibung, Cardmarket-Gruppen, Cardmarket-Eintragwerte und Stückpreis beim Teilverkauf, „Preis unter Vorschlag" (Grenze 120 %), „auch auf …", „Karte fehlt", `cleanupAfterSale` (welche Positionen fallen, welche Angebote enden, Erinnerungsliste), Links je Kanal, Kanal-Kürzel.
- **SQLite:** Anlegen setzt `for_sale`; Verkauft ganz/teilweise; Aufräumen in derselben Transaktion (auch bei Buchung ohne Angebot); Beenden; Erneut anbieten; Storno-Marke; Prüfungen (§5.7).
- **Abgleich:** zwei Ströme, Echo-Sperre, keine Rückschübe gezogener Zeilen.
- **Handy:** Blättern über 1000 Zeilen, Aufräumen nach `book_sale`, REST-Nutzlasten.
- **Am Gerät:** App starten, `adb logcat -b crash` leer; Abnahme: ein Angebot auf zwei Kanälen einstellen, auf einem verkaufen, Erinnerung und Aufräumen prüfen, Bilder teilen.

## 11. Bau-Reihenfolge

1. Rechen-/Text-Zwillinge mit Fixture.
2. Cloud-SQL als Datei (Nutzer spielt ein).
3. PC: Schema und Helfer, Aufräumen in `bookSale`, Sync, IPC, Oberfläche.
4. Handy: Daten, Oberfläche, Teilen.
5. Abschluss: Abschlussreview, Installer, APK, Abnahme.

## 12. Ausblick H3b

Ein Angebot auf dem Kanal eBay wird über die offizielle API eingestellt, geändert und beendet, Verkäufe werden abgeholt und gebucht. H3b ergänzt `listings` um eine eBay-Angebots-ID; eigenes Brainstorming.

## 13. Risiken

- **Erinnerung statt Automatik:** Auf Cardmarket und Kleinanzeigen bleibt die echte Anzeige stehen, bis der Nutzer sie herausnimmt; die App kann nur erinnern.
- **Cardmarket-Suche statt Produktseite** am Handy und für Drucke ohne Scraper-Treffer — ein Klick mehr.
- **Katalogbilder** zeigen nicht das eigene Exemplar; der Dialog weist darauf hin.
