# Spec D4 — Zwei Scan-Modi und kein Handy-Staging bei verbundenem PC

**Datum:** 2026-09-08
**Ersetzt:** Spec D §7a („Speed-Scan-Modus")
**Baut auf:** D1 (Offline-Katalog), D2 (OCR-Zonen), D3 (Printing, Edition, Ampel)

---

## 0. Warum das jetzt geht

D3 hat die Set-Code-Erkennung so weit gebracht, dass sie bei der Geräteabnahme
in 31 von 31 Fällen den richtigen Code lieferte. Erst dadurch wird ein
Wiederhol-Scan überhaupt sinnvoll: die Regel „gleicher Setcode → plus eins"
setzt voraus, dass der Setcode stimmt. Vor D3 hätte sie Mengen auf die falschen
Drucke addiert.

## 1. Was gebaut wird

Zwei Dinge, die sich an einer Stelle berühren:

1. **Ein zweiter Scan-Modus.** Heute wird jede Karte pro Stapel genau einmal
   erfasst. Neu wählbar: ein Modus, in dem ein erneutes Erkennen derselben
   Karte die Menge erhöht statt verworfen zu werden.
2. **Kein Handy-Staging, wenn der PC verbunden ist.** Die Karte geht dann
   ausschließlich an den PC; am Handy bleibt nur eine Rückmeldung.

## 2. Abgrenzung gegen Spec D §7a

§7a beschrieb einen „Speed-Scan", der **direkt in die Sammlung** schreibt, das
Staging überspringt und Unsicheres in eine Nachprüfen-Liste legt; ein
Desktop-Spiegel war dort ausdrücklich nicht vorgesehen.

Diese Spec ersetzt das. Der Unterschied ist keine Geschmacksfrage: das Staging
ist der einzige Ort, an dem eine Fehlerkennung **vor** dem Schreiben in die
Sammlung sichtbar wird. Eine Ampel, die auf Grün steht, obwohl die Karte falsch
aufgelöst wurde, kostet im Staging einen Klick und in der Sammlung eine
Nachforschung. D3s Abschlussreview hat genau diesen Fall belegt: zwei kritische
Fehler saßen hinter grünen Ampeln und wurden erst durch nachträgliche Prüfung
gefunden.

Übernommen wird aus §7a der Pref-Schlüssel **`scan_mode`** und der Gedanke, den
Modus im Scan-Screen umzuschalten. Verworfen wird das Schreiben an der
Sammlung vorbei und die Nachprüfen-Liste (letztere ist ohne Sammlungs-Schreiben
gegenstandslos — das Staging *ist* die Nachprüfen-Liste).

## 3. Die beiden Modi

| | `einzeln` (Voreinstellung, heutiges Verhalten) | `stapel` (neu) |
|---|---|---|
| Erste Erkennung | Neuer Staging-Eintrag | Neuer Staging-Eintrag |
| Erneute Erkennung derselben Karte | Verworfen | Wird zusammengefasst (Abschnitt 4) |
| Merkliste `seen` | Aktiv | Umgangen |

Der Schalter sitzt im Scanner-Overlay bei Blitz und Fokus-Sperre und wird in
`scanner_prefs` unter `scan_mode` gemerkt (Werte `einzeln` / `stapel`,
unbekannte oder fehlende Werte lesen als `einzeln`).

**Wann eine erneute Erkennung entsteht:** `BoxTracker` vergisst einen Passcode
nach `maxMisses` Bildern ohne Sicht. Eine Karte, die aus dem Bild verschwindet
und wiederkommt, ist damit ein neues Ereignis. Zwei gleiche Karten gleichzeitig
im Bild sind zwei Boxen und damit zwei Ereignisse. Diese Mechanik existiert und
wird nicht angefasst — Modus `stapel` entfernt lediglich die `seen`-Sperre, die
davor liegt.

## 4. Die Zusammenfassungsregel

Für einen erkannten Passcode `PC` mit aufgelöstem Setcode `SC`:

| Lage | Wirkung |
|---|---|
| Kein Eintrag für `PC` | Neuer Eintrag, Menge 1 |
| Eintrag da, Hauptdruck hat `SC` | Menge des Hauptdrucks + 1 |
| Eintrag da, ein Zusatzdruck hat `SC` | Menge dieses Zusatzdrucks + 1 |
| Eintrag da, `SC` kommt nicht vor | Neuer Zusatzdruck mit `SC`, Menge 1 |
| Eintrag da, `SC` nicht lesbar (`null`) | Menge des **Hauptdrucks** + 1 |

Die letzte Zeile ist eine bewusste Nutzerentscheidung: eine Karte, deren Code
nicht gelesen wurde, ist wahrscheinlich dieselbe wie die eben gescannte, nicht
eine neue unbekannte. Der Fehler ist im Staging sichtbar und dort mit einem
Klick zu korrigieren.

**Kein Netzzugriff.** Die bekannten Drucke (`knownSets`) liegen am vorhandenen
Eintrag bereits vor; `SetCodeMatch.best` läuft direkt gegen sie. Eine
Wiederholung ist damit sofort, offline und ohne Katalogzugriff aufgelöst.

**Wettlauf mit der ersten Auflösung.** Trifft eine Wiederholung ein, während der
erste Scan derselben Karte noch auflöst, ist `knownSets` leer und der Setcode
damit `null` — die Wiederholung landet nach der Regel oben als `+1` am
Hauptdruck. Das ist das gewünschte Verhalten und braucht keine Warteschlange:
in der Sekunde zwischen zwei Erkennungen derselben Karte ist „dieselbe Karte
nochmal" die richtige Annahme, und die Auflösung, die gleich fertig wird, gilt
dann für beide Kopien.

**Datenform:** Beide Seiten haben die nötigen Felder schon.
Handy: `ScanStagingEntry.quantity` und `ScanStagingEntry.extraPrintings`
(`ExtraPrinting` mit `selectedSet`, `quantity`, `edition`, `condition`).
PC: `card.quantity` und `card.extraPrintings`, beide in `handleAdd` bereits
ausgewertet. Es entsteht keine neue Datenform.

**Neue Zusatzdrucke** erben Edition und Zustand aus den Voreinstellungen
(`Prefs.defaultEdition` / `defaultCondition` am Handy, `defaults` am PC) —
dieselbe Quelle, aus der ein Haupteintrag sie heute bekommt.

## 5. Wo die Regel wohnt

**Die Zusammenfassung passiert dort, wo das Staging steht.** Offline führt sie
das Handy, bei verbundenem PC führt sie der PC.

Die Regel in einer Hand zu bündeln ist nicht möglich, ohne Teil 2 aufzugeben:
hielte das Handy die Wahrheit und spiegelte sie nur, gäbe es weiterhin ein
Handy-Staging — bloß unsichtbar. Es könnte außerdem von dem abweichen, was der
Nutzer am PC gerade von Hand geändert hat.

**Über die Leitung geht kein Modus-Feld.** In Modus `einzeln` schickt das Handy
nie eine Wiederholung, weil `seen` sie abfängt. Der PC kann deshalb
bedingungslos zusammenfassen: sieht er eine Wiederholung, war sie gewollt. Das
hält die Schnittstelle frei von einem Zustand, den beide Seiten sonst
gleichzeitig richtig halten müssten.

Der Preis ist die Regel aus Abschnitt 4 in zwei Sprachen. Das ist bewusst: die
Alternative — eine Seite zur dummen Anzeige der anderen zu machen — kostet mehr
als die doppelte Regel, und die Regel ist fünf Zeilen ohne Zustand.

## 6. Kein Handy-Staging bei verbundenem PC

### 6.1 Auslöser

Allein „PC verbunden" (`isConnected`). Kein eigener Schalter. Fällt die
Verbindung während des Scannens weg, führt das Handy ab der nächsten Karte
wieder selbst Staging; bereits gesendete Karten bleiben beim PC.

### 6.2 Auflösen ohne Eintrag

Heute steckt das Auflösen einer Karte — Katalog, Druckliste, `SetCodeMatch`,
`ScanConfidence` — **in** `stageScan`, also im Erzeugen des Staging-Eintrags,
und schreibt seine Zwischenstände direkt in dessen Felder. Ohne Handy-Staging
gibt es keinen Eintrag, in den hinein aufgelöst werden könnte.

Das Auflösen zieht deshalb in ein eigenes `ScanResolver` um, das ein Ergebnis
**zurückgibt**, statt Felder zu setzen:

```
suspend fun resolve(pc, evidence, framesEvidence, editionTexts, defaultEdition)
    : ResolvedScan?      // null = Karte nicht gefunden

class ResolvedScan(base, knownSets, match, confidence, edition)
```

Zwei Abnehmer, ein Auflöser:
- **offline:** Eintrag sofort mit `loading = true` anlegen (unverändertes
  Gefühl), dann aus `ResolvedScan` befüllen.
- **verbunden:** direkt auf die Leitung, kein Eintrag.

Das ist kein Aufräumen nebenbei, sondern die Voraussetzung dieses Abschnitts.
Der Nebengewinn: die Auflösung wird erstmals ohne Compose prüfbar.

Der Ablauf bleibt inhaltlich identisch — Katalog zuerst, verifizierte Drucke
sonst Netz-Union, `SetCodeMatch.best`, `ScanConfidence.fromEvidence`, die
Protokollzeile aus D3. Nur der Ort ändert sich.

### 6.3 Was das Handy zeigt

Die Fußzeile zeigt statt Liste und Übernehmen-Knopf:

> **42 an den PC gesendet** · ● (Ampelfarbe des letzten Scans)

Der Punkt nutzt `ScanStagingLogic.dotColor` — keine neuen Farben. Der Zähler
zählt gesendete Karten seit Scannerstart und wird von der Freigabe (6.4) nicht
verringert; er ist eine Fortschrittsanzeige, keine Bestandsanzeige.

### 6.4 Rückkanal: Freigabe

Heute redet der PC nie mit dem Handy. Ohne Rückkanal wüchse `seen` unbegrenzt
und dieselbe Karte wäre in einem späteren Stapel nie wieder scannbar.

Weil der PC **pro Karte** übernimmt (`handleAdd(tempId)`), nicht als Stapel,
wird das Signal feiner als ein Stapelende: **„diese Karte ist durch."** Der PC
sendet sie bei

- `handleAdd` — nach erfolgreichem Schreiben in die Sammlung,
- `handleDiscard` — die Karte wurde verworfen,
- `handleClearAll` — alle Passcodes der Liste auf einmal.

Ereignis `staging_released` mit `{ passcodes: string[] }`. Das Handy entfernt
diese Passcodes aus `seen` und macht sie damit sofort wieder scannbar.

Neu anzulegen (Hausregel: jeder IPC-Kanal in `main.cjs` **und**
`preload.cjs`):
- `main.cjs`: `ipcMain.handle('release-staged', …)` → `io.emit('staging_released', …)`
- `preload.cjs`: `releaseStaged(passcodes)`
- `ScanScreen.kt`: `socket.on("staging_released")` → `seen.removeAll(...)`

Bei nicht verbundenem Handy ist das `io.emit` wirkungslos — kein Sonderfall.

**Bewusste Folge:** wird eine Karte am PC übernommen, während das Handy noch
scannt, und taucht sie danach erneut auf, entsteht am PC ein **neuer** Eintrag,
obwohl die vorige Kopie schon in der Sammlung steht. Das ist richtig: es ist
eine weitere physische Kopie.

## 7. Rückgängig beim Doppelzählen

Bei jedem `+1` blinkt der Bildschirm anders als bei einer Neuaufnahme und
meldet kurz:

> **Angriff der Giganten ×2** — *rückgängig*

**Offline** nimmt ein Tipper das `+1` zurück — an genau der Stelle, an der es
gebucht wurde (Hauptdruck oder der betroffene Zusatzdruck; ein Zusatzdruck, der
durch diesen Scan erst entstand, verschwindet wieder).

**Bei verbundenem PC** ist die Meldung nur informativ, ohne Knopf. Korrigiert
wird am PC, wo der Eintrag mit seinen `+`/`−`-Knöpfen sichtbar in der Liste
steht, bevor du übernimmst — ein falscher Zähler kann dort nicht übersehen
werden. Damit entfällt ein zweites Rückkanal-Ereignis und dessen Behandlung.

## 8. Prüfbarkeit

Die Regel aus Abschnitt 4 kommt als reines Objekt `ScanAggregator` mit
JVM-Test daneben — dasselbe Muster wie `ScanStagingLogic`, `CardZones` und
`RarityRank`: die Entscheidung ist getrennt von der Compose-Anzeige, die sie
ausführt. Dieses Projekt hat keine Compose-Tests; eine Regel, die nur in einem
`@Composable` steht, ist ungeprüft.

Zu prüfen sind mindestens die fünf Zeilen der Tabelle in Abschnitt 4, dazu:
gleicher Setcode bei mehreren Zusatzdrucken trifft den richtigen; ein
Zusatzdruck erbt die Voreinstellungen; `null`-Setcode bei einem Eintrag *mit*
Zusatzdrucken landet trotzdem am Hauptdruck.

Die PC-seitige Fassung derselben Regel bekommt keinen Test — das Projekt hat
keinen Desktop-Testlauf, und einen dafür einzurichten gehört nicht in diese
Spec.

`ScanResolver` wird durch die Umstellung erstmals testbar; diese Spec verlangt
dafür keine Tests (das Verhalten ist unverändert und in D3 abgenommen).

## 9. Was ausdrücklich nicht dazugehört

- Kein Schreiben an der Sammlung vorbei (siehe Abschnitt 2).
- Keine Nachprüfen-Liste.
- Keine Änderung an Erkennung, Zonen, Ampel oder Editionslesung.
- Kein Rückkanal-Widerruf (Abschnitt 7).
- Kein Modus-Feld im Socket-Nutzdatensatz (Abschnitt 5).

## 10. Abnahme

1. Modus `einzeln`, PC aus: unverändertes heutiges Verhalten.
2. Modus `stapel`, PC aus: dieselbe Karte zweimal → ein Eintrag, Menge 2.
3. Modus `stapel`, PC aus: zwei Drucke derselben Karte → ein Eintrag,
   Hauptdruck plus ein Zusatzdruck.
4. Modus `stapel`, PC aus: Rückgängig nach einem `+1` stellt die Menge wieder
   her.
5. PC an: am Handy erscheint keine Staging-Liste, die Fußzeile zählt hoch, die
   Karten stehen am PC.
6. PC an, Modus `stapel`: Wiederholung erhöht die Menge **am PC**.
7. PC an: „Übernehmen" am PC gibt die Karte am Handy wieder frei — dieselbe
   Karte lässt sich danach erneut scannen.
8. PC während des Scannens trennen: das Handy führt ab der nächsten Karte
   wieder eigenes Staging.
