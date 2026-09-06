# Spec D1 — Offline-Katalog und Modell-Auslieferung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Scanner kennt Name, Text, Stats und Printings jeder Karte sofort und ohne Netz, und neue Scanner-Modelle kommen ohne neue APK aufs Handy.

**Architecture:** Der Desktop baut wöchentlich eine gepackte Katalogdatei aus den beiden YGOPRODeck-Dumps (EN + DE), reichert sie mit den vom Desktop bereits bestätigten deutschen Set-Codes aus `api_cache` an und lädt sie in einen öffentlich lesbaren Supabase-Storage-Bucket; eine Tabelle `catalog_versions` sagt, welche Version aktuell ist. Dasselbe Gespann liefert `index.bin`, `embedder.onnx` und `detector.onnx` aus. Das Handy prüft die Version beim Start und einmal täglich, lädt im WLAN nach, importiert in eine lokale SQLite `catalog.db` und tauscht atomar. Alle Karten-Lookups im Scan-, Staging-, Such- und Detail-Pfad lesen zuerst den Katalog; die bestehenden Netz-Repositories bleiben als Fallback.

**Tech Stack:** Electron main (CommonJS `.cjs`, better-sqlite3, `node:zlib`, `@supabase/supabase-js` Storage), Supabase Postgres + Storage, Android (Kotlin 2.0.0, `SQLiteOpenHelper`, OkHttp, ONNX Runtime), Jetpack Compose für die Statusanzeigen.

**Am 2026-09-06 gegen die echte API gemessen — nicht geschätzt:**
- `cardinfo.php` (englisch): **14.523** Karten. `cardinfo.php?language=de`: **11.769** Karten.
- Der deutsche Dump ist also **kein Ersatz**, sondern eine Teilmenge: 2.754 Karten haben keine deutsche Übersetzung. Deshalb ist der englische Dump das Gerüst und der deutsche legt nur Name und Text darüber. Eine Karte ohne deutschen Eintrag behält den englischen Namen und Text.
- Der deutsche Dump enthält `card_images`, `card_sets` und zusätzlich `name_en`. Letzteres wird **nicht** gebraucht, weil der Name ohnehin aus dem englischen Gerüst kommt — nicht darauf verlassen, es ist im englischen Dump nicht vorhanden.
- Beispiel `46986414`: DE `name` = „Dunkler Magier", DE `desc` = „Der ultimative Hexer im Hinblick auf Angriff und Verteidigung.", EN `name` = „Dark Magician".

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-spec-d-scan-flow-design.md`. Dieser Plan setzt **nur** §5 (Offline-Katalog) und den Modell-Teil von §5.2/§5.3 um. §6 (Printing-Auflösung), §7 (Edition), §7a (Speed-Scan), §7b/§7c (OCR-Zonen und Messkorb) sind **spätere Pläne D2–D4 — hier nicht anfangen.**
- Electron-Main-Dateien bleiben CommonJS `.cjs`, der Renderer bleibt ESM. Niemals eines ins andere umwandeln.
- **Jede benutzersichtbare Zeichenkette ist deutsch.** Verbindliches Vokabular (Spec C §4): Start · Scannen · Sammlung · Karten · Wunschliste · Sets · Decks · Deals · Insights · Einstellungen · Übernehmen · Prüfen · Abbrechen · Zurück · Exemplar · Printing · Set-Code · Rarity · Passcode · Edition · Zustand. Yu-Gi-Oh-Begriffe bleiben englisch (Rarity, Set-Code, Passcode, Secret Rare, …).
- Die Printing-Identität ist der 4-Spalten-Schlüssel `(id, set_code, language, rarity)`. `cards.quantity` und `cards.deleted` sind triggergepflegte Caches und werden nie aus Anwendungscode geschrieben. Exemplare und Printings werden ausschließlich soft-gelöscht.
- **Deutsche Set-Codes werden nie abgeleitet.** `printings_verified` enthält ausschließlich Codes, die der Desktop über Yugipedia/Fandom/Konami tatsächlich bestätigt hat. Ein englischer Code darf niemals durch Ersetzen der Region zu einem deutschen gemacht werden.
- Katalogdatei **≤ 8 MB gepackt**. Ein Test erzwingt das Limit.
- Android: Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34. **Kein Room** (Dependency-Regel) — `SQLiteOpenHelper`. Keine neue Abhängigkeit außer den unten in Task 4 genannten (keine).
- Bestehendes Android-Theme: `Primary`, `Gold`, `Good`, `Muted`, `OnSurface`, `Background`, `SurfaceColor`, `Line`, `ErrorColor`, `MonoFontFamily`, `SpaceCard`, `SectionHeader`, `ValueText`. Keine neuen Farben, kein neuer Kartenstil.
- Desktop-Palette: `obsidian-*`, `line`, `ink`, `ink-muted`, `ink-faint`, `space-violet`, `violet-soft`, `gold`, `good`, `crit`, `font-display`, `font-mono`. Keine neuen Farben.
- Verifikation Desktop: `npm run lint` aus `desktop/` zeigt **nur die 5 vorbestehenden Fehler** (`CollectionList.jsx` `viewMode`/`setViewMode`, ein ungenutztes `e` in `StagingArea.jsx`, `Statistics.jsx` `Icon`); ein sechster ist ein Fehlschlag. `npm run build` muss durchlaufen. Node-Tests: `node --test electron/<datei>.test.cjs`.
- Verifikation Android: `./gradlew :app:compileDebugKotlin` und `./gradlew :app:testDebugUnitTest` aus `android/` müssen BUILD SUCCESSFUL sein. Instrumentationstests (`:app:connectedDebugAndroidTest`) nur dort, wo ein Task es ausdrücklich sagt — sie brauchen das angeschlossene Gerät.
- **Niemals ein nacktes `npm install`** in `desktop/` — das würde `better-sqlite3` für die falsche ABI neu bauen. Wird ein Paket gebraucht, dann gezielt mit `--ignore-scripts` und die md5-Summe von `node_modules/better-sqlite3/build/Release/better_sqlite3.node` vorher und nachher vergleichen.
- **Nie committen:** `android/app/src/main/assets/embedder.onnx` und `index.bin` (feinjustierte Modellgewichte des Nutzers, absichtlich als geändert-aber-ungestaged im Baum), `android/local.properties` (echte Supabase-Zugangsdaten, git-ignoriert). Immer explizite Pfade stagen, **niemals `git add -A`** aus dem Repo-Wurzelverzeichnis.
- SQL wird **nicht** vom Agenten ausgeführt. Schema-Dateien werden geschrieben und dem Nutzer im Chat zum Einspielen im Supabase-SQL-Editor vorgelegt.
- Commit-Stil: `feat(desktop|android|supabase): …` / `fix(…): …`, ein Commit pro Task, Nachricht endet auf `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| Datei | Verantwortung |
|---|---|
| `desktop/electron/catalog-build.cjs` (neu) | **Reine** Funktionen: `mergeCards(en, de)`, `attachVerified(cards, apiCacheRows)`, `packCatalog(cards, version)` → gzip-Buffer. Kein Netz, kein Supabase, keine DB. |
| `desktop/electron/catalog-build.test.cjs` (neu) | Node-Test für Merge, verified-Anhang, Größenlimit, Nie-ableiten-Regel. |
| `desktop/electron/catalog-builder.cjs` (neu) | Orchestrierung: Dumps holen (`cachedFetch`), `api_cache` lesen, `catalog-build.cjs` aufrufen, in Supabase Storage hochladen, `catalog_versions` upserten. Dazu `uploadModel(kind, filePath)`. |
| `desktop/electron/main.cjs` | Wöchentlicher Scheduler (Muster von `startCardmarketBulkScheduler`), IPC `catalog-build-now`, `catalog-status`, `model-upload`. |
| `desktop/electron/preload.cjs` | Die drei Kanäle durchreichen. |
| `desktop/src/components/Settings.jsx` | Abschnitt **Daten**: Katalogstatus (Version, Datum, Größe), „Katalog jetzt bauen", „Scanner-Modell hochladen". |
| `supabase/catalog_versions_schema.sql` (neu) | Tabelle + RLS (lesen: alle; schreiben: authentifiziert) + Storage-Bucket-Hinweise. |
| `android/.../cloud/CatalogParser.kt` (neu) | **Rein**: gzip-JSON → `List<CatalogCard>`/`List<CatalogPrinting>`. JVM-unittestbar. |
| `android/.../cloud/CatalogDb.kt` (neu) | `SQLiteOpenHelper`, Tabellen `cards`, `printings`, `meta`; `importAll(cards)` in einer Transaktion; `version()`. |
| `android/.../cloud/CatalogRepository.kt` (neu) | `card(passcode)`, `printings(passcode)`, `search(name)`, `isReady()`. Einziger Lesezugriff für den Rest der App. |
| `android/.../cloud/CatalogSync.kt` (neu) | Versionsprüfung gegen `catalog_versions`, WLAN-Regel, Download, SHA-256, atomarer Tausch, Fortschritt als `StateFlow`. |
| `android/.../ml/ModelStore.kt` (neu) | Pfadauflösung `filesDir/models/<name>` vor APK-Asset; Download + Prüfsumme für `index`/`embedder`/`detector`. |
| `android/.../ml/DetectorModel.kt`, `EmbedderModel.kt`, `IndexSearcher.kt` | Öffnen über `ModelStore` statt direkt `context.assets`. |
| `android/.../ui/SettingsScreen.kt` | Abschnitt **Katalog**: Version, Stand, Status, „Auch mobil laden", „Jetzt prüfen". |
| `android/.../ui/StartScreen.kt` | Erststart-Banner „Katalog wird geladen" mit Fortschritt. |
| `android/app/src/test/java/.../CatalogParserTest.kt` (neu) | JVM-Test des Parsers. |
| `android/app/src/androidTest/java/.../CatalogDbTest.kt` (neu) | Instrumentationstest für Import, Lookups, atomaren Versionstausch. |

**Warum `CatalogParser` von `CatalogDb` getrennt ist:** `SQLiteOpenHelper` ist Android-Framework-Code und in einem reinen JVM-Unittest nicht verfügbar; Robolectric wäre eine neue Abhängigkeit. Die Parserlogik — wo die Fehler wohnen — bleibt dadurch schnell testbar, und nur der dünne SQLite-Schreibpfad braucht das Gerät.

---

### Task 1: Reiner Katalogbau (`catalog-build.cjs`)

**Files:**
- Create: `desktop/electron/catalog-build.cjs`
- Test: `desktop/electron/catalog-build.test.cjs`

**Interfaces:**
- Produces:
  - `mergeCards(enCards, deCards)` → `Array<CatalogCard>`. `enCards`/`deCards` sind die `data`-Arrays aus YGOPRODeck `cardinfo.php`.
  - `attachVerified(cards, verifiedByPasscode)` → dieselbe Liste, jede Karte um `printings_verified` ergänzt. `verifiedByPasscode` ist `Map<string, Array<{code, rarity, lang}>>`.
  - `packCatalog(cards, version)` → `{ buffer: Buffer, json: string, bytes: number }`, gzip-Level 9.
  - `CatalogCard` = `{ id:number, name_de:string, name_en:string, type:string, desc_de:string, atk:number|null, def:number|null, level:number|null, race:string|null, attribute:string|null, image:string, image_small:string, printings:Array<{code,rarity}>, printings_verified:Array<{code,rarity,lang}> }`
- Consumes: nichts (reine Funktionen, keine Requires außer `node:zlib`).

- [ ] **Step 1: Test schreiben**

`desktop/electron/catalog-build.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { mergeCards, attachVerified, packCatalog } = require('./catalog-build.cjs');

const EN = [{
  id: 46986414, name: 'Dark Magician', type: 'Normal Monster', desc: 'The ultimate wizard.',
  atk: 2500, def: 2100, level: 7, race: 'Spellcaster', attribute: 'DARK',
  card_images: [{ image_url: 'https://x/46986414.jpg', image_url_small: 'https://x/46986414_s.jpg' }],
  card_sets: [{ set_code: 'LOB-EN005', set_rarity: 'Ultra Rare' }, { set_code: 'SDY-006', set_rarity: 'Common' }],
}];
const DE = [{ id: 46986414, name: 'Dunkler Magier', desc: 'Der ultimative Zauberer.' }];

test('mergeCards nimmt den deutschen Namen und Text, behält das englische Gerüst', () => {
  const [c] = mergeCards(EN, DE);
  assert.equal(c.id, 46986414);
  assert.equal(c.name_de, 'Dunkler Magier');
  assert.equal(c.name_en, 'Dark Magician');
  assert.equal(c.desc_de, 'Der ultimative Zauberer.');
  assert.equal(c.atk, 2500);
  assert.equal(c.image, 'https://x/46986414.jpg');
  assert.deepEqual(c.printings, [
    { code: 'LOB-EN005', rarity: 'Ultra Rare' },
    { code: 'SDY-006', rarity: 'Common' },
  ]);
  assert.deepEqual(c.printings_verified, []);
});

test('mergeCards fällt auf Englisch zurück, wenn die Karte im DE-Dump fehlt', () => {
  const [c] = mergeCards(EN, []);
  assert.equal(c.name_de, 'Dark Magician');
  assert.equal(c.desc_de, 'The ultimate wizard.');
});

test('mergeCards überspringt Karten ohne id oder ohne Bild', () => {
  assert.equal(mergeCards([{ name: 'kaputt' }], []).length, 0);
  assert.equal(mergeCards([{ id: 1, name: 'x', card_images: [] }], []).length, 0);
});

test('attachVerified hängt nur echte Funde an und leitet nichts ab', () => {
  const merged = mergeCards(EN, DE);
  const out = attachVerified(merged, new Map([
    ['46986414', [{ code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' }]],
  ]));
  assert.deepEqual(out[0].printings_verified, [{ code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' }]);
  // Das englische Printing bleibt unangetastet, es entsteht kein abgeleiteter DE-Code.
  assert.deepEqual(out[0].printings.map(p => p.code), ['LOB-EN005', 'SDY-006']);
});

test('attachVerified lässt eine Karte ohne Fund leer', () => {
  const out = attachVerified(mergeCards(EN, DE), new Map());
  assert.deepEqual(out[0].printings_verified, []);
});

test('packCatalog liefert gültiges gzip mit Version und Karten', () => {
  const { buffer, bytes } = packCatalog(mergeCards(EN, DE), 12);
  const back = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  assert.equal(back.version, 12);
  assert.equal(back.cards.length, 1);
  assert.ok(typeof back.built_at === 'string');
  assert.equal(bytes, buffer.length);
});

test('packCatalog bleibt für einen realistischen Katalog unter 8 MB', () => {
  // 14.500 Karten mit einem 300-Zeichen-Text und 6 Printings — die reale Grössenordnung.
  const desc = 'x'.repeat(300);
  const many = Array.from({ length: 14500 }, (_, i) => ({
    id: 10000000 + i, name: `Karte ${i}`, type: 'Effect Monster', desc,
    atk: 1000, def: 1000, level: 4, race: 'Warrior', attribute: 'EARTH',
    card_images: [{ image_url: `https://x/${i}.jpg`, image_url_small: `https://x/${i}_s.jpg` }],
    card_sets: Array.from({ length: 6 }, (_, k) => ({ set_code: `AB${k}-EN00${k}`, set_rarity: 'Common' })),
  }));
  const { bytes } = packCatalog(mergeCards(many, []), 1);
  assert.ok(bytes <= 8 * 1024 * 1024, `Katalog ist ${(bytes / 1048576).toFixed(2)} MB, Limit 8 MB`);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node --test electron/catalog-build.test.cjs` aus `desktop/`
Expected: FAIL — `Cannot find module './catalog-build.cjs'`.

- [ ] **Step 3: Implementieren**

`desktop/electron/catalog-build.cjs`:

```js
// desktop/electron/catalog-build.cjs
// Reine Katalogbau-Funktionen: Merge der YGOPRODeck-Dumps (EN + DE), Anhang der vom Desktop
// bestätigten Set-Codes, gzip-Packen. Kein Netz, keine DB, kein Supabase — alles Testbare hier.
const zlib = require('node:zlib');

// Die Kartenliste des englischen Dumps ist das Gerüst (vollständige Printings, Stats, Bilder);
// aus dem deutschen Dump kommen nur Name und Text, mit Rückfall auf Englisch.
function mergeCards(enCards, deCards) {
  const de = new Map();
  for (const c of deCards || []) if (c && c.id != null) de.set(String(c.id), c);

  const out = [];
  for (const c of enCards || []) {
    if (!c || c.id == null) continue;
    const img = Array.isArray(c.card_images) ? c.card_images[0] : null;
    if (!img || !img.image_url) continue;              // ohne Bild ist die Karte im Scan wertlos
    const d = de.get(String(c.id));
    out.push({
      id: Number(c.id),
      name_de: (d && d.name) || c.name || '',
      name_en: c.name || '',
      type: c.type || '',
      desc_de: (d && d.desc) || c.desc || '',
      atk: c.atk ?? null,
      def: c.def ?? null,
      level: c.level ?? null,
      race: c.race || null,
      attribute: c.attribute || null,
      image: img.image_url,
      image_small: img.image_url_small || img.image_url,
      printings: (c.card_sets || [])
        .filter(s => s && s.set_code)
        .map(s => ({ code: s.set_code, rarity: s.set_rarity || 'Common' })),
      printings_verified: [],
    });
  }
  return out;
}

// `verifiedByPasscode` kommt aus dem api_cache des Desktops und enthält AUSSCHLIESSLICH Codes,
// die über Yugipedia/Fandom/Konami tatsächlich belegt sind. Hier wird nichts abgeleitet:
// aus LOB-EN005 wird niemals LOB-DE005 (DE- und G-Infix unterscheiden sich je nach Ära).
function attachVerified(cards, verifiedByPasscode) {
  for (const c of cards) {
    const v = verifiedByPasscode instanceof Map
      ? verifiedByPasscode.get(String(c.id))
      : (verifiedByPasscode || {})[String(c.id)];
    c.printings_verified = Array.isArray(v)
      ? v.filter(x => x && x.code).map(x => ({ code: x.code, rarity: x.rarity || 'Common', lang: x.lang || 'DE' }))
      : [];
  }
  return cards;
}

function packCatalog(cards, version) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  return { buffer, json, bytes: buffer.length };
}

module.exports = { mergeCards, attachVerified, packCatalog };
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test electron/catalog-build.test.cjs`
Expected: alle Tests PASS. Notiere die tatsächliche gepackte Grösse aus dem Grössen-Test im Report — sie entscheidet, ob §12 („`desc_de` kürzen") später gezogen werden muss.

- [ ] **Step 5: Committen**

```bash
git add desktop/electron/catalog-build.cjs desktop/electron/catalog-build.test.cjs
git commit -m "feat(desktop): reiner Katalogbau mit Merge, verified-Codes und Groessenlimit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Supabase-Schema `catalog_versions` und Storage-Bucket

**Files:**
- Create: `supabase/catalog_versions_schema.sql`

**Interfaces:**
- Produces: Tabelle `public.catalog_versions (kind, version, url, bytes, sha256, built_at)` mit Primärschlüssel `kind` (genau eine aktuelle Zeile pro Art) und `kind ∈ ('catalog','index','embedder','detector')`. Storage-Bucket `catalog`, öffentlich lesbar, Schreiben nur authentifiziert.
- Consumes: die `set_updated_at`-Hilfsfunktion existiert bereits aus `card_copies_schema.sql`; hier wird sie **nicht** gebraucht (`built_at` wird vom Client gesetzt).

Dieser Task schreibt nur die Datei. **Der Agent führt kein SQL aus.** Der Controller legt sie dem Nutzer im Chat vor.

- [ ] **Step 1: Schema schreiben**

`supabase/catalog_versions_schema.sql`:

```sql
-- supabase/catalog_versions_schema.sql — Spec D1. Einmal im Supabase-SQL-Editor ausführen.
-- Eine Zeile pro Artefaktart: welche Version aktuell ist und wo sie liegt.
-- Der Katalog ist kein Nutzerdatum -> Lesen für alle, Schreiben nur für den angemeldeten Desktop.

create table if not exists public.catalog_versions (
  kind       text primary key check (kind in ('catalog','index','embedder','detector')),
  version    integer not null,
  url        text not null,
  bytes      bigint not null default 0,
  sha256     text,
  built_at   timestamptz not null default now()
);

alter table public.catalog_versions enable row level security;

drop policy if exists catalog_versions_read on public.catalog_versions;
create policy catalog_versions_read on public.catalog_versions
  for select using (true);

drop policy if exists catalog_versions_write on public.catalog_versions;
create policy catalog_versions_write on public.catalog_versions
  for all to authenticated using (true) with check (true);

-- Storage-Bucket. Öffentlich lesbar, damit das Handy ohne Token laden kann.
insert into storage.buckets (id, name, public)
values ('catalog', 'catalog', true)
on conflict (id) do update set public = true;

drop policy if exists catalog_objects_read on storage.objects;
create policy catalog_objects_read on storage.objects
  for select using (bucket_id = 'catalog');

drop policy if exists catalog_objects_write on storage.objects;
create policy catalog_objects_write on storage.objects
  for all to authenticated using (bucket_id = 'catalog') with check (bucket_id = 'catalog');
```

- [ ] **Step 2: Selbstprüfung**

Es gibt keine Testmöglichkeit ohne die echte Datenbank. Prüfe stattdessen von Hand und halte es im Report fest:
- Die Datei ist zweimal hintereinander ausführbar (jedes `create`/`policy` ist `if not exists` bzw. `drop … ; create`).
- `kind` ist Primärschlüssel, also erzwingt `on conflict (kind) do update` im nächsten Task genau eine aktuelle Zeile pro Art.
- Keine `drop table`, kein `truncate`, nichts, was bestehende Daten anfasst.

- [ ] **Step 3: Committen**

```bash
git add supabase/catalog_versions_schema.sql
git commit -m "feat(supabase): catalog_versions Tabelle und oeffentlicher catalog-Bucket

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Controller-Aufgabe nach diesem Task:** dem Nutzer den vollständigen SQL-Text im Chat vorlegen mit dem Hinweis, ihn im Supabase-SQL-Editor auszuführen, und die Bestätigung abwarten, bevor Task 3 ausgeliefert wird (Task 3 lädt gegen diese Tabelle hoch).

---

### Task 3: Katalog-Orchestrierung und Upload (`catalog-builder.cjs`)

**Files:**
- Create: `desktop/electron/catalog-builder.cjs`
- Modify: `desktop/electron/main.cjs`, `desktop/electron/preload.cjs`

**Interfaces:**
- Consumes: `mergeCards`, `attachVerified`, `packCatalog` aus Task 1; `cachedFetch` aus `api-handler.cjs`; `ensureClient()` aus dem Rückgabewert von `startSync(db, getWindow)` in `main.cjs`.
- Produces:
  - `runCatalogBuild(db, { ensureClient, force })` → `{ version, bytes, url, cards, verified, error? }`
  - `uploadModel(db, { ensureClient, kind, filePath })` → `{ kind, version, bytes, sha256, url, error? }`
  - `getCatalogStatus(db)` → `{ lastRun, version, bytes }`
- IPC-Kanäle: `catalog-build-now`, `catalog-status`, `model-upload`.

**Wie die verified-Codes aus dem Cache kommen:** `api-handler.cjs` legt die Wiki-Ergebnisse unter `api_cache` mit `key` = `<prefix>:<url>` ab. Lies alle Zeilen, deren `key` auf den Set-Union-Abruf zeigt, parse `data` als JSON und ziehe pro Passcode die Codes mit ihrer Rarity und Sprache heraus. **Die genauen Cache-Präfixe stehen nicht in diesem Brief** — lies `api-handler.cjs` (`fetchSetsUnion`, `parseWikiSets`, `cachedFetchText`) und leite sie dort ab. Findest du kein verwertbares Format, liefere `verified: 0` und halte im Report fest, warum; der Katalog ist auch ohne `printings_verified` nützlich, und D2 kann nachziehen.

- [ ] **Step 1: `catalog-builder.cjs` schreiben**

Aufbau (kein Codeblock vorgegeben, weil die Cache-Extraktion aus dem echten `api-handler.cjs` abgeleitet werden muss — halte dich an das Muster von `cardmarket-bulk.cjs`):

1. `loadDumps(force)`: `cachedFetch('https://db.ygoprodeck.com/api/v7/cardinfo.php', 'catalog_en', 7 * 24)` und dieselbe URL mit `?language=de` unter `catalog_de`. Beide liefern `{ data: [...] }`. Schlägt einer fehl und es gibt keinen Cache → Fehler zurückgeben, **nicht** werfen (Muster: `runBulkRefresh`).
2. `readVerified(db)`: wie oben beschrieben aus `api_cache`, Rückgabe `Map<passcode, Array<{code, rarity, lang}>>`.
3. Bauen: `packCatalog(attachVerified(mergeCards(en, de), verified), version)`. `version` = bisherige Version aus `settings.catalog_version` + 1, Start bei 1.
4. Hochladen: `const c = await ensureClient()`, dann `c.storage.from('catalog').upload('catalog.v<N>.json.gz', buffer, { contentType: 'application/gzip', upsert: true })`, öffentliche URL über `c.storage.from('catalog').getPublicUrl(...)`.
5. `catalog_versions` upserten: `c.from('catalog_versions').upsert({ kind: 'catalog', version, url, bytes, sha256, built_at }, { onConflict: 'kind' })`. `sha256` über `crypto.createHash('sha256').update(buffer).digest('hex')`.
6. Erst **nach** erfolgreichem Upload `settings.catalog_version` und `settings.catalog_last_run` schreiben — schlägt der Upload fehl, bleibt die Version stehen und der nächste Lauf versucht dieselbe Nummer erneut.
7. `uploadModel(db, { ensureClient, kind, filePath })`: Datei lesen, SHA-256 bilden, als `<kind>.v<N>.bin` hochladen, `catalog_versions` für dieses `kind` upserten. Erlaubte `kind`-Werte prüfen und sonst einen Fehler zurückgeben.

- [ ] **Step 2: Scheduler und IPC in `main.cjs`**

Spiegle `startCardmarketBulkScheduler` (main.cjs:624-635): eine `tick`-Funktion, die anhand von `settings.catalog_last_run` entscheidet, ob mehr als 7 Tage vergangen sind, ein `setInterval` von einer Stunde, ein erster Aufruf kurz nach dem Start. Der Rückgabewert von `startSync(...)` wird bereits in `main.cjs` gehalten — nimm `ensureClient` von dort, baue keinen zweiten Supabase-Client.

Drei Handler:
```js
ipcMain.handle('catalog-build-now', async () => { … runCatalogBuild(db, { ensureClient, force: true }) … });
ipcMain.handle('catalog-status', () => { try { return getCatalogStatus(db); } catch { return { lastRun: null, version: 0, bytes: 0 }; } });
ipcMain.handle('model-upload', async (e, { kind, filePath }) => { … uploadModel(db, { ensureClient, kind, filePath }) … });
```
Jeder Handler fängt seine Fehler und gibt `{ error: '…' }` zurück statt zu werfen — der Renderer zeigt nur eine Statuszeile (Spec §10: „kein Fehler-Popup").

Für `model-upload` braucht der Renderer einen Dateidialog. Nutze denselben `dialog.showOpenDialog`-Weg, den `restore-database` in `main.cjs` schon geht, mit Filtern auf `.onnx` und `.bin`.

- [ ] **Step 3: `preload.cjs` erweitern**

Neben den bestehenden Wrappern:
```js
  buildCatalogNow: () => ipcRenderer.invoke('catalog-build-now'),
  getCatalogStatus: () => ipcRenderer.invoke('catalog-status'),
  uploadModel: (kind) => ipcRenderer.invoke('model-upload', { kind }),
```
(Die Dateiauswahl passiert im Main-Prozess, der Renderer schickt nur die Art.)

- [ ] **Step 4: Verifizieren**

Run aus `desktop/`:
- `npm run lint` → nur die 5 vorbestehenden Fehler.
- `npm run build` → erfolgreich.
- `node --test electron/catalog-build.test.cjs` → weiterhin PASS.
- `node -e "require('./electron/catalog-builder.cjs')"` → lädt ohne Fehler (Syntax- und Require-Prüfung ohne Electron).

Starte die App **nicht**; der echte Bau wird vom Controller zusammen mit dem Nutzer ausgelöst.

- [ ] **Step 5: Committen**

```bash
git add desktop/electron/catalog-builder.cjs desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(desktop): Katalog bauen, hochladen und Modelle ausliefern

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Einstellungen › Daten — Katalogstatus und Modell-Upload

**Files:**
- Modify: `desktop/src/components/Settings.jsx`

**Interfaces:**
- Consumes: `window.api.getCatalogStatus()`, `window.api.buildCatalogNow()`, `window.api.uploadModel(kind)` aus Task 3.

Der Abschnitt **Daten** existiert seit Spec C (`active === 'daten'`) und enthält Sichern / Wiederherstellen / Verschieben / Duplikate zusammenführen. Hier kommt eine Karte **Katalog** dazu, im selben Stil wie die bestehenden Karten des Abschnitts (`bg-obsidian-700 border border-line rounded-2xl p-6`).

- [ ] **Step 1: Statuskarte**

Inhalt, alle Zeichenketten deutsch:
- Überschrift `Katalog` (`font-display text-lg text-ink`).
- Erklärzeile: `Name, Text und Printings aller Karten — das Handy scannt damit ohne Netz.`
- Statuszeile aus `getCatalogStatus()`: `Version {version} · {bytes formatiert} · gebaut am {lastRun als deutsches Datum}`. Ohne Lauf: `Noch nie gebaut.`
- Knopf `Katalog jetzt bauen`, während des Laufs `Wird gebaut…` und deaktiviert.
- Ergebniszeile nach dem Lauf: bei Erfolg `Version {n} hochgeladen ({bytes}).` in `text-good`, bei `{ error }` der Fehlertext in `text-crit`.

**Wichtig zur Fortschrittsanzeige:** Spec C hat in `Settings.jsx` einen `runningAction`-Diskriminator eingeführt (`'prices' | 'downgrade' | null`), damit ein laufender Vorgang nicht in einem fremden Abschnitt als Balken auftaucht. Führe den Katalogbau als **eigenen** Wert (`'catalog'`) und lass die bestehenden zwei unangetastet.

- [ ] **Step 2: Modell-Upload**

Zweite Karte **Scanner-Modell** im selben Abschnitt: drei Knöpfe `Index hochladen`, `Embedder hochladen`, `Detektor hochladen`, die `uploadModel('index'|'embedder'|'detector')` aufrufen, plus eine Ergebniszeile im selben Muster. Erklärzeile: `Neue Modelldateien landen ohne neue App-Version auf dem Handy.`

- [ ] **Step 3: Verifizieren**

Run aus `desktop/`: `npm run lint` (nur die 5 bekannten Fehler), `npm run build`.
Dann `grep -n "Katalog\|Scanner-Modell" src/components/Settings.jsx` und im Report zeigen, dass beide Karten im `daten`-Zweig stehen und in keinem anderen.

- [ ] **Step 4: Committen**

```bash
git add desktop/src/components/Settings.jsx
git commit -m "feat(desktop): Katalogstatus und Modell-Upload im Datenbereich

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Android-Katalogparser (rein, unittestbar)

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt`
- Test: `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt`

**Interfaces:**
- Produces:
  - `data class CatalogCard(id: String, nameDe: String, nameEn: String, type: String, descDe: String, atk: Int?, def: Int?, level: Int?, race: String?, attribute: String?, image: String, imageSmall: String, printings: List<CatalogPrinting>)`
  - `data class CatalogPrinting(code: String, rarity: String, lang: String?, verified: Boolean)`
  - `object CatalogParser { fun parse(gzipped: ByteArray): ParsedCatalog }`
  - `data class ParsedCatalog(version: Int, builtAt: String, cards: List<CatalogCard>)`
- Consumes: nichts aus der App. `java.util.zip.GZIPInputStream` und `org.json` (beide bereits verfügbar; `org.json` ist als `testImplementation("org.json:json:20240303")` für den JVM-Test da und auf Android Teil des Frameworks).

`printings` und `printings_verified` aus der Datei werden zu **einer** Liste zusammengeführt: verified-Einträge zuerst, `verified = true`, mit ihrer Sprache; die übrigen mit `verified = false` und `lang = null`. Damit muss der Rest der App die beiden Quellen nicht kennen — und D2 kann „verified zuerst prüfen" als simples Sortierkriterium umsetzen.

- [ ] **Step 1: Test schreiben**

`android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class CatalogParserTest {

    private fun gz(json: String): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        return bos.toByteArray()
    }

    private val sample = """
    {"version":12,"built_at":"2026-09-06T03:00:00Z","cards":[
      {"id":46986414,"name_de":"Dunkler Magier","name_en":"Dark Magician","type":"Normal Monster",
       "desc_de":"Der ultimative Zauberer.","atk":2500,"def":2100,"level":7,
       "race":"Spellcaster","attribute":"DARK",
       "image":"https://x/a.jpg","image_small":"https://x/a_s.jpg",
       "printings":[{"code":"LOB-EN005","rarity":"Ultra Rare"}],
       "printings_verified":[{"code":"LOB-DE005","rarity":"Ultra Rare","lang":"DE"}]}
    ]}
    """.trimIndent()

    @Test fun `liest Version und Karte`() {
        val p = CatalogParser.parse(gz(sample))
        assertEquals(12, p.version)
        assertEquals(1, p.cards.size)
        val c = p.cards[0]
        assertEquals("46986414", c.id)
        assertEquals("Dunkler Magier", c.nameDe)
        assertEquals("Dark Magician", c.nameEn)
        assertEquals(2500, c.atk)
    }

    @Test fun `verified-Printings stehen vorn und sind markiert`() {
        val c = CatalogParser.parse(gz(sample)).cards[0]
        assertEquals(2, c.printings.size)
        assertEquals("LOB-DE005", c.printings[0].code)
        assertTrue(c.printings[0].verified)
        assertEquals("DE", c.printings[0].lang)
        assertEquals("LOB-EN005", c.printings[1].code)
        assertTrue(!c.printings[1].verified)
    }

    @Test fun `fehlende optionale Felder werden null, nicht 0`() {
        val json = """{"version":1,"built_at":"x","cards":[
          {"id":1,"name_de":"A","name_en":"A","type":"Spell Card","desc_de":"d",
           "image":"i","image_small":"s","printings":[],"printings_verified":[]}]}"""
        val c = CatalogParser.parse(gz(json)).cards[0]
        assertEquals(null, c.atk)
        assertEquals(null, c.def)
        assertEquals(null, c.level)
        assertEquals(0, c.printings.size)
    }

    @Test fun `eine kaputte Karte kippt nicht den ganzen Katalog`() {
        val json = """{"version":3,"built_at":"x","cards":[
          {"nope":true},
          {"id":2,"name_de":"B","name_en":"B","type":"t","desc_de":"d",
           "image":"i","image_small":"s","printings":[],"printings_verified":[]}]}"""
        val p = CatalogParser.parse(gz(json))
        assertEquals(3, p.version)
        assertEquals(1, p.cards.size)
        assertEquals("2", p.cards[0].id)
    }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `./gradlew :app:testDebugUnitTest --tests '*CatalogParserTest*'` aus `android/`
Expected: FAIL — `CatalogParser` existiert nicht (Kompilierfehler).

- [ ] **Step 3: Implementieren**

`CatalogParser.kt` mit `GZIPInputStream` → String → `JSONObject`. Karten ohne `id` oder ohne `image` werden übersprungen (dieselbe Regel wie im Desktop-Builder). Optionale Zahlen über `if (has(k) && !isNull(k)) getInt(k) else null` lesen — `optInt` würde `0` liefern und einen ATK-losen Zauber zu 0 ATK machen.

- [ ] **Step 4: Tests laufen lassen**

Run: `./gradlew :app:testDebugUnitTest` → BUILD SUCCESSFUL, alle vier Tests grün (`ValuationTest` bleibt grün).

- [ ] **Step 5: Committen**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt
git commit -m "feat(android): Katalogparser mit verified-Printings zuerst

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Lokale Katalogdatenbank (`CatalogDb`, `CatalogRepository`)

**Files:**
- Create: `android/.../cloud/CatalogDb.kt`, `android/.../cloud/CatalogRepository.kt`
- Test: `android/app/src/androidTest/java/com/example/yugiohscanner/CatalogDbTest.kt`

**Interfaces:**
- Consumes: `CatalogParser`, `CatalogCard`, `CatalogPrinting` aus Task 5.
- Produces:
  - `class CatalogDb(context: Context) : SQLiteOpenHelper(context, "catalog.db", null, 1)` mit `importAll(parsed: ParsedCatalog)`, `version(): Int`, `cardCount(): Int`
  - `object CatalogRepository` mit `init(context)`, `isReady(): Boolean`, `card(passcode: String): CatalogCard?`, `printings(passcode: String): List<CatalogPrinting>`, `search(name: String, limit: Int = 50): List<CatalogCard>`

Schema:
```sql
CREATE TABLE cards (
  id TEXT PRIMARY KEY, name_de TEXT, name_en TEXT, type TEXT, desc_de TEXT,
  atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
  image TEXT, image_small TEXT);
CREATE TABLE printings (
  card_id TEXT NOT NULL, code TEXT NOT NULL, rarity TEXT NOT NULL,
  lang TEXT, verified INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL);
CREATE INDEX printings_card_idx ON printings(card_id);
CREATE INDEX cards_name_de_idx ON cards(name_de);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```
`ord` bewahrt die Reihenfolge aus dem Parser (verified zuerst) über den SQLite-Roundtrip; ohne sie wäre die Reihenfolge undefiniert und D2s „verified zuerst" ginge still verloren.

**Atomarer Import:** `importAll` löscht und schreibt in **einer** Transaktion (`beginTransaction` / `setTransactionSuccessful` / `endTransaction`) und setzt `meta.version` als **letzte** Anweisung darin. Bricht der Import ab, bleibt die alte Version vollständig stehen — genau das verlangt Spec §5.3.

- [ ] **Step 1: Instrumentationstest schreiben**

`CatalogDbTest.kt` (androidTest, läuft auf dem angeschlossenen Gerät):
- Import eines kleinen Katalogs → `version()` und `cardCount()` stimmen.
- `card("46986414")` liefert die Karte mit deutschem Namen.
- `printings("46986414")` liefert die verified-Zeile **zuerst**.
- `search("Dunkler")` findet die Karte; `search("zzz")` liefert leer.
- Zweiter Import mit anderer Version ersetzt vollständig (kein Doppel, alte Karte weg, `version()` neu).
- Ein Import, der mitten drin wirft (kaputte Kartenliste), lässt Version und Inhalt des vorherigen Imports unangetastet.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `./gradlew :app:connectedDebugAndroidTest --tests '*CatalogDbTest*'` aus `android/`
Expected: FAIL (Klassen fehlen). **Ist kein Gerät verbunden** (`adb devices` leer), melde das als BLOCKED zurück, statt den Test zu überspringen.

- [ ] **Step 3: Implementieren**

`CatalogDb.kt` und `CatalogRepository.kt` wie oben. `CatalogRepository` hält die `CatalogDb`-Instanz und ist der einzige Lesezugriff für den Rest der App; `isReady()` ist `version() > 0`.

`search` nutzt `LIKE ? ESCAPE '\'` auf `name_de` **und** `name_en` mit `%<eingabe>%`, wobei `%`, `_` und `\` in der Eingabe escaped werden — sonst macht eine Suche nach `100%` die halbe Datenbank auf.

- [ ] **Step 4: Tests laufen lassen**

Run: `./gradlew :app:connectedDebugAndroidTest --tests '*CatalogDbTest*'` → BUILD SUCCESSFUL.
Dann `./gradlew :app:testDebugUnitTest` → weiterhin grün.

- [ ] **Step 5: Committen**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt android/app/src/androidTest/java/com/example/yugiohscanner/CatalogDbTest.kt
git commit -m "feat(android): lokale Katalogdatenbank mit atomarem Import

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Katalog-Abgleich (`CatalogSync`)

**Files:**
- Create: `android/.../cloud/CatalogSync.kt`
- Modify: `android/.../ui/AppNav.kt` (Anstoß beim Start)

**Interfaces:**
- Consumes: `SupabaseCloud` (URL und Anon-Key, bestehende OkHttp-Wege), `CatalogParser`, `CatalogDb`/`CatalogRepository`.
- Produces: `object CatalogSync` mit
  - `val state: StateFlow<CatalogState>` wobei `sealed interface CatalogState { object Idle; object Checking; data class Downloading(percent: Int); data class Importing(cards: Int); data class Ready(version: Int); data class Failed(reason: String) }`
  - `suspend fun checkAndUpdate(context: Context, force: Boolean = false)`

Regeln aus Spec §5.3, alle verbindlich:
- Prüfung beim App-Start und höchstens **einmal täglich** (Zeitstempel in `Prefs`).
- Download **nur im WLAN**, außer die Einstellung `catalog_mobile_ok` ist gesetzt. Netzart über `ConnectivityManager.getNetworkCapabilities(activeNetwork)` und `NET_CAPABILITY_NOT_METERED` prüfen — nicht über den Transporttyp, sonst gilt ein Hotspot fälschlich als WLAN.
- `catalog_versions` wird **ohne Token** gelesen (Tabelle ist für alle lesbar); der Katalog-Download braucht ebenfalls keinen Token, weil der Bucket öffentlich ist. Der Abgleich funktioniert also auch vor dem Login.
- Nach dem Download SHA-256 gegen `catalog_versions.sha256` prüfen; Abweichung → `Failed`, alte Version bleibt.
- Storage ist nicht erreichbar → `Failed` mit Grund, **kein Popup** — nur Zustand für die Statuszeile.

- [ ] **Step 1: Implementieren**

Herunterladen in eine temporäre Datei in `context.cacheDir`, prüfen, parsen, `importAll` aufrufen, temporäre Datei löschen. Fortschritt aus `Content-Length` und den gelesenen Bytes speisen.

Der Anstoß in `AppNav.kt` ist ein `LaunchedEffect(Unit) { CatalogSync.checkAndUpdate(context) }` auf oberster Ebene — **nicht** in einer einzelnen Destination, sonst läuft er bei jedem Tabwechsel erneut.

- [ ] **Step 2: Verifizieren**

Run aus `android/`: `./gradlew :app:compileDebugKotlin` und `./gradlew :app:testDebugUnitTest` → beide BUILD SUCCESSFUL.

Es gibt für diesen Task keinen automatisierten Test: er ist fast vollständig Netz- und Plattform-Anbindung, und ein Test dafür würde nur die Mocks prüfen. Halte im Report stattdessen fest, wie du die vier Fehlerfälle aus Spec §10 im Code abgesichert hast (Storage weg, Prüfsumme falsch, Import bricht ab, kein Netz).

- [ ] **Step 3: Committen**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogSync.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt
git commit -m "feat(android): Katalog-Abgleich mit WLAN-Regel und Pruefsumme

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Modellauslieferung (`ModelStore`)

**Files:**
- Create: `android/.../ml/ModelStore.kt`
- Modify: `android/.../ml/DetectorModel.kt`, `android/.../ml/EmbedderModel.kt`, `android/.../ml/IndexSearcher.kt`

**Interfaces:**
- Produces: `object ModelStore` mit `fun bytes(context: Context, name: String): ByteArray` (liest `filesDir/models/<name>`, sonst `context.assets.open(name)`) und `suspend fun checkAndUpdate(context: Context)` (dieselbe `catalog_versions`-Logik wie `CatalogSync`, für `index`/`embedder`/`detector`).

**Achtung — hier liegt das Risiko dieses Tasks.** Die drei Modellklassen öffnen heute direkt Assets:
- `ml/DetectorModel.kt:27` → `context.assets.open("detector.onnx").readBytes()`
- `ml/EmbedderModel.kt:14` → `context.assets.open("embedder.onnx").readBytes()`
- `ml/IndexSearcher.kt:18` → `ByteBuffer.wrap(context.assets.open("index.bin").readBytes())`

Ersetze **nur** diese drei Aufrufe durch `ModelStore.bytes(context, "<name>")`. Alles andere in diesen Dateien — Sessionaufbau, `OrtTuning.sessionOptions()`, Formen, Schwellwerte, `close()` — bleibt unangetastet. Die ONNX-Pipeline ist byte-genau geprüft und darf sich nicht verschieben.

Prüfsumme vor dem Tausch, Tausch atomar (in `models/<name>.tmp` laden, dann `renameTo`). Schlägt die Prüfsumme fehl, bleiben die APK-Assets aktiv (Spec §10).

- [ ] **Step 1: Implementieren**

- [ ] **Step 2: Verifizieren**

Run aus `android/`: `./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`.
Dann `git diff` über die drei ml-Dateien zeigen und im Report belegen, dass **je genau eine Zeile** geändert ist.

- [ ] **Step 3: Committen**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/ModelStore.kt android/app/src/main/java/com/example/yugiohscanner/ml/DetectorModel.kt android/app/src/main/java/com/example/yugiohscanner/ml/EmbedderModel.kt android/app/src/main/java/com/example/yugiohscanner/ml/IndexSearcher.kt
git commit -m "feat(android): Modelle aus filesDir vor den APK-Assets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Katalog im Scan-, Such- und Detailpfad nutzen

**Files:**
- Modify: `android/.../ui/ScanScreen.kt`, `android/.../ui/SearchScreen.kt`, `android/.../ui/CardDetailScreen.kt`, `android/.../cloud/PrintingRepository.kt` (nur ein Vorschalten, keine Umstrukturierung)

**Interfaces:**
- Consumes: `CatalogRepository` aus Task 6.

Die Regel ist überall dieselbe und steht in Spec §2 und §10: **Katalog zuerst, Netz als Rückfall.** Kennt der Katalog die Karte nicht (nagelneues Set), greift der bestehende Weg unverändert.

Konkret:
- In `ScanScreen.kt` löst `stageScan` heute über `CardSearchRepository.search` und `PrintingRepository.fetchAllSets` auf (die Stellen, die in Spec C den Login-Gate-Fehler ausgelöst haben). Setze `CatalogRepository.card(pc)` und `CatalogRepository.printings(pc)` davor; nur wenn beide leer sind, läuft der Netzweg.
- In `SearchScreen.kt` liefert `CatalogRepository.search(query)` die Trefferliste, solange `isReady()`; sonst der bestehende Weg.
- In `CardDetailScreen.kt` kommen Name, Text und Stats aus dem Katalog, wenn vorhanden.

**Nicht anfassen:** die Ampel, die Rarity-Vorauswahl und das sprachneutrale Matching. Das ist D2. Hier wird nur die Datenquelle vorgeschaltet.

- [ ] **Step 1: Umsetzen**

- [ ] **Step 2: Verifizieren**

Run aus `android/`: `./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`.
Dann `./gradlew :app:installDebug` und im Report festhalten, dass der folgende Durchgang **noch von Hand** zu prüfen ist (es gibt kein Compose-UI-Testgerüst): Flugmodus an, eine bekannte Karte scannen → Name erscheint sofort; eine Karte scannen, die der Katalog nicht kennt → Netzweg oder roter Eintrag, kein Absturz.

- [ ] **Step 3: Committen**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SearchScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/cloud/PrintingRepository.kt
git commit -m "feat(android): Katalog zuerst, Netz als Rueckfall in Scan, Suche und Detail

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Statusanzeigen auf dem Handy

**Files:**
- Modify: `android/.../ui/SettingsScreen.kt`, `android/.../ui/StartScreen.kt`

**Interfaces:**
- Consumes: `CatalogSync.state`, `CatalogRepository.isReady()`, `Prefs`.

- [ ] **Step 1: Einstellungen › Katalog**

Neuer Abschnitt zwischen **Desktop-Verbindung** und **Preise** (die Reihenfolge der übrigen Abschnitte aus Spec C bleibt: Konto, Desktop-Verbindung, **Katalog**, Preise, Standards, Über), mit `SectionHeader("Katalog")`:
- Zeile `Version {n} · {Anzahl} Karten` bzw. `Noch nicht geladen`.
- Zustandszeile aus `CatalogSync.state`: `Wird geprüft…`, `Wird geladen … {p} %`, `Wird importiert…`, `Aktuell`, `Fehlgeschlagen: {Grund}` (letzteres in `ErrorColor`).
- Schalter `Auch über Mobilfunk laden` (Prefs `catalog_mobile_ok`, Standard aus).
- Knopf `Jetzt prüfen`.

- [ ] **Step 2: Erststart-Banner auf Start**

Solange `!CatalogRepository.isReady()` und der Abgleich läuft, oben auf `StartScreen` eine schmale Zeile im bestehenden Kartenstil: `Katalog wird geladen … {p} %` mit dem Hinweis `Scannen geht schon — es dauert nur länger.` Verschwindet, sobald `Ready`.

Verwende dafür **nicht** die Fehlerzeile, die die Spec-C-Fix-Welle auf `StartScreen` eingebaut hat — die bleibt den Ladefehlern vorbehalten.

- [ ] **Step 3: Verifizieren**

Run aus `android/`: `./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`, dann `./gradlew :app:installDebug`.

- [ ] **Step 4: Committen**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt
git commit -m "feat(android): Katalogstatus in Einstellungen und Erststart-Banner

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Abnahme am Gerät (Controller mit dem Nutzer, kein Agent)

Nach Task 10, vor dem Merge:
1. Desktop: Einstellungen › Daten › `Katalog jetzt bauen`. Erwartung: Erfolgszeile mit Version 1 und einer Größe unter 8 MB.
2. Handy: App starten, Einstellungen › Katalog. Erwartung: lädt im WLAN, danach `Aktuell` mit realistischer Kartenzahl (~14.000).
3. Flugmodus an, eine bekannte Karte scannen. Erwartung: Name und Printings sofort, ohne Netz.
4. Eine Karte aus einem brandneuen Set scannen. Erwartung: Netzweg oder roter Eintrag, kein Absturz.

## Spec-Abdeckung (Selbstprüfung)

| Spec-D-Abschnitt | Task |
|---|---|
| §5.1 Katalogschema | 1 |
| §5.2 Bau, Upload, `catalog_versions`, Modelllieferung | 1, 2, 3, 4 |
| §5.3 Handy: SQLite, Repository, Update-Regel, Modelle, Banner | 5, 6, 7, 8, 10 |
| §5.3 Netz-Fallback in Scan/Suche/Detail | 9 |
| §10 Fehlerfälle | 3 (Desktop), 7 (Download/Prüfsumme), 9 (nicht im Katalog) |
| §11 Tests: Katalog-Builder, `CatalogDb` | 1, 6 |

**Bewusste Abweichungen (im Ledger festhalten):**
1. **Bilder bleiben online.** Spec §5.3 nennt Prefetch der eigenen Sammlungsbilder ausdrücklich als späteres Nice-to-have; der Coil-Cache bleibt wie er ist.
2. **`CatalogParser` ist von `CatalogDb` getrennt**, weil `SQLiteOpenHelper` in einem JVM-Unittest nicht läuft und Robolectric eine neue Abhängigkeit wäre. Die Parserlogik ist damit schnell testbar, der SQLite-Pfad über einen Instrumentationstest abgedeckt.
3. **Kein Test für `CatalogSync`** (Task 7): der Task ist fast vollständig Netz- und Plattformanbindung; ein Test würde die Mocks prüfen, nicht das Verhalten. Abgedeckt durch die Abnahme am Gerät.
4. **Der Desktop nutzt den Katalog nicht** — er bleibt bei `api_cache`. Steht so in Spec §3 (Nicht-Ziele).
