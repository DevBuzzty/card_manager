# Spec B — Nachtrag: Aufteilung in B1/B2 und Einsortieren über das Staging

**Datum:** 2026-09-09
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-b-binder-organisation-design.md`
**Grund:** Die Fassung vom 5. September entstand, bevor A, C und D gebaut waren. Drei ihrer Annahmen stimmen nicht mehr, und der Umfang ist für einen Plan zu groß.

---

## 1. Was sich seit dem 5. September geändert hat

Spec B setzt A und C voraus. Beide sind gebaut — und haben Teile von B gleich mitgenommen oder verschoben. Dazu kam Spec D in vier Teilen, deren letzter (D4) den Scanner umgebaut und eine Grundsatzentscheidung getroffen hat, die auf B durchschlägt.

| Annahme in Spec B | Stand am 2026-09-09 |
|---|---|
| §5.2: fünf Spalten an `card_copies` müssen angelegt werden | **Bereits gebaut.** `container_id`, `page`, `slot`, `tags`, `note` stehen in `copies-schema.cjs`, und `sync.cjs` spiegelt sie. Der A-Plan hat die spec-übergreifenden Spalten vorab angelegt, wie es die Programm-Übersicht vorsah. |
| §8: zwei SQL-Dateien für Supabase | **Nur noch eine.** `containers_schema.sql`. Die Spalten-Migration `card_copies_location_migration.sql` entfällt. |
| §7.1: Segment „Binder" neben Karten · Wunschliste · Sets · Decks | **Fehlt weiterhin.** Spec C hat die vier anderen ausgeliefert und Binder bis B zurückgestellt. Bleibt Aufgabe von B. |
| §6.3: „Passcode + Set-Code-Kandidaten aus der Pipeline" | **Überholt, zu Bs Vorteil.** Seit D3/D4 liefert `ScanResolver.resolve` ein fertiges `ResolvedScan` (Basiskarte, bekannte Drucke, Code-Treffer, Ampel). Der Einsortier-Modus konsumiert das, statt eine eigene Auswertung zu bauen. |
| §6.3: „Dedup über das bestehende IoU-Tracking" | Heißt heute konkret: `BoxTracker` vergisst einen Passcode nach `maxMisses` Bildern ohne Sicht, davor liegt die Merkliste `seen`. Unverändert nutzbar. |

## 2. Änderung: unbekannte Karten gehen ins Staging, nicht in die Sammlung

**Spec B §6.3 sagt:** Wird beim Einsortieren eine Karte erkannt, die nicht in der Sammlung ist, legt der Scanner sie an und weist sie dem Fach zu.

**Das gilt nicht mehr.** Nutzerentscheidung vom 2026-09-09, in derselben Sache wie bei D4: Spec D §7a wollte ebenfalls an der Sammlung vorbei schreiben und wurde deshalb ersetzt. Die Begründung trägt hier genauso — das Staging ist der einzige Ort, an dem eine Fehlerkennung sichtbar wird, **bevor** sie in der Sammlung steht. D3s Abschlussreview hat belegt, dass zwei kritische Fehler hinter grünen Ampeln saßen; eine falsch erkannte Karte bekäme sonst einen Binderplatz, an dem sie niemand je sucht.

**Stattdessen gilt:**

1. Die unbekannte Karte wandert ins normale Staging.
2. Der Staging-Eintrag trägt die **Fach-Reservierung** — Behälter, Seite, Fach —, für die er gedacht war.
3. Das Fach **rückt sofort vor**. Du legst die Karte physisch ein; der Scanner darf dich nicht auf eine Bestätigung warten lassen.
4. Beim Übernehmen des Stapels wird das Exemplar angelegt **und gleich an den reservierten Platz gesetzt**.
5. Übernimmst du nie, bleibt das Fach leer. Das ist sichtbar und harmlos — im Raster steht ein gestricheltes Fach.

Die Reservierung ist neu gegenüber Spec B und gehört zu **B2**. Sie braucht drei nullbare Felder am Staging-Eintrag und eine Zeile im Übernehmen-Pfad; ein eigener Datenstrom entsteht nicht.

## 3. Änderung: der Einsortier-Modus stagt immer lokal

Zwei Regeln kollidieren:

- Spec B §6.2: „Kein Staging-Zähler, kein Prüfen-Button, **kein Desktop-Spiegel**" im Einsortier-Modus.
- Spec D4 §6: **kein Handy-Staging**, sobald der PC verbunden ist — alles geht an den PC.

Zusammen ergäbe das für eine unbekannte Karte im Einsortier-Modus bei verbundenem PC: nirgendwohin.

**Es gilt:** Der Einsortier-Modus stagt **immer am Handy**, auch bei verbundenem PC, und spiegelt nichts. Die Fach-Reservierung gehört zu dem Binder, vor dem der Nutzer gerade steht — sie in eine Liste am Schreibtisch zu schicken, träfe den falschen Ort. D4s Regel bleibt für den normalen Scan-Ablauf unverändert; der Einsortier-Modus ist eine eigene Aufgabe, keine Spielart davon.

## 4. Änderung: `ScanScreen.kt` wird vor dem Einsortier-Modus aufgeteilt

`ScanScreen.kt` ist auf **1.100 Zeilen** gewachsen und trägt vier ineinandergreifende lokale Funktionen — `stageScan`, `aggregateRepeat`, `sendScan`, `onCapture` — mit Regeln, die nicht offensichtlich sind: Buchung und Zielermittlung müssen zusammen auf dem Hauptthread liegen, das Rückgängig arbeitet über Objektidentität statt über Indizes, und jeder Pfad, der einen Passcode in `seen` einträgt, braucht einen, der ihn wieder freigibt. Zwei dieser Regeln entstanden in D4 erst nach je zwei Fixrunden.

Der Einsortier-Modus wäre der fünfte Zweig in dieser Datei. **Erster Task von B2 ist deshalb ein verhaltensgleicher Umbau**, der die Scan-Logik aus der Compose-Datei herauszieht — dieselbe Bewegung, die D4 mit `ScanResolver` schon zur Hälfte gemacht hat. Nutzerentscheidung vom 2026-09-09.

## 5. Aufteilung in B1 und B2

Spec B als ein Plan wären rund 15 Tasks. Spec D wurde aus demselben Grund in vier Teile zerlegt; jeder war für sich abnehmbar. Für B genügen zwei.

### B1 — Behälter und Standort

Alles, was ohne Scanner auskommt und für sich benutzbar ist.

- **Datenmodell:** Tabelle `containers` (§5.1) in `database.cjs`; Standort-Index auf `card_copies`; Supabase-SQL `containers_schema.sql` (Tabelle, RLS, `updated_at`-Trigger), vom Nutzer im Dashboard angewandt. Die fünf Spalten am Exemplar sind bereits da.
- **Sync (§8):** dritter Strom `containers` mit eigenem Cursor, Soft-Delete, Echo-Skip; Zyklus-Reihenfolge Behälter **vor** Exemplaren; Löschen räumt in einer Transaktion die Standorte mit ab.
- **IPC (§9):** `list-containers`, `save-container`, `delete-container`, `set-copy-location`, `set-copy-tags-note`, `list-unsorted-copies`, `list-tags` — jeweils in `main.cjs` **und** `preload.cjs`.
- **Ansichten:** Segment „Binder" auf beiden Geräten mit Behälterliste, Belegung, Wert und dem Zähler „Nicht einsortiert" (§7.1); **Exemplar-Sheet** für Standort, Tags und Notiz (§7.3) — die einzige Schreibstelle für Tags und Notiz; Standort-Chip im Kartendetail; Filter nach Behälter und Tag (§7.4); Zähler auf der Startseite (§7.5).
- **Android:** `ContainersRepository`, `CopyRow` um die fünf Felder erweitert, `BindersScreen`, `CopySheet`, Erweiterungen an `CollectionRepository`, `CardDetailScreen`, `CollectionScreen`, `StartScreen`.

**Abnahme B1:** Behälter anlegen, umbenennen, löschen; ein Exemplar von Hand einem Behälter zuordnen; Tags und Notiz setzen; nach Behälter und Tag filtern; beide Geräte zeigen dasselbe; Behälter löschen setzt seine Exemplare auf „nicht einsortiert".

### B2 — Raster und Einsortieren

- **Task 1:** `ScanScreen.kt` verhaltensgleich aufteilen (§4 dieses Nachtrags).
- Binder-Ansicht als Seitenraster mit Blättern, Verschieben und „Aus Fach nehmen" (§7.2).
- `SlotMath` (`next`, `firstFree`) als reine, getestete Funktionen — Kotlin und JavaScript, als Zwillinge markiert, wie `ScanAggregator`/`scanAggregate` aus D4.
- Einsortier-Modus (§6) samt Auswahl-Sheet, Verschieben-Sheet, Rückgängig und der Fach-Reservierung aus §2 dieses Nachtrags.
- `pickCandidate(copies, passcode, setCodes)` als reine, getestete Funktion.

## 6. Was unverändert gilt

Alles Übrige aus Spec B bleibt: die Entscheidungstabelle (§4), das Datenmodell §5.1 und §5.3, die Ansichten §7 mit Ausnahme der oben genannten Punkte, die Sync-Regeln §8, die Testliste §10 und die Risiken §11. Insbesondere bleiben die Nicht-Ziele aus §3 in Kraft — kein Drag-and-Drop, keine Mehrfachzugehörigkeit, kein Einsortieren vom Desktop aus über den Socket.
