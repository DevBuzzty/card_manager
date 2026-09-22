# Spec I — Neustruktur und Gestaltung

**Stand:** 2026-09-22 · **Betrifft:** Desktop (Electron/React) und Handy (Android/Compose) · **Vorgänger:** Spec C (Navigation), H1–H3b (Verkaufen)

## 1. Warum

Die App ist gewachsen, die Oberfläche nicht mitgewachsen. Drei Probleme, die den täglichen Gebrauch bremsen:

1. **„Sammlung“ ist ein Sammelbecken.** Darunter liegen Karten, Binder, Sets, Wunschliste, Decks, Sealed — und innerhalb von „Karten“ nochmals sieben Chips (Alle, Unbekannt, Duplikate, Zum Verkauf, Angebote, Unvollständig, Foils) plus Werkzeugleiste mit Filter, Export und Preisen. Drei Ebenen Navigation auf einem Bildschirm.
2. **Der Verkaufsweg ist nicht erkennbar.** Heute: Exemplar öffnen → Schalter „Zum Verkauf“ → Bereich wechseln → Zeile anhaken → „Verkauft buchen“ oder „Angebot erstellen“. Vier Orte für einen Vorgang, ohne Hinweis, dass es weitergeht.
3. **Die Gestaltung schreit.** Neonviolett auf Fast-Schwarz, Leuchtränder, dazu Gelb für Set-Codes, Magenta für Seltenheiten, Orange für Preise, Grün für Haken. Nichts hat Vorrang, weil alles gleich laut ist. Das Bunteste auf dem Bildschirm sollte die Karte sein.

Dazu zwei konkrete Mängel: Unter jedem Exemplar ohne Behälter steht „ohne Standort“ (bei 14 Exemplaren vierzehnmal), und die Fußzeile des Exemplar-Dialogs schneidet bei fünf Knöpfen den letzten ab.

**Ziel:** Weniger Orte, ein erkennbarer Verkaufsweg, eine ruhige Oberfläche — auf beiden Geräten gleich.

**Nicht-Ziele:** Keine neuen Fachfunktionen. Keine Änderung an Datenmodell, Cloud-Schema oder Synchronisierung. Kein Umbau von Scannen, Binder-Einsortieren, Deckbau oder der eBay-Anbindung über das hinaus, was die neue Struktur erzwingt.

## 2. Ist-Zustand (Ausgangspunkt der Arbeit)

| Ort | Datei |
|---|---|
| PC-Seitenleiste, Reihenfolge | `desktop/src/components/Sidebar.jsx:36-65`, `desktop/src/utils/i18n-de.js:28-34` |
| PC-Routen | `desktop/src/App.jsx:113-144` |
| PC „Sammlung“-Segmente | `desktop/src/components/SammlungLayout.jsx:6-13` |
| PC Kartenliste mit sieben Chips | `desktop/src/components/CollectionList.jsx` (727 Zeilen; Chips `:590-612`, Weiche `:687-723`, Werkzeugleiste `:501-568`) |
| PC Kartendetail, Exemplarzeilen | `desktop/src/components/CardDetailPanel.jsx:280-364`, „ohne Standort“ `:351` |
| PC Exemplar-Dialog | `desktop/src/components/CopySheet.jsx:206-333`, Fußzeile ohne Umbruch `:298-324` |
| PC Verkaufsliste | `desktop/src/components/ForSaleList.jsx:106-137` |
| Handy-Navigation | `android/.../ui/AppNav.kt:85-89, 337-357` |
| Handy „Sammlung“-Segmente | `android/.../ui/SammlungScreen.kt:17-24` |
| Handy Kartenliste, vier Chips | `android/.../ui/CollectionScreen.kt:225-228` |
| Handy Kartendetail / Exemplar-Blatt | `android/.../ui/CardDetailScreen.kt:195-321`, `CopySheet.kt:196-309` |
| Handy Verkaufslisten | `android/.../ui/SaleLists.kt:211-313` |
| Farbpalette PC | `desktop/tailwind.config.js` (`space-*`) |

## 3. Struktur

### 3.1 Bereiche am PC

Die Seitenleiste wird in vier Gruppen geteilt. Gruppenüberschriften sind Text, keine aufklappbaren Bäume.

```text
Alltag      Start
            Scannen              ← Zähler, solange Unbekannte offen sind
Bestand     Sammlung             → Karten · Binder · Sets · Wunschliste · Sealed
            Decks
Handel      Verkaufen            → Kandidaten · Zum Verkauf · Angebote · Verkäufe
            Deals
Auswertung  Insights
            Einstellungen
```

Umzüge gegenüber heute:

| Inhalt | heute | künftig |
|---|---|---|
| Duplikate | Sammlung → Karten → Chip | Verkaufen → **Kandidaten** |
| Zum Verkauf | Sammlung → Karten → Chip | Verkaufen → **Zum Verkauf** |
| Angebote | Sammlung → Karten → Chip | Verkaufen → **Angebote** |
| Verkäufe | Insights → Reiter | Verkaufen → **Verkäufe** |
| Unbekannt | Sammlung → Karten → Chip | **Scannen** (eigener Abschnitt, Zähler in der Seitenleiste) |
| Unvollständig, Foils | Sammlung → Karten → Chips | **Gespeicherte Filter** in der Kartenliste |
| Decks | Sammlung → Segment | eigener Bereich **Decks** |

Insights behält Bestand, Wert, Verlauf und Preisentwicklung — alles Auswertung, kein Vorgang.

### 3.2 Bereiche am Handy

Untere Leiste: **Start · Sammlung · Verkaufen · Deals**, in der Mitte weiterhin der Scan-Knopf. Decks, Insights und Einstellungen bleiben Kacheln auf Start (wie Insights heute).

Innerhalb der Bereiche gilt dieselbe Unterteilung wie am PC, in derselben Reihenfolge und mit denselben Wörtern. Wo der PC eine linke Leiste hat, hat das Handy eine Reiterzeile; die Namen sind identisch.

### 3.3 Kartenliste

Die Chip-Zeile entfällt ersatzlos. Übrig bleibt eine Zeile mit Suche, **Filter**, **Sortierung** und den Werkzeugen (Exportieren, Preise). Die weggefallenen Sichten werden zu **gespeicherten Filtern**, die im Filter-Bereich oben als Voreinstellungen stehen:

- „Unvollständige Daten“ (fehlender Set-Code, fehlende Seltenheit oder fehlender Preis)
- „Nur Foils“

Gespeicherte Filter verhalten sich wie von Hand gesetzte Filter: Sie erscheinen als aktive Filter-Chips und lassen sich einzeln entfernen. Neue eigene Filter zu speichern ist **nicht** Teil dieser Spec.

„Unbekannt“ (Karten mit `set_code = 'Unknown'`) zieht als eigener Abschnitt zu **Scannen**, samt der bestehenden Sammel-Aktionen („Auf Standard-Set setzen“, „Alle zusammenführen“). In der Seitenleiste steht die Anzahl hinter „Scannen“, solange sie größer als null ist.

## 4. Kartendetail und Exemplare

### 4.1 Exemplarzeile

Jedes Exemplar wird eine Zeile mit genau drei Angaben plus Marken:

```text
NM · 1. Auflage · Ordner A, Seite 3                     [zum Verkauf]
EX · Unlimitiert · noch nicht einsortiert
```

- Zustand und Auflage stehen vorn, weil sie den Wert bestimmen.
- Der Standort steht als Klartext („Ordner A, Seite 3“, „Box Doppelte“). Fehlt der Behälter, steht **„noch nicht einsortiert“** in leiser Textfarbe — nie „ohne Standort“.
- Rechts höchstens zwei Marken: **zum Verkauf** (Warnfarbe), **angeboten** (Erfolgsfarbe). Verkaufte Exemplare erscheinen nicht in dieser Liste (unverändert zu heute).
- Ein Klick auf die Zeile öffnet den Exemplar-Dialog (unverändert).

### 4.2 Exemplar-Dialog

Aufbau von oben nach unten:

1. **Kopf:** Kartenname, darunter Druck, Zustand, Auflage als leiser Text. Schließen rechts.
2. **Mitte (scrollt):** Standort (Behälter, Seite, Fach), Tags, Notiz. Der Schalter „Zum Verkauf“ **entfällt** — die Verkaufsabsicht wird über die Aktion gesetzt (§5).
3. **Fuß (fest):** rechts **Speichern** als einzige Hauptaktion, links daneben **Verkaufen** (öffnet den Fluss aus §5), ganz links unauffällig **Entfernen**. Die Zeile bricht um, wenn der Platz nicht reicht (`flex-wrap`), und wird nie abgeschnitten.

Am Handy gilt derselbe Aufbau; das Blatt behält sein bisheriges Scrollverhalten, die Aktionen liegen unten in Daumenreichweite.

## 5. Verkaufsweg

### 5.1 Einstieg

„Verkaufen“ am Exemplar öffnet **im selben Fenster** drei Wege:

| Weg | Wirkung |
|---|---|
| **Verkauft buchen** | Öffnet den bestehenden Verkaufsdialog für dieses Exemplar. |
| **Angebot erstellen** | Öffnet den bestehenden Angebotsdialog für dieses Exemplar. |
| **Auf die Verkaufsliste** | Setzt `for_sale = 1` (heutiger Schalter) und schließt. Rückmeldung: „Auf der Verkaufsliste · Ansehen“. |

Derselbe Einstieg erscheint in der Kartenliste bei Mehrfachauswahl und in „Kandidaten“. Die bestehenden Sammel-Aktionen in „Zum Verkauf“ bleiben unverändert erhalten — gebündeltes Arbeiten ist weiterhin möglich, nur nicht mehr der einzige Weg.

### 5.2 Wie sich der Weg anfühlt (prüfbare Anforderungen)

1. **Kein Fensterstapel.** Vom Exemplar bis zur Bestätigung bleibt genau ein Fenster bzw. ein Blatt offen; der Inhalt wechselt darin. Übergänge dauern 120–200 ms und verschieben die darunterliegende Liste nicht.
2. **Vorbelegung.** Preis aus dem aktuellen Marktwert der Variante, Kanal wie beim letzten Mal, Zustand und Auflage vom Exemplar, Datum heute. Ein Verkauf zum Vorschlagspreis braucht höchstens zwei Bestätigungen.
3. **Sofort sichtbar.** Marken und Zähler ändern sich beim Klick, die Cloud zieht im Hintergrund nach. Scheitert das Schreiben, erscheint die Zeile wieder im alten Zustand mit einer Fehlermeldung.
4. **Bestätigung ohne Unterbrechung.** Nach dem Buchen erscheint für sechs Sekunden eine Leiste: „Verkauft gebucht · 4,50 € · Rückgängig“. Kein Dialog zum Wegklicken; „Rückgängig“ ruft die bestehende Storno-Funktion.
5. **Keine Sackgasse.** Jeder Abschluss bietet den nächsten sinnvollen Schritt an („Nächstes Exemplar“, „Angebot ansehen“, „Fertig“).
6. **Fehler im Fluss.** Fehlermeldungen erscheinen als Zeile an der Stelle, an der sie entstehen, mit einer Handlung, die sie behebt (z. B. „Preis liegt unter dem eBay-Mindestpreis von 1,00 € · Auf 1,00 € setzen“).
7. **Tastatur und Daumen.** Am PC: Enter = weiter, Esc = zurück, sinnvolle Tab-Reihenfolge, sichtbarer Fokusrahmen. Am Handy: Aktionen unten, Blatt wegwischbar, keine Eingabe hinter der Tastatur.

### 5.3 Bereich „Verkaufen“

Vier Stationen in der Reihenfolge des Vorgangs, jede mit Anzahl in der Reiterzeile:

| Station | Inhalt | Quelle heute |
|---|---|---|
| **Kandidaten** | Duplikate: mehrfach vorhandene Drucke, nach Wert sortiert, mit Vorschlag „behalten: 1“ | `DuplicatesList.jsx` |
| **Zum Verkauf** | Vorgemerkte Exemplare, Sammel-Aktionen „Verkauft buchen“, „Angebot erstellen“, „Exportieren“, je Zeile „Zurück in die Sammlung“ | `ForSaleList.jsx` |
| **Angebote** | Aktive und beendete Angebote, Kanalmarken, eBay-Marken, „Erneut versuchen“ | `ListingsList.jsx`, `ListingDetail.jsx` |
| **Verkäufe** | Gebuchte Verkäufe, Erlöse, Gebühren, Storno | `SalesPanel.jsx`, `SaleDetail.jsx` (heute unter Insights) |

Am Handy fehlt in „Zum Verkauf“ weiterhin der Export (wie heute, `SaleLists.kt:211`).

## 6. Gestaltung

### 6.1 Rollen statt Farben

Farben stehen künftig nur noch als **Rolle** im Code. Jede Rolle hat einen hellen und einen dunklen Wert.

| Rolle | Verwendung |
|---|---|
| `bg` | Seitengrund |
| `surface` | Karten, Leisten, Dialoge |
| `surface-2` | eingelassene Flächen (Zeilen, Felder) |
| `line` | Trennlinien, Rahmen |
| `text` | Fließtext, Überschriften |
| `text-muted` | Nebenangaben, Platzhalter, Set-Code, Seltenheit |
| `accent` / `accent-fg` | alles Klickbare: Hauptknöpfe, aktive Navigation, Fokus |
| `good` / `warn` / `bad` | nur Richtung: Gewinn, Achtung, Verlust/Fehler |

Werte (Katalog):

| Rolle | hell | dunkel |
|---|---|---|
| `bg` | `#f6f4ef` | `#17181a` |
| `surface` | `#fffdf8` | `#1d1f21` |
| `surface-2` | `#f1eee7` | `#232528` |
| `line` | `#e0dbd1` | `#2e3134` |
| `text` | `#1b1a17` | `#e9eaec` |
| `text-muted` | `#6c675e` | `#9ba0a6` |
| `accent` | `#4b3f8f` | `#8b6ad6` |
| `accent-fg` | `#ffffff` | `#14151a` |
| `good` | `#3f7d54` | `#7fa88a` |
| `warn` | `#9a6b1f` | `#c9a36b` |
| `bad` | `#a23b3b` | `#c07a7a` |

Alle Paare Text-auf-Fläche erreichen mindestens Kontrast 4,5:1, große Schrift und Rahmen mindestens 3:1.

### 6.2 Regeln

1. Keine Farbverläufe, keine Leuchtränder, keine farbigen Schatten. Erhebung entsteht durch Fläche und Linie.
2. **Eine** Akzentfarbe. Wo heute Violett, Magenta, Gelb, Orange und Grün nebeneinanderstehen, steht künftig `accent` oder gar keine Farbe.
3. Set-Code und Seltenheit in `text-muted`. Seltenheit darf durch Schriftschnitt hervorgehoben werden, nicht durch Farbe.
4. Preise in `text`. `good`/`bad` nur für Veränderung (Wertverlauf, Gewinn/Verlust), `warn` für „braucht Aufmerksamkeit“, `bad` für Fehler.
5. Ein Bildschirm hat höchstens eine Hauptaktion in `accent`.

### 6.3 Schrift, Zahlen, Raster

- Eine Schriftfamilie (Systemschrift), vier Größen: Überschrift 22, Abschnitt 17, Zeile 15, Nebensache 12–13 Punkt; Zeilenhöhe 1,5.
- Zahlen mit gleicher Ziffernbreite (`font-variant-numeric: tabular-nums`, Compose entsprechend), damit Preisspalten nicht zappeln.
- Abstände auf einem 4-Punkte-Raster; Standardabstand zwischen Blöcken 16, innerhalb einer Gruppe 8.
- Ecken: 10 Punkte für Flächen, 6 für Felder und Knöpfe, rund nur für Marken.

### 6.4 Umsetzung

**PC:** Die Rollen werden CSS-Variablen auf `:root` und `[data-theme="dark"]`; Tailwind bekommt sie als Farbnamen (`bg-surface`, `text-muted`, `bg-accent`). Die Palette `space-*` in `desktop/tailwind.config.js` entfällt, sobald keine Datei sie mehr nutzt.

**Handy:** Dieselben Rollen als Compose-Farbschema (helles und dunkles `ColorScheme` mit denselben Namen), abgeleitet aus einer gemeinsamen Quelle.

**Gemeinsame Quelle:** Eine Datei `docs/fixtures/design/tokens.json` hält Rollen und Werte. PC und Handy lesen sie beim Bauen bzw. bilden sie ab; ein Test je Seite prüft, dass die tatsächlich benutzten Werte mit der Datei übereinstimmen — dasselbe Zwillingsmuster wie bei Titel- und Markenregeln.

**Umschalter:** Einstellungen → Darstellung mit „Hell“, „Dunkel“, „Wie das System“. Vorgabe: hell. Die Wahl gilt je Gerät und wird nicht gespiegelt: am PC in der lokalen `settings`-Tabelle (`theme`; diese Tabelle steht in keinem Sync-Strom), am Handy in den lokalen Einstellungen.

## 7. Verträglichkeit

- **Keine Datenänderung.** Kein neues Feld außer `settings.theme`, keine Migration, kein Cloud-Schema.
- **Routen:** Die alten Adressen (`/sammlung/karten?segment=forsale` und Verwandte) leiten auf die neuen um, damit Lesezeichen und der Rückkanal vom Handy weiter funktionieren.
- **Tiefe Verweise:** Die bestehenden Sprünge von Start-Kacheln und aus Benachrichtigungen (`CollectionChip` am Handy, `AppNav.kt:231-233`) zeigen nach dem Umbau auf die neuen Orte.
- **Sprache:** Alle sichtbaren Texte bleiben deutsch; geänderte Texte sind in dieser Spec benannt.

## 8. Abnahme

Am Gerät zu prüfen, PC und Handy:

1. Die Seitenleiste zeigt vier Gruppen; „Scannen“ trägt die Anzahl der Unbekannten, „Verkaufen“ die Zahl offener Vorgänge.
2. Die Kartenliste hat keine Chip-Zeile mehr; „Unvollständige Daten“ und „Nur Foils“ sind im Filter erreichbar und erscheinen als entfernbare Filter-Chips.
3. Unbekannte Karten sind unter „Scannen“ erreichbar, die Sammel-Aktionen wirken dort wie vorher.
4. Ein Exemplar ohne Behälter zeigt „noch nicht einsortiert“; kein Bildschirm enthält den Text „ohne Standort“.
5. Der Exemplar-Dialog zeigt alle Knöpfe vollständig, auch bei schmalem Fenster; die Zeile bricht um.
6. Vom Exemplar aus lassen sich alle drei Wege erreichen; „Verkauft buchen“ ist mit höchstens zwei Bestätigungen erledigt, danach erscheint die Rückgängig-Leiste und ein Vorschlag für den nächsten Schritt.
7. Verkaufen zeigt vier Stationen mit Anzahlen; Verkäufe sind dort und nicht mehr unter Insights.
8. Hell und Dunkel lassen sich in den Einstellungen umschalten; in beiden ist jeder Text lesbar (Kontrast geprüft), und kein Bildschirm enthält Verläufe oder Leuchtränder.
9. Am Handy liegen unten vier Ziele plus Scan-Knopf; die Unterteilungen heißen wie am PC.
10. Die bestehenden Testsuiten laufen unverändert grün (Desktop-SQLite, Helfer, Android), ESLint bleibt bei fünf bekannten Fehlern.

## 9. Umsetzung in zwei Schritten

**I1 — Struktur und Rollen.** Bereiche und Umzüge auf beiden Geräten, Kartenliste ohne Chips, Unbekannte bei Scannen, Rollen-Schicht samt Hell/Dunkel-Umschalter, Katalog-Werte auf allen Bildschirmen. Ergebnis: Die App ist vollständig benutzbar und sieht neu aus.

**I2 — Verkaufsweg und Feinschliff.** Exemplarzeile, aufgeräumter Exemplar-Dialog samt Umbruch, Verkaufen-Einstieg mit drei Wegen, Fluss-Regeln aus §5.2, Rückgängig-Leiste, nächster-Schritt-Vorschläge.

## 10. Risiken

- **Breite Streuung:** Die Rollen-Umstellung berührt praktisch jede Oberflächendatei. Gegenmittel: erst die Schicht einziehen, dann Datei für Datei umstellen, Testsuiten nach jedem Schritt.
- **Compose und CSS driften auseinander.** Gegenmittel: gemeinsame Token-Datei plus Zwillings-Test je Seite.
- **Große Dateien:** `CollectionList.jsx` (727 Zeilen) verliert durch den Umbau Inhalte; die verbleibende Datei wird beim Umbau aufgeteilt (Liste, Filter, Werkzeugleiste). Andere überlange Dateien (`StagingArea.jsx`, `Settings.jsx`, `SortIntoBinderScreen.kt`) bleiben unberührt.
- **Gewohnheit:** Vertraute Wege ändern sich. Gegenmittel: gleiche Wörter wie bisher, Weiterleitungen von alten Adressen.

## 11. Nicht enthalten

H3b2 (Bestellungen, Gebühren, Storno von eBay), F2 (Fremd-Import), neue Auswertungen, Umbau von Scannen oder Deckbau, zusätzliche Verkaufskanäle.
