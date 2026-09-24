# Aufgabe: Kaltstart-Zwischenspeicher am Handy

**Stand:** 24.09.2026 · **Wann:** nach der I1-Abnahme (vor oder neben I2) · **Vorarbeit:** Zweig `perf/handy-ladewege` (3d2a83c)

## Warum

Nach dem Performance-Umbau öffnen die Reiter sofort. Nur der **App-Start** dauert noch: `CollectionStoreCore.loadInitial()` holt bei jedem Kaltstart die ganze Sammlung aus der Cloud (am Xiaomi 14: 2482 Karten-Gruppen, 8683 Karten, ~7–8 Tsd. Exemplare; drei geblätterte Abfragen zu je 1000 Zeilen, dazu JSON-Parsen). Einen Speicher auf dem Gerät gibt es für Karten, Exemplare und Behälter nicht, nur für den Katalog (`CatalogDb`).

## Ziel

Beim Kaltstart zeigt die App den **zuletzt gespeicherten Stand sofort** und holt im Hintergrund nur die Änderungen seit dem letzten Abgleich (der Delta-Weg existiert schon: `runDelta()` mit `SyncCursor`).

## Umrisse

- **Speichern:** nach jedem erfolgreichen Laden oder Abgleich `cards`, `copies`, `containers` plus die drei `TableCursor` (Stichtag und Serverzeit) auf das Gerät schreiben, im Hintergrund und entprellt. Gerätespeicher als eigene SQLite-Datei oder als komprimiertes JSON unter `filesDir`, **nicht** in der Katalog-Datenbank.
- **Laden:** `startInitialLoad()` liest zuerst den Gerätespeicher. Passt das Konto, gilt sofort `Ready`, und `requestSync()` stößt den Delta-Abgleich an. Ohne Speicher oder bei Lesefehler: vollständiges Laden wie heute.
- **Konto:** Der Speicher trägt die Nutzer-ID (aus dem Token). Bei einem anderen Konto wird er verworfen. `clear()` (Abmelden/Kontowechsel) löscht ihn mit.
- **Generationen:** Die Generationsprüfung aus `CollectionStoreCore` gilt auch für das Schreiben. Ein Lauf von vor dem Abmelden darf nichts speichern.
- **Gelöschte Zeilen:** Der Delta-Abgleich liefert auch gelöschte Zeilen (`deleted`), `DeltaMerge` entfernt sie. Beim Speichern landen nur lebende Zeilen auf dem Gerät.
- **Veralteter Stand:** Ist der Speicher älter als N Tage oder das Schema neuer als die App, wird vollständig geladen (Versionsfeld im Speicher).
- **Anzeige:** `SyncHint` zeigt wie heute, wenn der Abgleich scheitert. Der Nutzer sieht also, dass er einen gespeicherten Stand vor sich hat.

## Prüfbar

1. Zweiter Kaltstart: Start-Bildschirm mit Zahlen in unter 1 s ab dem Ende der Anmeldung (Flugmodus: ebenso, mit Hinweis „nicht abgeglichen“).
2. Eine Änderung am PC erscheint nach dem Kaltstart am Handy (Delta nach gespeichertem Stichtag).
3. Abmelden und mit einem anderen Konto anmelden: kein Datensatz des alten Kontos sichtbar.
4. Tests nach dem Muster von `CollectionStoreCoreTest`: Speicher lesen/schreiben mit nachgebauter Quelle, Konto-Wechsel, Generation, beschädigte Datei → vollständiges Laden.

## Nicht enthalten

R8/Code-Verkleinerung (eigene Aufgabe, braucht einen Gerätetest von Scanner und OCR) und ein eigenes Baseline-Profil der App (Macrobenchmark-Modul).
