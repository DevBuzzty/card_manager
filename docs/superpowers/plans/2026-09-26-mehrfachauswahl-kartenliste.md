# Mehrfachauswahl in der Kartenliste — Umsetzungsplan

**Ziel:** In der Kartenliste (PC und Handy) lassen sich mehrere Karten auswählen. Eine Leiste unten bietet an:
- **Verkaufen…** öffnet den Verkaufsweg aus I2 mit allen gewählten Exemplaren (verkauft buchen, Angebot erstellen, auf die Verkaufsliste).
- **Verschieben…** legt alle gewählten Exemplare in einen Behälter oder nimmt sie heraus, mit Rückgängig-Leiste.

Das schließt Spec I §5.1, Satz 2: „Derselbe Einstieg erscheint in der Kartenliste bei Mehrfachauswahl“. Das war aus I2 bewusst ausgeklammert.

**Entscheidungen (26.09.2026):**
- **Auswahl am PC:** über den Knopf „Auswählen“ in der Werkzeugzeile oder per Strg+Klick auf eine Kachel. Esc hebt die Auswahl auf.
- **Auswahl am Handy:** langes Drücken startet sie, danach wählt Tippen aus oder ab, „Zurück“ hebt sie auf.
- **Welche Exemplare:** alle lebenden Exemplare aller Drucke der gewählten Karten. Bei aktivem Behälter-Filter nur die Exemplare in diesen Behältern.
- **Verschieben:** Ziel ist jeder Behälter oder „Kein Behälter“. Seite und Fach werden geleert, wie bei `setCopyLocation`. „Rückgängig“ stellt den alten Standort je Exemplar wieder her.
- **Nicht enthalten:** Löschen per Mehrfachauswahl (zu riskant ohne eigene Rückfrage-Logik) und Tags per Mehrfachauswahl.

## Aufgaben

1. **Zwilling `selection`:** Fixture `docs/fixtures/copies/selection.json`, `desktop/src/utils/selection.js` und `android/.../ml/Selection.kt`, jeweils mit Test.
   - `selectionCopies(groups, copiesByPrinting, containerFilter)` liefert die Exemplare, sortiert nach `copy_id`.
   - `selectionText(cards, copies)` erzeugt „1 Karte · 3 Exemplare“.
   - `moveText(n, targetName)` und `moveUndoText`.
2. **PC-Hauptprozess:** `copies.cjs#moveCopies(db, { copyIds, containerId })` in einer Transaktion. Es nimmt jede Behälterart oder `null`, gibt die alten Standorte zurück und leert Seite und Fach. `restoreLocations(db, locations)` ist das Rückgängig. Dazu die IPC-Kanäle `move-copies` und `restore-copy-locations` (main, preload, Wächter) und Tests.
3. **PC-Oberfläche:**
   - `CollectionList`/`CollectionGrid`/`CardTile`: Auswahlzustand, Häkchen-Overlay, Strg+Klick, Esc.
   - `CollectionToolbar`: Knopf „Auswählen“.
   - Neue `SelectionBar.jsx` mit „Alle sichtbaren“, „Verkaufen…“, „Verschieben…“, „Abbrechen“.
   - `MoveDialog.jsx` als Behälter-Auswahl.
   - `SellFlowDialog` bekommt ein frei wählbares `subtitle`.
   - Die Exemplare für den Verkaufsweg kommen aus `listSaleCopies` (dort steht `for_sale`).
4. **Handy:**
   - `CollectionScreen`: `combinedClickable` (langes Drücken), Häkchen, Auswahl-Leiste unten statt des FAB, `BackHandler`.
   - `SellFlowSheet` bekommt `subtitle`.
   - `ContainerPicker` wird `internal`.
   - Neues `MoveSheet`: Schleife über `CollectionRepository.setCopyLocation` in `InFlight`, danach `awaitSync`, Snackbar mit Rückgängig.
5. **Bauen, installieren, prüfen** (PC per CDP auf einer DB-Kopie ohne Sync, Handy am Gerät), Merge nach OK.

Prüfläufe wie in I2: Renderer-Helfer, Electron-Suite, Lint = 5, `vite build`, `gradlew testDebugUnitTest assembleRelease`.
