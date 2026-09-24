# Spec I2 — Verkaufsweg und Feinschliff: Umsetzungsplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte sind Kästchen (`- [ ]`).

**Ziel:** Jedes Exemplar zeigt in einer Zeile, was es ist und wo es liegt. Der Exemplar-Dialog ist aufgeräumt, und von dort (und aus „Kandidaten“) führt **ein** erkennbarer Verkaufsweg mit drei Wegen, ohne Fensterstapel, mit Vorbelegung, Rückgängig-Leiste und nächstem Schritt. Dazu kommt die Schrift- und Raster-Vereinheitlichung aus Spec I §6.3 und der Feinschliff aus der I1-Abnahme.

**Architektur:** Die Fachlogik ohne Oberfläche (Exemplarzeile, Vorbelegung, nächster Schritt, Fehler mit Handlung) liegt in reinen Helfern mit **einer Fixture je Thema** und einem Zwillings-Test je Gerät (Muster wie `sales.json` und `listings.json`). Die bestehenden Dialoge `SaleDialog`/`ListingDialog` (PC) und `SaleSheet`/`ListingSheet` (Handy) werden **nicht neu geschrieben**. Sie bekommen eine eingebettete Form, die im Exemplar-Fenster statt eines zweiten Fensters erscheint.

**Technik:** React 18 + Tailwind (Renderer, ESM), Electron-Hauptprozess (CommonJS `.cjs`), Jetpack Compose (Kotlin), Node-Test-Runner, `electron --test`, JUnit.

**Spec:** `docs/superpowers/specs/2026-09-22-spec-i-neustruktur-und-gestaltung.md` §4, §5, §6.3, §10 · **Vorgänger:** I1 (gemergt 24.09.2026, `678ef84`), Abnahme-Protokoll `docs/superpowers/ledgers/2026-09-24-i1-abnahme.md`

## Entscheidungen vor dem Plan (24.09.2026, mit dem Nutzer)

- **§6.3 vollständig:** Systemschrift statt Chakra Petch, Manrope und JetBrains Mono, vier Schriftgrößen, Ecken 10/6, auf PC und Handy.
- **Mehrfachauswahl in der Kartenliste ist NICHT Teil von I2** (Spec §5.1, Satz 2). Der Einstieg kommt an das Exemplar und in „Kandidaten“. Die Sammelaktionen unter „Zum Verkauf“ bleiben. Die Mehrfachauswahl wird eine eigene Aufgabe.
- **„Kanal wie beim letzten Mal“ ohne neues Feld:** Abgeleitet aus dem jüngsten nicht stornierten Verkauf. Damit bleibt Spec §7 „keine Datenänderung“ gewahrt.

## Globale Vorgaben

- Alle sichtbaren Texte auf **Deutsch** mit echten Umlauten. Commit-Nachrichten deutsch, jede endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Keine Datenänderung:** kein neues Feld, keine Migration, kein Cloud-Schema, kein neuer Sync-Strom.
- Farbrollen und Regeln aus Spec §6.1/§6.2 gelten weiter; der Wächter-Test `desktop/src/utils/noLegacyColors.test.js` bleibt grün und wird in Task 10 um Schrift- und Eckenregeln erweitert.
- Neue IPC-Kanäle immer in `electron/main.cjs` **und** `electron/preload.cjs` **und** `electron/ipc-channels.test.cjs`.
- Prüfläufe, die nach jeder Aufgabe grün bleiben müssen:
  - `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs`
  - `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
  - `cd desktop && npx eslint .` → **genau 5 Fehler** (Altlast)
  - `cd desktop && npx vite build`
  - `cd android && ./gradlew testDebugUnitTest assembleRelease` (JAVA_HOME = JBR von Android Studio; `local.properties` nie lesen, ändern oder stagen)
- Handy-APK zum Ausprobieren immer als Release (`assembleRelease`); nach Änderungen an `local.properties` mit `clean`.
- Kein `git stash`. Explizit nur die eigenen Dateien stagen. Kein `npm install`.

---

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/copies/copy-row.json` (neu) | Exemplarzeile: Text, Standort, Marken | 1 |
| `desktop/src/utils/copyRow.js` + `copyRow.test.js` (neu), `android/.../ml/CopyRowText.kt` + `CopyRowTextTest.kt` (neu) | Zwillinge der Exemplarzeile | 1 |
| `docs/fixtures/sales/sale-flow.json` (neu) | Vorbelegung, letzter Kanal, nächster Schritt, Fehler mit Handlung | 2 |
| `desktop/src/utils/saleFlow.js` + `saleFlow.test.js` (neu), `android/.../ml/SaleFlow.kt` + `SaleFlowTest.kt` (neu) | Zwillinge des Verkaufswegs | 2 |
| `desktop/src/components/Toast.jsx` (neu), `App.jsx` | Rückgängig-/Hinweisleiste mit Zeitgeber | 3 |
| `desktop/src/components/CardDetailPanel.jsx` (Z. 343–361) | Exemplarzeile PC | 4 |
| `desktop/src/components/CopySheet.jsx` | Dialog-Aufbau, Fuß mit Umbruch, Schalter entfällt | 5 |
| `desktop/src/components/SellFlow.jsx` (neu), `SaleDialog.jsx`, `ListingDialog.jsx`, `CopySheet.jsx` | Drei Wege im selben Fenster, eingebettete Dialoge, Tastatur | 6 |
| `desktop/src/components/DuplicatesList.jsx` | Einstieg „Verkaufen…“ in „Kandidaten“ | 7 |
| `android/.../ui/CardDetailScreen.kt` (Z. 305–333), `ui/CopySheet.kt`, `ui/SellFlow.kt` (neu), `SaleSheet.kt`, `ListingSheet.kt`, `SaleLists.kt` | Handy: Zeile, Dialog, drei Wege, Snackbar, Kandidaten | 8, 9 |
| `docs/fixtures/design/tokens.json`, `desktop/tailwind.config.js`, `desktop/src/index.css`, Renderer-Dateien, `theme.test.js`, `noLegacyColors.test.js` | §6.3 PC | 10 |
| `android/.../ui/theme/Type.kt`, `Theme.kt`, `components/SpaceCard.kt`, `DesignTokensTest.kt` | §6.3 Handy | 11 |
| `Insights.jsx`, Deckbau-Komponenten, `CardTile.jsx`, `DealsScreen.kt`, `SalesPanel.jsx`, `CollectionList.jsx` → drei Dateien | Feinschliff aus der Abnahme, Aufteilung §10 | 12 |
| — | Bauen, aufspielen, Abnahme §8 Punkte 4–6 plus Rückschau 1–10 | 13 |

Reihenfolge: 1 → 13. Parallel erlaubt (getrennte Dateien, Commits nie gleichzeitig): 1 ∥ 2, 3 ∥ 4, 8 ∥ 10, 11 ∥ 12. Task 6 erst nach 3, 5; Task 9 erst nach 8.

---

### Task 1: Exemplarzeile als Zwilling (Spec §4.1)

**Dateien:**
- Erstellen: `docs/fixtures/copies/copy-row.json`
- Erstellen: `desktop/src/utils/copyRow.js`, `desktop/src/utils/copyRow.test.js`
- Erstellen: `android/app/src/main/java/com/example/yugiohscanner/ml/CopyRowText.kt`, `android/app/src/test/java/com/example/yugiohscanner/CopyRowTextTest.kt`

**Schnittstellen:**
- Verbraucht: `formatCopyLocation` (PC, `desktop/src/utils/…`, heute in `CardDetailPanel.jsx:351` benutzt) bzw. `CopyLocation.format` (Handy); `offeredText`-Eingabe `offers[copy_id]` (PC `listingText.js#activeByCopy`, Handy `ListingText.activeByCopy`).
- Liefert: `copyRow(copy, container, activeOffers) -> { lead, location, unsorted, marks }` mit `marks ⊆ ['zum-verkauf', 'angeboten']` in dieser Reihenfolge; Handy `CopyRowText.of(copy, container, activeOffers)` mit denselben Feldern.

- [ ] **Schritt 1: Fixture anlegen** — `docs/fixtures/copies/copy-row.json`:

```json
{
  "_": "ZWILLING: desktop/src/utils/copyRow.test.js und android CopyRowTextTest.kt. Spec I §4.1.",
  "editionen": { "first": "1. Auflage", "unlimited": "Unlimitiert", "limited": "Limitiert", "unknown": "Auflage unbekannt" },
  "ohneBehaelter": "noch nicht einsortiert",
  "faelle": [
    { "name": "Binder mit Seite", "copy": { "condition": "NM", "edition": "first", "container_id": "a", "page": 3, "slot": 5, "for_sale": 0 },
      "container": { "container_id": "a", "name": "Ordner A", "kind": "binder" }, "angebote": 0,
      "lead": "NM · 1. Auflage", "location": "Ordner A, Seite 3", "unsorted": false, "marks": [] },
    { "name": "Box ohne Seite", "copy": { "condition": "EX", "edition": "unlimited", "container_id": "b", "page": null, "slot": null, "for_sale": 1 },
      "container": { "container_id": "b", "name": "Box Doppelte", "kind": "box" }, "angebote": 0,
      "lead": "EX · Unlimitiert", "location": "Box Doppelte", "unsorted": false, "marks": ["zum-verkauf"] },
    { "name": "ohne Behälter, angeboten", "copy": { "condition": "NM", "edition": "unknown", "container_id": null, "page": null, "slot": null, "for_sale": 1 },
      "container": null, "angebote": 1,
      "lead": "NM · Auflage unbekannt", "location": "noch nicht einsortiert", "unsorted": true, "marks": ["zum-verkauf", "angeboten"] },
    { "name": "Behälter gelöscht", "copy": { "condition": "GD", "edition": "limited", "container_id": "weg", "page": 1, "slot": 1, "for_sale": 0 },
      "container": null, "angebote": 0,
      "lead": "GD · Limitiert", "location": "noch nicht einsortiert", "unsorted": true, "marks": [] }
  ]
}
```

  Vor dem Eintragen prüfen: Der genaue Standort-Text („Ordner A, Seite 3“ vs. „Ordner A · S. 3 · F. 5“) kommt aus `formatCopyLocation`/`CopyLocation.format`. **Fixture an die bestehende Formatierung anpassen**, nicht die Formatierung ändern. Die Spec nennt „Ordner A, Seite 3“ nur als Beispiel.

- [ ] **Schritt 2: Fehlschlagende Tests schreiben** (PC `copyRow.test.js` liest die Fixture über `new URL('../../../docs/fixtures/copies/copy-row.json', import.meta.url)`, Handy über `Fixtures.text("copies/copy-row.json")`). Je Fall `lead`, `location`, `unsorted`, `marks` vergleichen. Zusätzlich: `editionen` der Fixture = Beschriftungen der App (`EDITION_LABELS` bzw. `Valuation.EDITION_LABELS`), damit „1st Ed“ und „1. Auflage“ nicht auseinanderlaufen.
- [ ] **Schritt 3: Fehlschlag bestätigen** — `cd desktop && node --test src/utils/copyRow.test.js`; `cd android && ./gradlew testDebugUnitTest --tests '*CopyRowTextTest'`.
- [ ] **Schritt 4: Helfer schreiben** — PC:

```js
// Spec I §4.1 -- eine Zeile je Exemplar: Zustand und Auflage vorn, Standort im Klartext, hoechstens zwei Marken.
// ZWILLING: android ml/CopyRowText.kt, Fixture docs/fixtures/copies/copy-row.json.
import { EDITION_LABELS } from './valuation.js';
import { formatCopyLocation } from './copyLocation.js';

export const UNSORTED_TEXT = 'noch nicht einsortiert';

export function copyRow(copy, container, activeOffers = []) {
  const lead = `${copy.condition || 'NM'} · ${EDITION_LABELS[copy.edition || 'unknown'] || copy.edition}`;
  const unsorted = !copy.container_id || !container;
  const location = unsorted ? UNSORTED_TEXT : formatCopyLocation(copy, container);
  const marks = [];
  if (copy.for_sale) marks.push('zum-verkauf');
  if (activeOffers.length > 0) marks.push('angeboten');
  return { lead, location, unsorted, marks };
}
```

  Handy analog (`object CopyRowText { data class Line(...); fun of(copy: CopyRow, container: ContainerRow?, activeOffers: Int): Line }`).
- [ ] **Schritt 5: Tests grün, Commit** `feat(i2): Exemplarzeile als Zwilling (Fixture copy-row)`.

---

### Task 2: Verkaufsweg-Logik als Zwilling (Spec §5.2)

**Dateien:**
- Erstellen: `docs/fixtures/sales/sale-flow.json`
- Erstellen: `desktop/src/utils/saleFlow.js`, `saleFlow.test.js`; `android/.../ml/SaleFlow.kt`, `SaleFlowTest.kt`

**Schnittstellen:**
- Verbraucht: `saleMath.js` / `SalesMath.kt` (Vorschlagspreis = Marktwert der Variante, Abschlag, Mindestpreis — **bestehend, nicht nachbauen**), Liste der Verkäufe (PC `salesOverview`, Handy `SideStores.sales`).
- Liefert:
  - `lastChannel(sales, fallback = 'cardmarket')` — Kanal des jüngsten **nicht stornierten** Verkaufs (nach `sold_on`, dann `created_at`); ohne Verkauf `fallback`.
  - `salePrefill({ copies, variantValueCents, sales, today })` → `{ channel_id, grossCents, sold_on, condition, edition }` (Zustand/Auflage nur, wenn alle Exemplare gleich; sonst `null`).
  - `nextSteps({ way, remainingForSaleOfCard, listingId })` → geordnete Liste aus `'naechstes-exemplar' | 'angebot-ansehen' | 'verkaufsliste-ansehen' | 'fertig'` (Spec §5.2 Punkt 5). `fertig` steht immer zuletzt.
  - `flowError(code, ctx)` → `{ text, fix: { label, value } | null }` für die bekannten Fehlerfälle. **Schritt 1 erhebt die Liste** aus den heutigen Prüfungen in `SaleDialog.jsx`, `ListingDialog.jsx`, `SaleSheet.kt`, `ListingSheet.kt` (z. B. Preis fehlt/0 → „Preis fehlt · Vorschlag 4,50 € übernehmen“; Preis unter dem eingestellten Mindestpreis → „Preis liegt unter dem Mindestpreis von 0,10 € · Auf 0,10 € setzen“; eBay-Grenzen, falls in `supabase/functions/_shared/ebay-map.ts` eine Untergrenze steht).

- [ ] **Schritt 1: Fehlerfälle erheben**: `grep -n "setError\|error =" desktop/src/components/SaleDialog.jsx desktop/src/components/ListingDialog.jsx android/.../ui/SaleSheet.kt android/.../ui/ListingSheet.kt`. Jede Meldung, die der Nutzer selbst beheben kann, wird ein `code` in der Fixture. Meldungen ohne Abhilfe (Netz, Server) bleiben Text ohne `fix`.
- [ ] **Schritt 2: Fixture** `sale-flow.json` mit den Blöcken `lastChannel` (mindestens: leer → Fallback; zwei Verkäufe, jüngster storniert → der ältere; gleicher Tag → `created_at` entscheidet), `prefill` (einheitlich vs. gemischt Zustand/Auflage; kein Marktwert → `grossCents: null`), `nextSteps` (je Weg), `errors` (je `code` Text und Fix). ZWILLING-Kopfzeile wie in Task 1.
- [ ] **Schritt 3: Fehlschlagende Tests** auf beiden Seiten, **Schritt 4: Helfer**, **Schritt 5: grün, Commit** `feat(i2): Verkaufsweg-Logik als Zwilling (Vorbelegung, letzter Kanal, naechster Schritt)`.

---

### Task 3: PC — Hinweis- und Rückgängig-Leiste

**Dateien:**
- Erstellen: `desktop/src/components/Toast.jsx`
- Ändern: `desktop/src/App.jsx` (Provider um die Routen), `desktop/src/components/ForSaleList.jsx:141-146` (heutige Inline-Rückgängig-Zeile auf die Leiste umstellen)

**Schnittstellen:**
- Liefert: `ToastProvider`, `useToast()` → `show({ text, action?: { label, run }, ms = 6000 })`. Immer nur **eine** Leiste; eine neue ersetzt die alte. Unten mittig, `role="status"`, `aria-live="polite"`, schließt sich nach `ms`, bei Mausüber/Fokus pausiert der Zeitgeber. Kein Dialog, nichts zum Wegklicken nötig (Spec §5.2 Punkt 4).

- [ ] **Schritt 1:** Komponente mit Rollen-Farben (`bg-surface`, `border-line`, Aktion in `text-accent`); Übergang 150 ms (`transition-opacity`), der die Liste darunter nicht verschiebt (`fixed`).
- [ ] **Schritt 2:** `ForSaleList` nutzt `useToast` für „n Karten als verkauft gebucht · Rückgängig“ (bestehendes `undoSale` bleibt die Aktion).
- [ ] **Schritt 3:** Helfer `desktop/src/utils/toastQueue.js` (reine Zeitgeber-/Ersetz-Logik) mit Test `toastQueue.test.js`: ersetzt statt stapelt, pausiert, räumt nach Ablauf.
- [ ] **Schritt 4:** Prüfläufe, Commit `feat(i2): PC-Hinweisleiste mit Rueckgaengig`.

---

### Task 4: PC — Exemplarzeile im Kartendetail (Spec §4.1)

**Dateien:** Ändern: `desktop/src/components/CardDetailPanel.jsx:343-361`

- [ ] **Schritt 1:** Die Zeile rendert `copyRow(c, container, offers[c.copy_id] || [])`:
  - links `lead` in `text-text`, dahinter `·` und `location`. Bei `unsorted` in `text-muted`, sonst `text-text`.
  - rechts höchstens zwei Marken: „zum Verkauf“ (`warn`, getönt: Rand/Fläche `warn/15`, Text `text-text`), „angeboten“ (`good`, ebenso getönt).
  - Tag-Chips bleiben, rücken unter die Zeile, wenn der Platz nicht reicht (`flex-wrap`).
  - Das Symbol `Tag` und die `offeredText`-Zeile entfallen, die Marken ersetzen sie. Der Angebotstext steht als `title` an der Marke „angeboten“.
- [ ] **Schritt 2:** `grep -rn "ohne Standort" desktop/src` → **0 Treffer** (Spec §8 Punkt 4).
- [ ] **Schritt 3:** Klick auf die Zeile öffnet weiter `CopySheet` (unverändert).
- [ ] **Schritt 4:** Prüfläufe, Commit `feat(i2): PC-Exemplarzeile (Zustand, Auflage, Standort, Marken)`.

---

### Task 5: PC — Exemplar-Dialog aufräumen (Spec §4.2)

**Dateien:** Ändern: `desktop/src/components/CopySheet.jsx` (Kopf Z. 210–220, Schalter Z. 279–283, Fuß Z. 298–324)

- [ ] **Schritt 1: Kopf:** Kartenname als Titel (`card.name`, als Prop von `CardDetailPanel` hereinreichen), darunter leise `Druck · Zustand · Auflage` (`set_code · rarity`, `lead` aus `copyRow`). Schließen rechts.
- [ ] **Schritt 2: Mitte:** Standort, Tags, Notiz. Der Schalter „Zum Verkauf“ und `toggleForSale` **entfallen** (Weg 3 in Task 6 ersetzt ihn).
- [ ] **Schritt 3: Fuß:** `flex flex-wrap items-center gap-2`. Ganz links „Entfernen“ (leise: `text-muted hover:text-bad`), rechts `ml-auto` „Verkaufen“ (Sekundärknopf, Rahmen) und „Speichern“ (einzige `accent`-Fläche). „Abbrechen“ entfällt, geschlossen wird über das X oder Esc. Bei 360 px Breite bricht die Zeile um, nichts wird abgeschnitten (Spec §8 Punkt 5).
- [ ] **Schritt 4:** Prüfen mit `window.innerWidth` 360 (DevTools-Gerätemodus) und im Normalfenster: alle Knöpfe vollständig sichtbar.
- [ ] **Schritt 5:** Prüfläufe, Commit `feat(i2): PC-Exemplar-Dialog aufgeraeumt, Fuss mit Umbruch`.

---

### Task 6: PC — drei Wege im selben Fenster (Spec §5.1, §5.2)

**Dateien:**
- Erstellen: `desktop/src/components/SellFlow.jsx`
- Ändern: `SaleDialog.jsx` und `ListingDialog.jsx` (neues Prop `embedded`: ohne eigenes `fixed inset-0`-Overlay, nur Inhalt und Fuß), `CopySheet.jsx` (Inhalt wechselt zwischen `edit` und `sell`)

**Schnittstellen:**
- `SellFlow({ copies, card, onDone, onBack })` zeigt die Auswahl der drei Wege und danach eingebettet `SaleDialog`/`ListingDialog`. Bei „Auf die Verkaufsliste“ ruft es `setForSale({ copyIds, value: true })` und schließt, danach `toast.show({ text: 'Auf der Verkaufsliste', action: { label: 'Ansehen', run: () => navigate('/verkaufen/zum-verkauf') } })`.
- `SaleDialog` bekommt `prefill` aus `salePrefill` (Task 2): Kanal wie beim letzten Mal, Preis = Vorschlag, Datum heute. **Verkauf zum Vorschlagspreis = höchstens zwei Bestätigungen:** „Verkauft buchen“ (Weg wählen) → „Buchen“ (Formular mit Vorbelegung).
- Nach dem Buchen: Fenster schließt, `toast.show({ text: 'Verkauft gebucht · 4,50 € · Rückgängig', action: { label: 'Rückgängig', run: () => window.api.cancelSale(saleId) } })`. Der Betrag kommt aus dem Formular, `booked` liefert heute nur die `sale_id` (`main.cjs:908-913`).
- Nächster Schritt: Das Fenster zeigt vor dem Schließen kurz (bis zur nächsten Eingabe) die Vorschläge aus `nextSteps` als Knöpfe. „Fertig“ schließt, „Nächstes Exemplar“ öffnet das nächste vorgemerkte Exemplar derselben Karte, „Angebot ansehen“ springt zu `/verkaufen/angebote/<id>`.

- [ ] **Schritt 1:** `embedded` in beiden Dialogen, bestehende Aufrufer (`ForSaleList`, `ListingDetail`) unverändert lassen.
- [ ] **Schritt 2:** `SellFlow` mit Übergang 150 ms (`transition-[opacity,transform]`, nur Inhalt des Fensters, die Liste dahinter bleibt stehen).
- [ ] **Schritt 3: Fehler im Fluss:** Meldungen aus `flowError` stehen als Zeile direkt am Feld, mit Knopf für die Abhilfe (setzt den Wert, Fokus bleibt).
- [ ] **Schritt 4: Tastatur:** Enter = weiter/buchen, Esc = eine Stufe zurück (Formular → Wege → Exemplar → zu), sinnvolle Tab-Reihenfolge, sichtbarer Fokusrahmen (`focus-visible:ring-2 ring-accent`).
- [ ] **Schritt 5: Sofort sichtbar:** Marken und Seitenleisten-Zähler ziehen per `collection-dirty` nach, der Mechanismus besteht seit I1. Schlägt das Schreiben fehl, bleibt der alte Zustand, die Meldung erscheint im Fluss.
- [ ] **Schritt 6:** Prüfläufe, Commit `feat(i2): PC-Verkaufsweg mit drei Wegen im selben Fenster`.

---

### Task 7: PC — Einstieg in „Kandidaten“

**Dateien:** Ändern: `desktop/src/components/DuplicatesList.jsx`

- [ ] **Schritt 1:** Je Kandidat neben „Auf die Verkaufsliste“ ein Knopf „Verkaufen…“. Er öffnet `SellFlow` in einem Fenster mit den **vorgeschlagenen** Exemplaren (die über dem Playset, gleiche Auswahlregel wie „Auf die Verkaufsliste“, `Duplicates`-Helfer wiederverwenden).
- [ ] **Schritt 2:** Prüfläufe, Commit `feat(i2): Verkaufen-Einstieg in Kandidaten`.

---

### Task 8: Handy — Exemplarzeile und Exemplar-Dialog (Spec §4)

**Dateien:** Ändern: `android/.../ui/CardDetailScreen.kt:305-333` (`CopyLocationRow`), `ui/CopySheet.kt` (Kopf, Schalter Z. 271–274, Fuß Z. 287–312)

- [ ] **Schritt 1:** `CopyLocationRow` rendert `CopyRowText.of(...)`: `lead · location` (leise bei `unsorted`), Marken als getönte Plaketten rechts. `Sell`-Symbol und `offeredText`-Zeile entfallen. `grep -rn "ohne Standort" android/app/src/main` → 0 Treffer (Kommentare in `ScanStagingScreen.kt` ebenfalls anpassen).
- [ ] **Schritt 2:** `CopySheet`: Kopf wie PC. Schalter „Zum Verkauf“ entfällt. Der Fuß wird `FlowRow` (bricht um), mit „Entfernen“ leise links, „Verkaufen“ und „Speichern“ rechts. Die Aktionen liegen unten in Daumenreichweite, das Blatt behält sein Scrollverhalten (Spec §4.2 letzter Absatz).
- [ ] **Schritt 3:** Prüfläufe, Commit `feat(i2): Handy-Exemplarzeile und aufgeraeumter Exemplar-Dialog`.

---

### Task 9: Handy — drei Wege, Snackbar, Kandidaten (Spec §5)

**Dateien:** Erstellen: `android/.../ui/SellFlow.kt`. Ändern: `ui/CopySheet.kt`, `ui/SaleSheet.kt`, `ui/ListingSheet.kt` (je eine eingebettete Inhalts-Composable ohne eigenes `ModalBottomSheet`), `ui/CardDetailScreen.kt` (SnackbarHost), `ui/SaleLists.kt` (Kandidaten-Einstieg; Inline-Rückgängig Z. 288–298 auf Snackbar umstellen)

- [ ] **Schritt 1:** Eingebettete Inhalte `SaleSheetContent`/`ListingSheetContent`. Die bestehenden `SaleSheet`/`ListingSheet` rufen sie in ihrem Blatt auf, damit die Aufrufer unverändert bleiben.
- [ ] **Schritt 2:** `CopySheet` wechselt per `AnimatedContent` (150 ms) zwischen Bearbeiten → Wege → Formular → nächster Schritt, alles **im selben Blatt** (kein zweites Blatt). Das Blatt ist wegwischbar, Eingaben liegen nie hinter der Tastatur (`imePadding`).
- [ ] **Schritt 3:** Vorbelegung aus `SaleFlow.prefill` (letzter Kanal aus `SideStores.sales`).
- [ ] **Schritt 4: Rückgängig:** `SnackbarHostState.showSnackbar(message, actionLabel = "Rückgängig", duration = Indefinite)` mit eigenem 6-s-Timeout (Compose kennt nur Short/Long), Aktion → `SalesRepository.cancel(saleId)`, danach `SideStores.sales.refreshAndWait()` und `CollectionStore.awaitSync()`.
- [ ] **Schritt 5: Sofort sichtbar:** Marke „zum Verkauf“ und Zähler gelten ab dem Tippen. Dazu kommt eine Überlagerung `PendingForSale` (copyId → Wert) in `CollectionStore`, die bis zum nächsten Abgleich mit dem echten Wert gilt und bei Schreibfehler verworfen wird (Fehler im Fluss). Test `PendingForSaleTest`: setzen, Abgleich bestätigt → entfernt; Fehler → verworfen.
- [ ] **Schritt 6:** Kandidaten (`DuplicatesList` in `SaleLists.kt`) bekommen „Verkaufen…“ wie am PC.
- [ ] **Schritt 7:** Prüfläufe, Commit `feat(i2): Handy-Verkaufsweg mit drei Wegen, Rueckgaengig-Snackbar, Kandidaten`.

---

### Task 10: PC — Schrift, Größen, Ecken (Spec §6.3)

**Dateien:** Ändern: `docs/fixtures/design/tokens.json` (neuer Block `typo` und `radius`), `desktop/tailwind.config.js` (`fontFamily`, `fontSize`, `borderRadius`), `desktop/src/index.css` (Schriftladen entfernen), Renderer-Dateien, `theme.test.js`, `noLegacyColors.test.js`

- [ ] **Schritt 1:** Wo die Schriften geladen werden: `grep -rn "Chakra\|Manrope\|JetBrains" desktop/index.html desktop/src desktop/package.json`. Alle Ladestellen entfernen. Kein Paket deinstallieren (kein `npm`), nur den Import streichen. Paketreste notieren.
- [ ] **Schritt 2:** `tokens.json` bekommt `typo: { family: "system-ui", sizes: { titel: 22, abschnitt: 17, zeile: 15, klein: 13, winzig: 12 }, lineHeight: 1.5 }` und `radius: { flaeche: 10, feld: 6, marke: 9999 }`. `theme.test.js` prüft Tailwind gegen die Datei (Zwilling zu Task 11).
- [ ] **Schritt 3:** Tailwind: `fontFamily.sans = fontFamily.display = fontFamily.mono = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']`. Die Klassennamen bleiben, sie lösen nur auf die Systemschrift auf. `tabular-nums` bleibt (`index.css:35`). Rollen-Größen `text-titel`, `text-abschnitt`, `text-zeile`, `text-klein`. `borderRadius.flaeche = '10px'`, `borderRadius.feld = '6px'`.
- [ ] **Schritt 4:** Ersetzen: `rounded-xl|2xl|3xl` → `rounded-flaeche`, `rounded|rounded-md|rounded-lg` an Feldern und Knöpfen → `rounded-feld`, `rounded-full` nur an Marken und Avataren. Beliebige Pixelgrößen (`text-[11px]` usw.) auf die vier Größen abbilden, Ausnahmen nur mit Kommentar.
- [ ] **Schritt 5:** Wächter erweitern: `rounded-(xl|2xl|3xl)`, `font-(display|mono)` außerhalb `tailwind.config.js` und nicht freigegebene `text-[Npx]` schlagen fehl.
- [ ] **Schritt 6:** Sichtprüfung aller 15 Bereiche hell und dunkel, dazu die Kontrastmessung aus der I1-Abnahme wiederholen (Skript `audit.js`, Vorgehen im Abnahme-Protokoll).
- [ ] **Schritt 7:** Prüfläufe, Commit `feat(i2): PC-Systemschrift, vier Groessen, Ecken 10/6`.

---

### Task 11: Handy — Schrift, Größen, Ecken (Spec §6.3)

**Dateien:** Ändern: `android/.../ui/theme/Type.kt` (FontFamily → `FontFamily.Default`, Größen 22/17/15/13/12, Zeilenhöhe 1,5, `TNUM` bleibt), `ui/theme/Theme.kt:61-64` (`Shapes`: small/medium = 6.dp, large = 10.dp), `ui/components/SpaceCard.kt:18` (16 → 10), `DesignTokensTest.kt` (liest `typo`/`radius` aus `tokens.json`)

- [ ] **Schritt 1:** Google-Fonts-Einbindung (`ui-text-google-fonts`, Font-Provider in `Type.kt`) entfernen, falls danach unbenutzt, auch die Abhängigkeit in `app/build.gradle.kts`.
- [ ] **Schritt 2:** `grep -rn "RoundedCornerShape(1[2-9]\|RoundedCornerShape(2" android/app/src/main` → auf 10 bzw. 6 abbilden.
- [ ] **Schritt 3:** Prüfläufe, Release bauen, auf das Gerät, Sichtprüfung hell/dunkel.
- [ ] **Schritt 4:** Commit `feat(i2): Handy-Systemschrift, vier Groessen, Ecken 10/6`.

---

### Task 12: Feinschliff aus der Abnahme, Aufteilung CollectionList (Spec §10)

**Dateien:** siehe Dateiübersicht

- [ ] **Schritt 1: Sprache:** Englische Beschriftungen eindeutschen, gefunden über `grep -rnE "\"(TOTAL PORTFOLIO VALUE|ALL TIME|ALLOCATION|ASSET|PRICE|QTY|EQUITY|My Decks|Select or Create a Deck|Search Collection)" desktop/src`. Zum Beispiel Gesamtwert, Seit Beginn, Aufteilung, Karte, Preis, Anzahl, Wert, Meine Decks, Deck wählen oder anlegen, Sammlung durchsuchen. Die Zeitraum-Knöpfe 1W/1M/1Y/ALL werden 1W/1M/1J/Alles wie am Handy.
- [ ] **Schritt 2: Preisformat:** In `CardTile.jsx` steht der Einzelpreis heute als „€0.26“. Er läuft künftig über `fmtEUR`, wie die Summe. Test: `grep -rn "€\${\|'€'" desktop/src/components` → 0.
- [ ] **Schritt 3:** `CardTile` zeigt für die Seltenheit „Unknown“ keine „COMMON“-Marke, sondern „Seltenheit unbekannt“ (leise). Das Handy prüfen und gleichziehen.
- [ ] **Schritt 4:** Handy-Deals: Den Platzhalter auf „Suchbegriff“ kürzen und das Beispiel als `supportingText` darunter setzen. Das Feld bleibt einzeilig.
- [ ] **Schritt 5:** `SalesPanel.jsx:32,41` gegen fehlendes `window.api` absichern (`window.api?.salesOverview?.()`), wie die anderen Panels.
- [ ] **Schritt 6: Aufteilung** `CollectionList.jsx` (647 Zeilen) in `CollectionList.jsx` (Zustand, Laden, Filter-Memo), `CollectionToolbar.jsx` (Werkzeugleiste Z. 454–521, Banner, gespeicherte Filter, Dropdowns, Behälter-/Tag-Filter, aktive Chips Z. 522–611) und `CollectionGrid.jsx` (AutoSizer-Helfer Z. 24–58, `Cell` Z. 420–449, Gitter Z. 612–647). **Reine Verschiebung**, keine Verhaltensänderung. Prüfen per Sichtvergleich vorher/nachher und über die bestehenden Tests.
- [ ] **Schritt 7:** Prüfläufe, je Schritt ein Commit (`fix(i2): …`, `refactor(i2): CollectionList aufgeteilt`).

---

### Task 13: Bauen, aufspielen, abnehmen

- [ ] **Schritt 1:** `cd desktop && npm run dist`, installieren; `cd android && ./gradlew assembleRelease`, per `adb install -r` aufs Handy.
- [ ] **Schritt 2: Abnahme Spec §8 Punkte 4, 5, 6** auf beiden Geräten:
  - 4: Ein Exemplar ohne Behälter zeigt „noch nicht einsortiert“, `grep` nach „ohne Standort“ ergibt 0.
  - 5: Alle Knöpfe des Exemplar-Dialogs sind vollständig sichtbar, bei schmalem Fenster und 360 dp.
  - 6: Alle drei Wege sind vom Exemplar aus erreichbar. „Verkauft buchen“ braucht höchstens zwei Bestätigungen. Danach kommen die Rückgängig-Leiste und ein Vorschlag für den nächsten Schritt.
- [ ] **Schritt 3: Rückschau** Punkte 1–3 und 7–10 aus der I1-Abnahme (Kontrastmessung in beiden Modi wegen der neuen Schrift).
- [ ] **Schritt 4:** Protokoll `docs/superpowers/ledgers/<Datum>-i2-abnahme.md` nach dem Muster der I1-Abnahme.
- [ ] **Schritt 5:** Bei bestandener Abnahme Merge in `main` nach Rückfrage beim Nutzer.

**Achtung beim Testen:** Aktionen, die Daten verändern (Verkauf buchen, Verkaufsliste, Storno), nur mit Zustimmung des Nutzers an der echten Sammlung oder auf einer **Kopie der PC-Datenbank mit ausgeschaltetem Sync** (Vorgehen: Abnahme-Protokoll I1, Punkt 3). Buchungen sind echte Verkäufe in der Cloud.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Spec | Tasks |
|---|---|
| §4.1 Exemplarzeile | 1, 4, 8 |
| §4.2 Exemplar-Dialog | 5, 8 |
| §5.1 Einstieg, drei Wege | 6, 7, 9 (Mehrfachauswahl in der Kartenliste bewusst ausgeklammert, siehe Entscheidungen) |
| §5.2 Punkt 1 Kein Fensterstapel | 6, 9 |
| §5.2 Punkt 2 Vorbelegung | 2, 6, 9 |
| §5.2 Punkt 3 Sofort sichtbar | 6 (PC lokal), 9 (Handy-Überlagerung) |
| §5.2 Punkt 4 Rückgängig | 3, 6, 9 |
| §5.2 Punkt 5 Nächster Schritt | 2, 6, 9 |
| §5.2 Punkt 6 Fehler im Fluss | 2, 6, 9 |
| §5.2 Punkt 7 Tastatur/Daumen | 6, 8, 9 |
| §5.3 Bereich „Verkaufen“ | seit I1 vorhanden |
| §6.3 Schrift/Raster | 10, 11 |
| §10 CollectionList aufteilen | 12 |
| §8 Punkte 4–6 | 13 |

**Offene Annahmen:**
- Der Standort-Text der Fixture folgt der bestehenden Formatierung (Task 1, Schritt 1).
- Ob eBay eine Mindestpreis-Grenze im Code kennt, klärt Task 2 Schritt 1. Das Spec-Beispiel „1,00 €“ ist nur ein Beispiel.
- Die Überlagerung `PendingForSale` (Task 9) ist die einzige neue Zustandsschicht am Handy. Wird sie zu groß, reicht als Rückfall „Marke nach `awaitSync`“, wie heute. Dann gilt die Anforderung „beim Klick“ am Handy als nicht erfüllt und wird im Protokoll vermerkt.

**Nicht in diesem Plan:** Mehrfachauswahl in der Kartenliste; H3b2 (eBay-Bestellungen); Offline-Start am Handy; die Zähl-Abweichung Handy/PC (Summe `cards.quantity` gegenüber lebenden `card_copies`, heute 30), die gesondert geklärt wird.
