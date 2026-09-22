# Spec H3b — eBay über die offizielle API

**Datum:** 2026-09-22
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (Brainstorming 2026-09-22)
**Teil von:** Programm H. H3 geteilt in H3a (Angebote halbautomatisch, gemergt `7b23e93`) und **H3b (dieses Dokument)**. H3b wird in **zwei Plänen** gebaut: **H3b1 Verbinden und Einstellen**, **H3b2 Verkäufe automatisch** (§11).
**Setzt voraus:** H2 (`sales`, `sale_items`, `sale_channels`, `book_sale`, `update_sale`, `cancel_sale`, Rechen-Zwillinge `sales-math`), H3a (`listings`, `listing_items`, Aufräumen `cleanupAfterSale`, Stückpreis, Fixture `docs/fixtures/listings/listings.json`), das Edge-Function-Muster von `refresh-cardmarket-prices` (Deno, Cron mit Geheimwert, `--no-verify-jwt`).
**Nicht Teil von H3b:** Rücksendungen und Erstattungen nach dem Versand (bleiben manuell in H2), Versandetiketten, Nachrichten an Käufer, Auktionen, andere eBay-Marktplätze als eBay.de, Aufräumen alter Foto-Dateien im Speicher, Cardmarket/Kleinanzeigen (bleiben halbautomatisch, H3a).

---

## 1. Problem

H3a merkt sich Angebote und bereitet sie vor; auf eBay stellt der Nutzer aber weiter von Hand ein, ändert Preise doppelt, beendet Anzeigen von Hand und bucht jeden eBay-Verkauf selbst. Wird eine Karte anderswo verkauft, bleibt die eBay-Anzeige online, bis er daran denkt.

## 2. Ziel

- Ein H3a-Angebot auf dem Kanal **eBay** wird automatisch zu einer echten eBay-Anzeige: **einstellen, ändern, beenden** über die offizielle API.
- **Bestand abgleichen:** Wird eine Karte anderswo verkauft, sinkt die eBay-Menge bzw. die Anzeige endet automatisch.
- **Verkäufe abholen und buchen:** eBay-Bestellungen werden automatisch als H2-Verkauf gebucht, mit **echten Gebühren**, inklusive Aufräumen anderer Angebote.
- **Eigene Fotos** zu Angeboten, zusätzlich zum Katalogbild.
- Alles läuft **in der Cloud**, das Handy funktioniert ohne PC.

## 3. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| Anbindung **in der Cloud** (Supabase Edge Functions) | am PC; erst PC, später Cloud | Handy ohne PC, Verkäufe auch nachts (Nutzer) |
| Unbekannter eBay-Stand → **Einrichtungs-Check** + Schalter **Sandbox/Produktion** | Annahme „alles da" | Nutzer kennt Stand seines Kontos nicht |
| Umfang: einstellen, ändern/beenden, Verkäufe abholen + buchen, Bestand abgleichen | Teilmengen | Nutzer (alle vier) |
| Bilder: Katalogbild, **eigene Fotos optional** | nur Katalog; nur eigene Fotos | Nutzer |
| Buchung mit **echten Werten** (Preis/Versand aus Bestellung, Gebühren aus Finanzdaten, vorläufig per Prozentsatz) | Prozentsatz; nur Vorschlag | Nutzer |
| **Ein Abgleicher (Soll/Ist)** in der Cloud, Zeitplan + sofortiger Anstoß | Einzelaufrufe je Aktion; nur Bestellungen | robust bei Funkloch/Neustart, ein Ort mit eBay-Wissen (Nutzer: Ansatz A) |
| eBay-Stand in **eigener Tabelle** `ebay_listings`, nur von der Funktion geschrieben | Spalten an `listings` | PC schiebt `listings` komplett; eBay-Felder würden sich gegenseitig überschreiben |
| **Eine Spec, zwei Pläne** (H3b1, H3b2) | ein Plan | Umfang; H3b1 ist allein schon nutzbar (Nutzer) |

## 4. Verbindung und Einrichtung

### 4.1 Secrets (Nutzer hinterlegt, `supabase secrets set`)
Je Umgebung: `EBAY_SANDBOX_CLIENT_ID`, `EBAY_SANDBOX_CLIENT_SECRET`, `EBAY_SANDBOX_RUNAME` und `EBAY_PROD_CLIENT_ID`, `EBAY_PROD_CLIENT_SECRET`, `EBAY_PROD_RUNAME`; dazu `EBAY_CRON_SECRET` (Header `x-ebay-secret` für den Zeitplan). Die Geräte sehen keinen dieser Werte.

### 4.2 Tabelle `ebay_account` (eine Zeile, Schlüssel `id = 1`)
`environment` (`sandbox`|`production`), `marketplace` (`EBAY_DE`), `refresh_token`, `refresh_expires_at`, `access_token`, `access_expires_at`, `oauth_state`, `oauth_state_expires_at`, `payment_policy_id`, `fulfillment_policy_id`, `return_policy_id`, `location_key`, `orders_cursor` (H3b2), `last_run_at`, `last_run_summary`, `last_error`, `connected_at`, `updated_at`.
RLS aktiv **ohne** Regel für `authenticated` — nur die Dienstrolle (Funktion) liest und schreibt.
**Ansicht `ebay_status`** (für `authenticated` lesbar): `environment`, `connected` (Refresh-Token vorhanden und nicht abgelaufen), `refresh_expires_at`, Einrichtung (`has_payment_policy`, `has_fulfillment_policy`, `has_return_policy`, `has_location`), gewählte Richtlinien-IDs **und ihre Namen**, `last_run_at`, `last_run_summary`, `last_error`. Keine Tokens.

### 4.3 Funktion `ebay-auth` (deploy mit `--no-verify-jwt`)
Aktionen (Body/Query `action`):
- `start` (Anmeldung Pflicht, JWT wird in der Funktion selbst geprüft): erzeugt einmaligen `oauth_state` (10 Minuten gültig), liefert die eBay-Zustimmungs-URL (Umgebung aus `ebay_account.environment`, Rechte: `sell.inventory`, `sell.account`, `sell.fulfillment`, `sell.finances`).
- `callback` (von eBay, ohne Anmeldung): prüft `state` gegen `oauth_state` und Gültigkeit, tauscht `code` gegen Tokens, speichert sie, leert `oauth_state`, zeigt eine schlichte HTML-Seite „Verbunden – du kannst das Fenster schließen." bzw. „Verbindung fehlgeschlagen: …".
- `check` (Anmeldung): liest Zahlungs-, Versand-, Rücknahme-Richtlinien für `EBAY_DE` und die Artikelstandorte; genau eine je Art → automatisch gewählt; mehrere → Auswahl in den Einstellungen; keine → Link zur Seite im Verkäuferkonto.
- `select` (Anmeldung): speichert die gewählten Richtlinien-IDs.
- `create_location` (Anmeldung): legt einen Artikelstandort mit Land, PLZ und Ort an (Schlüssel `ygo-default`).
- `set_environment` (Anmeldung): wechselt Sandbox ↔ Produktion; **trennt** dabei (Tokens und Richtlinien leeren).
- `disconnect` (Anmeldung): löscht Tokens.
Refresh-Token-Laufzeit (~18 Monate): 30 Tage vor Ablauf ein Hinweis (§7).

### 4.4 Einstellungen (PC und Handy), Abschnitt „eBay"
Umgebung, Verbinden/Trennen (öffnet die Zustimmungs-URL im Browser), Check-Liste mit Häkchen, Richtlinien-Auswahl, „Standort anlegen", „Jetzt abgleichen", letzter Lauf und letzter Fehler. Solange der Check nicht grün ist, bleiben eBay-Angebote auf `wartet`.

## 5. Einstellen, Ändern, Beenden (H3b1)

### 5.1 Tabelle `ebay_listings` (nur die Funktion schreibt)
`listing_id` (Schlüssel), `environment`, `state` (`wartet`|`online`|`fehler`|`beendet`), `sku`, `offer_id`, `item_id`, `item_url`, `published_qty`, `synced_hash`, `error`, `synced_at`, `updated_at`. Geräte lesen; der PC zieht sie als **Nur-Lese-Strom** (kein Push).

### 5.2 Abbildung (reine Deno-Funktion, getestet, §10)
| Feld | Regel |
|---|---|
| Art | Gleiche Karten (ein Druck, gleicher Zustand, gleiche Auflage, gleiche Sprache) → **Menge n**, **Stückpreis** = Angebotspreis ÷ n (Regel `pieceCents` aus H3a). Konvolut → Menge 1, Gesamtpreis. |
| SKU | `L-<listing_id>` |
| Titel | Angebotstitel (≤ 65 aus H3a, eBay erlaubt 80); leer → Titel-Regel aus H3a |
| Beschreibung | Angebotsbeschreibung, HTML-entschärft, Zeilenumbrüche als `<br>` |
| Kategorie | Einzelkarten/gleiche Karten `183454` („Einzelne Yu-Gi-Oh! TCG Karten“), Konvolut `183455` („Sammlungen & Lots“, Nutzer 22.09.); eBay.de, Festpreis, `GTC` |
| Merkmale | Pflichtmerkmale einmal je Lauf aus der eBay-Taxonomie (`getItemAspectsForCategory`), befüllt aus den Kartendaten: Spiel „Yu-Gi-Oh! TCG", Hersteller „Konami", Kartenname (deutsch, Rückfall englisch), Set, Rarität, Sprache, Merkmal „1. Auflage" falls zutreffend. Fehlt eBay ein Pflichtmerkmal → `fehler` mit eBays Meldung. |
| Zustand | „Ungraded" + Kartenzustand: MT/NM → Near mint or better; EX → Lightly played; GD/LP → Moderately played; PL/PO → Heavily played. Konvolut: schlechtester Zustand. |
| Bilder | eigene Fotos (Reihenfolge), danach Katalogbild je Druck, höchstens 24 |
| Richtlinien, Standort | aus `ebay_account` |

### 5.3 Abgleich je Angebot
- **Soll** = Angebot auf Kanal `ebay`, Status `aktiv`, lebende Positionen; Menge = Zahl lebender Positionen mit lebendem Exemplar.
- **Einstellen:** Soll aktiv, kein `offer_id` → Inventar-Artikel anlegen, Offer anlegen, veröffentlichen → `online`, `item_url`.
- **Ändern:** Prüfsumme über Titel, Text, Preis, Menge, Zustand, Bilder weicht von `synced_hash` ab → Inventar-Artikel/Offer aktualisieren.
- **Menge senken:** H3a nimmt Positionen heraus (z. B. anderswo verkauft) → neue Menge übertragen.
- **Zurückziehen:** Angebot `beendet`/`verkauft`/gelöscht oder Menge 0 → Offer zurückziehen → `beendet`.
- **Manuell auf eBay beendet** (Offer nicht mehr veröffentlicht, obwohl Soll aktiv) → `fehler` „auf eBay beendet – in der App beenden oder erneut einstellen". Andere manuelle Änderungen auf eBay überschreibt der nächste Abgleich (App ist Quelle).
- **Umgebung:** `ebay_listings.environment` ≠ aktuelle Umgebung → Zeile gilt als `beendet (andere Umgebung)`; neu einstellen in der aktuellen.

### 5.4 Anzeige in der App (PC und Handy)
Übersicht und Detail eines eBay-Angebots: Marke „auf eBay online" (Link `item_url`), „wartet auf eBay", „eBay-Fehler: …" mit „Erneut versuchen" (stößt `ebay-sync` an). Nach Anlegen/Ändern/Beenden eines eBay-Angebots stößt das Gerät `ebay-sync` an.

## 6. Eigene Fotos (H3b1)

- **Speicher** `listing-photos` (Supabase Storage): öffentlich lesbar (eBay lädt die Bilder selbst), schreiben nur angemeldet; Pfad `<listing_id>/<uuid>.jpg`.
- **Tabelle `listing_photos`:** `photo_id`, `listing_id`, `path`, `sort`, `created_at`, `updated_at`, `deleted`; PC-Strom in beide Richtungen wie `listings`.
- **Handy:** „Foto hinzufügen" (Kamera oder Galerie), Löschen, Reihenfolge; **PC:** „Datei wählen", Löschen, Reihenfolge. Vor dem Hochladen auf höchstens 1600 px lange Seite, JPEG, Ziel < 500 KB (eBay verlangt ≥ 500 px).
- Höchstens **12** eigene Fotos je Angebot. Fotos gelten für alle Kanäle (auch „Bilder"-Ordner/Teilen aus H3a).
- Löschen ist weich; die Datei bleibt im Speicher (eBay hat sie kopiert).

## 7. Verkäufe automatisch (H3b2)

### 7.1 Abholen
Je Lauf: eBay-Bestellungen mit Änderung seit `orders_cursor`. Tabelle **`ebay_orders`**: `order_id` (Schlüssel), `environment`, `sale_id`, `status` (`gebucht`|`storniert`|`fehler`), `fees_final`, `raw_total`, `created_at`, `updated_at` — nie doppelt buchen.

### 7.2 Buchen (ein H2-Verkauf je Bestellung)
- Zu jeder Bestellposition das Angebot über die SKU; bei Menge q die ersten q lebenden Positionen, sortiert nach `copy_id`.
- Kanal eBay; Datum = Bestelldatum in Europe/Berlin; **Preis** = Artikelpreis + vom Käufer bezahlter Versand; **Gebühren** vorläufig = Preis × Kanal-Prozentsatz (H2), Marke „Gebühren vorläufig"; **Versand** leer (Hinweis „Versandkosten nachtragen"); Notiz „eBay-Bestellung <Nummer>".
- Aufteilung/Marktwert per **Deno-Zwilling** von `sales-math` (Fixture `docs/fixtures/sales/sales.json`), Buchung über `book_sale`.
- Danach Angebot ganz/teilweise verkauft und **Aufräumen** anderer Angebote per **Deno-Zwilling** von `listing-text` (`cleanupAfterSale`, `afterListingSale`; Fixture `docs/fixtures/listings/listings.json`).

### 7.3 Echte Gebühren
Späterer Lauf liest eBays Finanzdaten (Transaktionen zur Bestellung); sobald vorhanden, Gebühren per `update_sale` nachtragen (Marktwert bleibt eingefroren), `fees_final = true`, Marke entfällt.

### 7.4 Käufer-Storno vor Versand
Bestellung storniert → H2-Storno (`cancel_sale`), Karten kommen zurück, Hinweis; Angebot wird nicht still neu eingestellt („Erneut anbieten").

### 7.5 Karte inzwischen anderswo verkauft
Buchen, was noch lebt; Hinweis „eBay-Verkauf, aber Karte schon anderswo verkauft – bitte prüfen"; H2-Doppelverkauf-Erkennung greift.

### 7.6 Hinweise `sale_notices`
`notice_id`, `kind` (`reminder`|`shipping`|`error`|`token`), `text`, `sale_id`, `listing_id`, `created_at`, `updated_at`, `dismissed`. Anzeige auf Start (beide Geräte) und als Banner in „Angebote", bis weggetippt; PC zusätzlich Windows-Benachrichtigung (Muster Preis-Alarme). PC zieht sie als Strom (Wegtippen wird geschoben).

## 8. Ablauf `ebay-sync`

- **Zeitplan:** pg_cron alle 5 Minuten mit Header `x-ebay-secret`. **Sofort:** angemeldeter Aufruf durch ein Gerät nach eBay-relevanter Änderung oder „Jetzt abgleichen".
- **Nur ein Durchgang gleichzeitig** (Datenbank-Sperre, `pg_try_advisory_lock`); ein zweiter Aufruf antwortet „läuft schon".
- **Reihenfolge:** 1. Token erneuern; 2. Bestellungen abholen und buchen (H3b2); 3. Gebühren nachtragen (H3b2); 4. Angebote abgleichen (höchstens 50 je Durchgang); 5. Stand schreiben.
- In H3b1 laufen nur 1, 4, 5.

## 9. Fehlerfälle und Sicherheit

| Fall | Verhalten |
|---|---|
| eBay nicht erreichbar/überlastet | Durchgang bricht ab, nächster versucht es erneut; Soll steht in `listings` |
| Einzelne Anzeige abgelehnt | nur dieses Angebot `fehler` mit Meldung, „Erneut versuchen" |
| Zustimmung widerrufen / Token abgelaufen | „Verbindung abgelaufen – bitte neu verbinden" + Hinweis; neue eBay-Angebote bleiben `wartet` |
| Einrichtung unvollständig | Angebote `wartet`, Check zeigt Fehlendes |
| Umgebung wechseln | trennt; eBay-Stand merkt sich die Umgebung |
| Manuell auf eBay geändert/beendet | §5.3 |

**Sicherheit:** Secrets nur in Supabase; Tokens nur in `ebay_account` (keine Regel für `authenticated`); Geräte sehen `ebay_status`; `ebay-auth`-Rücksprung nur mit gültigem, einmaligem `state` (10 min); alle anderen Aktionen prüfen das JWT; keine Tokens/Secrets in Protokollen; Einspielen, Secrets, Deploy und Zeitplan macht der Nutzer; Agents rufen keine Funktionen auf.

## 10. Tests

- **Deno-Zwillinge** gegen `docs/fixtures/sales/sales.json` und `docs/fixtures/listings/listings.json` (H3b2; für H3b1 nur `pieceCents` und die Mengenregel).
- **Abbildung** (reine Deno-Funktionen) gegen `docs/fixtures/ebay/*.json`: Angebot → Inventar-Artikel/Offer (Menge, Stückpreis, Zustand, Merkmale, Bilder, HTML-Entschärfung), Prüfsumme; H3b2: Bestellung → Buchung (Exemplar-Auswahl, Werte, mehrere Positionen), Gebühren aus Finanzdaten.
- **Abgleicher mit nachgebautem eBay** (eingespeiste `fetch`-Antworten, kein Netz): einstellen, ändern, Menge senken, zurückziehen, manuell beendet, Token abgelaufen, Einzelfehler, zweiter paralleler Lauf; H3b2: Bestellung doppelt geliefert, Storno, Karte schon verkauft, Gebühren nachtragen.
- **PC/Handy:** Nur-Lese-Ströme (`ebay_listings`, `ebay_status`) bzw. Ströme (`listing_photos`, `sale_notices`), Foto-Verkleinern, Marken und Hinweise, Einstellungen.
- **Abnahme:** vollständig in der **Sandbox** (verbinden, Check, einstellen, ändern, zurückziehen; H3b2: Sandbox-Käufer kauft, Buchung, Gebühren, Storno), danach Produktion mit einer echten Karte.

## 11. Bau-Reihenfolge

- **H3b1 — Verbinden und Einstellen:** SQL (`ebay_account`, `ebay_status`, `ebay_listings`, `listing_photos`, Speicher), `ebay-auth`, Einrichtungs-Check, `ebay-sync` Schritte 1/4/5, Fotos (PC + Handy), Anzeige, Einstellungen, Anleitung (Secrets, RuName-Rücksprung-Adresse `https://<projekt>.supabase.co/functions/v1/ebay-auth?action=callback`, Deploy, Cron). Danach verkauft der Nutzer echt auf eBay und bucht per Tipp aus dem Angebot (H3a).
- **H3b2 — Verkäufe automatisch:** `ebay_orders`, `sale_notices`, Schritte 2/3, Deno-Zwillinge, Käufer-Storno, Hinweise (Start, Banner, Windows-Benachrichtigung).

## 12. Risiken

- **eBay-Pflichtmerkmale** ändern sich; die Funktion liest sie live, eine Anzeige kann trotzdem mit Meldung auf `fehler` gehen.
- **Kategorie-Zustandsbeschreibungen** (Ungraded + Kartenzustand) sind eBay-spezifisch; falls eBay die Kennungen ändert, schlägt Einstellen mit Meldung fehl.
- **Öffentliche Foto-Adressen:** nicht erratbar, aber in der eBay-Anzeige öffentlich.
- **Keine automatische Rücksendung:** Erstattungen nach Versand bleiben manuell.
- **Zeitplan-Latenz:** ohne Anstoß bis zu 5 Minuten zwischen Änderung und eBay.
