# Zwischenspeicher für die Android-App — Design

Stand: 2026-09-13 · Status: vom Nutzer abschnittsweise freigegeben, Spec zur Durchsicht

## 1. Anlass und Ziel

Die Handy-App lädt bei **jedem** Seitenwechsel die ganze Sammlung neu (2703 Karten, 7441
Exemplare, ~2 s, rund 20 Netzabfragen). Ursache: jeder Bildschirm hält seine Daten in
`remember`; verlässt man die Destination, verwirft Navigation-Compose die Komposition, und
`LaunchedEffect(Unit)` lädt beim Wiederkommen von vorn. `saveState`/`restoreState` rettet nur
`rememberSaveable`-Werte, davon gibt es keine.

Vorarbeit (gemerged `ddd0b5f`): doppelte Exemplar-Abfrage weg, Laden nebenläufig, Binder
anlegen 4494 → 260 ms, volles Nachladen 4,3 → ~2 s. Der Rest ist strukturell.

**Ziel:** Nach einem einmaligen Laden beim App-Start ist jeder Seitenwechsel ohne Netzabfrage
sofort da. Änderungen vom PC erscheinen trotzdem ohne Neustart am Handy.

**Nutzerentscheidungen (2026-09-13):**
- Der PC ändert die Sammlung **oft gleichzeitig**, während die Handy-App offen ist.
- Ansatz **B**: zentraler Speicher + Delta-Abgleich über `updated_at`, in **zwei Phasen**.
- Speicher **nur im Arbeitsspeicher**, dafür ein **Ladebildschirm beim App-Start**, der alles lädt.
- Umfang umfasst zusätzlich: Beifang-Fehler (§7), Wunschliste/Decks/Deals, Set-Liste,
  Nach-unten-Ziehen (Phase 2).

**Nicht Ziel:** Speicher auf der Festplatte; Supabase Realtime; Änderungen am Desktop oder an
der Datenbank (kein SQL); den PC-Sync-Takt (20 s) verkürzen.

## 2. Globale Randbedingungen

- Keine SQL-Ausführung, keine Schemaänderung. Alle genutzten Spalten existieren:
  `cards.updated_at`, `card_copies.updated_at` (+ Index), `containers.updated_at` (+ Index),
  alle serverseitig per Trigger gestempelt (`supabase/schema.sql:30-42`,
  `card_copies_schema.sql:27-33`, `containers_schema.sql:13-31`).
- `cards.quantity`/`cards.deleted` bleiben trigger-gepflegt; die App schreibt sie nie.
- Soft-Delete: gelöschte Zeilen tragen `deleted = true`, es wird nie hart gelöscht.
- Alle sichtbaren Texte deutsch mit echten Umlauten; „Fächer“, nicht „Taschen“.
- Regeln wohnen in reinen, getesteten Helfern unter `ml/`, nicht in der Oberfläche.
- Keine neue Laufzeit-Bibliothek. Testabhängigkeit `kotlinx-coroutines-test` ist erlaubt.
- minSdk 26: `java.time` steht zur Verfügung.
- Die bestehenden Schreibwege (`CollectionRepository`, `ContainersRepository`) bleiben in
  Signatur und Serverwirkung unverändert.

## 3. Aufbau

### 3.1 `CollectionStore` (neu, `cloud/CollectionStore.kt`)

Ein `object`, das so lange lebt wie der App-Prozess. Es hält zwei getrennte Flüsse — die Daten
und den Abgleichstatus. Getrennt, damit ein erfolgreicher Abgleich ohne Änderung (alle 10 s) den
Datenfluss nicht berührt und keine Seite neu zeichnet; nur der Hinweis aus §6 hört auf den Status.

```kotlin
sealed interface StoreState {
    data object Empty : StoreState                       // nicht angemeldet / geleert
    data object Loading : StoreState                     // erstes Laden läuft
    data class Failed(val message: String) : StoreState  // erstes Laden gescheitert
    data class Ready(
        val cards: List<CardRow>,           // sortiert nach Schlüssel (§4.2)
        val copies: List<CopyRow>,          // sortiert nach copy_id
        val containers: List<ContainerRow>, // sortiert nach sort_order, dann container_id
    ) : StoreState
}
data class SyncStatus(val lastSuccess: Instant? = null, val failing: Boolean = false)
```

`state: StateFlow<StoreState>`, `sync: StateFlow<SyncStatus>`.

Öffentliche Operationen:
- `loadInitial()` — vollständiges Laden (§4.1); `Loading` → `Ready` oder `Failed`.
- `requestSync()` — fordert einen Delta-Abgleich an (§4.3); kehrt sofort zurück.
- `awaitSync()` — wie `requestSync()`, wartet aber, bis ein Abgleich **nach** dem Aufruf fertig
  ist. Für Schreibvorgänge, deren Ergebnis die Oberfläche sofort zeigen soll.
- `clear()` — setzt `Empty`, verwirft Stichtage, erhöht die Generation (§4.4).

Die Netzarbeit steckt hinter einer Schnittstelle `StoreSource` (Seiten holen für Voll- und
Delta-Laden je Tabelle), damit der Speicher mit einem Fake-Netz testbar ist. Die echte
Implementierung liegt bei den Repositories.

### 3.2 Reine Regeln (neu, `ml/`)

- `ml/DeltaMerge.kt` — arbeitet eine Seite geänderter Zeilen in eine Tabelle ein (§4.2).
- `ml/Keyset.kt` — baut den PostgREST-Filter „nach Schlüssel X“ bzw. „nach (updated_at, Schlüssel)“
  mit korrekter Maskierung (§4.1, §4.3).
- `ml/SyncCursor.kt` — Stichtag fortschreiben und Überlappung abziehen (§4.3).

### 3.3 Ladebildschirm (neu, `ui/StartupLoadingScreen.kt`)

In `AppNav`: Ist `cloudReady` wahr und der Speicherzustand nicht `Ready`, zeigt die App statt
des `NavHost` den Ladebildschirm.
- `Loading`: Fortschrittsanzeige und Text „Sammlung wird geladen …“.
- `Failed`: Meldung und Knopf „Erneut versuchen“ (ruft `loadInitial()`); zusätzlich „Abmelden“,
  damit ein falsches Konto nicht festhält.
- `Empty` bei `cloudReady`: löst `loadInitial()` aus.

`CloudLoginScreen` und `SettingsScreen` sind vom Ladebildschirm nicht betroffen.

### 3.4 Takt

Solange die Activity mindestens `STARTED` ist (`repeatOnLifecycle`, `lifecycle-runtime-ktx`
ist vorhanden), fordert `AppNav` alle **10 s** einen Abgleich an. Beim Übergang in den
Vordergrund sofort einer. Im Hintergrund keiner. Zusätzlich fordert `AppNav` bei jedem Wechsel
der Destination (`currentBackStackEntry`-Route ändert sich) einen Abgleich an — die Seite zeigt
dabei sofort den Speicherstand, der Abgleich läuft im Hintergrund.

## 4. Datenfluss

### 4.1 Vollständiges Laden

Die drei Tabellen laden **nebenläufig**; `Ready` wird erst gesetzt, wenn alle drei vollständig
da sind. Scheitert eine, wird keine übernommen (`Failed`).

**Blättern nach Schlüssel statt nach Versatz.** Heute `limit/offset`: wird während des Blätterns
eine frühere Zeile gelöscht oder fällt eine Karte auf Menge 0, rückt die Ergebnismenge vor, und
eine Zeile wird still übersprungen. Neu: jede Folgeseite fragt „Schlüssel größer als der letzte
gelieferte“, sortiert nach genau diesem Schlüssel, Seitengröße 1000.

| Tabelle | Schlüssel (= Sortierung) | Filter wie heute |
|---|---|---|
| `card_copies` | `copy_id` | `deleted=eq.false` |
| `containers` | `container_id` (anschließend lokal nach `sort_order`, dann `container_id`) | `deleted=eq.false` |
| `cards` | `id, set_code, language, rarity` | `deleted=eq.false&quantity=gt.0` |

Für den zusammengesetzten Kartenschlüssel baut `Keyset` den Ausdruck
`or=(id.gt.A,and(id.eq.A,set_code.gt.B),and(id.eq.A,set_code.eq.B,language.gt.C),and(id.eq.A,set_code.eq.B,language.eq.C,rarity.gt.D))`.
Werte werden in doppelte Anführungszeichen gesetzt, `"` und `\` darin maskiert — Seltenheiten
wie `Secret Rare`, Kommas und Klammern dürfen den Ausdruck nicht zerbrechen. Alle vier
Schlüsselspalten sind Teil des Primärschlüssels (`supabase/schema.sql:25`) und damit auf dem
Server nie `null`; `Keyset` braucht keinen `null`-Fall.

**Spalten.** `cards` bleibt bei `select=*` (liefert `updated_at` und `deleted` bereits mit). Eine
Spaltenliste hätte die Spalte `desc` enthalten müssen, deren Verhalten im `select` von PostgREST
ohne Test gegen den Server nicht belegt ist — und gegen den Server testen Umsetzer nicht.
`COPY_COLS` und die Behälterspalten bekommen `updated_at` (Behälter auch `deleted`). `CardRow`, `CopyRow`, `ContainerRow` erhalten ein Feld
`updatedAt: String?` (letztes Feld, Standard `null`); `CardRow` und `ContainerRow` zusätzlich
`deleted: Boolean = false`, damit das Delta Löschungen erkennt.

**Reihenfolge im Speicher.** Sortiert wird lokal nach Codepunkten der Schlüssel, nicht nach der
Server-Sortierung (Datenbank-Kollation). Keine Seite zeigt `cards` oder `copies` in
Lieferreihenfolge — Sammlung, Sets und Binder sortieren selbst, die unsortierte Liste über
`UnsortedCopies`. Das Blättern selbst nutzt weiter die Server-Sortierung; Filter und Sortierung
laufen dort mit derselben Kollation und passen zueinander.

Der **Stichtag** je Tabelle ist nach dem Laden der größte gelieferte `updated_at`
(Zeichenkette vom Server, nicht die Uhr des Handys).

### 4.2 Einarbeiten (`DeltaMerge`)

Eingabe: aktuelle Liste einer Tabelle, gelieferte Zeilen. Regel:
- Zeile mit `deleted = true` → Schlüssel entfernen.
- Karte mit `quantity <= 0` → Schlüssel entfernen (entspricht dem Filter `quantity=gt.0`).
- sonst → einsetzen oder ersetzen.
- Ergebnis in derselben Reihenfolge wie das vollständige Laden (§4.1).
- **Keine tatsächliche Änderung → dieselbe Listeninstanz zurück** (`===`). Sonst zeichnen sich
  alle Seiten alle 10 s neu.
- Doppelt gelieferte, unveränderte Zeilen ändern nichts (Voraussetzung der Überlappung, §4.3).

Für Deltas werden die Filter `deleted=eq.false` und `quantity=gt.0` **weggelassen** — gelöschte
und auf 0 gefallene Zeilen müssen ankommen, damit sie lokal verschwinden.

### 4.3 Delta-Abgleich

- Abfrage je Tabelle: `updated_at >= (Stichtag − 60 s)`, sortiert nach `(updated_at, Schlüssel)`,
  Folgeseiten per `Keyset` nach `(updated_at, Schlüssel)`. Ein Preis-Update stempelt Hunderte
  Karten mit demselben Zeitpunkt; nur nach `updated_at` zu blättern hinge dort fest oder verlöre
  Zeilen.
- **Überlappung 60 s:** fängt Zeilen, deren Transaktion vor dem Stichtag begann (Stempel = Beginn),
  aber erst danach sichtbar wurde. Genau an dieser Grenze lag ein früherer Fehler im PC-Sync.
- Neuer Stichtag = max(alter Stichtag, größter gelieferter `updated_at`). Die Tabelle wird erst
  übernommen, wenn **alle** ihre Delta-Seiten da sind; der Stichtag rückt erst dann vor.
- Die drei Tabellen werden nebenläufig abgeglichen und **gemeinsam** in einem Schritt in
  `Ready` übernommen. Scheitert eine: nichts übernommen, `SyncStatus.failing = true`, Stichtage
  unverändert.
- **Tabelle ohne Stichtag** (beim ersten Laden leer): das Delta fragt ab
  `1970-01-01T00:00:00Z`, also inklusive gelöschter Zeilen — sonst verschwände eine später
  angelegte und wieder gelöschte Zeile nie.
- **Nur ein Abgleich gleichzeitig.** Kommt während eines laufenden Abgleichs eine Anforderung,
  wird genau **ein** weiterer Lauf vorgemerkt und direkt danach ausgeführt (beliebig viele
  Anforderungen verschmelzen zu diesem einen). `awaitSync()` wartet auf einen Lauf, der **nach**
  dem Aufruf startet.
- Kurzzeitige Unstimmigkeit zwischen Tabellen (Exemplar schon da, Kartenmenge noch nicht) ist
  zulässig — wie heute beim nebenläufigen Nachladen; der nächste Lauf gleicht sie aus.

### 4.4 Abmelden, Kontowechsel

`clear()` bei `SupabaseCloud.signOut()` (Pfad `AppNav.kt` `onLoggedOut`) und vor jedem
erfolgreichen Login in `CloudLoginScreen` (anderer Projekt-URL/Schlüssel möglich). Jeder
Lade-/Abgleichlauf merkt sich die **Generation** beim Start; ist sie beim Übernehmen nicht mehr
aktuell, wird das Ergebnis verworfen.

Beendet Android den Prozess, ist der Speicher leer; `cloudReady` ist heute schon `remember` —
beim Wiederöffnen folgen Anmeldung und Ladebildschirm.

## 5. Bildschirme (Phase 1)

Grundregel: kein Laden in `LaunchedEffect` mehr; der Bildschirm liest `CollectionStore.state`
per `collectAsState()`. Nach einem eigenen Schreibvorgang `awaitSync()` (statt `reload()`), dann
wie bisher Erfolg/Fehler anzeigen. Ein Fehler **nach** erfolgreichem Schreiben, nur beim
Abgleich, wird nicht als Schreibfehler gemeldet — der Hinweis aus §6 übernimmt.

| Bildschirm | Änderung |
|---|---|
| `StartScreen` | `cards`/`copies` aus dem Speicher. `SnapshotsRepository.upsertToday` nur mit `Ready`-Daten (der Ladebildschirm garantiert das) — behebt §7.3. Sets, Deals weiter wie heute bis Phase 2. |
| `CollectionScreen` | alles aus dem Speicher. Tag-Vorschläge aus den Exemplaren im Speicher (`Tags.parse`/`Tags.add` wie `listTags()`), kein Netzaufruf. `onChanged`-Nachladen entfällt. |
| `BindersScreen` | aus dem Speicher; nach Speichern/Löschen `awaitSync()`. `ml/ReloadScope.kt` und `ReloadScopeTest` entfallen. Die Regel „Meldung nach geschlossenem Dialog auf den Bildschirm“ (`9edf64c`) bleibt sinngemäß. |
| `BinderPageScreen` | aus dem Speicher; `write()` und CopySheet-`onSaved` → `awaitSync()`. Beide `LaunchedEffect`-Ladevorgänge entfallen (behebt §7.1). Der Rückkanal `seiteNachEinsortieren` bleibt. |
| `SortIntoBinderScreen` | nimmt beim Betreten **einmal** die `Ready`-Listen als Arbeitskopie für `SortSession.start` und hört danach nicht auf den Speicher. Beim Verlassen `requestSync()`. Wartet der Speicher noch (`Ready` fehlt), kann der Modus nicht betreten werden — der Ladebildschirm macht das zum Nicht-Fall. |
| `CardDetailScreen` | Drucke und Exemplare aus dem Speicher, gefiltert nach `cardId`; `loadCardsFor`/`loadCopiesFor`-Aufrufe und `onChanged` entfallen. Nach jedem Schreibvorgang `awaitSync()`. Alle `scope.launch`-Schreibpfade fangen Fehler ab (behebt §7.2). Wunschliste weiter wie heute bis Phase 2. |
| `CopySheet` | Behälter und Tag-Vorschläge aus dem Speicher; öffnet ohne Netzabfrage. |
| `SetCompletionScreen` | Karten aus dem Speicher; Sets bis Phase 2 wie heute. |
| `SearchScreen` | „schon vorhanden“ aus dem Speicher statt `loadCards()` pro Suche. `AddPrintingSection` von hier → `requestSync()` (heute `onAdded = {}`, behebt §7.4). |
| `ScanScreen` / `ScanStagingSheet` | nach `onCommitted` `requestSync()` (behebt §7.4). |

Unverändert in Phase 1: `WishlistScreen`, `DecksScreen`, `DealsScreen`, Sammlungs-Segment-Navigation.

Die Voll- und Delta-Abfragen für `StoreSource` entstehen in `CollectionRepository` und
`ContainersRepository` neu (Blättern nach Schlüssel). Danach ohne Aufrufer und zu entfernen:
`CollectionRepository.loadCards()`, `loadCopies()`, `loadCardsFor()`, `loadCopiesFor()`,
`listTags()` (alle mit Versatz-Blättern bzw. Einzelabfragen); `ContainersRepository.list()` nur,
falls es danach keinen Aufrufer mehr hat.

## 6. Fehleranzeige

| Fall | Verhalten |
|---|---|
| Erstes Laden scheitert | Ladebildschirm `Failed`: Meldung, „Erneut versuchen“, „Abmelden“ |
| Abgleich scheitert | Daten und Stichtage bleiben; oben auf Start, Sammlung (beide Segmente) und Binder-Seite ein schmaler Hinweis „Nicht abgeglichen seit HH:MM – nächster Versuch läuft“; verschwindet beim nächsten erfolgreichen Abgleich |
| 401 | wie heute: stilles Neuanmelden in `executeWithReauth` |
| Schreibfehler | wie heute am Ort des Schreibens |
| Abmelden während eines Laufs | Ergebnis verworfen (Generation, §4.4) |

## 7. Beifang-Fehler (Phase 1)

1. **Doppeltes Laden nach dem Einsortieren** — `BinderPageScreen` lädt über
   `LaunchedEffect(containerId)` und `LaunchedEffect(seiteNachEinsortieren)` zweimal voll.
   Entfällt mit §5.
2. **Absturz in der Kartendetailansicht** — `CardDetailScreen` startet `refresh()` nach
   `addPrinting`/CopySheet in `scope.launch` ohne Fehlerbehandlung; ein Netzfehler beendet die App.
3. **0-€-Tageswert** — `StartScreen` speichert den Tageswert auch, wenn das Laden scheiterte und
   `cards`/`copies` noch leer sind.
4. **Schreibvorgänge ohne Nachladen** — Scan-Übernehmen (`ScanScreen`, `SortIntoBinderScreen`)
   und Drucke aus der Suche (`AppNav` `onAdded = {}`) laden danach nichts nach; heute verdeckt
   durch das Neuladen beim Zurückkehren.

## 8. Phase 2

Wunschliste, Decks, Deals und Deal-Treffer haben **kein** `updated_at` und sind klein. Deshalb
kein Delta, sondern:
- **Speicher je Liste** im selben Muster (Wert + Lade- und Fehlerstatus), geladen beim ersten Öffnen der
  Seite, danach sofort angezeigt und **im Hintergrund voll neu geladen** bei jedem Öffnen, beim
  Nach-unten-Ziehen und nach eigenen Schreibvorgängen. Kein 10-s-Takt.
- Die Deal-Treffer-Zahl auf Start liest aus demselben Speicher.
- **Set-Liste (YGOPRODeck):** einmal pro Prozess geladen (erster Bedarf), danach aus dem Speicher;
  Nach-unten-Ziehen auf der Set-Vervollständigung lädt neu. Scheitert das Laden, Verhalten wie
  heute.
- **Nach unten ziehen** auf Start, Sammlung (beide Segmente), Binder-Seite, Wunschliste, Decks,
  Deals: löst den jeweiligen Abgleich aus (Sammlung: `awaitSync()`), Anzeige bis zum Ende.
  Umsetzung mit `androidx.compose.material3.pulltorefresh` (`PullToRefreshContainer`,
  `rememberPullToRefreshState`, `@OptIn(ExperimentalMaterial3Api::class)`) aus der vorhandenen
  BOM `2024.02.02`. Die BOM wird dafür **nicht** angehoben. Fehlt die API in dieser Version, gibt
  es stattdessen ein Aktualisieren-Symbol oben auf denselben Seiten mit derselben Wirkung.
- `CardDetailScreen` liest „auf der Wunschliste“ aus dem Wunschlisten-Speicher.

## 9. Tests

**Reine Regeln (JVM):**
- `DeltaMerge`: einsetzen, ersetzen, `deleted` entfernt, Karte `quantity <= 0` entfernt,
  unveränderte Lieferung → dieselbe Instanz, Reihenfolge je Tabelle, leere Lieferung.
- `Keyset`: einfacher und zusammengesetzter Schlüssel; Werte mit Leerzeichen, Komma, Klammer,
  Anführungszeichen, Backslash; `(updated_at, Schlüssel)`.
- `SyncCursor`: Stichtag = Maximum, bleibt bei leerer Lieferung, Überlappung 60 s über
  ISO-Zeitstempel mit Mikrosekunden und Zeitzone.
- Blättern über mehr als eine Seite, deren Zeilen **alle denselben** `updated_at` tragen:
  jede Zeile genau einmal, Ende wird erreicht.

**Speicher mit Fake-`StoreSource` (`kotlinx-coroutines-test`):**
- `Ready` erst, wenn alle drei Tabellen vollständig geladen sind; Fehler einer Tabelle → `Failed`,
  nichts übernommen.
- Abgleich-Fehler → Daten und Stichtage unverändert, `SyncStatus.failing = true`; nächster Erfolg setzt
  zurück.
- Anforderungen während eines Laufs → genau ein weiterer Lauf.
- `awaitSync()` kehrt erst nach einem Lauf zurück, der nach dem Aufruf begann.
- `clear()` während eines Laufs → dessen Ergebnis wird verworfen.
- Vollständiges Laden mit einer Quelle, die zwischen zwei Seiten eine frühere Zeile entfernt →
  keine Zeile fehlt.

**Abnahme am Gerät:**
1. App-Start zeigt den Ladebildschirm, danach Start.
2. Wechsel Start ↔ Sammlung ↔ Binder ↔ Binder-Seite ↔ Scan und zurück: sofort, ohne Ladeanzeige.
3. Am PC ein Exemplar einem Binder zuweisen: erscheint am Handy ohne Neustart (≤ ~30 s, siehe §10).
4. Am Handy Binder anlegen, Karte einlegen, Exemplar hinzufügen: sofort sichtbar.
5. Scan übernehmen, Druck aus der Suche hinzufügen: in der Sammlung sichtbar ohne Neustart.
6. Flugmodus: Hinweis „Nicht abgeglichen seit …“, Daten bleiben; Flugmodus aus → Hinweis weg.
7. Flugmodus beim App-Start: Ladebildschirm mit „Erneut versuchen“.
8. Phase 2: Nach-unten-Ziehen auf den genannten Seiten; Wunschliste/Decks/Deals öffnen sofort.

## 10. Bekannte Grenzen

- **PC-Änderungen brauchen bis zu ~30 s** bis aufs Handy: der PC schiebt alle 20 s in die Cloud
  (`desktop/electron/sync.cjs:407-408`), dazu bis zu 10 s Handy-Takt. Schneller nur mit kürzerem
  PC-Takt — eigene Änderung, nicht Teil dieser Spec.
- App-Start dauert weiter ~2 s (Ladebildschirm), weil der Speicher den Prozess nicht überlebt.
- Der 10-s-Takt kostet im Vordergrund drei kleine Abfragen; nach großen Preis-Updates liefert die
  60-s-Überlappung dieselben Zeilen einige Male erneut (unschädlich, §4.2).
