# Ladewege der Android-App — gemessener Performance-Fix

Zweig `perf/messung`. Nur `android/` angefasst; `desktop/` ausschliesslich gelesen.

## Ausgangsmessung (Gerät, echte Sammlung: 2702 Karten, 7440 Exemplare, alle unsortiert)

```
anlegen bis sichtbar = 4494 ms   davon schreiben = 121 ms
reload gesamt = 4329 ms
  Behälter      289 ms  (1 Zeile)
  unsortiert   1501 ms  (7440 Zeilen)
  Karten        966 ms  (2702 Zeilen)
  Exemplare    1573 ms  (7440 Zeilen)
```

Das Schreiben war nie das Problem. 97 % war Nachladen, und zwar vier Aufrufe **nacheinander**,
von denen zwei **dieselben 7440 Zeilen** holten.

## 1. Die doppelte Abfrage ist weg

`created_at` steht jetzt in `COPY_COLS` (`cloud/CollectionRepository.kt`) und als Feld an
`CopyRow`. Damit lässt sich die unsortierte Liste aus den ohnehin geladenen Exemplaren ableiten:

- Neuer Helfer **`ml/UnsortedCopies.kt`** — `from(copies)` filtert auf `containerId == null` und
  sortiert nach `created_at`, dann `copy_id`.
- **Die Reihenfolge bleibt Zeile für Zeile dieselbe wie bisher.** Sie ist im Fach-Füllen-Sheet
  und in der Liste "Nicht einsortiert" sichtbar und spiegelt den Desktop
  (`desktop/electron/copies.cjs#listUnsortedCopies`, `ORDER BY cp.created_at, cp.copy_id`).
  Fehlende Zeitstempel stehen **hinten** — so verhält sich `order=created_at.asc` in PostgREST
  (PostgreSQL setzt bei ASC `NULLS LAST` ein), also genau die Reihenfolge, die bisher ankam.
- Verglichen wird `created_at` als Zeichenkette. Das trifft die zeitliche Ordnung, solange alle
  Werte aus derselben Quelle im selben ISO-Format kommen — bei PostgREST tun sie das. Der Fall
  abgeschnittener Sekundenbruchteile (`.7` gegen `.07` gegen keine) ist ausdrücklich getestet.
- Getestet in **`UnsortedCopiesTest`** (7 Fälle): nur Exemplare ohne Behälter, ältestes zuerst,
  gleicher `created_at` → `copy_id` entscheidet, fehlender `created_at` → hinten, Bruchteile,
  leere Eingabe, Eingabeliste bleibt unverändert.
- Der Desktop macht es genauso: `copies.cjs#listAllCopies` wählt `created_at` mit aus und
  sortiert danach.

### Wie `created_at` gegen die Schreibwege abgesichert ist

Das war der gefährliche Teil: ein Feld, das der Server selbst stempelt, darf kein Schreibweg
mitschicken. Geprüft wurde so:

1. **Alle Schreibwege auf `card_copies` aufgelistet** — `insertCopies()`, `patchCopy()` (und
   damit `removeCopies`, `updateCopyGroup`, `setCopyLocation`, `setCopyTagsNote`, `deleteCopy`,
   `softDelete`), dazu `ContainersRepository.save()`/`delete()`, die per PATCH nur `page`,
   `slot`, `container_id` räumen.
2. **Jeder einzelne baut sein JSON Feld für Feld aus Einzelwerten** — `JSONObject().put("copy_id",
   …).put("card_id", …)…`. **Eine `CopyRow` wird nirgends als Ganzes serialisiert.** Es gibt kein
   `toJson()`, keine Reflexion, keine Serialisierungs-Bibliothek auf dieser Klasse. Ein neues
   Feld an der Datenklasse kann deshalb gar nicht in einen Request geraten.
3. **Gegenprobe per Suche**: `grep -rn "CopyRow(" android` findet genau zwei Konstruktionsstellen
   im Produktivcode — die Datenklasse selbst und `parseCopies()` (Lesepfad). Alle übrigen
   Treffer sind Tests. `grep -rn "CopyRow"` über alle Dateien bestätigt: keine Datei außerhalb
   von Lesepfad/Anzeige berührt sie.
4. **Am Handy gibt es keinen Sync-Weg für Exemplare**, der `CopyRow` hochschieben würde — die
   Cloud ist hier die Datenbank, `sync.cjs` ist Desktop-Code und bleibt unberührt.
5. Der Grund steht als Kommentar direkt am Feld (`CopyRow.createdAt`) und an `COPY_COLS`, damit
   ein späteres `toJson()` nicht unbemerkt daran vorbeigeht.

Zusätzlich: `loadCopies()` sortiert weiterhin serverseitig nach `copy_id.asc`. Das ist Absicht —
diese Ordnung ist eindeutig und macht das `limit`/`offset`-Blättern stabil; die sichtbare
Reihenfolge stellt der Helfer im Speicher her.

### Verbleibende Aufrufer von `listUnsortedCopies()`

**Keine.** Alle drei bisherigen Aufrufer (`BindersScreen`, `BinderPageScreen`, `StartScreen`)
luden ohnehin schon `loadCopies()` und leiten jetzt ab. Die Funktion bleibt stehen — sie ist der
richtige Weg für einen Aufrufer, der **nur** die unsortierten Exemplare braucht und die Sammlung
sonst nicht lädt (für den wäre das Ableiten der teurere Weg). Sie ist als "zurzeit ohne Aufrufer"
markiert; wer sie lieber löschen möchte, kann das gefahrlos tun.

## 2. Die verbleibenden Aufrufe laufen nebenläufig

Überall nach demselben Muster: `coroutineScope { val a = async {…}; …; a.await() }`, Zustand wird
**erst gesetzt, wenn alle Teile da sind**.

**Die Fehlerbehandlung bleibt unverändert:** `coroutineScope` bricht bei einem Fehler alle
Geschwister ab und wirft an den Aufrufer weiter, der wie bisher `error` setzt. Ein Teilfehler
kann keinen halb gefüllten Bildschirm erzeugen, der wie "leer" aussieht (in Spec B1 zweimal ein
Befund).

| Bildschirm | vorher | nachher |
|---|---|---|
| `BindersScreen` | 4 nacheinander | 3 nebenläufig (Behälter, Karten, Exemplare) |
| `BinderPageScreen` | 4 nacheinander | 3 nebenläufig |
| `SortIntoBinderScreen` | 3 nacheinander | 3 nebenläufig |
| `CollectionScreen` (`reload`) | 2 nacheinander | 2 nebenläufig |
| `SetCompletionScreen` | 2 nacheinander (`loadCards` + `loadSets`) | 2 nebenläufig |
| `StartScreen` | `loadCards` + `loadCopies` + `listUnsortedCopies` | 2 nebenläufig, Zähler abgeleitet |

**Nicht angefasst, mit Grund:**

- **`SearchScreen`** macht nur *einen* Sammlungsaufruf (`loadCards`), und der steht bewusst
  *nach* der Suche im selben `try`: schlägt die Suche fehl, wird gar nicht erst geladen. Eine
  Parallelisierung würde diese Fehlersemantik ändern, ohne Wartezeit zu sparen, die der Nutzer
  spürt.
- **Der zweite Effekt in `CollectionScreen`** (`ContainersRepository.list()` + `listTags()`) macht
  zwar zwei Aufrufe, läuft aber ohnehin schon parallel zum `reload()` und ist kürzer als dieses.
  Ihn zu parallelisieren verschiebt nichts Sichtbares — Diff ohne Gegenwert.
- **Die übrigen Blöcke in `StartScreen`** (`loadSets`, `SnapshotsRepository`, `DealsRepository`)
  haben jeweils eigene Fangzweige mit eigener Bedeutung; `Snapshots` hängt zudem an
  `cards`/`copies`. Die hätte man nur unter Aufgabe ihrer getrennten Fehlermeldungen
  zusammenziehen können.

Ein Detail in `StartScreen`: der Zähler "Nicht einsortiert" wird jetzt gerechnet statt geladen,
behält aber seinen eigenen Fehlerzustand. Er hängt jetzt daran, ob die **Exemplare** geladen
werden konnten (`copiesGeladen`), nicht daran, ob eine Liste leer ist — "0 nicht einsortiert"
darf weiterhin nie dastehen, wo in Wahrheit nichts geladen werden konnte.

## 3. Beim Anlegen und Umbenennen wird nur noch die Behälterliste geladen

Die Entscheidung steht an **einer** Stelle: **`ml/ReloadScope.kt`**, getestet in
`ReloadScopeTest` (6 Fälle). `BindersScreen` fragt sie, statt selbst `if`s zu streuen — in
Spec B1 gab es zweimal echten Datenverlust, weil die Oberfläche solche Entscheidungen selbst und
verstreut traf.

Die Regel und ihre Begründung Fall für Fall:

| Aktion | Umfang | warum |
|---|---|---|
| neu angelegt | nur Behälter | ändert weder Karten noch Exemplare |
| umbenannt | nur Behälter | dito |
| Fachzahl geändert (4/9/12) | nur Behälter | `save()` räumt nichts; was "darstellbar" ist, rechnet `BinderGrid` aus bereits geladenen Daten |
| **Art geändert** | **alles** | `ContainersRepository.save()` räumt Seite und Fach aller Exemplare des Behälters |
| **gelöscht** | **alles** | `ContainersRepository.delete()` räumt zusätzlich den Behälter aus allen Exemplaren |

Der Artwechsel wird bewusst in **beide** Richtungen voll nachgeladen, obwohl heute nur der Weg
weg von `binder` tatsächlich räumt. Das ist die sichere Seite derselben Regel; wer sie später
umdreht, soll nicht zusätzlich hier nachziehen müssen.

Die vorherige Art wird **vor** dem Speichern abgelesen — danach steht in `containers` schon die
neue.

## Messung: was ich erwarte

Die `PERF`-Instrumentierung in `BindersScreen.kt` bleibt drin und misst weiter dasselbe:
Gesamtzeit des Anlegens, Schreibzeit, Zeit je Ladeaufruf. Neu ist eine Zeile für den
`CONTAINERS_ONLY`-Weg und die (vernachlässigbare) Zeit der Ableitung.

**Einen Binder anlegen oder umbenennen** — der gemeldete Schmerzpunkt:

```
anlegen bis sichtbar ≈ 400 ms   (davon schreiben ≈ 120 ms, nachladen = CONTAINERS_ONLY)
reload nur-behaelter ≈ 290 ms
```

Von **4494 ms auf grob 400 ms**, ein Faktor um 10. Es bleiben nur noch Schreiben (121 ms) plus
ein Behälter-Aufruf (289 ms) übrig.

**Erstes Laden des Bildschirms und jeder Vorgang, der wirklich alles braucht** (Löschen,
Artwechsel):

```
reload gesamt ≈ 1600-1900 ms
  container   ≈ 290 ms   |
  karten      ≈ 970 ms   |  nebenläufig
  exemplare   ≈ 1570 ms  |
  unsortiert  < 5 ms  (abgeleitet, 7440 Zeilen sortieren)
```

Von **4329 ms auf ungefähr die Dauer des längsten Einzelaufrufs**. Zwei Effekte zusammen: der
1501-ms-Posten fällt komplett weg, und die verbleibenden drei überlappen statt sich zu addieren.
Vorbehalte: die drei Aufrufe teilen sich jetzt Verbindung und Funkstrecke, `exemplare` lädt durch
`created_at` etwas mehr Bytes, und OkHttp läuft mit begrenzt vielen gleichzeitigen Verbindungen
— 1573 ms sind also die Untergrenze, nicht die Vorhersage. Erwartet: **1,6–2,0 s** statt 4,3 s.

**`StartScreen`** verliert einen vollen 7440-Zeilen-Durchlauf ersatzlos (der Zähler wird
gerechnet), und die beiden verbleibenden Aufrufe überlappen.

## Prüfung

- `cd android && ./gradlew test` — grün. **352 Tests je Build-Variante** (vorher 339, +13:
  7 `UnsortedCopiesTest`, 6 `ReloadScopeTest`).
- `cd android && ./gradlew assembleDebug` — grün.
- Nicht am Gerät nachgemessen — das ist der nächste Schritt, wofür die Instrumentierung drin
  bleibt.
