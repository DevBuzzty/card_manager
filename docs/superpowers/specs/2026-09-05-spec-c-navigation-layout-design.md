# Spec C — Navigation und Layout (Desktop + Handy)

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). C räumt um, damit A (Exemplare) und alle späteren Specs an logischen Stellen landen. Hängt von A nur dort ab, wo Exemplar-Gruppen angezeigt werden; C kann vor oder parallel zu A gebaut werden, die betreffenden Stellen zeigen bis dahin `× Menge`.

## 1. Problem

Die App wirkt wie eine Alpha: Entwickler-Details im Erststart (Supabase-URL, anon key), Verbindungsstatus als Fließtext über der Kamera, Sprachmix (Deutsch/Englisch) auf beiden Geräten, eine „Mehr"-Rumpelkammer am Handy, keine Zurück-Navigation, sieben Dropdowns in einer Kopfzeile, „Factory Reset" neben „Backup". Informationen liegen nicht dort, wo man sie braucht. Handy und Desktop haben unterschiedliche Landkarten.

## 2. Ziel

- Beide Geräte haben **dieselbe Landkarte**: Start · Scannen · Sammlung (Karten · Wunschliste · Sets · Decks) · Deals, plus Einstellungen.
- Jeder Screen zeigt seine Information an der logischen Stelle, technische Details sind versteckt, aber erreichbar.
- Echte Navigation: Zurück funktioniert überall, Zustände sind adressierbar.
- Durchgehend Deutsch, ein Wortschatz.
- Design-System (Farben, Fonts, SpaceCard, Sidebar-Optik) bleibt. **Umräumen, nicht neu anstreichen.**

## 3. Nicht-Ziele

- Neue Funktionen. Keine Ordner (B), keine Karten-Charts (G), kein Deckbuilder-Inhalt (E), keine Scan-Genauigkeit (D).
- Farb-/Typo-Redesign.
- iOS.

## 4. Gemeinsamer Wortschatz

| Begriff | Nicht mehr |
|---|---|
| Start | Home, Übersicht, Dashboard, „Welcome back, Duelist" |
| Scannen | Scan, Staging Area, Incoming Scans |
| Sammlung | Collection, My Collection |
| Karten / Wunschliste / Sets / Decks | Wishlist, Set-Vervollständigung, Deck Builder |
| Deals | Deals & Preis-Alerts |
| Insights | Statistics, Portfolio (als Tab) |
| Einstellungen | Settings |
| Übernehmen | Commit, Submit, Save |
| Prüfen | Review |
| Abbrechen / Zurück | Cancel / Back |
| Exemplar, Printing, Set-Code, Rarity, Passcode, Edition, Zustand | Variante, Variant, Druckvariante (uneinheitlich) |

Yu-Gi-Oh-Fachbegriffe bleiben englisch (Rarity, Set-Code, Passcode, Secret Rare …).

---

## 5. Handy

### 5.1 App-Shell

Vier Tabs plus erhabener Scan-Button, **kein „Mehr"**:

| Tab | Inhalt |
|---|---|
| **Start** | Wert-Dashboard oben (Gesamtwert, Veränderung, Verlauf-Chart), darunter Zuletzt gescannt, neue Deal-Treffer, Set-Fortschritt. Ersetzt `UebersichtScreen` + `PortfolioScreen` als Tab; der Verlauf-Chart wandert in die Start-Kopfkarte. |
| **Sammlung** | Segment-Leiste `Karten · Wunschliste · Sets · Decks` (Material3 `SegmentedButton`/TabRow oben). Hostet `CollectionScreen`, `WishlistScreen`, `SetCompletionScreen`, `DecksScreen`. |
| **Scan** (FAB) | Kamera, siehe 5.3. |
| **Deals** | `DealsScreen` wie heute. |
| **Profil-Icon** | oben rechts auf Start; öffnet Einstellungen (5.6). |

`Tab.PORTFOLIO` und `Tab.SETTINGS` entfallen; `MoreScreen.kt` wird gelöscht.

### 5.2 Navigation und Back-Stack

- **Navigation Compose** (`androidx.navigation:navigation-compose` 2.7.x, kompatibel mit Kotlin 2.0 / compileSdk 34). Ein `NavHost` mit Bottom-Bar-Zielen als Top-Level-Routen und Detail-Zielen darüber.
- Routen: `start`, `sammlung/{segment}`, `deals`, `scan`, `karte/{id}/{setCode}/{language}/{rarity}`, `set/{setCode}`, `deck/{deckId}`, `einstellungen`, `login`.
- Zurück-Taste und Zurück-Pfeil tun dasselbe. Tab-Wechsel behält den Stack des jeweiligen Tabs (`saveState`/`restoreState`). Bottom-Bar bleibt auf Top-Level-Zielen sichtbar, verschwindet auf Detail-Zielen und im Scan.
- Karten-Detail ist von überall erreichbar: Sammlung, Staging-Sheet, Deals, Suche, Set-Detail, Deck.
- Die `var sub`-Muster in `MoreScreen`/`CollectionScreen` werden durch Routen ersetzt.

### 5.3 Scan-Screen

- Vollbild-Kamera. **Kopfleiste:** links Schließen (zurück zum vorherigen Tab), Mitte Titel „Scannen" mit einem **Status-Punkt** (grün = Desktop verbunden, grau = nicht; Tipp zeigt einen Satz als Snackbar: „Desktop verbunden – Scans werden zusätzlich an den PC gespiegelt." / „Kein Desktop – Scans bleiben am Handy."), rechts Tastatur-Icon für manuelle Passcode-Eingabe (Dialog, deutsch: Passcode, Abbrechen, Übernehmen).
- **Fußleiste:** Zähler „n Karten erkannt" + Button **Prüfen (n)**. Tipp öffnet das Staging als **Bottom-Sheet** (`ModalBottomSheet`) über der Kamera; Kamera läuft dahinter weiter, Sheet lässt sich wegwischen und wieder öffnen, ohne dass Einträge verloren gehen.
- **Staging-Sheet** = heutiger `ScanStagingScreen`-Inhalt (Set-Auswahl, Menge, weitere Printings, ab A der Zustand/Edition-Chip). Button **Übernehmen** committet alle Einträge, leert das Staging, schließt das Sheet, Zähler auf 0. Kein „Neu", keine „Scan History", kein „Clear History" mehr: das Staging ist die History.
- **Verhalten:** Jeder Scan landet **immer** im Handy-Staging. Ist ein Desktop-Socket verbunden, wird der Scan **zusätzlich** gesendet (Spiegel), nie stattdessen. Der Desktop dedupliziert wie heute über Passcode im Staging.
- Ohne Kamera-Recht: ein Leerzustand mit Erklärung und Button „Kamera erlauben". Kein IP-Formular mehr an dieser Stelle (`ConfigScreen` entfällt).

### 5.4 Login

- Ein Screen: Logo/Name, E-Mail, Passwort, **Anmelden**. Fehlertext inline (deutsch).
- Supabase-URL und Publishable Key kommen aus `BuildConfig.SUPABASE_URL` / `BuildConfig.SUPABASE_KEY`, gespeist aus `local.properties` (`supabase.url`, `supabase.key`, nicht im Git; `local.properties.example` dokumentiert die Keys).
- Zusammengeklappter Bereich **„Erweitert"** enthält die beiden Felder weiterhin und überschreibt die BuildConfig-Werte in den Prefs, falls gesetzt (anderes Projekt anbinden).
- Nach Login → `start`. Bereits angemeldet → Login wird übersprungen, kein Flackern (Splash bleibt bis `SupabaseCloud.signIn()` beantwortet ist).

### 5.5 Sammlung › Karten

- Kopf: Titel + Lupen-Icon; das Suchfeld klappt erst beim Tipp auf (Fokus + Tastatur), X schließt und leert.
- Zeile darunter: Sortier-Chip (Wert · Preis · Name · Neueste), **Filter**-Chip mit Zähler aktiver Filter, Umschalter **Liste / Grid**.
- **Filter-Sheet** (Bottom-Sheet): Set, Rarity, Typ, Attribut, Sprache; ab A zusätzlich Zustand, Edition. Aktive Filter erscheinen als Chips unter der Kopfzeile, jeder mit X.
- **Grid-Ansicht:** 3 Spalten Kartenbilder (Coil), unten links Menge, unten rechts Preis; Tipp → Detail.
- **Plus-FAB** unten rechts: „Karte suchen und hinzufügen" (`SearchScreen` als Route).

### 5.6 Einstellungen (über Profil-Icon)

Gruppen mit `SectionHeader`, gleicher Aufbau wie heute, ergänzt:
- **Konto:** E-Mail, Abmelden.
- **Desktop-Verbindung:** IP-Feld, Verbindungsstatus, Testen-Button. Text: „Optional. Spiegelt Scans zusätzlich an die Desktop-App."
- **Preise:** Preisquelle.
- **Standards** (ab A): Zustand, Edition.
- **Über:** Version, kurze Beschreibung.

### 5.7 Karten-Detail

Reihenfolge von oben: Bild groß (Hero), Name, Set-Code · Rarity · Sprache, **Preis prominent** (Printing-Preis, ab A Wert der Exemplare), dann **Deine Exemplare** (heute Varianten; ab A Gruppen mit Plus/Minus), dann **Weiteres Printing hinzufügen**, dann eingeklappt: Kartentext, Stats (ATK/DEF/Level/Typ/Attribut). Kopfleiste: Zurück links, Wunschlisten-Herz rechts.

### 5.8 Start

Von oben: Kopfzeile „Start" + Profil-Icon. **Wert-Karte** (Gesamtwert, Δ 7 Tage / 30 Tage aus `portfolio_snapshots`, Verlauf-Canvas-Chart aus `PortfolioScreen`). **Schnellaktionen** (Scannen, Sammlung, Deals). **Zuletzt gescannt** (5 Karten, Tipp → Detail). **Neue Deal-Treffer** (3, Tipp → Deals). **Set-Fortschritt** (Top 3 nach Fortschritt, Tipp → Set-Detail).

---

## 6. Desktop

### 6.1 Sidebar

- Einträge: **Start · Scannen · Sammlung · Deals · Insights**, unten **Einstellungen**. Keine Gruppen-Labels.
- Die Scanner-Server-Box unten wird ein **Status-Pill**: „Handy verbunden" (grün) / „Kein Handy" (grau). Klick → `/einstellungen/verbindung`. Die IP steht dort und zusätzlich im Leerzustand des Scannen-Tabs („Verbinde dein Handy mit 192.168.x.y").
- Socket-Server meldet Verbindungen an den Renderer (`phone-connected` / `phone-disconnected` Events, in `preload.cjs` exponiert), damit der Pill echt ist.

### 6.2 Router

- `react-router-dom` mit `HashRouter` (Electron `file://`-tauglich).
- Routen:
  - `/start`
  - `/scannen`
  - `/sammlung/karten`, `/sammlung/wunschliste`, `/sammlung/sets`, `/sammlung/decks`, `/sammlung/decks/:id`
  - `/deals`
  - `/insights`
  - `/einstellungen/:bereich` (`konto`, `preise`, `verbindung`, `daten`, `standards`, `gefahrenzone`)
  - `/karte/:id/:setCode/:language/:rarity` als **Overlay-Route** über der aktuellen Seite (Seitenpanel, 6.3). `location.state.background` hält die Seite darunter.
- Zurück/Vor: Maus-Tasten 4/5 und Alt+←/→ (Electron `app-command`/Keydown → `navigate(-1|1)`).
- `App.jsx` verliert `activeTab`; `Sidebar` nutzt `NavLink`; `CommandPalette` navigiert auf Routen; `Dashboard`-Callbacks `setActiveTab` werden `navigate`.
- Scan-Staging-Zustand (`scannedCards`) bleibt im App-Root, damit er beim Routenwechsel nicht verloren geht.

### 6.3 Karten-Detail als Seitenpanel

- Rechtes Panel (~420 px, `SpaceCard`-Optik), Liste bleibt links sichtbar und scrollbar. Esc oder X schließt. **Pfeil hoch/runter** wechselt zur vorherigen/nächsten Karte der aktuellen Liste (Liste liefert dem Panel eine geordnete Key-Liste über Context).
- Inhalt in derselben Reihenfolge wie am Handy (5.7): Bild, Name, Printing-Zeile, Preis, Deine Exemplare (ab A Gruppen), Weiteres Printing, eingeklappt Text/Stats. Manuelles Preisfeld (`set-card-price`) bleibt, unter dem Preis.
- `CardDetailModal.jsx` wird zu `CardDetailPanel.jsx`; alle Aufrufer (CollectionList, StagingArea, Deals, CardSearchModal, DeckBuilder) öffnen die Overlay-Route statt lokalem Modal-State.

### 6.4 Sammlung › Karten (CollectionList)

Zwei Ebenen statt einer Kopfzeile:
1. **Zeile 1:** Titel + Zähler, Suche, Ansicht Liste/Grid, Sortierung, **Filter**-Knopf (Zähler aktiver Filter), **Preise**-Menü.
2. **Zeile 2 (ausklappbar):** die heutigen Dropdowns (Typ, Sprache, Attribut, Rasse/Typ, Rarity, Set; ab A Zustand, Edition). Aktive Filter als Chips mit X unter der Zeile, auch wenn Zeile 2 eingeklappt ist.
- **Arbeitslisten-Chips** (Alle / Unbekannt / Unvollständig / Foils) bleiben als Segment links unter Zeile 1.
- **Preise-Menü** (Dropdown): Jetzt aktualisieren (Bulk), Rest scrapen, Auto-Checkbox, Rarity-Schwellwert, Fehlende Daten holen; Statuszeile (letzter Lauf, Anzahl) im Menü-Fuß. Nichts davon mehr in der Kopfzeile.
- Grid-Ansicht: `CardTile` (existiert) in `react-window` FixedSizeGrid.

### 6.5 Start

Ersetzt `Dashboard.jsx`-Inhalt:
- **Wert-Karte:** Gesamtwert, Δ 7 Tage und 30 Tage (aus `portfolio_history`), Sparkline (recharts, klein). Klick → `/insights`.
- **Arbeitslisten-Zähler:** Unbekannt, Fehlende Daten, unvollständig – je Klick → Sammlung mit gesetztem Chip.
- **Zuletzt gescannt** (5), **Neue Deal-Treffer** (3), **Set-Fortschritt** (Top 3).
- Schnellaktion **Scannen** + Handy-Status. Kein Begrüßungstext.

### 6.6 Einstellungen

Linke Unter-Navigation (Bereiche), rechts der Inhalt:
- **Konto & Sync:** Supabase-Login/Status, letzter Sync, Sync jetzt.
- **Preise:** Preisquelle, Cardmarket-Bulk-Status, Auto-Scraper.
- **Verbindung:** IP-Adresse (Kopieren), verbundene Handys, Port-Hinweis.
- **Daten:** Backup, Wiederherstellen, Datenbank verschieben, CSV-Import/-Export.
- **Standards** (ab A): Zustand, Edition.
- **Gefahrenzone:** Factory Reset, Downgrade, Cleanup Duplikate – jeweils rot, eigener Bestätigungsdialog mit Klartext, was passiert.

### 6.7 Scannen (StagingArea)

Bleibt funktional; Anpassungen: Titel „Scannen", Leerzustand mit IP und Handy-Status („Verbinde dein Handy mit …" / „Handy verbunden, warte auf Scans"), Buttons deutsch (CSV importieren, Anleitung, Suchen), Übernehmen statt Commit. Karten-Detail via Overlay-Route.

### 6.8 Insights

Bleibt (Portfolio + Statistics). Nur Titel/Labels deutsch.

---

## 7. Betroffene Dateien

**Android:** `MainActivity.kt` (Shell, NavHost, Bottom-Bar; `MainScreen`/`ConfigScreen`/History entfernen), neu `ui/AppNav.kt` (Routen), `ui/StartScreen.kt` (ersetzt `UebersichtScreen` + `PortfolioScreen`-Tab), `ui/ScanScreen.kt` (Kamera-Shell + Sheet; nutzt `ScannerScreen`-Overlay und `ScanStagingScreen`-Inhalt), `ui/CloudLoginScreen.kt` (E-Mail/Passwort, Erweitert), `ui/CollectionScreen.kt` (Segmente, Filter-Sheet, Grid, FAB), `ui/CardDetailScreen.kt` (Reihenfolge, Herz), `ui/SettingsScreen.kt` (Gruppen), `MoreScreen.kt` löschen, `build.gradle.kts` (navigation-compose, BuildConfig-Felder), `local.properties.example`. Alle Screens: Wortschatz-Durchgang.

**Desktop renderer:** `App.jsx` (Router, Overlay-Route, Staging-State), `Sidebar.jsx` (NavLink, Status-Pill), `Dashboard.jsx` → Start, `CollectionList.jsx` (zwei Ebenen, Preise-Menü, Grid), `CardDetailModal.jsx` → `CardDetailPanel.jsx`, `Settings.jsx` (Bereiche + Gefahrenzone-Dialoge), `StagingArea.jsx`, `Wishlist.jsx`/`SetCompletion.jsx`/`DeckBuilder.jsx` (unter Sammlung-Segmente), `CommandPalette.jsx` (Routen), neu `components/SammlungLayout.jsx` (Segment-Leiste), `utils/i18n-de.js` (Wortschatz-Konstanten, kein Framework).
**Desktop main:** `main.cjs` (Socket connect/disconnect → `phone-connected`/`phone-disconnected`; `app-command` für Maus-Zurück), `preload.cjs` (Events exponieren).
**Dependencies:** `react-router-dom`, `androidx.navigation:navigation-compose`.

## 8. Fehlerfälle

- **Handy offline / Cloud nicht erreichbar:** Start zeigt Wert-Karte mit letztem bekannten Wert und Hinweis „Offline – zuletzt aktualisiert …"; Scannen funktioniert weiter (Staging ist lokal), Übernehmen zeigt Fehler und behält die Einträge.
- **Desktop-Socket bricht ab:** Status-Punkt wird grau, keine Snackbar-Flut (nur bei Zustandswechsel eine).
- **Unbekannte Route** (alter Deep-Link): Redirect auf `/start`.
- **Overlay-Route ohne Hintergrund** (Reload auf `/karte/...`): Panel öffnet über `/sammlung/karten`.

## 9. Tests

- **Desktop:** `rarity.test.mjs`-Stil für `utils/i18n-de.js` (alle Keys vorhanden); React-Router-Smoke: jede Route rendert ohne `window.api` in eine Leerzustands-Ansicht (Vite-Dev im Browser); manueller Durchgang: Zurück/Vor, Panel Pfeil-Navigation, Cmd+K.
- **Android:** statischer Check; On-Device-Durchgang: Login → Start → Scan → Sheet → Übernehmen → Sammlung → Detail → Zurück-Taste bis zum Tab; Tab-Wechsel behält Position; Zurück auf Start beendet App (kein Zwischenzustand).
- **Wortschatz-Grep:** `grep -rn "Collection\|Settings\|Wishlist\|Submit\|Cancel\|Welcome" desktop/src android/…/ui` liefert nach Umbau nur Code-Identifier, keine UI-Strings.

## 10. Reihenfolge im Plan (Vorschlag)

1. Desktop Router + Sidebar + Wortschatz (Fundament, sichtbar, risikoarm).
2. Desktop Panel + Sammlung-Segmente + Toolbar.
3. Desktop Start + Einstellungen.
4. Android NavHost + Shell + Login.
5. Android Scan-Sheet.
6. Android Sammlung + Detail + Start.
