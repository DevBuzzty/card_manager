# Ergebnis-Seite nach dem Einzelfoto + Euro-Preise je Druck – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nach einem Einzelfoto öffnet das Handy automatisch eine Ergebnis-Seite mit erkanntem Druck, Seltenheit, Auflage und tagesaktuellen Cardmarket-Euro-Preisen für alle Drucke; übernommen wird nur noch per „In Sammlung +“.

**Architecture:** Die tägliche Edge Function `refresh-cardmarket-prices` legt zusätzlich `cm-prices.json.gz` (idProduct → Trend/Tief) in den öffentlichen Storage-Bucket `catalog`. Der PC schreibt beim Katalog-Bau je Druck die Cardmarket-Produktnummer(n) `cm` in den Offline-Katalog (gleiche Zuordnungsregeln wie der Bulk-Lauf). Das Handy lädt die Preisdatei 1×/Tag, verknüpft Druck → `cm` → Trend offline und zeigt alles in `ScanErgebnisScreen`.

**Tech Stack:** Deno (Supabase Edge Function), Node/Electron CommonJS (`desktop/electron/*.cjs`, better-sqlite3), Kotlin + Jetpack Compose (Android), org.json, OkHttp.

**Spec:** `docs/superpowers/specs/2026-10-04-scan-ergebnis-seite-design.md`

## Global Constraints

- UI-Texte und Kommentare auf Deutsch.
- Android-Gestaltung nur mit vorhandenen Tokens/Bausteinen (`ui/theme/Color.kt`, `Type.kt`, `SpaceCard`, `RarityChip`, `SectionHeader`, `langFlag`, `PriceHistoryChart`); keine neuen Farben, keine Hex-Werte.
- `cards.quantity` / `cards.deleted` nie direkt schreiben (Desktop); nichts in diesem Plan schreibt sie.
- KR-Drucke bekommen **nie** einen Cardmarket-Preis (Cardmarket führt kein Koreanisch); für KR gilt nur der eigene Preis (k-tcg).
- Der neue Edge-Function-Schritt ist **nie fatal** für die bestehende Preisaktualisierung der Sammlung.
- Agents deployen keine Edge Functions und spielen kein SQL ein – das macht der Nutzer (Task 10).
- `android/local.properties` nie lesen oder ändern.
- Testbefehle: Desktop-Main `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`; Deno `deno test --allow-read supabase/functions/refresh-cardmarket-prices/` (Repo-Wurzel); Android `cd android && ./gradlew testDebugUnitTest` (JDK = Android Studios `jbr`).
- Abweichung von Spec §6, bewusst: **kein JS-Zwilling** für „Preis je Druck“ – der Desktop hat diese Ansicht nicht (YAGNI). Die Fixture liegt trotzdem in `docs/fixtures/` und wird vom Kotlin-Test gelesen.
- Abweichung von Spec §4.5, bewusst: „Du hast schon N×“ zeigt die Anzahl je Druck aus `CardRow.quantity`; Zustand/Auflage je Exemplar stehen im Handy-Speicher nicht pro Druck bereit und entfallen.

## Review Focus

1. Alter Katalog ohne `cm`-Felder (Handy noch nicht neu geladen) → Seite öffnet, Preise „–“, kein Absturz. → Test in Task 4 (Parser) und Task 7 (`drucke` mit leerem `cm`).
2. Kaputte oder halb geladene Preisdatei → Parser wirft, alte Preise bleiben, kein Absturz. → Test in Task 5.
3. Scan ohne erkannten Druck (`match.selected == null`) → kein Druck markiert, Kopf zeigt Spanne/„–“. → Test in Task 7 (`startAuswahl`).
4. KR-Druck mit zufällig gleichem Code → nie Cardmarket-Preis. → Test in Task 7.
5. Preisdatei älter als 3 Tage → Stand sichtbar. → Test in Task 7 (`standText`).

---

### Task 1: Edge Function schreibt die tägliche Preisdatei

**Files:**
- Create: `supabase/functions/refresh-cardmarket-prices/price_file.ts`
- Create: `supabase/functions/refresh-cardmarket-prices/price_file_test.ts`
- Modify: `supabase/functions/refresh-cardmarket-prices/index.ts` (Guide-Abruf vor den Früh-Ausstieg ziehen, neuer Schritt 2b)

**Interfaces:**
- Produces: Storage-Objekt `catalog/cm-prices.json.gz`, Inhalt `{ "v": 1, "date": "YYYY-MM-DD", "p": { "<idProduct>": [trend|null, low|null] } }`; Antwort-JSON der Funktion bekommt `priceFile: { entries: number } | { error: string }`.

- [ ] **Step 1: Failing test schreiben** – `price_file_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { buildPriceFile, gzipJson } from "./price_file.ts";

Deno.test("buildPriceFile: trend/low > 0 bleiben, 0/null/kaputt werden null, leere Zeilen fallen weg", () => {
  const guide = { priceGuides: [
    { idProduct: 101, trend: 1.5, low: 0.2 },
    { idProduct: 102, trend: 0, low: 0.5 },      // trend 0 = kein Trend
    { idProduct: 103, trend: null, low: null },  // nichts -> weg
    { idProduct: "x", trend: 3 },                // kaputte ID -> weg
    { idProduct: 104, trend: 2 },                // low fehlt
  ] };
  assertEquals(buildPriceFile(guide, "2026-10-04"), {
    v: 1, date: "2026-10-04",
    p: { "101": [1.5, 0.2], "102": [null, 0.5], "104": [2, null] },
  });
});

Deno.test("buildPriceFile: kein priceGuides-Array -> leere Datei", () => {
  assertEquals(buildPriceFile(null, "2026-10-04"), { v: 1, date: "2026-10-04", p: {} });
});

Deno.test("gzipJson: entpackt wieder zum selben JSON", async () => {
  const gz = await gzipJson({ a: 1 });
  const text = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  assertEquals(JSON.parse(text), { a: 1 });
});
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `deno test --allow-read supabase/functions/refresh-cardmarket-prices/price_file_test.ts`
Expected: FAIL – Modul `./price_file.ts` nicht gefunden.

- [ ] **Step 3: `price_file.ts` schreiben**

```ts
// Spec 2026-10-04 §3.1 — kompakte Tages-Preisdatei fuer das Handy (Storage catalog/cm-prices.json.gz).
// Cardmarket meldet "kein Trend" als trend: 0 (wie im Desktop, cardmarket-bulk.cjs) -> null.
export type PriceFile = { v: 1; date: string; p: Record<string, [number | null, number | null]> };

const pos = (x: unknown): number | null => (typeof x === "number" && x > 0 ? x : null);

export function buildPriceFile(guide: unknown, date: string): PriceFile {
  const arr = (guide as { priceGuides?: unknown } | null)?.priceGuides;
  const p: PriceFile["p"] = {};
  if (Array.isArray(arr)) {
    for (const g of arr as Array<Record<string, unknown>>) {
      const id = Number(g?.idProduct);
      if (!Number.isInteger(id) || id <= 0) continue;
      const trend = pos(g.trend), low = pos(g.low);
      if (trend === null && low === null) continue;
      p[String(id)] = [trend, low];
    }
  }
  return { v: 1, date, p };
}

export async function gzipJson(obj: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
```

- [ ] **Step 4: Test laufen lassen, muss bestehen**

Run: `deno test --allow-read supabase/functions/refresh-cardmarket-prices/`
Expected: PASS (alle Tests inkl. `prices_test.ts`, `sealed_test.ts`).

- [ ] **Step 5: `index.ts` umbauen.** Import ergänzen (nach Zeile 14):

```ts
import { buildPriceFile, gzipJson } from "./price_file.ts";
```

Den bisherigen Block „Early exit“ (L77–79) und „Guide fetch and parse“ (L82–87) **ersetzen** durch – Guide zuerst, dann Preisdatei, dann der alte Früh-Ausstieg:

```ts
  // 2. Price guide (immer -- auch ohne eigene Karten braucht das Handy die Tages-Preisdatei).
  let res: Response;
  try { res = await fetch(GUIDE_URL, { headers: { "User-Agent": UA } }); }
  catch (e) { return json({ error: `guide fetch: ${(e as Error).message}` }, 502); }
  if (!res.ok) return json({ error: `guide HTTP ${res.status}` }, 502);
  let guide: unknown;
  try { guide = await res.json(); } catch (e) { return json({ error: `guide parse: ${(e as Error).message}` }, 502); }

  // 2b. Spec 2026-10-04 §3.1: Tages-Preisdatei fuers Handy. Nie fatal fuer die Sammlungspreise.
  let priceFile: { entries: number } | { error: string };
  try {
    const file = buildPriceFile(guide, new Date().toISOString().slice(0, 10));
    const gz = await gzipJson(file);
    const { error } = await supabase.storage.from("catalog")
      .upload("cm-prices.json.gz", gz, { contentType: "application/gzip", upsert: true, cacheControl: "3600" });
    if (error) throw new Error(error.message);
    priceFile = { entries: Object.keys(file.p).length };
  } catch (e) {
    priceFile = { error: (e as Error).message };
    console.error("[refresh-cardmarket-prices] price file skipped:", priceFile.error);
  }

  if (ids.size === 0 && sealedRows.length === 0) {
    return json({ needed: 0, found: 0, updated: 0, sealed: sealedBody(0), priceFile });
  }
```

Am Ende (L113) die Antwort erweitern:

```ts
  const body = { needed: ids.size, found: prices.length, updated, sealed: sealedBody(sealedUpdated), priceFile };
```

- [ ] **Step 6: Tests erneut**

Run: `deno test --allow-read supabase/functions/refresh-cardmarket-prices/`
Expected: PASS. Zusätzlich `deno check supabase/functions/refresh-cardmarket-prices/index.ts` → keine Typfehler.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/refresh-cardmarket-prices/
git commit -m "feat(cloud): Tages-Preisdatei cm-prices.json.gz fuer das Handy"
```

---

### Task 2: Zuordnung Druck → Cardmarket-Produkt(e) (rein)

**Files:**
- Modify: `desktop/electron/cardmarket-bulk-parse.cjs` (neue Funktion `cmForPrinting`, Export)
- Test: `desktop/electron/cardmarket-bulk-parse.test.cjs`

**Interfaces:**
- Consumes: `resolveProduct`, `deriveProduct`, `expansionIdsFor` (intern), `normName` (aus `cardmarket-parse.cjs`), Index-Objekt `{ expansionIndex, singlesIndex, versionIndex, learned }`.
- Produces: `cmForPrinting({ cardName, setNames, rarity, printingRarities, realId }, ix) → number | number[] | null`.

- [ ] **Step 1: Failing test** – ans Ende von `cardmarket-bulk-parse.test.cjs`:

```js
const { cmForPrinting } = require('./cardmarket-bulk-parse.cjs');

test('cmForPrinting: echte ID > eindeutig > abgeleitet > Kandidaten > null', () => {
  const singles = [
    { idProduct: 10, name: 'Solo Card', idExpansion: 7 },
    { idProduct: 30, name: 'Toadally Awesome', idExpansion: 7 },
    { idProduct: 20, name: 'Toadally Awesome', idExpansion: 7 },
  ];
  const base = {
    expansionIndex: buildExpansionIndex([{ name: 'Some Set Booster', idExpansion: 7 }]),
    singlesIndex: buildSinglesIndex(singles),
    versionIndex: buildVersionIndex(singles),
  };
  const set = ['Some Set'];
  const keinModell = { ...base, learned: new Map() };
  // echte ID aus der Sammlung gewinnt immer
  assert.equal(cmForPrinting({ cardName: 'Toadally Awesome', setNames: set, rarity: 'Ultra Rare', printingRarities: [], realId: 99 }, keinModell), 99);
  // eindeutig in den Dateien
  assert.equal(cmForPrinting({ cardName: 'Solo Card', setNames: set, rarity: 'Common', printingRarities: ['Common'] }, keinModell), 10);
  // mehrdeutig, kein Modell -> alle Kandidaten aufsteigend
  assert.deepEqual(cmForPrinting({ cardName: 'Toadally Awesome', setNames: set, rarity: 'Ultra Rare', printingRarities: ['Super Rare', 'Ultra Rare'] }, keinModell), [20, 30]);
  // mehrdeutig, Modell mit 2 Vorbildern auf Position 1 -> abgeleitet
  const learned = new Map([['7|2|Ultra Rare', new Map([[1, 2]])]]);
  assert.equal(cmForPrinting({ cardName: 'Toadally Awesome', setNames: set, rarity: 'Ultra Rare', printingRarities: ['Super Rare', 'Ultra Rare'] }, { ...base, learned }), 30);
  // Set unbekannt -> null
  assert.equal(cmForPrinting({ cardName: 'Solo Card', setNames: ['Gibt Es Nicht'], rarity: 'Common', printingRarities: [] }, keinModell), null);
});
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd desktop && node --test electron/cardmarket-bulk-parse.test.cjs`
Expected: FAIL – `cmForPrinting is not a function`.

- [ ] **Step 3: Implementierung** – in `cardmarket-bulk-parse.cjs` direkt vor `// Cardmarket nummeriert die Versionen einer Karte je Set` einfügen:

```js
// Spec 2026-10-04 §3.2 — Cardmarket-Produkt(e) eines Katalog-Drucks fuer die Preise auf dem Handy.
// Reihenfolge: echte ID aus der Sammlung > eindeutig in den Dateien > aus der Set-Reihenfolge abgeleitet
// > alle Versionen der Karte im Set (aufsteigend; das Handy zeigt daraus eine Spanne) > null.
function cmForPrinting({ cardName, setNames, rarity, printingRarities, realId }, ix) {
  if (realId) return Number(realId);
  const r = resolveProduct({ cardName, setNames }, ix);
  if (r.idProduct) return r.idProduct;
  if (r.reason !== 'ambiguous') return null;
  const d = deriveProduct({ cardName, setNames, rarity, printingRarities: printingRarities || [] }, ix);
  if (d.idProduct) return d.idProduct;
  const ids = [];
  for (const e of expansionIdsFor(setNames, ix.expansionIndex)) {
    for (const id of ix.versionIndex.byKey.get(normName(cardName) + '|' + e) || []) ids.push(id);
  }
  return ids.length ? ids.sort((a, b) => a - b) : null;
}
```

und in `module.exports` `cmForPrinting,` ergänzen (Zeile mit `idFromVersionRow,`).

- [ ] **Step 4: Test laufen lassen, muss bestehen**

Run: `cd desktop && node --test electron/cardmarket-bulk-parse.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/cardmarket-bulk-parse.cjs desktop/electron/cardmarket-bulk-parse.test.cjs
git commit -m "feat(cardmarket): cmForPrinting -- Cardmarket-Produkt(e) je Katalog-Druck"
```

---

### Task 3: Katalog-Bau schreibt `cm` je Druck

**Files:**
- Modify: `desktop/electron/cardmarket-bulk.cjs` (neu `makeCmLookup`, Export)
- Modify: `desktop/electron/catalog-build.cjs` (neu `attachCm`, Export)
- Modify: `desktop/electron/catalog-builder.cjs:197-198` (Aufruf)
- Test: `desktop/electron/catalog-build.test.cjs`

**Interfaces:**
- Consumes: `cmForPrinting` (Task 2); intern `loadAll`, `buildIndexes`, `learnedFrom`, `prefixOf`.
- Produces: `makeCmLookup(db, userDataPath) → Promise<((nameEn, code, rarity, printingRarities) => number|number[]|null) | null>`; `attachCm(cards, lookup) → cards` (setzt `p.cm` an `printings[]` und `printings_verified[]`).

- [ ] **Step 1: Failing test** – ans Ende von `catalog-build.test.cjs`:

```js
const { attachCm } = require('./catalog-build.cjs');

test('attachCm setzt cm an printings und printings_verified, uebergibt die Seltenheiten des Set-Kuerzels', () => {
  const cards = [{
    id: '1', name_en: 'Toadally Awesome',
    printings: [{ code: 'RA03-EN040', rarity: 'Super Rare' }, { code: 'RA03-EN040', rarity: 'Ultra Rare' }, { code: 'SHVI-EN032', rarity: 'Secret Rare' }],
    printings_verified: [{ code: 'RA03-DE040', rarity: 'Ultra Rare', lang: 'DE' }],
  }];
  const calls = [];
  const lookup = (name, code, rarity, rars) => {
    calls.push([name, code, rarity, rars]);
    if (code.startsWith('SHVI')) return null;
    return rarity === 'Ultra Rare' ? 30 : [20, 30];
  };
  attachCm(cards, lookup);
  assert.deepEqual(cards[0].printings[0].cm, [20, 30]);
  assert.equal(cards[0].printings[1].cm, 30);
  assert.equal('cm' in cards[0].printings[2], false);           // null -> Feld fehlt
  assert.equal(cards[0].printings_verified[0].cm, 30);
  assert.deepEqual(calls[3], ['Toadally Awesome', 'RA03-DE040', 'Ultra Rare', ['Super Rare', 'Ultra Rare']]);
});
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/catalog-build.test.cjs`
Expected: FAIL – `attachCm is not a function`.

- [ ] **Step 3: `attachCm` in `catalog-build.cjs`** – vor `function packCatalog` einfügen und exportieren:

```js
// Spec 2026-10-04 §3.2 — `cm` je Druck fuer die Euro-Preise auf dem Handy: Zahl (eindeutig),
// Array (mehrdeutig, Handy zeigt Spanne) oder fehlt. Cardmarket-Produkte sind sprachneutral, also
// bekommen DE- und EN-Druck desselben Sets/derselben Seltenheit dieselbe Nummer.
function attachCm(cards, lookup) {
  const prefixOf = (code) => String(code || '').split('-')[0].toUpperCase();
  for (const c of cards) {
    const rarities = (prefix) => (c.printings || []).filter(p => prefixOf(p.code) === prefix).map(p => p.rarity);
    for (const p of [...(c.printings || []), ...(c.printings_verified || [])]) {
      const cm = lookup(c.name_en, p.code, p.rarity, rarities(prefixOf(p.code)));
      if (cm != null) p.cm = cm;
    }
  }
  return cards;
}
```

`module.exports` von `catalog-build.cjs` um `attachCm` erweitern.

- [ ] **Step 4: `makeCmLookup` in `cardmarket-bulk.cjs`** – Imports oben ergänzen:

```js
const { normName } = require('./cardmarket-parse.cjs');
const { isKoreanCode } = require('./language-kr.cjs');
```

(`applyLangFactor` wird schon aus `language-kr.cjs` importiert – dann beide in einer Zeile: `const { applyLangFactor, isKoreanCode } = require('./language-kr.cjs');`.) `cmForPrinting` in den bestehenden `require('./cardmarket-bulk-parse.cjs')` aufnehmen. Vor `module.exports` einfügen:

```js
// Spec 2026-10-04 §3.2 — Zuordnung fuer den Katalog-Bau. Echte IDs aus der Sammlung (nicht abgeleitet)
// haben Vorrang. KR-Drucke bekommen nie eine Nummer (Cardmarket fuehrt kein Koreanisch).
// null, wenn die Cardmarket-Dateien oder YGOPRODecks Set-Liste fehlen -- der Katalog wird dann ohne `cm` gebaut.
async function makeCmLookup(db, userDataPath) {
  const data = await loadAll(userDataPath, false);
  const ix = buildIndexes(data);
  if (!ix) return null;
  const learned = learnedFrom(db, ix);
  const real = new Map();
  const rows = db.prepare(
    "SELECT name, set_code, rarity, cm_product_id FROM cards WHERE cm_product_id IS NOT NULL AND COALESCE(cm_product_derived, 0) = 0 AND language != 'KR'"
  ).all();
  for (const r of rows) real.set(`${prefixOf(r.set_code)}|${normName(r.name)}|${r.rarity}`, r.cm_product_id);
  return (nameEn, code, rarity, printingRarities) => {
    if (isKoreanCode(code)) return null;
    const prefix = prefixOf(code);
    return cmForPrinting({
      cardName: nameEn, setNames: ix.setsByPrefix.get(prefix) || [], rarity, printingRarities,
      realId: real.get(`${prefix}|${normName(nameEn)}|${rarity}`),
    }, { ...ix, learned });
  };
}
```

`module.exports = { runBulkRefresh, getBulkStatus, makeDeriver, makeCmLookup };`

- [ ] **Step 5: Aufruf in `catalog-builder.cjs`** – Imports: `attachCm` aus `./catalog-build.cjs` zum bestehenden Import, `const { makeCmLookup } = require('./cardmarket-bulk.cjs');`. Direkt nach Zeile 198 (`const cards = attachVerified(...)`) einfügen:

```js
    // Spec 2026-10-04 §3.2: Cardmarket-Produkt je Druck. Ohne Dateien/Netz wird ohne `cm` gebaut.
    try {
      const cmLookup = userDataPath ? await makeCmLookup(db, userDataPath) : null;
      if (cmLookup) attachCm(cards, cmLookup);
    } catch (e) {
      console.warn('[catalog-builder] ohne Cardmarket-Zuordnung:', e.message);
    }
```

- [ ] **Step 6: Alle Main-Prozess-Tests**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
Expected: PASS (bisher 531 + 2 neue).

- [ ] **Step 7: Probe auf Kopie der echten Daten** (Skript im Scratchpad, nicht committen): DB `%APPDATA%\yugioh-card-manager\cards.db` kopieren, `makeCmLookup(db, '%APPDATA%\\yugioh-card-manager')` aufrufen, für 5 bekannte Karten ausgeben (z. B. Toadally Awesome RA03, Dark Magician LOB, Fiendsmith's Lacrima RA05). Erwartet: Zahlen bzw. Arrays, KR → null. Ergebnis im Commit-Text notieren.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/cardmarket-bulk.cjs desktop/electron/catalog-build.cjs desktop/electron/catalog-builder.cjs desktop/electron/catalog-build.test.cjs
git commit -m "feat(katalog): Cardmarket-Produktnummer je Druck (cm) im Offline-Katalog"
```

---

### Task 4: Handy liest und speichert `cm` je Druck

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt` (Feld + Parsen)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt` (Spalte `cm`, `VERSION = 5`)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt` (`printings()` liest `cm`)
- Test: `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt`

**Interfaces:**
- Produces: `data class CatalogPrinting(val code: String, val rarity: String, val lang: String?, val verified: Boolean, val cm: List<Int> = emptyList())`; `CatalogParser.cmOf(o: JSONObject): List<Int>` (internal).

- [ ] **Step 1: Failing test** – in `CatalogParserTest.kt` neue Tests (bestehende Hilfsfunktion zum gzippen des Test-JSON wiederverwenden; sie liegt in derselben Datei):

```kotlin
    @Test
    fun `cm je Druck - Zahl, Array oder fehlt`() {
        val o1 = org.json.JSONObject("""{"code":"A-EN001","rarity":"Common","cm":123}""")
        val o2 = org.json.JSONObject("""{"code":"A-EN001","rarity":"Common","cm":[5,7]}""")
        val o3 = org.json.JSONObject("""{"code":"A-EN001","rarity":"Common"}""")
        assertEquals(listOf(123), CatalogParser.cmOf(o1))
        assertEquals(listOf(5, 7), CatalogParser.cmOf(o2))
        assertEquals(emptyList<Int>(), CatalogParser.cmOf(o3))   // alter Katalog: kein Absturz
    }
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*CatalogParserTest*"`
Expected: FAIL – `cmOf` unbekannt.

- [ ] **Step 3: Parser** – `CatalogPrinting` um `val cm: List<Int> = emptyList()` erweitern (letzter Parameter, Default hält alle bestehenden Aufrufer gültig). In `object CatalogParser` ergänzen:

```kotlin
    /** Spec 2026-10-04 §3.2: `cm` ist eine Zahl (eindeutig), ein Array (mehrdeutig) oder fehlt (alter Katalog). */
    internal fun cmOf(o: JSONObject): List<Int> = when (val v = o.opt("cm")) {
        is Number -> listOf(v.toInt()).filter { it > 0 }
        is JSONArray -> (0 until v.length()).map { v.optInt(it, 0) }.filter { it > 0 }
        else -> emptyList()
    }
```

In beiden Schleifen (verified / unverified) `cm = cmOf(printingJson)` an den `CatalogPrinting(...)`-Aufruf anhängen.

- [ ] **Step 4: DB** – `CatalogDb.VERSION = 5`; Tabelle `printings` um `cm TEXT` erweitern (`lang TEXT, verified INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL, cm TEXT)`); in `importAll` nach `put("ord", index)`:

```kotlin
                    if (printing.cm.isEmpty()) printingValues.putNull("cm") else printingValues.put("cm", printing.cm.joinToString(","))
```

`onUpgrade` verwirft schon alles und legt neu an; dadurch ist die lokale Katalog-Version 0 und `CatalogSync` lädt beim nächsten Start sofort neu (`shouldDownloadNow`: `localVersion == 0 → true`).

- [ ] **Step 5: Repository** – in `CatalogRepository.printings()` die Spaltenliste um `"cm"` erweitern und beim Erzeugen ergänzen:

```kotlin
                        verified = c.getInt(3) != 0,
                        cm = if (c.isNull(4)) emptyList() else c.getString(4).split(',').mapNotNull { it.trim().toIntOrNull() },
```

- [ ] **Step 6: Tests**

Run: `cd android && ./gradlew testDebugUnitTest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt
git commit -m "feat(android): Katalog liest Cardmarket-Produkt je Druck (cm)"
```

---

### Task 5: Handy lädt die Tages-Preisdatei

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/CmPriceFile.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt:192-195` (Aufruf beim App-Start)
- Test: `android/app/src/test/java/com/example/yugiohscanner/CmPriceFileTest.kt`

**Interfaces:**
- Produces: `object CmPriceFile { data class Preise(val datum: String, val trend: Map<Int, Double>, val low: Map<Int, Double>); fun parse(gz: ByteArray): Preise; internal fun faellig(lastMs: Long, nowMs: Long, dateiDa: Boolean): Boolean; fun aktuell(): Preise?; val stand: StateFlow<Preise?>; suspend fun aktualisieren(context: Context, force: Boolean = false) }`

- [ ] **Step 1: Failing test** – `CmPriceFileTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CmPriceFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class CmPriceFileTest {
    private fun gz(s: String): ByteArray = ByteArrayOutputStream().also { b -> GZIPOutputStream(b).use { it.write(s.toByteArray()) } }.toByteArray()

    @Test
    fun `parse liest Datum, Trend und Tief, null bleibt leer`() {
        val p = CmPriceFile.parse(gz("""{"v":1,"date":"2026-10-04","p":{"101":[1.5,0.2],"102":[null,0.5]}}"""))
        assertEquals("2026-10-04", p.datum)
        assertEquals(1.5, p.trend[101]!!, 0.0)
        assertEquals(null, p.trend[102])
        assertEquals(0.5, p.low[102]!!, 0.0)
    }

    @Test(expected = Exception::class)
    fun `parse einer abgeschnittenen Datei wirft -- alte Preise bleiben beim Aufrufer`() {
        val voll = gz("""{"v":1,"date":"2026-10-04","p":{"101":[1.5,0.2]}}""")
        CmPriceFile.parse(voll.copyOf(voll.size / 2))
    }

    @Test
    fun `faellig - ohne Datei sofort, sonst nach 24 h`() {
        val h = 3_600_000L
        assertTrue(CmPriceFile.faellig(lastMs = 0, nowMs = 1000, dateiDa = false))
        assertEquals(false, CmPriceFile.faellig(lastMs = 0, nowMs = 23 * h, dateiDa = true))
        assertTrue(CmPriceFile.faellig(lastMs = 0, nowMs = 24 * h, dateiDa = true))
    }
}
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*CmPriceFileTest*"`
Expected: FAIL – `CmPriceFile` unbekannt.

- [ ] **Step 3: `CmPriceFile.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import android.content.Context
import com.example.yugiohscanner.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.zip.GZIPInputStream

/**
 * Spec 2026-10-04 §3.3 -- Cardmarket-Tagespreise je Produkt (idProduct -> Trend/Tief) fuer die
 * Ergebnis-Seite. Die Cloud-Funktion refresh-cardmarket-prices legt die Datei taeglich um 05:00 UTC
 * in den oeffentlichen Bucket `catalog`. Geladen wird hoechstens 1x/Tag, danach offline aus filesDir.
 * Eine kaputte Datei ersetzt nie die letzte gute.
 */
object CmPriceFile {
    data class Preise(val datum: String, val trend: Map<Int, Double>, val low: Map<Int, Double>)

    private const val DATEI = "cm-prices.json.gz"
    private const val KEY_LAST = "cm_prices_last_download_at"
    private const val INTERVAL_MS = 24L * 60 * 60 * 1000
    private val lock = Mutex()
    private val _stand = MutableStateFlow<Preise?>(null)
    val stand: StateFlow<Preise?> = _stand

    fun aktuell(): Preise? = _stand.value

    fun parse(gz: ByteArray): Preise {
        val text = GZIPInputStream(gz.inputStream()).bufferedReader().use { it.readText() }
        val o = JSONObject(text)
        val p = o.getJSONObject("p")
        val trend = HashMap<Int, Double>(p.length() * 2)
        val low = HashMap<Int, Double>(p.length() * 2)
        for (k in p.keys()) {
            val id = k.toIntOrNull() ?: continue
            val a = p.getJSONArray(k)
            if (!a.isNull(0)) trend[id] = a.getDouble(0)
            if (a.length() > 1 && !a.isNull(1)) low[id] = a.getDouble(1)
        }
        return Preise(o.getString("date"), trend, low)
    }

    internal fun faellig(lastMs: Long, nowMs: Long, dateiDa: Boolean): Boolean =
        !dateiDa || nowMs - lastMs >= INTERVAL_MS

    private fun url(context: Context): String {
        val prefs = context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
        val base = (prefs.getString("supabase_url", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL)
            .trim().trimEnd('/').removeSuffix("/rest/v1")
        return "$base/storage/v1/object/public/catalog/$DATEI"
    }

    suspend fun aktualisieren(context: Context, force: Boolean = false) = withContext(Dispatchers.IO) {
        if (!lock.tryLock()) return@withContext
        try {
            val datei = File(context.filesDir, DATEI)
            if (_stand.value == null && datei.exists()) {
                _stand.value = runCatching { parse(datei.readBytes()) }.getOrNull()
            }
            val prefs = context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
            if (!force && !faellig(prefs.getLong(KEY_LAST, 0L), System.currentTimeMillis(), datei.exists())) return@withContext
            val bytes = SupabaseCloud.http().newCall(Request.Builder().url(url(context)).build()).execute().use { r ->
                if (!r.isSuccessful) return@withContext
                r.body?.bytes() ?: return@withContext
            }
            val neu = runCatching { parse(bytes) }.getOrNull() ?: return@withContext   // kaputt: alte behalten
            val tmp = File(context.filesDir, "$DATEI.tmp")
            tmp.writeBytes(bytes)
            tmp.renameTo(datei)
            prefs.edit().putLong(KEY_LAST, System.currentTimeMillis()).apply()
            _stand.value = neu
        } catch (_: Exception) {
            // offline o. ae.: naechster Start versucht es wieder
        } finally {
            lock.unlock()
        }
    }
}
```

Hinweis: Falls `renameTo` auf ein bestehendes Ziel auf dem Gerät `false` liefert, vorher `datei.delete()` aufrufen; das in Step 5 am Gerät prüfen (Datei-Datum in `adb shell run-as com.example.yugiohscanner ls -l files`).

- [ ] **Step 4: App-Start** – `AppNav.kt` im bestehenden `LaunchedEffect(Unit)` (L192–195) ergänzen:

```kotlin
        CatalogSync.checkAndUpdate(context)
        ModelStore.checkAndUpdate(context)
        com.example.yugiohscanner.cloud.CmPriceFile.aktualisieren(context)
```

- [ ] **Step 5: Tests**

Run: `cd android && ./gradlew testDebugUnitTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CmPriceFile.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/test/java/com/example/yugiohscanner/CmPriceFileTest.kt
git commit -m "feat(android): Cardmarket-Tagespreise 1x/Tag laden, offline vorhalten"
```

---

### Task 6: Preis je Druck (rein, mit Fixture)

**Files:**
- Create: `docs/fixtures/druck-preis.json`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/DruckPreis.kt`
- Test: `android/app/src/test/java/com/example/yugiohscanner/DruckPreisTest.kt`

**Interfaces:**
- Produces: `object DruckPreis { sealed interface Preis; data class Fest(val eur: Double, val ausSammlung: Boolean): Preis; data class Spanne(val min: Double, val max: Double): Preis; object Keiner: Preis; fun fuer(eigenerPreis: Double?, cm: List<Int>, trend: (Int) -> Double?): Preis; fun text(p: Preis): String; fun spanneUeber(preise: List<Preis>): Preis }`

- [ ] **Step 1: Fixture** – `docs/fixtures/druck-preis.json`:

```json
{
  "_doc": "Spec 2026-10-04 §3.3 -- Preis je Druck. Gelesen von DruckPreisTest.kt. Reihenfolge: eigener Preis > eindeutiger Trend > Spanne > keiner.",
  "cases": [
    { "name": "eigener Preis gewinnt", "eigenerPreis": 7.5, "cm": [1], "trends": { "1": 3.0 }, "art": "fest", "eur": 7.5, "text": "7,50 €" },
    { "name": "eigener Preis 0 zaehlt nicht", "eigenerPreis": 0, "cm": [1], "trends": { "1": 3.0 }, "art": "fest", "eur": 3.0, "text": "3,00 €" },
    { "name": "eindeutig mit Trend", "eigenerPreis": null, "cm": [1], "trends": { "1": 12.4 }, "art": "fest", "eur": 12.4, "text": "12,40 €" },
    { "name": "eindeutig ohne Trend", "eigenerPreis": null, "cm": [1], "trends": {}, "art": "keiner", "text": "–" },
    { "name": "mehrdeutig -> Spanne", "eigenerPreis": null, "cm": [1, 2, 3], "trends": { "1": 5.0, "2": 3.1, "3": 48.0 }, "art": "spanne", "min": 3.1, "max": 48.0, "text": "ca. 3,10–48,00 €" },
    { "name": "mehrdeutig, nur ein Wert", "eigenerPreis": null, "cm": [1, 2], "trends": { "2": 4.2 }, "art": "fest", "eur": 4.2, "text": "4,20 €" },
    { "name": "mehrdeutig, gleiche Werte", "eigenerPreis": null, "cm": [1, 2], "trends": { "1": 4.2, "2": 4.2 }, "art": "fest", "eur": 4.2, "text": "4,20 €" },
    { "name": "keine Zuordnung", "eigenerPreis": null, "cm": [], "trends": { "1": 9.0 }, "art": "keiner", "text": "–" }
  ]
}
```

- [ ] **Step 2: Failing test** – `DruckPreisTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ui.DruckPreis
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Fixture docs/fixtures/druck-preis.json (Spec 2026-10-04 §3.3). */
class DruckPreisTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/druck-preis.json"))

    @Test
    fun `alle Faelle der Fixture`() {
        val cases = f.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val eigen = if (c.isNull("eigenerPreis")) null else c.getDouble("eigenerPreis")
            val cm = c.getJSONArray("cm").let { a -> (0 until a.length()).map { a.getInt(it) } }
            val t = c.getJSONObject("trends")
            val p = DruckPreis.fuer(eigen, cm) { id -> if (t.has(id.toString())) t.getDouble(id.toString()) else null }
            when (c.getString("art")) {
                "fest" -> assertEquals(name, c.getDouble("eur"), (p as DruckPreis.Fest).eur, 0.001)
                "spanne" -> {
                    p as DruckPreis.Spanne
                    assertEquals(name, c.getDouble("min"), p.min, 0.001)
                    assertEquals(name, c.getDouble("max"), p.max, 0.001)
                }
                else -> assertEquals(name, DruckPreis.Keiner, p)
            }
            assertEquals(name, c.getString("text"), DruckPreis.text(p))
        }
    }

    @Test
    fun `spanneUeber fasst Fest und Spanne zusammen, Keiner zaehlt nicht`() {
        val p = DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, false), DruckPreis.Spanne(2.0, 9.0), DruckPreis.Keiner))
        assertEquals(DruckPreis.Spanne(2.0, 9.0), p)
        assertEquals(DruckPreis.Keiner, DruckPreis.spanneUeber(listOf(DruckPreis.Keiner)))
        assertEquals(DruckPreis.Fest(5.0, false), DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, false))))
    }
}
```

- [ ] **Step 3: Test laufen lassen, muss scheitern**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*DruckPreisTest*"`
Expected: FAIL – `DruckPreis` unbekannt.

- [ ] **Step 4: `DruckPreis.kt`**

```kotlin
package com.example.yugiohscanner.ui

import java.util.Locale

/**
 * Spec 2026-10-04 §3.3 -- Preis eines Drucks auf der Ergebnis-Seite, feste Reihenfolge:
 * eigener Druck mit Preis > 0 > eindeutige Cardmarket-Nummer mit Trend > Spanne der moeglichen
 * Nummern > keiner. Fixture: docs/fixtures/druck-preis.json.
 */
object DruckPreis {
    sealed interface Preis
    data class Fest(val eur: Double, val ausSammlung: Boolean) : Preis
    data class Spanne(val min: Double, val max: Double) : Preis
    object Keiner : Preis

    fun fuer(eigenerPreis: Double?, cm: List<Int>, trend: (Int) -> Double?): Preis {
        if (eigenerPreis != null && eigenerPreis > 0) return Fest(eigenerPreis, ausSammlung = true)
        val werte = cm.mapNotNull(trend).filter { it > 0 }
        if (werte.isEmpty()) return Keiner
        val min = werte.min(); val max = werte.max()
        return if (min == max) Fest(min, ausSammlung = false) else Spanne(min, max)
    }

    /** Kopfpreis bei unsicherer Erkennung: Spanne ueber die moeglichen Drucke. */
    fun spanneUeber(preise: List<Preis>): Preis {
        val werte = preise.flatMap { p -> when (p) { is Fest -> listOf(p.eur); is Spanne -> listOf(p.min, p.max); Keiner -> emptyList() } }
        if (werte.isEmpty()) return Keiner
        val min = werte.min(); val max = werte.max()
        return if (min == max) Fest(min, ausSammlung = false) else Spanne(min, max)
    }

    private fun eur(v: Double) = String.format(Locale.GERMANY, "%.2f", v)

    fun text(p: Preis): String = when (p) {
        is Fest -> "${eur(p.eur)} €"
        is Spanne -> "ca. ${eur(p.min)}–${eur(p.max)} €"
        Keiner -> "–"
    }
}
```

- [ ] **Step 5: Tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*DruckPreisTest*"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/fixtures/druck-preis.json android/app/src/main/java/com/example/yugiohscanner/ui/DruckPreis.kt android/app/src/test/java/com/example/yugiohscanner/DruckPreisTest.kt
git commit -m "feat(android): Preis je Druck -- eigener Preis, Cardmarket-Trend, Spanne"
```

---

### Task 7: Ergebnis-Modell (rein): Druckliste, Startauswahl, Kopfpreis, Stand

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanErgebnis.kt`
- Test: `android/app/src/test/java/com/example/yugiohscanner/ScanErgebnisTest.kt`

**Interfaces:**
- Consumes: `DruckPreis` (Task 6), `CatalogPrinting.cm` (Task 4), `SetOption`, `CardRow`.
- Produces:
  - `data class Druck(val setCode: String, val rarity: String, val language: String, val cm: List<Int>, val anzahl: Int, val preis: DruckPreis.Preis, val eigeneZeile: CardRow?)`
  - `fun key(setCode: String, rarity: String, language: String): String`
  - `fun drucke(known: List<SetOption>, katalog: List<CatalogPrinting>, besitz: List<CardRow>, trend: (Int) -> Double?): List<Druck>`
  - `fun startAuswahl(selected: SetOption?, ersatz: SetOption?): String?`
  - `fun kopfPreis(drucke: List<Druck>, auswahl: String?, sicher: Boolean, kandidaten: List<SetOption>): DruckPreis.Preis`
  - `fun standText(datum: String?, heute: java.time.LocalDate): String?`

- [ ] **Step 1: Failing test** – `ScanErgebnisTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.DruckPreis
import com.example.yugiohscanner.ui.ScanErgebnis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class ScanErgebnisTest {
    private val known = listOf(
        SetOption("RA05-DE038", "Ultra Rare", 0.0, "DE", verified = true),
        SetOption("RA05-DE038", "Secret Rare", 0.0, "DE", verified = true),
        SetOption("CORI-KR027", "Ultra Rare", 0.0, "KR"),
    )
    private val katalog = listOf(
        CatalogPrinting("RA05-DE038", "Ultra Rare", "DE", true, cm = listOf(1)),
        CatalogPrinting("RA05-DE038", "Secret Rare", "DE", true, cm = listOf(2, 3)),
        CatalogPrinting("CORI-KR027", "Ultra Rare", "KR", true, cm = listOf(9)),   // darf nie zaehlen
    )
    private val trends = mapOf(1 to 12.4, 2 to 18.9, 3 to 48.0, 9 to 99.0)
    private fun row(code: String, rarity: String, lang: String, qty: Int, price: Double?) =
        CardRow(id = "1", setCode = code, language = lang, name = "X", imageUrl = null, rarity = rarity, quantity = qty, price = price)

    @Test
    fun `drucke - Preise, Anzahl, KR ohne Cardmarket, eigene Zeilen ergaenzt`() {
        val besitz = listOf(row("CORI-KR027", "Ultra Rare", "KR", 1, 5.11), row("LOB-DE005", "Ultra Rare", "DE", 2, 30.0))
        val d = ScanErgebnis.drucke(known, katalog, besitz) { trends[it] }
        assertEquals(4, d.size)
        assertEquals(DruckPreis.Fest(12.4, false), d[0].preis)
        assertEquals(DruckPreis.Spanne(18.9, 48.0), d[1].preis)
        assertEquals(DruckPreis.Fest(5.11, true), d[2].preis)          // KR: nur eigener Preis
        assertEquals(emptyList<Int>(), d[2].cm)
        assertEquals("LOB-DE005", d[3].setCode); assertEquals(2, d[3].anzahl)
    }

    @Test
    fun `drucke - alter Katalog ohne cm gibt Keiner statt Absturz`() {
        val alt = katalog.map { it.copy(cm = emptyList()) }
        val d = ScanErgebnis.drucke(known, alt, emptyList()) { trends[it] }
        assertEquals(DruckPreis.Keiner, d[0].preis)
    }

    @Test
    fun `startAuswahl - erkannter Druck, sonst Ersatz, Unknown nie`() {
        assertEquals("RA05-DE038|ultra rare|DE", ScanErgebnis.startAuswahl(known[0], null))
        assertEquals("RA05-DE038|secret rare|DE", ScanErgebnis.startAuswahl(null, known[1]))
        assertNull(ScanErgebnis.startAuswahl(null, SetOption("Unknown", "Unknown", 0.0, "DE")))
        assertNull(ScanErgebnis.startAuswahl(null, null))
    }

    @Test
    fun `kopfPreis - sicher zeigt Auswahl, unsicher Spanne der Kandidaten`() {
        val d = ScanErgebnis.drucke(known, katalog, emptyList()) { trends[it] }
        val auswahl = ScanErgebnis.key("RA05-DE038", "Ultra Rare", "DE")
        assertEquals(DruckPreis.Fest(12.4, false), ScanErgebnis.kopfPreis(d, auswahl, sicher = true, kandidaten = emptyList()))
        assertEquals(DruckPreis.Spanne(12.4, 48.0), ScanErgebnis.kopfPreis(d, auswahl, sicher = false, kandidaten = known.take(2)))
        // ohne Kandidaten und ohne Auswahl: Spanne ueber alle Drucke
        assertEquals(DruckPreis.Spanne(12.4, 48.0), ScanErgebnis.kopfPreis(d.take(2), null, sicher = false, kandidaten = emptyList()))
    }

    @Test
    fun `standText - erst ab 3 Tagen sichtbar`() {
        val heute = LocalDate.of(2026, 10, 4)
        assertNull(ScanErgebnis.standText("2026-10-02", heute))
        assertEquals("Stand 01.10.", ScanErgebnis.standText("2026-10-01", heute))
        assertNull(ScanErgebnis.standText(null, heute))
        assertNull(ScanErgebnis.standText("kaputt", heute))
    }
}
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*ScanErgebnisTest*"`
Expected: FAIL – `ScanErgebnis` unbekannt.

- [ ] **Step 3: `ScanErgebnis.kt`**

```kotlin
package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.SetOption
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Spec 2026-10-04 §4 -- reine Logik der Ergebnis-Seite (Compose-frei, unit-getestet). */
object ScanErgebnis {
    data class Druck(
        val setCode: String, val rarity: String, val language: String,
        val cm: List<Int>, val anzahl: Int, val preis: DruckPreis.Preis, val eigeneZeile: CardRow?,
    )

    fun key(setCode: String, rarity: String, language: String) =
        "${setCode.uppercase()}|${rarity.lowercase()}|${language.uppercase()}"

    /** Alle Drucke der Karte: erst die bekannten (Katalog-Reihenfolge), dann eigene, die fehlen. KR nie mit Cardmarket. */
    fun drucke(known: List<SetOption>, katalog: List<CatalogPrinting>, besitz: List<CardRow>, trend: (Int) -> Double?): List<Druck> {
        val out = LinkedHashMap<String, Druck>()
        fun nimm(code: String, rarity: String, lang: String) {
            val k = key(code, rarity, lang)
            if (k in out) return
            val eigen = besitz.filter {
                it.setCode.equals(code, true) && (it.rarity ?: "").equals(rarity, true) && it.language.equals(lang, true)
            }
            val cm = if (lang.equals("KR", true)) emptyList() else
                katalog.firstOrNull { it.code.equals(code, true) && it.rarity.equals(rarity, true) && it.cm.isNotEmpty() }?.cm ?: emptyList()
            val mitPreis = eigen.firstOrNull { (it.price ?: 0.0) > 0 }
            out[k] = Druck(code, rarity, lang, cm, eigen.sumOf { it.quantity }, DruckPreis.fuer(mitPreis?.price, cm, trend), mitPreis ?: eigen.firstOrNull())
        }
        known.forEach { nimm(it.setCode, it.rarity, it.language) }
        besitz.forEach { nimm(it.setCode, it.rarity ?: "Unknown", it.language) }
        return out.values.toList()
    }

    fun startAuswahl(selected: SetOption?, ersatz: SetOption?): String? {
        val s = selected ?: ersatz ?: return null
        if (s.setCode.equals("Unknown", true)) return null
        return key(s.setCode, s.rarity, s.language)
    }

    fun kopfPreis(drucke: List<Druck>, auswahl: String?, sicher: Boolean, kandidaten: List<SetOption>): DruckPreis.Preis {
        val gewaehlt = drucke.firstOrNull { key(it.setCode, it.rarity, it.language) == auswahl }
        if (sicher && gewaehlt != null) return gewaehlt.preis
        val keys = kandidaten.map { key(it.setCode, it.rarity, it.language) }.toSet()
        val basis = if (keys.isEmpty()) drucke else drucke.filter { key(it.setCode, it.rarity, it.language) in keys }
        return DruckPreis.spanneUeber(basis.map { it.preis })
    }

    /** Spec §5: Stand der Preisdatei erst ab 3 Tagen Alter anzeigen. */
    fun standText(datum: String?, heute: LocalDate): String? {
        val d = runCatching { LocalDate.parse(datum ?: return null) }.getOrNull() ?: return null
        if (ChronoUnit.DAYS.between(d, heute) < 3) return null
        return "Stand %02d.%02d.".format(d.dayOfMonth, d.monthValue)
    }
}
```

- [ ] **Step 4: Tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*ScanErgebnisTest*"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanErgebnis.kt android/app/src/test/java/com/example/yugiohscanner/ScanErgebnisTest.kt
git commit -m "feat(android): Ergebnis-Modell -- Druckliste, Startauswahl, Kopfpreis, Stand"
```

---

### Task 8: `ScanErgebnisScreen` (Compose)

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanErgebnisScreen.kt`

**Interfaces:**
- Consumes: `ResolvedScan`, `ScanErgebnis` (Task 7), `DruckPreis` (Task 6), `CmPriceFile.stand` (Task 5), `CatalogRepository.card`, `CollectionStore.state`, `ScanSprache.ersatzDruck`, `Valuation.EDITION_LABELS`, `Valuation.EDITIONS`.
- Produces: `@Composable fun ScanErgebnisScreen(r: ResolvedScan, onWeiter: () -> Unit, onUebernehmen: (ResolvedScan) -> Unit)`. `onUebernehmen` bekommt ein `ResolvedScan` mit `match.selected` = gewählter Druck und `confidence.effectiveEdition` = gewählte Auflage; hat der Nutzer etwas gewählt, ist `confidence.light = GREEN`, `reason = null`, `editionConfidence = HIGH`.

- [ ] **Step 1: Datei anlegen**

```kotlin
package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CmPriceFile
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ml.ScanSprache
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Warn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate

/**
 * Spec 2026-10-04 §4 -- Ergebnis-Seite nach dem Einzelfoto (abgenommener Entwurf
 * "ergebnis-seite-detail"): Bild, Namen, Chips (Seltenheit, Auflage, Set-Code), grosser Preis,
 * "Du hast schon", alle Drucke mit dem eigenen markiert; unten "Naechste Karte" / "In Sammlung +".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanErgebnisScreen(r: ResolvedScan, onWeiter: () -> Unit, onUebernehmen: (ResolvedScan) -> Unit) {
    BackHandler { onWeiter() }
    val pc = r.base.id
    val store by CollectionStore.state.collectAsState()
    val besitz = remember((store as? StoreState.Ready)?.cards, pc) {
        (store as? StoreState.Ready)?.cards?.filter { it.id == pc && !it.deleted && it.quantity > 0 } ?: emptyList()
    }
    var katalog by remember(pc) { mutableStateOf<CatalogCard?>(null) }
    LaunchedEffect(pc) { katalog = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(pc) }.getOrNull() } }
    val preise by CmPriceFile.stand.collectAsState()

    val drucke = remember(katalog, besitz, preise) {
        ScanErgebnis.drucke(r.knownSets, katalog?.printings ?: emptyList(), besitz) { id -> preise?.trend?.get(id) }
    }
    var auswahl by remember(r) {
        mutableStateOf(ScanErgebnis.startAuswahl(r.match.selected, ScanSprache.ersatzDruck(ScanSprache.fest, r.knownSets)))
    }
    var auflage by remember(r) { mutableStateOf(r.confidence.effectiveEdition) }
    var gewaehlt by remember(r) { mutableStateOf(false) }
    var auflageOffen by remember { mutableStateOf(false) }
    var grossesBild by remember { mutableStateOf(false) }

    val sicher = gewaehlt || r.confidence.light == ScanConfidence.Light.GREEN
    val auflageUnsicher = !gewaehlt && (r.confidence.editionConfidence == EditionEvidence.Confidence.LOW || auflage == "unknown")
    val markiert = drucke.firstOrNull { ScanErgebnis.key(it.setCode, it.rarity, it.language) == auswahl }
    val kopf = ScanErgebnis.kopfPreis(drucke, auswahl, sicher, r.match.candidates)
    val bild = katalog?.image?.takeIf { it.isNotBlank() } ?: r.base.imageUrl
    val nameDe = katalog?.nameDe?.takeIf { it.isNotBlank() } ?: r.base.name ?: pc
    val nameEn = katalog?.nameEn?.takeIf { it.isNotBlank() && it != nameDe }

    Scaffold(
        bottomBar = {
            Surface(tonalElevation = 2.dp) {
                Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onWeiter, modifier = Modifier.weight(1f)) { Text("Nächste Karte") }
                    Button(onClick = {
                        val druck = markiert?.let { m ->
                            r.knownSets.firstOrNull { ScanErgebnis.key(it.setCode, it.rarity, it.language) == auswahl }
                                ?: SetOption(m.setCode, m.rarity, 0.0, m.language)
                        }
                        val conf = if (gewaehlt) r.confidence.copy(
                            light = ScanConfidence.Light.GREEN, reason = null,
                            effectiveEdition = auflage, editionConfidence = EditionEvidence.Confidence.HIGH,
                        ) else r.confidence.copy(effectiveEdition = auflage)
                        onUebernehmen(ResolvedScan(r.base, r.knownSets, r.match.copy(selected = druck ?: r.match.selected), conf, r.readSetCode))
                    }, modifier = Modifier.weight(1f)) { Text("In Sammlung +") }
                }
            }
        },
    ) { innen ->
        Column(Modifier.padding(innen).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp)) {
            // 1. Leiste
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("‹ Kamera", color = Muted, modifier = Modifier.clickable(onClick = onWeiter).padding(vertical = 4.dp))
                Spacer(Modifier.weight(1f))
                val farbe = when (r.confidence.light) {
                    ScanConfidence.Light.GREEN -> Good
                    ScanConfidence.Light.YELLOW -> Warn
                    ScanConfidence.Light.RED -> MaterialTheme.colorScheme.error
                }
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (gewaehlt) Good else farbe))
                Spacer(Modifier.width(6.dp))
                Text(if (gewaehlt) "von dir gewählt" else r.confidence.reason ?: "sicher erkannt",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            Spacer(Modifier.height(12.dp))

            // 2.+3. Bild, Namen, Chips
            Row {
                AsyncImage(model = bild, contentDescription = nameDe,
                    modifier = Modifier.width(110.dp).height(160.dp).clip(RoundedCornerShape(6.dp)).clickable { grossesBild = true })
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(nameDe, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    nameEn?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Muted) }
                    Spacer(Modifier.height(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip(markiert?.rarity?.let { if (sicher) it else "$it?" } ?: "Seltenheit?", akzent = sicher && markiert != null, warn = !sicher || markiert == null)
                        Box {
                            Chip((Valuation.EDITION_LABELS[auflage] ?: auflage) + if (auflageUnsicher) "? ▾" else " ▾",
                                warn = auflageUnsicher, onClick = { auflageOffen = true })
                            DropdownMenu(expanded = auflageOffen, onDismissRequest = { auflageOffen = false }) {
                                Valuation.EDITIONS.forEach { e ->
                                    DropdownMenuItem(text = { Text(Valuation.EDITION_LABELS[e] ?: e) },
                                        onClick = { auflage = e; gewaehlt = true; auflageOffen = false })
                                }
                            }
                        }
                        markiert?.let { Chip("${langFlag(it.language)} ${it.setCode}") }
                    }
                }
            }

            // 6. Hinweis bei Unsicherheit
            if (!sicher || markiert == null) {
                Spacer(Modifier.height(10.dp))
                Surface(color = Warn.copy(alpha = 0.15f), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(if (markiert == null) "Druck nicht erkannt – tippe unten deinen Druck an."
                        else "Mehrere Seltenheiten möglich – tippe unten deinen Druck an.",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }

            // 4. Preisfeld
            Spacer(Modifier.height(12.dp))
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(DruckPreis.text(kopf), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    val low = markiert?.cm?.singleOrNull()?.let { preise?.low?.get(it) }
                    val zeile = buildList {
                        add(if (kopf is DruckPreis.Fest && kopf.ausSammlung) "dein Sammlungspreis" else "Cardmarket-Trend")
                        if (sicher && low != null) add("ab ${DruckPreis.text(DruckPreis.Fest(low, false))}")
                        ScanErgebnis.standText(preise?.datum, LocalDate.now())?.let { add(it) }
                        if (preise == null) add("Preise werden beim nächsten Netz geladen")
                    }.joinToString(" · ")
                    Text(zeile, style = MaterialTheme.typography.bodySmall, color = Muted)
                }
            }

            // 5. Besitz
            val gesamt = besitz.sumOf { it.quantity }
            if (gesamt > 0) {
                Spacer(Modifier.height(8.dp))
                Surface(color = Good.copy(alpha = 0.12f), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Text("Du hast schon ${gesamt}×" + (markiert?.takeIf { it.anzahl > 0 }?.let { " (davon ${it.anzahl}× dieser Druck)" } ?: ""),
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }

            // 7. Alle Drucke
            Spacer(Modifier.height(16.dp))
            SectionHeader("Alle Drucke")
            Spacer(Modifier.height(6.dp))
            drucke.forEach { d ->
                val k = ScanErgebnis.key(d.setCode, d.rarity, d.language)
                val istMeins = k == auswahl
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                        .then(if (istMeins) Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.10f))
                            .border(1.5.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp)) else Modifier)
                        .clickable { auswahl = k; gewaehlt = true }
                        .padding(horizontal = 10.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${langFlag(d.language)} ${d.setCode}", fontWeight = if (istMeins) FontWeight.SemiBold else FontWeight.Normal)
                    Text(" · ${d.rarity}", color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (d.anzahl > 0) Text("  du hast ${d.anzahl}", color = Good, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.weight(1f))
                    Text(DruckPreis.text(d.preis), fontWeight = if (istMeins) FontWeight.SemiBold else FontWeight.Normal)
                }
            }

            // 8. Preisverlauf (nur eigener Druck) und Kartentext
            markiert?.eigeneZeile?.let { eigen ->
                Spacer(Modifier.height(16.dp)); SectionHeader("Preisverlauf"); Spacer(Modifier.height(6.dp))
                PriceHistoryChart(eigen)
            }
            katalog?.descDe?.takeIf { it.isNotBlank() }?.let { text ->
                Spacer(Modifier.height(16.dp)); SectionHeader("Karte"); Spacer(Modifier.height(6.dp))
                katalog?.type?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Muted) }
                Text(text, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (grossesBild) {
        Dialog(onDismissRequest = { grossesBild = false }) {
            AsyncImage(model = bild, contentDescription = nameDe,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { grossesBild = false })
        }
    }
}

@Composable
private fun Chip(text: String, akzent: Boolean = false, warn: Boolean = false, onClick: (() -> Unit)? = null) {
    val bg = when {
        akzent -> MaterialTheme.colorScheme.primary
        warn -> Warn.copy(alpha = 0.18f)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val fg = if (akzent) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Surface(color = bg, shape = RoundedCornerShape(999.dp),
        border = if (akzent) null else androidx.compose.foundation.BorderStroke(1.dp, if (warn) Warn else MaterialTheme.colorScheme.outline),
        modifier = if (onClick != null) Modifier.clip(RoundedCornerShape(999.dp)).clickable(onClick = onClick) else Modifier) {
        Text(text, color = fg, style = MaterialTheme.typography.labelSmall, fontWeight = if (akzent) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp))
    }
}
```

Hinweise für die Umsetzung: `FlowRow` braucht `@OptIn(ExperimentalLayoutApi::class)` (Import `androidx.compose.foundation.layout.ExperimentalLayoutApi`), falls die Compose-Version es noch als experimentell führt. `Warn`, `Good`, `Muted` sind `@Composable`-Getter aus `ui/theme/Color.kt` – die Namen dort prüfen und ggf. anpassen. `ResolvedScan` liegt in `ui/ScanResolver.kt` (gleiches Paket).

- [ ] **Step 2: Kompilieren**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanErgebnisScreen.kt
git commit -m "feat(android): Ergebnis-Seite nach dem Einzelfoto"
```

---

### Task 9: Einbinden: Foto → Ergebnis-Seite, Übernahme nur per Knopf

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt` (State, `fotoAusloesen` L521–547, €-Knopf L803–825 entfernen, Overlay einfügen)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanCapture.kt` (neu `uebernehmeFoto`, `onFoto` entfernen)
- Delete: `android/app/src/main/java/com/example/yugiohscanner/ui/KartenInfoSheet.kt`, `ui/KartenInfo.kt`, `android/app/src/test/java/com/example/yugiohscanner/KartenInfoTest.kt` (nur noch vom entfernten €-Knopf genutzt)

**Interfaces:**
- Consumes: `ScanErgebnisScreen` (Task 8), `ScanResolver.resolve`.
- Produces: `ScanCapture.uebernehmeFoto(r: ResolvedScan)`.

- [ ] **Step 1: `uebernehmeFoto` in `ScanCapture.kt`** – `onFoto` (L381–399 inkl. KDoc) **ersetzen** durch:

```kotlin
    /**
     * Spec 2026-10-04 §4: "In Sammlung +" der Ergebnis-Seite. Ein Einzelfoto wird NICHT mehr
     * automatisch uebernommen -- erst hier, mit genau dem markierten Druck und der gewaehlten
     * Auflage, ohne erneutes Aufloesen. Mit PC wie bisher Modus "foto" (scanAggregate.js fasst
     * zusammen), ohne PC ins Handy-Staging; derselbe Druck mit derselben Auflage zaehlt +1.
     */
    fun uebernehmeFoto(r: ResolvedScan) {
        val pc = r.base.id
        seen.add(pc)
        val s = socket()
        if (s != null && connected()) {
            sendScanToDesktop(s, pc, r, "foto")
            gesendeteAufloesung[pc] = r
            sentCount++
            lastLight = r.confidence.light
            blink(0.8f)
            scope.launch { snackbar.showSnackbar("${r.base.name ?: pc} an den PC") }
            return
        }
        val vorhanden = stagingCards.firstOrNull {
            it.passcode == pc && !it.loading && it.selectedSet == r.match.selected && it.edition == r.confidence.effectiveEdition
        }
        if (vorhanden != null) {
            vorhanden.quantity++
        } else {
            stagingCards.add(ScanStagingEntry(System.nanoTime(), pc).apply {
                condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
                base = r.base
                knownSets = r.knownSets
                codeMatch = r.match
                selectedSet = r.match.selected
                confidence = r.confidence
                edition = r.confidence.effectiveEdition
                userTouched = true
                loading = false
            })
        }
        blink(0.8f)
        scope.launch { snackbar.showSnackbar("${r.base.name ?: pc} vorgemerkt – „Prüfen“ zum Übernehmen") }
    }
```

Prüfen: `sentCount`, `lastLight`, `confidence`, `userTouched` sind in `ScanCapture`/`ScanStagingEntry` als `var` deklariert (laut Bestand ja); falls `sentCount`/`lastLight` `private set` haben, ist der Zugriff aus der Klasse selbst erlaubt.

- [ ] **Step 2: `ScanScreen.kt`** – State (L485–487) ersetzen:

```kotlin
    // Spec 2026-10-04 §4: das Ergebnis des letzten Einzelfotos -- solange gesetzt, liegt die Ergebnis-Seite ueber der Kamera.
    var ergebnis by remember { mutableStateOf<ResolvedScan?>(null) }
```

In `fotoAusloesen` den Erfolgszweig (`capture.onFoto(...)` und `letzteFotoKarte = ...`) ersetzen durch:

```kotlin
                        val r = ScanResolver.resolve(
                            erg.passcode.toString(), erg.evidence, erg.frames, erg.editionTexts,
                            com.example.yugiohscanner.Prefs.defaultEdition(context),
                        )
                        if (r == null) {
                            snackbar.showSnackbar("Karte ${erg.passcode} nicht gefunden")
                        } else {
                            ergebnis = r
                            // bestehender Ton + Vibration bleiben hier unveraendert stehen
                        }
```

(Die vorhandenen Zeilen für `tone?.startTone(...)` und `vibrator?.vibrate(...)` in den `else`-Zweig verschieben.)

Den Block „Karten-Info der zuletzt fotografierten Karte“ (L803–825: €-Box und `ModalBottomSheet { KartenInfoSheet(pc) }`) **löschen** und an seiner Stelle – als letztes Kind des äußeren Box-Layouts, damit es über allem liegt – einfügen:

```kotlin
        ergebnis?.let { r ->
            Surface(Modifier.fillMaxSize()) {
                ScanErgebnisScreen(
                    r = r,
                    onWeiter = { ergebnis = null },
                    onUebernehmen = { neu -> capture.uebernehmeFoto(neu); ergebnis = null },
                )
            }
        }
```

Nicht mehr benötigte Imports (`Icons.Default.Euro`, `ModalBottomSheet` falls nur hier genutzt) entfernen.

- [ ] **Step 3: Verwaiste Dateien löschen**

```bash
git rm android/app/src/main/java/com/example/yugiohscanner/ui/KartenInfoSheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/KartenInfo.kt android/app/src/test/java/com/example/yugiohscanner/KartenInfoTest.kt
```

Vorher `grep -rn "KartenInfo" android/app/src` – es darf nach Step 2 nichts mehr außer diesen Dateien darauf verweisen.

- [ ] **Step 4: Bauen und testen**

Run: `cd android && ./gradlew testDebugUnitTest assembleRelease`
Expected: BUILD SUCCESSFUL, alle Tests grün.

- [ ] **Step 5: Commit**

```bash
git add -A android/app/src
git commit -m "feat(android): Einzelfoto oeffnet Ergebnis-Seite, Uebernahme nur per Knopf"
```

---

### Task 10: Ausrollen und Abnahme

**Files:** keine Code-Änderung (nur Notizen/Ledger, falls vorhanden).

- [ ] **Step 1: Nutzer deployt die Edge Function** (Agents rufen keine Edge Functions auf). Befehl für den Nutzer:

```bash
supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
```

Danach einmal manuell auslösen oder bis 05:00 UTC warten. Prüfen: `https://<projekt>.supabase.co/storage/v1/object/public/catalog/cm-prices.json.gz` liefert eine Datei (HTTP 200). Falls 403/404 wegen Bucket-Rechten: SQL-Freigabe für Lesen von `catalog/cm-prices.json.gz` schreiben und vom Nutzer im Dashboard einspielen lassen.

- [ ] **Step 2: Desktop-Installer bauen** (`cd desktop && npm run dist`), Nutzer installiert, dann in der App den Katalog neu bauen lassen (Einstellungen → Katalog, „jetzt bauen“ bzw. Neustart, `catalogDue`). Prüfen: neue `catalog_versions`-Version, im lokalen `%APPDATA%\yugioh-card-manager\catalog\catalog.json.gz` tragen Drucke `cm`.

- [ ] **Step 3: APK bauen und installieren**

```bash
cd android && ./gradlew assembleRelease && adb install -r app/build/outputs/apk/release/app-release.apk
```

App starten, `adb logcat -b crash -d` muss leer bleiben. Die App lädt beim Start den neuen Katalog (DB-Version 5 → Neuimport) und die Preisdatei.

- [ ] **Step 4: Abnahme am Gerät mit dem Nutzer** (Spec §6):
  1. Sicher erkannte Karte fotografieren → Seite öffnet automatisch, Seltenheit/Auflage/Set-Code stimmen, Euro-Preis steht.
  2. Unsicher erkannte Karte (z. B. RA05 mit mehreren Seltenheiten) → gelbe Chips, Spanne, Druck antippen → Preis wechselt.
  3. Auflage-Chip umstellen.
  4. „Nächste Karte“ → Kamera, nichts übernommen.
  5. „In Sammlung +“ mit PC → kommt am PC an; ohne PC → in „Prüfen & übernehmen“.
  6. Flugmodus → Seite öffnet, Preise aus der zuletzt geladenen Datei.
  7. KR-Karte → nur k-tcg-/Sammlungspreis, nie Cardmarket.

- [ ] **Step 5: Merge** nach bestandener Abnahme auf Nutzerwunsch (main, push).
