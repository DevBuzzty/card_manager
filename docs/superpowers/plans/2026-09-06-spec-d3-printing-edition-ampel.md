# Spec D3 — Printing-Auflösung, Edition und Ampel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Scan landet mit dem richtigen Printing, der richtigen Sprache und der erkannten Edition im Staging — ohne Rückfrage, und mit einer Ampel, die sagt, wo man hinsehen muss.

**Architecture:** Heute wird der OCR-Bandtext als Ganzes gegen die bekannten Printing-Codes gematcht. Das ist sprachblind auf die falsche Art: `LOB-EN005` und `LOB-DE005` unterscheiden sich um genau zwei Zeichen, und die Toleranz beträgt bei achtstelligen Codes ebenfalls zwei — der englische Druck wird also für eine deutsche Karte akzeptiert (in der D1-Gesamtreview als kritischer Fehler nachgewiesen). D3 dreht das um: ein Code wird in **Präfix · Region · Nummer** zerlegt, der Vergleich läuft **nur über Präfix und Nummer**, und die **Region wird getrennt aus dem Bandtext gelesen**. Damit verschwindet die Verwechslung konstruktionsbedingt, statt über eine Schwellwert-Justierung. Dazu kommen: Rarity-Vorauswahl nach Rang, automatische Editionserkennung aus dem Bandtext, eine dreistufige Ampel pro Staging-Eintrag, und ein erweiterter Socket-Payload, damit der Desktop dieselbe Vorauswahl und dieselbe Ampel zeigt.

**Tech Stack:** Kotlin/Android (reine Matching- und Evidenzklassen mit JVM-Unit-Tests, Compose für Ampel und Chips), Electron-Renderer (`StagingArea.jsx`), Socket.io als bestehender Transport.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-spec-d-scan-flow-design.md`, Abschnitte **§6** (Printing ohne Nachfrage) und **§7** (Edition automatisch). §7a (Speed-Scan, Nachprüfen-Liste) ist **D4** — hier nicht anfangen. §7b/§7c (Zonen, Messkorb) sind **D2** und werden hier vorausgesetzt.
- **Setzt D2 voraus:** D3 arbeitet auf `zoneTexts: Map<Zone, String>` statt auf einem einzelnen `bandText`. Ist D2 noch nicht gebaut, liest D3 aus `Zone.SET_CODE`/`Zone.EDITION` ersatzweise denselben Bandtext — der Code muss aber schon gegen die Zonen-Schnittstelle geschrieben sein.
- **Deutsche Set-Codes werden nie erfunden.** Ein Code darf nur entstehen, wenn **jeder** seiner Teile belegt ist: Präfix und Nummer aus einem bekannten Printing der Karte, die Region **aus dem Bandtext der Karte gelesen**. Wird die Region nicht gelesen, wird **kein** Code zusammengesetzt — siehe die verbindliche Regel unten.
- **Jede benutzersichtbare Zeichenkette ist deutsch.** Yu-Gi-Oh-Begriffe bleiben englisch (Rarity, Set-Code, Passcode, Secret Rare, Common). Verbindliches Vokabular aus Spec C §4.
- Printing-Identität bleibt der 4-Spalten-Schlüssel `(id, set_code, language, rarity)`. `cards.quantity`/`deleted` sind triggergepflegte Caches und werden nie aus Anwendungscode geschrieben. Nur Soft-Delete.
- Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34, **keine neue Abhängigkeit**. Electron-Main bleibt CommonJS `.cjs`, der Renderer ESM.
- Desktop-Lint-Baseline: 5 vorbestehende Fehler, ein sechster ist ein Fehlschlag. **Nie ein nacktes `npm install`** — `desktop/node_modules` und `better-sqlite3` sind ABI-gebunden.
- **Nie committen:** `android/app/src/main/assets/embedder.onnx`, `index.bin`, `android/local.properties`. Explizite Pfade stagen, **niemals `git add -A`**.
- Commit-Stil: `feat(android|desktop): …`, ein Commit pro Task, Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Die verbindliche Regel für die Region (Nutzerentscheidung, 2026-09-06)

Spec §6.1 sagt: „Kein Region-Token lesbar → Sprache = Default-Sprache des Nutzers (DE)." **Das gilt hier nicht.** Der Nutzer hat anders entschieden, und die echten Daten geben ihm recht: Beim Dunklen Magier existieren `SDY-G005` und `SYE-DE001` nebeneinander — das Regionskürzel hängt an der Ära, nicht an der Sprache. Ein aus `LOB-EN005` plus Annahme gebautes `LOB-DE005` wäre ein plausibel aussehender Code, den niemand belegt hat, und bei älteren Sets systematisch falsch.

**Stattdessen gilt:**
1. Region **sicher gelesen** → Code aus Präfix + gelesener Region + Nummer. Ampel wie sonst.
2. Region **nicht lesbar** → es werden **nur tatsächlich bekannte Printings** mit diesem Präfix und dieser Nummer angeboten (aus `printings_verified` und aus den englischen Printings des Katalogs). Ampel **gelb**, Grund `Region unklar`. Nichts wird zusammengesetzt.
3. Region gelesen, aber der entstehende Code **widerspricht einem verifizierten Printing** derselben Karte mit gleichem Präfix und gleicher Nummer → Ampel **gelb**, Grund `Region widerspricht bekanntem Druck`, und das verifizierte Printing steht in der Auswahl **vorn**. Die Karte gewinnt gegen die Vermutung, aber ein Beleg gewinnt gegen einen Lesefehler.

## File Structure

| Datei | Verantwortung |
|---|---|
| `android/.../cloud/SetCodeMatch.kt` | Zerlegung `PREFIX·REGION·NUMMER`, Vergleich nur über Präfix+Nummer, Region getrennt aus dem Text lesen. Der Kern dieses Plans. |
| `android/.../ml/RegionToken.kt` (neu) | Liest das Regionskürzel aus dem Set-Code-Zonentext (`DE`, `G`, `EN`, `FR`, `IT`, `SP`, `PT`, `JP`, …), mit derselben Confusion-Toleranz wie der Rest. Rein. |
| `android/.../ml/RarityRank.kt` (neu) | Rangfolge Common < Short Print < Rare < Super < Ultra < Secret < Rest, plus `lowest(rarities)`. Kotlin-Pendant zu `findBestDefaultSet` am Desktop. Rein. |
| `android/.../ml/EditionEvidence.kt` (neu) | Sammelt Editionsmarker über die Frames derselben Karte; liefert `first`/`limited`/`unlimited`/`unknown` mit `HIGH`/`LOW`. Rein. |
| `android/.../ml/ScanConfidence.kt` (neu) | Die Ampel: `GREEN`/`YELLOW`/`RED` plus deutscher Grund, aus Code-Distanz, Frameanzahl, Rarity-Eindeutigkeit und Edition. Rein, tabellengetrieben. |
| `android/.../ml/SetCodeEvidence.kt` | Sammelt nach der Bestätigung weiter, solange die Karte getrackt ist (§6.2). |
| `android/.../ui/ScanStagingScreen.kt` | Ampelpunkt + Grund je Eintrag, Schalter **Nur unsichere**, Edition-Chip. |
| `android/.../ui/ScanScreen.kt` | Auflösung nutzt die neuen Klassen; `userTouched` je Eintrag. |
| `android/.../cloud/CollectionRepository.kt` | Socket-Payload um `rarity`, `language`, `edition`, `editionConfidence`, `confidence`, `reason` erweitern. |
| `desktop/src/components/StagingArea.jsx` | Payload-Felder als Vorauswahl übernehmen statt neu zu matchen; Ampel anzeigen. |
| Tests | `SetCodeMatchTest`, `RegionTokenTest`, `RarityRankTest`, `EditionEvidenceTest`, `ScanConfidenceTest` (JVM); `setCodeMatch.test.js` am Desktop erweitern. |

---

### Task 1: `RegionToken` — das Regionskürzel lesen

**Files:** Create `android/.../ml/RegionToken.kt`, `android/app/src/test/.../RegionTokenTest.kt`.

**Interfaces:**
- Produces: `object RegionToken { val KNOWN: Set<String>; fun read(zoneText: String, prefix: String, number: String): String? }` — gibt das Kürzel zurück oder `null`, wenn es nicht sicher lesbar ist.
- `KNOWN` = `DE, G, EN, E, FR, F, IT, I, SP, S, PT, P, JP, JA, KR, AE, TC, SC` (die real vorkommenden Kürzel; Beleg im Kommentar).

`read` sucht im Zonentext die Stelle zwischen dem erkannten Präfix und der Nummer und prüft das dazwischenliegende Token gegen `KNOWN`, mit der bestehenden Confusion-Tabelle (0/O, 1/I/l, 5/S, 8/B). **Mehrdeutig ⇒ `null`.** Lieber nichts als das Falsche — das ist der ganze Punkt dieses Plans.

- [ ] **Schritt 1: Test schreiben** — `"LOB-DE005"` → `"DE"`; `"LOB-G005"` → `"G"`; `"L0B-DE0O5"` (typische OCR-Fehler) → `"DE"`; `"LOB005"` (kein Kürzel) → `null`; `"LOB-XX005"` (unbekanntes Kürzel) → `null`; ein Text, in dem sowohl `DE` als auch `EN` plausibel gelesen werden könnten → `null`.
- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Implementieren** — [ ] **Schritt 4: Tests grün** — [ ] **Schritt 5: Committen**

---

### Task 2: `SetCodeMatch` sprachneutral

**Files:** Modify `android/.../cloud/SetCodeMatch.kt`; Test `android/app/src/test/.../SetCodeMatchTest.kt`.

**Interfaces:**
- Produces: `data class CodeParts(prefix: String, region: String?, number: String)`, `fun parts(code: String): CodeParts?`, und ein erweitertes `best(...)`, das `SetOption(code, rarity, language, verified)` liefert **plus** die Angabe, warum (für die Ampel).
- Consumes: `RegionToken` aus Task 1; die Printing-Liste aus dem Katalog (D1), verifizierte Einträge zuerst.

**Der Kern:** Der Distanzvergleich läuft **nur über `prefix + number`**. Die Region ist aus dem Vergleich ausgeblendet und wird separat entschieden. Damit kann `LOB-EN005` nicht mehr als Treffer für eine deutsche Karte durchgehen — nicht weil eine Toleranz enger wird, sondern weil die verwechselbaren Zeichen gar nicht mehr verglichen werden.

**Reihenfolge:** `printings_verified` **zuerst** exakt prüfen (z. B. Speed Duel `SGX3-DEA10`), dann die sprachneutralen Kandidaten.

**Die drei Regionsfälle** aus dem Abschnitt oben sind hier umzusetzen. Rarity-Annahme: gleiche Rarity für alle Sprachen desselben Codes; ein verifiziertes Printing überschreibt sie.

- [ ] **Schritt 1: Test schreiben** — Zerlegung von `LOB-EN005`, `LOB-G005`, `SGX3-DEA10`, `RA01-DE001` (mehrstellige Präfixe, Buchstabe in der Nummer); sprachneutraler Treffer aus `"LOB DE005"` und `"L0B-DE0O5"`; verified schlägt abgeleitet; **kein** Treffer ⇒ `null`; und die drei Regionsfälle, jeder mit dem erwarteten Ampelgrund.
- [ ] **Schritt 2: Fehlschlag bestätigen** — [ ] **Schritt 3: Implementieren** — [ ] **Schritt 4: Tests grün** — [ ] **Schritt 5: Committen**

---

### Task 3: `RarityRank` und die Vorauswahl

**Files:** Create `android/.../ml/RarityRank.kt`, Test.

Mehrere Rarities für denselben Code ⇒ Vorauswahl ist die **niedrigste** nach der Rangfolge (Common < Short Print < Rare < Super Rare < Ultra Rare < Secret Rare < Rest), dieselbe Logik wie `findBestDefaultSet` am Desktop. Mehrdeutigkeit ist kein Fehler, sondern ein **Ampelgrund** (gelb, `Rarity mehrdeutig: Ultra/Secret`).

- [ ] **Schritt 1: Test** — Rangfolge vollständig; unbekannte Rarity landet hinten; `lowest` bei Gleichstand stabil. — [ ] **Schritt 2–5** wie oben.

---

### Task 4: `EditionEvidence` — Edition automatisch (§7)

**Files:** Create `android/.../ml/EditionEvidence.kt`, Test.

**Interfaces:** `add(zoneText: String)`, `result(): EditionResult(edition: String, confidence: Confidence)` mit `edition ∈ first|limited|unlimited|unknown`, `confidence ∈ HIGH|LOW`.

Marker (case-insensitiv, OCR-tolerant — `1st` ≈ `lst`/`Ist`, `Auflage` ≈ `Auflaqe`):
- **first:** `1st Edition`, `1. Auflage`, `1ª Edición`, `1ère Édition`, `1ª Edizione`, `1ª Edição`
- **limited:** `LIMITED EDITION`, `LIMITIERTE AUFLAGE`, `EDICIÓN LIMITADA`, `ÉDITION LIMITÉE`
- Kein Marker, aber die **Passcode-Zeile** in ≥ 2 Frames gelesen → **unlimited**
- Sonst **unknown**

`HIGH` = Marker in ≥ 2 Frames, oder unlimited mit ≥ 3 Frames. `LOW` = 1 Frame. **`LOW` macht den Eintrag gelb.**

Aus Spec §7, wörtlich zu übernehmen: steht die Standard-Edition (Spec A) auf `first` und die Erkennung liefert `unlimited` mit `HIGH`, **gewinnt die Erkennung** — die Karte schlägt die Einstellung.

- [ ] **Schritt 1: Test** — alle Markersprachen; typische OCR-Verschreibungen; die unlimited-Regel (≥ 2 Frames mit Passcode); `unknown` bei einem Frame ohne Marker; die Standard-schlägt-Einstellung-Regel. — [ ] **Schritt 2–5** wie oben.

---

### Task 5: `ScanConfidence` — die Ampel

**Files:** Create `android/.../ml/ScanConfidence.kt`, Test.

Die Tabelle aus Spec §6.4, als **parametrisierter Test** (das Spec verlangt das ausdrücklich):

| Ampel | Bedingung |
|---|---|
| **Grün** | Code-Distanz 0 in ≥ 2 Frames **und** Rarity eindeutig **und** Edition ≠ unknown |
| **Gelb** | Code nur mit Toleranz oder nur 1 Frame, **oder** Rarity mehrdeutig, **oder** Edition unknown/LOW, **oder** Region unklar, **oder** Region widerspricht einem bekannten Druck |
| **Rot** | kein Code-Treffer (Set = `Unknown`) |

`reason` ist **deutsch** und nennt den konkreten Fall, nicht nur die Stufe: `Rarity mehrdeutig: Ultra/Secret`, `Code unsicher: LOB-DE0?5`, `Region unklar`, `Edition nicht erkannt`.

- [ ] **Schritt 1: Test** — jede Zeile der Tabelle plus die vier Gelb-Gründe einzeln. — [ ] **Schritt 2–5** wie oben.

---

### Task 6: Stille Verbesserung (§6.2)

**Files:** Modify `android/.../ml/SetCodeEvidence.kt`, `android/.../ui/ScanScreen.kt`.

`SetCodeEvidence` sammelt **nach** der ersten Bestätigung weiter, solange `BoxTracker` die Karte sieht. Bei jedem neuen Frame wird neu aufgelöst; wird der Treffer **besser** (kleinere Distanz, mehr Frames), aktualisiert sich der Staging-Eintrag — **es sei denn**, der Nutzer hat ihn angefasst (`userTouched`).

`userTouched` wird gesetzt, sobald der Nutzer Set, Rarity, Sprache oder Edition eines Eintrags ändert. Ohne dieses Flag würde die Automatik eine bewusste Korrektur wieder überschreiben — das ist der Fehler, den dieser Task vermeiden muss.

- [ ] **Schritt 1: Umsetzen** — [ ] **Schritt 2: `compileDebugKotlin`, `testDebugUnitTest`** — [ ] **Schritt 3: Committen**

---

### Task 7: Staging-Sheet — Ampel, Gründe, Nur-unsichere, Edition-Chip

**Files:** Modify `android/.../ui/ScanStagingScreen.kt`, `android/.../ui/ScanScreen.kt`.

- Farbiger Punkt links am Eintrag (`Good` / `Gold` / `ErrorColor` — **keine neuen Farben**), Grund als Untertitel.
- Oben im Sheet der Schalter **Nur unsichere** (zeigt gelb + rot). **Übernehmen nimmt immer alle**, unabhängig vom Filter — das steht so im Spec und verhindert, dass ein Filter versehentlich Karten unterschlägt.
- Edition-Chip aus Spec A zeigt den erkannten Wert; manuelle Änderung setzt `userTouched`.

**Vorsicht an dieser Stelle:** Die Übernahme-Schleife in `ScanStagingScreen` hat bereits eine Historie — sie hat früher noch nicht aufgelöste Einträge still verworfen (in der Spec-C-Fixwelle repariert: es werden nur die tatsächlich übernommenen Einträge entfernt, und `seen` wird passend dazu bereinigt). Diese Mechanik **nicht** anfassen; der Filter ist reine Anzeige.

- [ ] **Schritt 1: Umsetzen** — [ ] **Schritt 2: Bauen und installieren** — [ ] **Schritt 3: Committen**

---

### Task 8: Socket-Payload und Desktop-Staging (§6.5)

**Files:** Modify `android/.../cloud/CollectionRepository.kt`, `desktop/src/components/StagingArea.jsx`; Test `desktop/src/utils/setCodeMatch.test.js` erweitern.

Payload Handy → Desktop:
```
{ passcode, setCode, setCodeCandidates, rarity, language,
  edition, editionConfidence, confidence, reason }
```

Der Desktop nutzt `setCode`/`rarity`/`language` **direkt als Vorauswahl**, statt die Kandidaten erneut zu matchen — das Handy hat den Bandtext gesehen, der Desktop nicht. `edition` füllt den Chip aus Spec A. Ampel und Grund werden angezeigt wie auf dem Handy.

**Abwärtskompatibilität:** Ein älteres Handy sendet die neuen Felder nicht. Der Desktop muss dann **genau wie heute** weiterarbeiten (Kandidaten selbst matchen, keine Ampel), nicht abstürzen und nicht leere Chips zeigen. Ein Test deckt den Payload ohne die neuen Felder ab.

- [ ] **Schritt 1: Payload erweitern** — [ ] **Schritt 2: Desktop übernimmt die Vorauswahl** — [ ] **Schritt 3: Test für alten und neuen Payload** — [ ] **Schritt 4: `npm run lint`, `npm run build`, `node --test`** — [ ] **Schritt 5: Committen**

---

### Task 9: Abnahme am Gerät

**Files:** keine; ein Messbericht.

Aus Spec §11, unverändert übernommen: **30 Karten** scannen, darunter 10 Foils, 5 Karten erster Auflage und 3 mit mehrdeutigen Codes. Erwartung: **≥ 25 grün**, und **keine falsch-grünen** — eine grüne Karte mit falschem Printing ist das einzige Ergebnis, das den Plan zurückwirft, weil Grün genau die Zusage „musst du nicht prüfen" ist.

Zusätzlich, weil D1 es aufgeworfen hat: mindestens 5 der 30 Karten sollen **nicht** zu den 1.890 Karten mit verifizierten deutschen Codes gehören. Genau dort zeigt sich, ob die sprachneutrale Auflösung die Abdeckungslücke schließt.

- [ ] **Schritt 1: Scannen und protokollieren** — [ ] **Schritt 2: Ampelverteilung und Fehlerfälle berichten** — [ ] **Schritt 3: Urteil**

---

## Spec-Abdeckung (Selbstprüfung)

| Spec-D-Abschnitt | Task |
|---|---|
| §6.1 sprachneutrales Matching, Region aus dem Text, verified zuerst | 1, 2 |
| §6.2 stille Verbesserung, `userTouched` | 6 |
| §6.3 Rarity-Vorauswahl | 3 |
| §6.4 Ampel mit Gründen, Nur-unsichere | 5, 7 |
| §6.5 Socket-Payload, Desktop-Vorauswahl | 8 |
| §7 Edition automatisch, Sicherheit, Karte schlägt Einstellung | 4 |
| §11 Tests und die 30-Karten-Abnahme | 1–5 (Unit), 9 (Gerät) |

**Bewusste Abweichungen (im Ledger festhalten):**
1. **Die Rückfallregel aus §6.1 wird nicht umgesetzt.** Das Spec will bei unlesbarer Region die Standardsprache annehmen; auf Entscheidung des Nutzers werden stattdessen nur belegte Codes angeboten und der Eintrag gelb markiert. Begründung oben — die eigenen Daten zeigen `SDY-G005` neben `SYE-DE001`.
2. **Zusätzlicher Gelb-Grund** „Region widerspricht bekanntem Druck", den das Spec nicht kennt. Er fängt den Fall ab, dass die Region zwar gelesen wurde, aber falsch — sonst bliebe ein selbstbewusst falscher Code grün.
3. **`SetCodeMatch`s Toleranzarithmetik wird nicht nachjustiert.** Sie wird durch das Ausblenden der Region gegenstandslos, was der bessere Weg ist als eine Schwellwertänderung, deren Nebenwirkungen niemand messen kann.
4. **Keine Schemaänderung.** `needs_review`/`review_reason` existieren in Supabase bereits aus Spec A, werden aber erst von **D4** (Speed-Scan) beschrieben. D3 hält die Ampel nur im Staging.
