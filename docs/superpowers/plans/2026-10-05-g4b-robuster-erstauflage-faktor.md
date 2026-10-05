# G4b Robuster Erste-Auflage-Faktor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Cardmarket-Aufschlagsfaktor der Ersten Auflage (`cards.cm_first_ed_factor`) wird aus dem Median der günstigsten vergleichbaren Angebote (gleiche Sprache, Zustand EX+) „1. Auflage" gegen „nicht 1. Auflage" berechnet statt aus zwei Ab-Preis-Minima; bei < 3 Angeboten je Seite gibt es keinen Faktor, Obergrenze 10.

**Architecture:** Reine, getestete Helfer in `desktop/electron/cardmarket-parse.cjs` (Sprachtabelle, URL, Angebots-Parser, robuster Wert, Faktor). `desktop/electron/cardmarket-scraper.cjs` liest statt des Infokastens die Angebotstabelle (`OFFERS_JS`, reine DOM-Extraktion) auf zwei gefilterten Produktseiten (`isFirstEd=N` / `Y`). Eine einmalige Migration setzt die 1st-Ed-Zeitstempel zurück, damit alle Faktoren neu berechnet werden. Trigger, Sync, Bewertung, Cloud und Handy bleiben unverändert.

**Tech Stack:** Electron (main process, CommonJS `.cjs`), better-sqlite3, `node:test` unter `ELECTRON_RUN_AS_NODE=1`.

**Spec:** `docs/superpowers/specs/2026-10-05-spec-g-nachtrag-g4b-robuster-erstauflage-faktor.md` (Nachtrag zu `docs/superpowers/specs/2026-09-15-spec-g-nachtrag-g4-erste-auflage-preis.md`)

## Global Constraints

- Main-Prozess-Dateien bleiben CommonJS (`.cjs`); nicht nach ESM umbauen.
- Mindestens **3** passende Angebote je Seite; robuster Wert = Median der bis zu **5** günstigsten.
- Zustand **MT, NM, EX** zählen; alles andere nicht.
- Faktor = `clamp(round4(robustY / robustN), 1, 10)`; sonst `NULL`.
- `price_first_ed` schreibt **nur** der bestehende Trigger — nie aus Anwendungscode.
- Seitenzahl pro Kandidat bleibt 3 (Versionen, N, Y); Drossel und Poller-Grenze (2) unverändert.
- Kein SQL einspielen, keine Edge Function, keine APK. Installer nicht aus einem Junction-Worktree bauen.
- Agents rufen keine Edge Functions auf. Agents legen keine eigenen Worktrees an.
- Kommentare und UI-Texte auf Deutsch, Stil wie die umgebenden G4-Kommentare (`// Spec G4b §n: …`).
- Lint: `npm run lint` hat **5** bekannte Altfehler; keine neuen.
- Testlauf (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/<datei>.test.cjs`

## Review Focus

1. **Markup-Bruch auf Cardmarket** (Angebotstabelle nicht gefunden) darf vorhandene Faktoren nicht auf NULL setzen → Faktor unverändert, nur Zeitstempel, `errors++` (Test in Task 3).
2. **URL-Filter wird still ignoriert** (Cardmarket liefert trotz `language=3` englische oder PO-Angebote) → der Parser filtert Sprache und Zustand trotzdem selbst (Test in Task 2).
3. **Preisformate** „1.234,56 €", „0,15 €", „58 €" und unlesbare Preise in Angebotszeilen → korrekt bzw. Zeile verworfen (Test in Task 2).
4. **Echte leere Liste** (Tabelle vorhanden, 0 Angebote, seltener Druck) → Faktor NULL + Zeitstempel, kein Dauerfehler, der die Poller-Plätze blockiert (Test in Task 3).
5. **Migration läuft genau einmal** und löscht keine Faktoren (zweiter Start ändert nichts; Test in Task 4).

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/cm-messung.cjs` (Create, untracked) | Wegwerf-Messwerkzeug: lädt Produktseiten im sichtbaren Electron-Fenster, speichert HTML und `OFFERS_JS`-Ausgabe | 1 |
| `docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/messung.md` (Create, untracked) | Messergebnis: Selektoren, Sprach-Ids, Filterwirkung, leere Seite | 1 |
| `desktop/electron/fixtures/cm-offers-*.json` (Create) | `OFFERS_JS`-Ausgaben als Test-Fixtures | 1 |
| `desktop/electron/cardmarket-parse.cjs` (Modify) | `CM_LANGUAGES`, `offersUrl`, `parseOffers`, `robustLow`, `robustFactor`; alte `firstEdUrl`/`parseFromPrice`/`firstEdFactor` entfernen | 2, 3 |
| `desktop/electron/cardmarket-parse.test.cjs` (Modify) | Tests der reinen Helfer | 2, 3 |
| `desktop/electron/cardmarket-scraper.cjs` (Modify) | `OFFERS_JS`, `runFirstEdPass` neu, Kandidaten-Sprachfilter; `INFO_PAIRS_JS` entfernen | 3 |
| `desktop/electron/cardmarket-first-ed.test.cjs` (Modify) | Durchgang mit gestubbtem Fenster, Kandidaten | 3 |
| `desktop/electron/copies-schema.cjs` (Modify) | `resetFirstEdFactorsOnce(db)` | 4 |
| `desktop/electron/database.cjs` (Modify) | Aufruf der Migration | 4 |
| `desktop/electron/copies-schema.test.cjs` (Modify) | Migrationstest | 4 |

---

### Task 1: Messversuch auf Cardmarket (Controller + Nutzer, kein Subagent)

Dieser Task braucht den Nutzer (Cloudflare-Prüfung im sichtbaren Fenster) und wird vom Controller selbst ausgeführt. Er schreibt keinen Produktcode.

**Files:**
- Create: `docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/cm-messung.cjs`
- Create: `docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/messung.md`
- Create: `desktop/electron/fixtures/cm-offers-sdj-g001-N.json`, `cm-offers-sdj-g001-Y.json`, `cm-offers-mamo-de020-N.json`, `cm-offers-mamo-de020-Y.json`, `cm-offers-leer.json`

**Interfaces:**
- Produces: endgültiges `OFFERS_JS` (Rückgabe `{ found: boolean, rows: [{ priceText: string, condition: string, labels: string[] }] }`), bestätigte Cardmarket-Sprach-Ids für DE und EN, bestätigt `minCondition=3` = EX oder besser, Fixtures für Task 2 und 3.

- [ ] **Step 1: Produkt-URLs vom Nutzer holen**

Den Nutzer bitten, auf cardmarket.com (englische Seite, `/en/`) die Produktseiten von Red-Eyes Black Dragon **SDJ-G001** (Ultra Rare) und **MAMO-DE020** (Ultra Rare, „Maze of Memories") zu öffnen und die beiden URLs ohne Query in den Chat zu kopieren.

- [ ] **Step 2: Messwerkzeug anlegen**

```js
// cm-messung.cjs — Wegwerf-Werkzeug fuer Spec G4b Task 1 (nicht eingecheckt).
// Start in desktop/:  npx electron ../docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/cm-messung.cjs <slug>=<produkt-url> ...
// Beispiel:           ... sdj-g001=https://www.cardmarket.com/en/YuGiOh/Products/Singles/... mamo-de020=https://...
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const FIX = path.join(__dirname, '../../../../desktop/electron/fixtures');

// Entwurf — nach der Messung die tatsaechlich passenden Selektoren eintragen und 1:1 nach Task 3 uebernehmen.
const OFFERS_JS = `(() => {
  const table = document.querySelector('.article-table, #table .table-body, #table');
  const rows = [];
  if (table) table.querySelectorAll('.article-row').forEach(r => {
    const priceEl = r.querySelector('.price-container .color-primary, .price-container span, .price-container');
    const condEl = r.querySelector('.article-condition .badge, .article-condition');
    const labels = [...r.querySelectorAll('.product-attributes [aria-label], .product-attributes [data-bs-original-title], .product-attributes [data-original-title], .product-attributes [title]')]
      .map(e => e.getAttribute('aria-label') || e.getAttribute('data-bs-original-title') || e.getAttribute('data-original-title') || e.getAttribute('title') || '')
      .filter(Boolean);
    rows.push({ priceText: (priceEl && priceEl.textContent || '').trim(), condition: (condEl && condEl.textContent || '').trim(), labels });
  });
  return { found: !!table, rows };
})()`;

const challenged = (t) => /just a moment|attention required|nur einen moment/i.test(t || '');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function load(win, url) {
  await win.loadURL(url);
  for (let i = 0; i < 60; i++) {           // bis ~2 min: Nutzer loest die Pruefung im Fenster
    if (!challenged(win.webContents.getTitle())) return true;
    await wait(2000);
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1200, height: 900, webPreferences: { session: session.fromPartition('persist:cm-messung'), sandbox: true } });
  const variants = [
    ['N', '?isFirstEd=N&language=3&minCondition=3'],
    ['Y', '?isFirstEd=Y&language=3&minCondition=3'],
    ['N-ohne-filter', '?isFirstEd=N'],
    ['Y-ohne-filter', '?isFirstEd=Y'],
    ['N-EN', '?isFirstEd=N&language=1&minCondition=3'],
    ['Y-IT', '?isFirstEd=Y&language=5&minCondition=1'],   // vermutlich leer -> zeigt die leere Tabelle
  ];
  for (const arg of process.argv.slice(2).filter(a => a.includes('='))) {
    const [slug, product] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
    for (const [tag, q] of variants) {
      const ok = await load(win, product + q);
      const html = ok ? await win.webContents.executeJavaScript('document.documentElement.outerHTML') : '';
      const offers = ok ? await win.webContents.executeJavaScript(OFFERS_JS).catch(e => ({ error: String(e) })) : null;
      fs.writeFileSync(path.join(OUT, `${slug}-${tag}.html`), html);
      fs.writeFileSync(path.join(OUT, `${slug}-${tag}.json`), JSON.stringify({ url: product + q, ok, offers }, null, 2));
      console.log(slug, tag, ok, offers && offers.rows ? offers.rows.length : offers);
      await wait(3000 + Math.random() * 2000);   // hoefliche Pause wie der Scraper
    }
  }
  app.quit();
});
```

- [ ] **Step 3: Messung laufen lassen**

Run (in `desktop/`): `npx electron ../docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/cm-messung.cjs sdj-g001=<URL1> mamo-de020=<URL2>`
Erwartet: ein sichtbares Fenster, bei einer Cloudflare-Prüfung klickt der Nutzer sie weg; je Variante eine Konsolenzeile `slug tag true <Zeilenzahl>`.

- [ ] **Step 4: Auswerten und Selektoren festziehen**

Im gespeicherten HTML (`sdj-g001-N.html`) die Angebotszeilen ansehen und prüfen:
1. Liefert `OFFERS_JS` für jede sichtbare Angebotszeile genau einen Eintrag mit Preis-Text („8,50 €"), Zustand („NM", „EX", …) und einer Sprachbezeichnung in `labels` („German"/„Deutsch")? Wenn nicht: Selektoren in `OFFERS_JS` anpassen, Step 3 wiederholen.
2. `language=3` → nur deutsche Angebote? `language=1` → nur englische? (Sprach-Ids DE = 3, EN = 1 bestätigen oder korrigieren.)
3. `minCondition=3` → nur MT/NM/EX?
4. `isFirstEd=Y` → nur Erste Auflage (Vergleich mit `Y-ohne-filter`)?
5. Sortierung Preis aufsteigend?
6. Leere Variante (`Y-IT` oder eine andere leere): ist `found` dort `true` (Tabelle vorhanden, nur ohne Zeilen)? Falls `found` bei einer leeren Liste `false` ist, `OFFERS_JS` so ändern, dass `found` den Behälter der Angebotsliste prüft, der auch bei 0 Treffern im DOM steht (z. B. den Tabellen-Kopf oder die „Keine Artikel"-Meldung), und Step 3 wiederholen.

**Abbruchkriterium (Spec §3):** Lassen sich die Angebotszeilen nicht auslesen (z. B. nur per Nachladen), Task abbrechen und den Nutzer neu entscheiden lassen.

- [ ] **Step 5: Ergebnis festhalten**

`messung.md` mit: endgültigem `OFFERS_JS` (vollständig), Sprach-Ids (mindestens DE und EN gemessen; FR 2, ES 4, IT 5 als „nicht gemessen, aus Cardmarket-Konvention" markieren, falls nicht geprüft), Wirkung von `minCondition`, Zeilenzahl je Variante, und den von Hand ausgerechneten robusten Werten (Median der 5 günstigsten DE/EX+) für N und Y beider Karten samt Faktor.

Die JSON-Ausgaben (nur der `offers`-Teil) kopieren:
- `sdj-g001-N.json` → `desktop/electron/fixtures/cm-offers-sdj-g001-N.json`
- `sdj-g001-Y.json` → `desktop/electron/fixtures/cm-offers-sdj-g001-Y.json`
- `mamo-de020-N.json` → `desktop/electron/fixtures/cm-offers-mamo-de020-N.json`
- `mamo-de020-Y.json` → `desktop/electron/fixtures/cm-offers-mamo-de020-Y.json`
- leere Variante → `desktop/electron/fixtures/cm-offers-leer.json`

Jede Fixture hat die Form `{ "found": true, "rows": [ { "priceText": "...", "condition": "...", "labels": ["..."] } ] }`. Prüfen, dass keine Verkäufernamen enthalten sind.

- [ ] **Step 6: Commit (nur Fixtures)**

```bash
rtk git add desktop/electron/fixtures/cm-offers-*.json
rtk git commit -m "test(g4b): Cardmarket-Angebotslisten als Fixtures (Messversuch)"
```

---

### Task 2: Reine Helfer in `cardmarket-parse.cjs`

**Files:**
- Modify: `desktop/electron/cardmarket-parse.cjs:97-122`
- Test: `desktop/electron/cardmarket-parse.test.cjs`

**Interfaces:**
- Consumes: Fixtures aus Task 1; Sprach-Ids aus `messung.md` (falls DE ≠ 3 oder EN ≠ 1 gemessen wurde, die gemessenen Werte in `CM_LANGUAGES` eintragen und die Erwartungen in den Tests entsprechend anpassen).
- Produces:
  - `CM_LANGUAGES: { [code: string]: { id: number, names: string[] } }` (Codes `EN`, `FR`, `DE`, `ES`, `IT`)
  - `GOOD_CONDITIONS: string[]` = `['MT','NM','EX']`
  - `FIRST_ED_FACTOR_MAX: number` = `10`
  - `offersUrl(product: string, firstEd: boolean, language: string) -> string`
  - `parseOffers(rows: {priceText, condition, labels}[]) -> { price: number, condition: string, language: string|null }[]`
  - `robustLow(offers, { language: string, minCount = 3, take = 5 }) -> number|null`
  - `robustFactor(base: number|null, first: number|null) -> { factor: number|null, capped: boolean, raw: number|null }`
  - `firstEdUrl` und `parseFromPrice` bleiben in diesem Task noch exportiert (der Scraper nutzt sie bis Task 3).

- [ ] **Step 1: Failing tests schreiben**

In `cardmarket-parse.test.cjs` den Import in Zeile 4 ersetzen:

```js
const { normRarity, normName, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor,
  CM_LANGUAGES, offersUrl, parseOffers, robustLow, FIRST_ED_FACTOR_MAX } = require('./cardmarket-parse.cjs');
const path = require('path');
const fixture = (name) => require(path.join(__dirname, 'fixtures', name));
```

Nach dem bestehenden Test `firstEdFactor: Untergrenze 1, 4 Stellen, fromAll 0/NULL, fromFirst NULL` (Zeilen 97–105; bleibt bis Task 3 stehen, weil der Scraper die alte Funktion noch nutzt) einfügen:

```js
test('robustFactor (G4b): Untergrenze 1, Obergrenze 10, 4 Stellen, fehlende Seite -> NULL', () => {
  assert.deepStrictEqual(robustFactor(55, 58), { factor: 1.0545, capped: false, raw: 1.0545 });
  assert.deepStrictEqual(robustFactor(3, 4), { factor: 1.3333, capped: false, raw: 1.3333 });
  assert.deepStrictEqual(robustFactor(58, 55), { factor: 1, capped: false, raw: 0.9483 }, 'Ausreisser nach unten -> 1');
  assert.deepStrictEqual(robustFactor(8, 80), { factor: 10, capped: false, raw: 10 }, 'genau 10 ist nicht gekappt');
  assert.deepStrictEqual(robustFactor(8.09, 76.86), { factor: 9.5006, capped: false, raw: 9.5006 });
  assert.deepStrictEqual(robustFactor(2, 50), { factor: FIRST_ED_FACTOR_MAX, capped: true, raw: 25 });
  assert.deepStrictEqual(robustFactor(null, 58), { factor: null, capped: false, raw: null });
  assert.deepStrictEqual(robustFactor(0, 58), { factor: null, capped: false, raw: null });
  assert.deepStrictEqual(robustFactor(55, null), { factor: null, capped: false, raw: null });
});
```

Am Dateiende anfügen:

```js
test('offersUrl: isFirstEd Y/N, Sprache und Mindestzustand EX', () => {
  const P = 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y';
  assert.equal(offersUrl(P, true, 'DE'), `${P}?isFirstEd=Y&language=${CM_LANGUAGES.DE.id}&minCondition=3`);
  assert.equal(offersUrl(P, false, 'EN'), `${P}?isFirstEd=N&language=${CM_LANGUAGES.EN.id}&minCondition=3`);
  assert.equal(offersUrl(P, false, 'KR'), `${P}?isFirstEd=N&minCondition=3`, 'Sprache ohne Cardmarket-Id -> kein Sprachparameter');
});

test('parseOffers: Preisformate, Zustand normalisiert, Sprache aus den Labels, unlesbarer Preis faellt weg', () => {
  const rows = [
    { priceText: '1.234,56 €', condition: 'nm', labels: ['German'] },
    { priceText: '0,15 €', condition: 'EX', labels: ['Deutsch', 'First Edition'] },
    { priceText: '58 €', condition: 'MT', labels: ['English'] },
    { priceText: 'N/A', condition: 'NM', labels: ['German'] },
    { priceText: '3,00 €', condition: 'NM', labels: ['Klingon'] },
  ];
  assert.deepStrictEqual(parseOffers(rows), [
    { price: 1234.56, condition: 'NM', language: 'DE' },
    { price: 0.15, condition: 'EX', language: 'DE' },
    { price: 58, condition: 'MT', language: 'EN' },
    { price: 3, condition: 'NM', language: null },
  ]);
  assert.deepStrictEqual(parseOffers(null), []);
});

const de = (price, condition = 'NM') => ({ price, condition, language: 'DE' });

test('robustLow: unter 3 Angeboten null, genau 3, gerade Anzahl, nur die 5 guenstigsten', () => {
  assert.equal(robustLow([], { language: 'DE' }), null);
  assert.equal(robustLow([de(1), de(2)], { language: 'DE' }), null);
  assert.equal(robustLow([de(3), de(1), de(2)], { language: 'DE' }), 2);
  assert.equal(robustLow([de(4), de(1), de(2), de(3)], { language: 'DE' }), 2.5);
  assert.equal(robustLow([de(1), de(2), de(3), de(4), de(5), de(100), de(200)], { language: 'DE' }), 3);
});

test('robustLow: Ausreisser unten/oben verschieben den Wert nicht', () => {
  assert.equal(robustLow([de(0.5), de(8), de(8.5), de(9), de(9.5)], { language: 'DE' }), 8.5);
  assert.equal(robustLow([de(8), de(8.5), de(9), de(9.5), de(500)], { language: 'DE' }), 9);
});

test('robustLow: filtert Sprache und Zustand selbst (falls Cardmarket den URL-Filter ignoriert)', () => {
  const offers = [de(1, 'PO'), de(1, 'LP'), de(2, 'GD'), { price: 1, condition: 'NM', language: 'EN' },
    { price: 1, condition: 'NM', language: null }, de(5), de(6, 'EX'), de(7, 'MT')];
  assert.equal(robustLow(offers, { language: 'DE' }), 6);
  assert.equal(robustLow(offers, { language: 'EN' }), null);
});

test('robustLow + robustFactor auf den Mess-Fixtures: plausibel und nie ueber 10', () => {
  for (const card of ['sdj-g001', 'mamo-de020']) {
    const n = robustLow(parseOffers(fixture(`cm-offers-${card}-N.json`).rows), { language: 'DE' });
    const y = robustLow(parseOffers(fixture(`cm-offers-${card}-Y.json`).rows), { language: 'DE' });
    const { factor } = robustFactor(n, y);
    assert.ok(factor === null || (factor >= 1 && factor <= 10), `${card}: ${factor}`);
  }
  assert.equal(robustLow(parseOffers(fixture('cm-offers-leer.json').rows), { language: 'DE' }), null);
});
```

Zusätzlich je Karte die in `messung.md` von Hand ausgerechneten Werte als genaue Erwartung eintragen, z. B. (Zahlen aus `messung.md` übernehmen):

```js
test('Mess-Fixtures: Werte wie von Hand in messung.md ausgerechnet', () => {
  const r = (f) => robustLow(parseOffers(fixture(f).rows), { language: 'DE' });
  assert.equal(r('cm-offers-mamo-de020-N.json'), /* Wert aus messung.md */ MAMO_N);
  assert.equal(r('cm-offers-mamo-de020-Y.json'), /* Wert aus messung.md */ MAMO_Y);
  assert.equal(r('cm-offers-sdj-g001-N.json'), /* Wert aus messung.md */ SDJ_N);
  assert.equal(r('cm-offers-sdj-g001-Y.json'), /* Wert aus messung.md */ SDJ_Y);
});
```

Die Konstanten `MAMO_N`, `MAMO_Y`, `SDJ_N`, `SDJ_Y` direkt über dem Test als `const` mit den Zahlen aus `messung.md` definieren (`null`, wenn dort „< 3 Angebote" steht).

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-parse.test.cjs`
Expected: FAIL — `offersUrl is not a function` / `robustFactor is not a function`.

- [ ] **Step 3: Implementierung**

In `cardmarket-parse.cjs` die `module.exports`-Zeile (122) ersetzen durch (der alte `firstEdFactor` darüber bleibt bis Task 3):

```js
// Spec G4b §4: Sprache des Printings -> Cardmarket-Sprachfilter (?language=<id>) und Bezeichnungen, wie sie in
// den Angebotszeilen stehen (en/de Seite). Sprachen ohne Eintrag (z. B. KR) sind keine 1st-Ed-Kandidaten.
const CM_LANGUAGES = {
  EN: { id: 1, names: ['english', 'englisch'] },
  FR: { id: 2, names: ['french', 'franzosisch', 'franzoesisch'] },
  DE: { id: 3, names: ['german', 'deutsch'] },
  ES: { id: 4, names: ['spanish', 'spanisch'] },
  IT: { id: 5, names: ['italian', 'italienisch'] },
};
const GOOD_CONDITIONS = ['MT', 'NM', 'EX'];
const FIRST_ED_FACTOR_MAX = 10;

const normLabel = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
function languageOf(labels) {
  for (const l of labels || []) {
    const n = normLabel(l);
    for (const [code, { names }] of Object.entries(CM_LANGUAGES)) if (names.includes(n)) return code;
  }
  return null;
}

// Produktseite mit Angebotsfilter: Erste Auflage ja/nein, Sprache des Printings, Zustand EX oder besser
// (minCondition=3: MT 1, NM 2, EX 3). Der Parser filtert trotzdem selbst nach — falls Cardmarket einen
// Parameter still ignoriert.
function offersUrl(product, firstEd, language) {
  const lang = CM_LANGUAGES[language];
  return `${product}?isFirstEd=${firstEd ? 'Y' : 'N'}${lang ? `&language=${lang.id}` : ''}&minCondition=3`;
}

// Rohe Angebotszeilen aus OFFERS_JS -> { price, condition, language }; Zeilen ohne lesbaren Preis fallen weg.
function parseOffers(rows) {
  const out = [];
  for (const r of rows || []) {
    const price = parseEuro(r && r.priceText);
    if (!(price > 0)) continue;
    out.push({ price, condition: String(r.condition || '').trim().toUpperCase(), language: languageOf(r.labels) });
  }
  return out;
}

// Spec G4b §4: Median der bis zu `take` guenstigsten passenden Angebote (Sprache, Zustand EX+); unter
// `minCount` passenden Angeboten null. Ein einzelner Ausreisser nach unten oder oben verschiebt den Wert nicht.
function robustLow(offers, { language, minCount = 3, take = 5 } = {}) {
  const prices = (offers || [])
    .filter(o => o.language === language && GOOD_CONDITIONS.includes(o.condition) && o.price > 0)
    .map(o => o.price)
    .sort((a, b) => a - b);
  if (prices.length < minCount) return null;
  const low = prices.slice(0, take);
  const mid = Math.floor(low.length / 2);
  return low.length % 2 ? low[mid] : (low[mid - 1] + low[mid]) / 2;
}

// Spec G4b §4: factor = clamp(round4(first / base), 1, 10); fehlt eine Seite (zu wenige Angebote) -> null.
// `raw` und `capped` nur fuer die Log-Zeile bei gekappten Werten.
function robustFactor(base, first) {
  if (!(Number(base) > 0) || !(Number(first) > 0)) return { factor: null, capped: false, raw: null };
  const raw = Math.round((Number(first) / Number(base)) * 10000) / 10000;
  return { factor: Math.min(FIRST_ED_FACTOR_MAX, Math.max(1, raw)), capped: raw > FIRST_ED_FACTOR_MAX, raw };
}

module.exports = { normRarity, normName, rarityKey, rarityRank, RARITY_SYNONYMS, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice,
  firstEdFactor, CM_LANGUAGES, GOOD_CONDITIONS, FIRST_ED_FACTOR_MAX, offersUrl, parseOffers, robustLow, robustFactor };
```

(Hinweis: `'Französisch'` wird durch `normLabel` zu `franzosisch` — deshalb steht diese Form in `names`.)

- [ ] **Step 4: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-parse.test.cjs`
Expected: PASS (alle Tests, auch die bestehenden).

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-first-ed.test.cjs`
Expected: PASS (unverändert — der Scraper nutzt noch die alten Helfer).

- [ ] **Step 5: Commit**

```bash
rtk git add desktop/electron/cardmarket-parse.cjs desktop/electron/cardmarket-parse.test.cjs
rtk git commit -m "feat(g4b): robuste Helfer fuer den 1st-Ed-Faktor (Angebote, Median, Grenzen)"
```

---

### Task 3: Scraper-Durchgang auf Angebotslisten umstellen

**Files:**
- Modify: `desktop/electron/cardmarket-scraper.cjs:8` (Import), `:64-75` (`INFO_PAIRS_JS` → `OFFERS_JS`), `:216-294` (`firstEdCandidates`, `runFirstEdPass`)
- Modify: `desktop/electron/cardmarket-parse.cjs` (`firstEdUrl`, `parseFromPrice` entfernen)
- Modify: `desktop/electron/cardmarket-parse.test.cjs` (Tests zu `firstEdUrl`/`parseFromPrice` entfernen)
- Test: `desktop/electron/cardmarket-first-ed.test.cjs`

**Interfaces:**
- Consumes: `CM_LANGUAGES`, `offersUrl`, `parseOffers`, `robustLow`, `robustFactor` aus Task 2; `OFFERS_JS` endgültig aus `messung.md` (Task 1).
- Produces: `runFirstEdPass(db, opts)` mit unveränderter Signatur und Rückgabe `{ candidates, updated, noOffers, skipped, errors }` (main.cjs bleibt unverändert); `deps.readOffers(win) -> Promise<{ found: boolean, rows: [] }>` ersetzt `deps.readInfoPairs`.

- [ ] **Step 1: Failing tests schreiben**

In `cardmarket-first-ed.test.cjs`:

(a) Der `printing`-Helfer bekommt einen Sprachparameter. Zeilen 20–26 ersetzen:

```js
function printing(db, { id, set_code, rarity, name = 'Test Card', price = 10, locked = 0, pid = null, ts = null, language = 'DE' }, copies) {
  db.prepare(`INSERT INTO cards (id, name, set_code, language, rarity, price, price_locked, cm_product_id, cm_first_ed_updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, set_code, language, rarity, price, locked, pid, ts);
  const P = { id, set_code, language, rarity };
  for (const c of copies) addCopies(db, P, { edition: c.edition, condition: 'NM', count: 1 });
  return P;
}
```

(b) Nach dem Test `Kandidaten: set_code Unknown ist nie Kandidat` einfügen:

```js
test('Kandidaten (G4b): Sprachen ohne Cardmarket-Filter (KR, JP) sind keine Kandidaten', () => {
  const db = candidateDb();
  printing(db, { id: '9', set_code: 'RC04-KR001', rarity: 'Ultra Rare', language: 'KR' }, [{ edition: 'first' }]);
  printing(db, { id: '10', set_code: 'LOB-JP001', rarity: 'Ultra Rare', language: 'JP' }, [{ edition: 'first' }]);
  printing(db, { id: '11', set_code: 'LOB-EN001', rarity: 'Ultra Rare', language: 'EN' }, [{ edition: 'first' }]);
  assert.deepEqual(ids(firstEdCandidates(db, { minRank: 4, nowMs: NOW })), ['1', '11', '7']);
});
```

(Reihenfolge: `cm_first_ed_updated_at` NULL zuerst, dann nach `id` als Text — `'1' < '11' < '7'`.)

(c) Den Block ab `// --- Durchgang mit gestubbtem Fenster ---` (Zeile 67) bis Dateiende **ersetzen** durch:

```js
// --- Durchgang mit gestubbtem Fenster (Spec G4b: Angebotslisten N/Y statt Ab-Preis) ---
const { offersUrl } = require('./cardmarket-parse.cjs');
const VERSIONS = 'https://www.cardmarket.com/en/YuGiOh/Cards/Test-Card/Versions';
const PRODUCT = 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare';
const PAGE_N = offersUrl(PRODUCT, false, 'DE');
const PAGE_Y = offersUrl(PRODUCT, true, 'DE');
const ROWS = [{ expansion: 'Maze of Memories', code: 'MAMO', rarity: '', trend: 55, imgSrc: '', href: '/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare' }];
const offer = (eur, condition = 'NM', lang = 'German') => ({ priceText: `${eur.toFixed(2).replace('.', ',')} €`, condition, labels: [lang] });
const table = (...eurs) => ({ found: true, rows: eurs.map((e) => offer(e)) });

function stub(pages, { challenge = [] } = {}) {
  const visited = [];
  return {
    visited,
    deps: {
      makeWindow: async () => ({ url: null, destroy() {} }),
      loadPage: async (win, url) => { visited.push(url); win.url = url; return !challenge.includes(url); },
      readRows: async (win) => (pages[win.url] && pages[win.url].rows) || [],
      readOffers: async (win) => (pages[win.url] && pages[win.url].offers) || { found: false, rows: [] },
      sleep: async () => {},
      setNameFor: async () => null,
      cardName: async (c) => c.name,
    },
  };
}
const MAMO = (db) => db.prepare("SELECT price_first_ed AS pfe, cm_first_ed_factor AS f, cm_first_ed_updated_at AS ts FROM cards WHERE id = 'm'").get();
const mamoDb = () => {
  const db = freshDb();
  printing(db, { id: 'm', set_code: 'MAMO-DE020', rarity: 'Ultra Rare', price: 73.85 }, [{ edition: 'first' }]);
  return db;
};

test('Durchgang: Median der guenstigsten N/Y -> Faktor, Trigger setzt price_first_ed, keine price_history', async () => {
  const db = mamoDb();
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PAGE_N]: { offers: table(20, 54, 55, 56, 57, 90) },   // Median der 5 guenstigsten = 55; Billig-Ausreisser 20 egal
    [PAGE_Y]: { offers: table(57, 58, 59, 300) },          // 4 Angebote -> Mittel aus 58 und 59 = 58,5
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PAGE_N, PAGE_Y]);
  assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, skipped: out.skipped, errors: out.errors }, { updated: 1, noOffers: 0, skipped: 0, errors: 0 });
  const r = MAMO(db);
  assert.equal(r.f, 1.0636);
  assert.equal(r.pfe, 78.55);
  assert.ok(r.ts);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM price_history').get().n, 0);
});

test('Durchgang: weniger als 3 passende 1st-Ed-Angebote -> Faktor NULL, Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PAGE_N]: { offers: table(54, 55, 56) },
    [PAGE_Y]: { offers: { found: true, rows: [offer(500), offer(510), offer(1, 'PO'), offer(2, 'NM', 'English')] } },
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.equal(out.updated, 1);
  assert.equal(out.noOffers, 1);
  assert.deepEqual({ f: MAMO(db).f, pfe: MAMO(db).pfe }, { f: null, pfe: null });
  assert.ok(MAMO(db).ts);
});

test('Durchgang: Tabelle vorhanden, aber leer (seltener Druck) -> Faktor NULL + Zeitstempel, kein Fehler', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: { found: true, rows: [] } }, [PAGE_Y]: { offers: { found: true, rows: [] } } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, errors: out.errors }, { updated: 1, noOffers: 1, errors: 0 });
  assert.equal(MAMO(db).f, null);
  assert.ok(MAMO(db).ts);
});

test('Durchgang: Angebotstabelle fehlt (Markup geaendert) -> Faktor bleibt, nur Zeitstempel, errors++', async () => {
  for (const missing of ['N', 'Y']) {
    const db = mamoDb();
    db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
    const s = stub({
      [VERSIONS]: { rows: ROWS },
      [PAGE_N]: { offers: missing === 'N' ? { found: false, rows: [] } : table(54, 55, 56) },
      [PAGE_Y]: { offers: missing === 'Y' ? { found: false, rows: [] } : table(57, 58, 59) },
    });
    const out = await runFirstEdPass(db, { force: true, deps: s.deps });
    assert.deepEqual({ updated: out.updated, errors: out.errors }, { updated: 0, errors: 1 }, missing);
    const r = MAMO(db);
    assert.equal(r.f, 1.2, `${missing}: Faktor unveraendert`);
    assert.equal(r.pfe, 88.62);
    assert.ok(r.ts, `${missing}: Zeitstempel gesetzt, Kandidat blockiert den Poller nicht`);
  }
});

test('Durchgang: Verhaeltnis ueber 10 wird auf 10 gekappt', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: table(1, 1, 1) }, [PAGE_Y]: { offers: table(50, 50, 50) } });
  await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.equal(MAMO(db).f, 10);
  assert.equal(MAMO(db).pfe, 738.5);
});

test('Durchgang: Cloudflare-Pruefung auf Seite N -> nichts geschrieben, Y nicht geladen', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS } }, { challenge: [PAGE_N] });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PAGE_N]);
  assert.deepEqual({ updated: out.updated, skipped: out.skipped }, { updated: 0, skipped: 1 });
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: Cloudflare-Pruefung auf Seite Y -> nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: table(54, 55, 56) } }, { challenge: [PAGE_Y] });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PAGE_N, PAGE_Y]);
  assert.equal(out.skipped, 1);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: kein Produkt-Link oder keine Zeile -> nur Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: [{ ...ROWS[0], href: '' }] } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS]);
  assert.equal(out.skipped, 1);
  const r = MAMO(db);
  assert.equal(r.f, null);
  assert.ok(r.ts);
});

test('Durchgang: englisches Printing filtert mit language=EN', async () => {
  const db = freshDb();
  printing(db, { id: 'e', set_code: 'MAMO-EN020', rarity: 'Ultra Rare', price: 50, language: 'EN' }, [{ edition: 'first' }]);
  const N = offersUrl(PRODUCT, false, 'EN'), Y = offersUrl(PRODUCT, true, 'EN');
  const en = (...eurs) => ({ found: true, rows: eurs.map((e) => offer(e, 'NM', 'English')) });
  const s = stub({ [VERSIONS]: { rows: ROWS }, [N]: { offers: en(40, 40, 40) }, [Y]: { offers: en(60, 60, 60) } });
  await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, N, Y]);
  assert.equal(db.prepare("SELECT cm_first_ed_factor AS f FROM cards WHERE id = 'e'").get().f, 1.5);
});

test('Durchgang: maxCards begrenzt die Kandidaten (Poller 2)', async () => {
  const db = freshDb();
  for (const id of ['a', 'b', 'c']) printing(db, { id, set_code: `MAMO-DE02${id === 'a' ? 0 : id === 'b' ? 1 : 2}`, rarity: 'Ultra Rare' }, [{ edition: 'first' }]);
  const s = stub({});
  const out = await runFirstEdPass(db, { force: true, maxCards: 2, deps: s.deps });
  assert.equal(out.candidates, 2);
  assert.equal(s.visited.length, 2, 'je Kandidat nur die Versions-Seite (ohne Zeilen)');
});

test('Durchgang: bereits abgebrochen vor der Schleife -> kein Fenster, nichts besucht, nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS } });
  let makeWindowCalls = 0;
  const deps = { ...s.deps, makeWindow: async () => { makeWindowCalls++; return { url: null, destroy() {} }; } };
  const out = await runFirstEdPass(db, { force: true, shouldAbort: () => true, deps });
  assert.equal(makeWindowCalls, 0);
  assert.deepEqual(s.visited, []);
  assert.equal(out.updated, 0);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});
```

Rechenkontrolle Treffer-Test: N = Median(20, 54, 55, 56, 57) = 55; Y = (58 + 59) / 2 = 58,5; 58,5 / 55 = 1,06363… → 1,0636; 73,85 × 1,0636 = 78,546… → 78,55. Kappung: 50 / 1 = 50 → 10; 73,85 × 10 = 738,5. Markup-Test: 73,85 × 1,2 = 88,62.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-first-ed.test.cjs`
Expected: FAIL — besucht wird noch `PRODUCT` / `?isFirstEd=Y`, KR/JP sind noch Kandidaten.

- [ ] **Step 3: Implementierung Scraper**

`cardmarket-scraper.cjs` Zeile 8 ersetzen:

```js
const { rarityRank, selectVersionRow, productUrl, CM_LANGUAGES, offersUrl, parseOffers, robustLow, robustFactor } = require('./cardmarket-parse.cjs');
```

Den Kommentarblock direkt vor `INFO_PAIRS_JS` und `INFO_PAIRS_JS` selbst (Zeilen ~64–75) ersetzen durch das **endgültige `OFFERS_JS` aus `messung.md`** mit diesem Kommentar darüber:

```js
// Spec G4b §5: Angebotstabelle der Produktseite (gemessen 2026-10-05, siehe Ledger messung.md). Reine Extraktion
// ohne Logik: je Zeile Preis-Text, Zustand, Attribut-Labels (Sprache, Erste Auflage …). `found` sagt, ob der
// Behaelter der Angebotsliste im DOM steht (auch bei 0 Treffern) — fehlt er, hat Cardmarket das Markup geaendert.
// Die Auswertung macht der reine Parser parseOffers/robustLow in cardmarket-parse.cjs.
const OFFERS_JS = `…`;   // <- Wortlaut aus messung.md
```

`firstEdCandidates`: im `WHERE` nach `AND c.set_code <> 'Unknown'` ergänzen:

```js
       AND c.language IN (${Object.keys(CM_LANGUAGES).map(() => '?').join(', ')})
```

und `.all()` zu `.all(...Object.keys(CM_LANGUAGES))` ändern. Den Kommentar über der Funktion um einen Satz ergänzen: `Spec G4b: nur Sprachen mit Cardmarket-Filter (CM_LANGUAGES); z. B. KR-Preise kommen aus k-tcg.`

Den Kommentarblock über `runFirstEdPass` und die Funktion (Zeilen 236–294) ersetzen durch:

```js
// Spec G4b §5 — zweiter Durchgang: je Kandidat Versions-Seite (Zeile + Produkt-Link), dann die Angebotslisten
// "nicht 1. Auflage" (N) und "1. Auflage" (Y), beide gefiltert auf die Sprache des Printings und Zustand EX+.
// Faktor = Median der guenstigsten passenden Angebote Y ÷ N (robustLow/robustFactor); zu wenige Angebote -> NULL.
// Schreibt nur cm_first_ed_factor + cm_first_ed_updated_at; price_first_ed setzt der Trigger (copies-schema.cjs).
// Keine price_history-Zeile. Bei den deterministischen Fehlschlaegen "keine Versionszeile", "kein Produkt-Link" und
// "Angebotstabelle fehlt" wird NUR der Zeitstempel gesetzt (Faktor unveraendert) — sonst bliebe so ein Kandidat fuer
// immer der aelteste und wuerde die Poller-Plaetze belegen; ein Markup-Bruch setzt so nie still Faktoren auf NULL.
// Bei Cloudflare-Pruefung (loadPage false) und bei Exceptions wird nichts geschrieben, der naechste Lauf versucht es
// wieder. `deps` ersetzt im Test Fenster, Netz und Pausen.
async function runFirstEdPass(db, { minRank = 1, force = false, maxCards = Infinity, headless = false, onChallenge, shouldAbort, onProgress, deps = {} } = {}) {
  const d = {
    makeWindow,
    loadPage,
    readRows: (win) => win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []),
    readOffers: (win) => win.webContents.executeJavaScript(OFFERS_JS).catch(() => ({ found: false, rows: [] })),
    sleep: () => sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS)),
    setNameFor,
    cardName: async (c) => c.name || (await fetchCardData(c.id))?.data?.[0]?.name,
    ...deps,
  };
  const list = firstEdCandidates(db, { minRank, force, nowMs: Date.now(), limit: maxCards });
  const out = { candidates: list.length, updated: 0, noOffers: 0, skipped: 0, errors: 0 };
  if (list.length === 0) return out;
  // Already aborted before the loop starts — never open the hidden window for a run that won't do anything.
  if (shouldAbort && shouldAbort()) return out;
  const write = db.prepare('UPDATE cards SET cm_first_ed_factor = ?, cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?');
  const stamp = db.prepare('UPDATE cards SET cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?');
  const win = await d.makeWindow();
  try {
    for (let i = 0; i < list.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      const p = list[i];
      const key = [String(p.id), p.set_code, p.language, p.rarity];
      onProgress && onProgress({ current: i + 1, total: list.length, name: p.name });
      try {
        const name = await d.cardName(p);
        const versionsUrl = name ? resolveUrl(name) : null;
        if (!versionsUrl || !(await d.loadPage(win, versionsUrl, onChallenge, headless))) { out.skipped++; continue; }
        const hit = await selectVersionRow(await d.readRows(win), p, () => d.setNameFor(p.id, p.set_code));
        const product = hit ? productUrl(hit.href) : null;
        if (!product) { stamp.run(...key); out.skipped++; continue; }
        await d.sleep();
        if (!(await d.loadPage(win, offersUrl(product, false, p.language), onChallenge, headless))) { out.skipped++; continue; }
        const pageN = await d.readOffers(win);
        await d.sleep();
        if (!(await d.loadPage(win, offersUrl(product, true, p.language), onChallenge, headless))) { out.skipped++; continue; }
        const pageY = await d.readOffers(win);
        if (!pageN.found || !pageY.found) {
          stamp.run(...key);
          out.errors++;
          console.warn('[cardmarket] 1st Ed: Angebotstabelle nicht gefunden', p.set_code, p.rarity, { N: pageN.found, Y: pageY.found });
          continue;
        }
        const base = robustLow(parseOffers(pageN.rows), { language: p.language });
        const first = robustLow(parseOffers(pageY.rows), { language: p.language });
        const { factor, capped, raw } = robustFactor(base, first);
        if (capped) console.warn('[cardmarket] 1st Ed: Faktor gekappt', p.set_code, p.rarity, { base, first, raw });
        write.run(factor, ...key);
        out.updated++;
        if (factor == null) out.noOffers++;
      } catch (e) {
        out.errors++;
      } finally {
        await d.sleep();
      }
    }
  } finally { win.destroy(); }
  return out;
}
```

- [ ] **Step 4: Alte Helfer entfernen**

In `cardmarket-parse.cjs`: `const firstEdUrl = …` (Zeile 97), `parseFromPrice` samt Kommentar (Zeilen 106–112) und den alten `firstEdFactor` samt Kommentar (Zeilen 114–120) löschen; alle drei aus `module.exports` entfernen. `parseEuro` bleibt (wird von `parseOffers` genutzt).

In `cardmarket-parse.test.cjs`: `firstEdUrl`, `parseFromPrice` und `firstEdFactor` aus dem Import entfernen; die `firstEdUrl`-Assertion im `productUrl`-Test (Zeile 82), den ganzen Test `parseFromPrice: …` (Zeilen 85–95) und den alten Test `firstEdFactor: Untergrenze 1, 4 Stellen, …` löschen.

Prüfen, dass nichts mehr darauf verweist:

Run (Repo-Wurzel): `grep -rnE "firstEdUrl|parseFromPrice|firstEdFactor|INFO_PAIRS_JS|readInfoPairs" desktop/electron desktop/src`
Expected: keine Treffer.

- [ ] **Step 5: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-first-ed.test.cjs electron/cardmarket-parse.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add desktop/electron/cardmarket-scraper.cjs desktop/electron/cardmarket-parse.cjs desktop/electron/cardmarket-parse.test.cjs desktop/electron/cardmarket-first-ed.test.cjs
rtk git commit -m "feat(g4b): 1st-Ed-Durchgang liest Angebotslisten N/Y statt Ab-Preis; nur Sprachen mit Cardmarket-Filter"
```

---

### Task 4: Einmalige Neuberechnung aller Faktoren

**Files:**
- Modify: `desktop/electron/copies-schema.cjs` (neue Funktion nach `ensureCopiesSchema`, Export Zeile 180)
- Modify: `desktop/electron/database.cjs:294-295` (Aufruf)
- Test: `desktop/electron/copies-schema.test.cjs`

**Interfaces:**
- Produces: `resetFirstEdFactorsOnce(db) -> { reset: number, skipped: boolean }`; Merker `settings.first_ed_factor_v2_reset = '1'`.

- [ ] **Step 1: Failing test schreiben**

Am Ende von `copies-schema.test.cjs` anfügen (oben den Import um `resetFirstEdFactorsOnce` ergänzen, falls dort `require('./copies-schema.cjs')` destrukturiert wird; sonst eigene Zeile):

```js
const { resetFirstEdFactorsOnce } = require('./copies-schema.cjs');

test('G4b: resetFirstEdFactorsOnce setzt die 1st-Ed-Zeitstempel genau einmal zurueck, Faktoren bleiben', () => {
  const Database = require('better-sqlite3');
  const { ensureCopiesSchema } = require('./copies-schema.cjs');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 0, rarity TEXT, set_code TEXT, price REAL,
             language TEXT DEFAULT 'DE', price_locked INTEGER DEFAULT 0, cm_product_id INTEGER,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0,
             PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  db.prepare(`INSERT INTO cards (id, set_code, rarity, price, cm_first_ed_factor, cm_first_ed_updated_at)
              VALUES ('1', 'SDJ-G001', 'Ultra Rare', 8.09, 9.5, '2026-10-04 10:00:00'),
                     ('2', 'MAMO-DE020', 'Ultra Rare', 73.85, NULL, NULL)`).run();

  assert.deepEqual(resetFirstEdFactorsOnce(db), { reset: 1, skipped: false });
  const r = db.prepare("SELECT cm_first_ed_factor AS f, cm_first_ed_updated_at AS ts, price_first_ed AS pfe FROM cards WHERE id = '1'").get();
  assert.deepEqual(r, { f: 9.5, ts: null, pfe: 76.86 }, 'Faktor und 1st-Ed-Preis bleiben bis zur Neuberechnung');

  db.prepare("UPDATE cards SET cm_first_ed_updated_at = '2026-10-05 10:00:00' WHERE id = '1'").run();
  assert.deepEqual(resetFirstEdFactorsOnce(db), { reset: 0, skipped: true });
  assert.equal(db.prepare("SELECT cm_first_ed_updated_at AS ts FROM cards WHERE id = '1'").get().ts, '2026-10-05 10:00:00');
});
```

Falls `copies-schema.test.cjs` `test`/`assert` anders importiert, den Stil der Datei übernehmen.

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs`
Expected: FAIL — `resetFirstEdFactorsOnce is not a function`.

- [ ] **Step 3: Implementierung**

In `copies-schema.cjs` nach `ensureCopiesSchema` (vor `// One-time, desktop-only: …backfillCopies`) einfügen:

```js
// Spec G4b §5: einmalig alle 1st-Ed-Zeitstempel zuruecksetzen, damit der robuste Faktor (Angebots-Median statt
// Ab-Preis) fuer jedes Printing neu berechnet wird. Faktoren bleiben bis dahin stehen (keine Luecke im Gesamtwert).
// Laeuft nach backfill/reconcile in database.cjs, wo settings sicher existiert. Guarded.
function resetFirstEdFactorsOnce(db) {
  if (getSetting(db, 'first_ed_factor_v2_reset') === '1') return { reset: 0, skipped: true };
  let reset = 0;
  db.transaction(() => {
    reset = db.prepare('UPDATE cards SET cm_first_ed_updated_at = NULL WHERE cm_first_ed_updated_at IS NOT NULL').run().changes;
    setSetting(db, 'first_ed_factor_v2_reset', '1');
  })();
  return { reset, skipped: false };
}
```

Export (Zeile 180) ändern zu:

```js
module.exports = { ensureCopiesSchema, backfillCopies, reconcileCopies, resetFirstEdFactorsOnce };
```

In `database.cjs` Zeile 4 den Import ergänzen:

```js
const { ensureCopiesSchema, backfillCopies, reconcileCopies, resetFirstEdFactorsOnce } = require('./copies-schema.cjs');
```

und nach Zeile 295 (`if (!rc.skipped && rc.created > 0) …`) einfügen:

```js
        const fe = resetFirstEdFactorsOnce(db); // Spec G4b: robuster 1st-Ed-Faktor -> alle einmal neu berechnen
        if (!fe.skipped) console.log(`1st-Ed factor reset: ${fe.reset} printing(s) queued for recalculation.`);
```

- [ ] **Step 4: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add desktop/electron/copies-schema.cjs desktop/electron/copies-schema.test.cjs desktop/electron/database.cjs
rtk git commit -m "feat(g4b): einmalige Neuberechnung aller 1st-Ed-Faktoren nach dem Update"
```

---

### Task 5: Gesamtlauf, Installer, Abnahme (Controller + Nutzer)

**Files:** keine neuen. Ledger `docs/superpowers/ledgers/2026-10-05-spec-g4b-robuster-faktor/progress.md` fortschreiben.

- [ ] **Step 1: Alle Tests**

Run (in `desktop/`):
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- `node --test src/utils/*.test.js src/utils/*.test.mjs`
- `node electron/test-sync.cjs`

Expected: alles grün (Bewertungs-, Trigger- und Sync-Tests unverändert).

- [ ] **Step 2: Lint**

Run: `rtk npm run lint`
Expected: genau die 5 bekannten Altfehler.

- [ ] **Step 3: Installer bauen**

Aus dem Hauptordner `desktop/` (nicht aus einem Junction-Worktree): `rtk npm run dist`
Expected: Installer in `desktop/dist-electron/`. Dem Nutzer mit SendUserFile anbieten bzw. den Pfad nennen.

- [ ] **Step 4: Abnahme mit dem Nutzer (Spec §9)**

1. Installer installiert; beim Start erscheint im Log `1st-Ed factor reset: N printing(s) …`.
2. Knopf „Cardmarket" → 1st-Ed-Durchgang läuft durch (bei Cloudflare-Prüfung klickt der Nutzer).
3. **SDJ-G001:** Faktor plausibel (Nutzer vergleicht auf Cardmarket: Angebote Deutsch, EX+, mit/ohne 1. Auflage) oder keine „1st Ed"-Zeile mehr.
4. **MAMO-DE020:** Faktor in der Größenordnung ×1,05.
5. Gesamtwert ändert sich entsprechend; nach dem Sync zeigt das Handy dieselbe Preiszeile.

- [ ] **Step 5: Merge nach Freigabe**

Nur nach ausdrücklicher Freigabe des Nutzers mergen und pushen (superpowers:finishing-a-development-branch).
