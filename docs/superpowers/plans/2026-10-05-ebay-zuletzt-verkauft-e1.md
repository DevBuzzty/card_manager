# eBay „zuletzt verkauft" E1 (Daten) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Je Druck einen eBay-Verkaufswert (Median der passenden Verkäufe der letzten 90 Tage auf EBAY_DE) in der Cloud ermitteln, auf PC und Handy im Karten-Detail anzeigen und auf Knopfdruck neu abrufen — vollständig gebaut und getestet, bevor eBay den Scope `buy.marketplace.insights` freischaltet, und danach ohne Zutun aktiv.

**Architecture:** Neue Edge Function `ebay-sold-prices` (Deno) mit reinen Modulen `match.ts` (Titelfilter) und `summarize.ts` (Wert), einem schmalen Store (`sold-store.ts`, echte + nachgebaute Fassung) und einem Ablauf `run.ts`; eBay-Aufrufe über den vorhandenen `_shared/ebay-client.ts` (um Scope-Parameter, Scope-Erkennung und `searchSold` erweitert). Cloud-Tabellen `ebay_sold_prices` + `ebay_insights_state` plus Kandidaten-RPC in `supabase/ebay_sold_schema.sql`. PC: Nur-Lese-Spiegel über `READ_ONLY_STREAMS` in `sync.cjs`, zwei IPC-Kanäle, Zeile im `CardDetailPanel`. Handy: Abruf je Druck per REST, Zeile im `CardDetailScreen`. Die Anzeigezeile ist ein getesteter JS/Kotlin-Zwilling mit gemeinsamer Fixture.

**Tech Stack:** Deno 2 (Edge Functions, `jsr:@std/assert@1`, `jsr:@supabase/supabase-js@2`), Postgres/pg_cron, Electron main (CommonJS, better-sqlite3, `node:test` unter `ELECTRON_RUN_AS_NODE=1`), React renderer (Tailwind-Tokens), Kotlin/Compose (OkHttp, JUnit).

**Spec:** `docs/superpowers/specs/2026-10-05-ebay-zuletzt-verkauft-design.md` (nur Teil E1; E2 §9 ist NICHT Teil dieses Plans)

## Global Constraints

- Cardmarket hat Vorrang; eBay schreibt **nie** in `cards.price`/`price_first_ed` (E1 schreibt überhaupt nicht in `cards`).
- Marktplatz `EBAY_DE`; nur Verkäufe in EUR; Artikelpreis ohne Versand.
- Wert = Median, **mindestens 3** passende Verkäufe, sonst NULL; `sales` = höchstens **20** jüngste passende Verkäufe.
- Zeitplan: Kandidaten mit `price >= minPrice` (Standard **5**), oder lebendes Exemplar `edition='first'`, oder `for_sale`, oder in `listing_items`; frisch **7 Tage**; höchstens `budget` (Standard **50**) je Lauf; ältester Stand zuerst.
- Scope: `https://api.ebay.com/oauth/api_scope/buy.marketplace.insights`; fehlt er → `access='fehlt'`, keine Suchabfrage.
- Zugang zur Funktion: Kopf `x-ebay-secret` = `EBAY_CRON_SECRET` (Zeitplan) **oder** angemeldeter Nutzer (Einzelabruf). Nutzer dürfen keinen Zeitplan-Lauf auslösen.
- Nie Tokens, Secrets oder Codes protokollieren, in Fehlermeldungen übernehmen, in Fixtures/Ledger/Chat schreiben.
- **Agents rufen keine Edge Functions auf und deployen nichts**; SQL, Deploy, Cron macht der Nutzer.
- Main-Prozess bleibt CommonJS (`.cjs`), Renderer ESM. Neue IPC-Kanäle in `main.cjs` **und** `preload.cjs` und in `ipc-channels.test.cjs`.
- UI-Texte und Kommentare Deutsch; Farben/Schrift nur über Design-Tokens (`theme.test.js`, `noLegacyColors.test.js`).
- Lint: genau die 5 bekannten Altfehler, keine neuen. `test-sync.cjs` ist auf main vorbestehend rot (nicht beheben, nicht verschlimmern).
- Installer nie aus einem Junction-Worktree bauen; Agents legen keine eigenen Worktrees an.
- Testläufe: Deno aus der Repo-Wurzel `deno test --allow-read supabase/functions/<pfad>`; Desktop in `desktop/`: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/<datei>.test.cjs` bzw. `node --test src/utils/<datei>.test.mjs`; Android in `android/`: `./gradlew testDebugUnitTest --tests "<Klasse>"` (JAVA_HOME = Android-Studio-`jbr`).

## Review Focus

1. **Scope wird während eines Laufs entzogen bzw. eBay antwortet 403 an der Suche** (Token ging noch) → `access='fehlt'`, Lauf endet, kein Druck bekommt `status='fehler'` (Test in Task 5).
2. **Titel mit „1x" (Einzelstück, in DE üblich)** darf nicht als Lot verworfen werden; „3x"/„x3" schon (Test in Task 3).
3. **Set-Code-Teilstring** (`LOB-DE001` darf nicht auf „LOB-DE0012"/„XLOB-DE001" passen) (Test in Task 3).
4. **Quarter Century Secret Rare vs. Secret Rare** mit gleichem Set-Code: Titel „Quarter Century Secret Rare" darf einem Secret-Rare-Druck nicht zugeordnet werden (Test in Task 3).
5. **Mirror ohne Cloud-Tabelle** (SQL noch nicht eingespielt): PC-Pull protokolliert und läuft weiter, Detail zeigt „noch nicht geprüft" statt Absturz (Test in Task 6).

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `docs/superpowers/ledgers/2026-10-05-ebay-sold/messung.mjs` (Create, untracked) | Wegwerf-Messung: Kategorie-Id, Titel-Korpus, Scope-Fehlerantwort | 1 |
| `docs/superpowers/ledgers/2026-10-05-ebay-sold/messung.md` (Create, untracked) | Messergebnis | 1 |
| `supabase/functions/ebay-sold-prices/fixtures/titles.json` (Create) | Messkorb: echte Titel mit erwarteter Zuordnung | 1, 3 |
| `supabase/functions/_shared/ebay-client.ts` (Modify) | `INSIGHTS_SCOPE`, `appToken(…, scope)`, `scopeMissing`, `searchSold` | 2 |
| `supabase/functions/_shared/ebay-client_test.ts` (Modify) | Tests dazu | 2 |
| `supabase/functions/ebay-sold-prices/match.ts` (+`_test.ts`) | Titelfilter | 3 |
| `supabase/functions/ebay-sold-prices/summarize.ts` (+`_test.ts`) | Median/Status/Belege | 3 |
| `supabase/ebay_sold_schema.sql` (Create) | Tabellen, RLS, Statuszeile, RPC `ebay_sold_candidates` | 4 |
| `supabase/ebay_sold_cron.sql` (Create) | pg_cron-Eintrag (idempotent) | 4 |
| `supabase/functions/ebay-sold-prices/sold-store.ts` (Create) | Store-Schnittstelle + Supabase-Fassung | 4 |
| `supabase/functions/ebay-sold-prices/fake-sold-store.ts` (Create) | Nachgebauter Store für Tests | 4 |
| `supabase/functions/ebay-sold-prices/run.ts` (+`_test.ts`) | Ablauf Zeitplan/Einzeln, Selbst-Einschalten, Fehler | 5 |
| `supabase/functions/ebay-sold-prices/handler.ts` (+`_test.ts`) | Anfrage prüfen | 5 |
| `supabase/functions/ebay-sold-prices/index.ts` (Create) | Verdrahtung, `Deno.serve` | 5 |
| `supabase/README_ebay_cloud.md` (Modify) | Abschnitt Einspielen/Deploy/Cron | 5 |
| `desktop/electron/ebay-schema.cjs` (Modify) | lokale Tabelle `ebay_sold_prices`, `EBAY_SOLD_COLS` | 6 |
| `desktop/electron/sync.cjs` (Modify) | Nur-Lese-Strom + `pullInsightsState` | 6 |
| `desktop/electron/ebay-sold.cjs` (+`.test.cjs`) (Create) | `soldRowFor`, `insightsAccess` | 6 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` (Modify) | `ebay-sold-get`, `ebay-sold-check` | 6 |
| `docs/fixtures/ebay/sold-line.json` (Create) | Zwillings-Fixture Anzeigezeile | 7 |
| `desktop/src/utils/ebaySold.js` (+`ebaySold.test.mjs`) | `ebaySoldLine`, `ebaySoldCanCheck` | 7 |
| `android/…/cloud/EbaySold.kt` (+`EbaySoldTest.kt`) | Zwilling | 7 |
| `desktop/src/components/EbaySoldRow.jsx` (Create), `CardDetailPanel.jsx` (Modify) | Anzeige PC | 8 |
| `android/…/cloud/EbaySoldRepository.kt` (+Test), `ui/EbaySoldRow.kt` (Create), `ui/CardDetailScreen.kt` (Modify) | Anzeige Handy | 9 |

**Spec-Abweichung (bewusst, im Spec §7 nachgetragen):** Das Handy lädt in E1 die eBay-Zeile **je Druck beim Öffnen des Details** (REST mit Filter auf den Druck) statt eines vollständigen Delta-Spiegels — E1 braucht den Wert nur im Detail; der vollständige Spiegel kommt mit E2 (Bewertung).

---

### Task 1: Messung (Controller + Nutzer, kein Subagent)

Braucht den Nutzer: Er setzt die App-Zugangsdaten als Umgebungsvariablen in **seinem** Terminal und startet das Skript selbst. Werte nie in Chat/Ledger/Log.

**Files:**
- Create: `docs/superpowers/ledgers/2026-10-05-ebay-sold/messung.mjs`, `messung.md`
- Create: `supabase/functions/ebay-sold-prices/fixtures/titles.json`

**Interfaces:**
- Produces: `YGO_CATEGORY_ID` (String, gemessen); exakter Fehlerrumpf von eBay bei Token-Anfrage mit nicht gewährtem Scope (für Task 2); `titles.json` im Format `[{ "set_code": "...", "rarity": "...", "title": "...", "conditionId": "...", "expect": { "ok": true|false, "first": true|false } }]`.

- [ ] **Step 1: Drucke für den Korpus auswählen (nur lesend aus der lokalen DB)**

Run (in `desktop/`):
```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "const D=require('better-sqlite3');const db=new D(process.env.APPDATA+'/yugioh-card-manager/cards.db',{readonly:true});const q=(w,n)=>db.prepare('SELECT set_code,rarity,language FROM cards WHERE deleted=0 AND quantity>0 AND set_code<>\'Unknown\' AND '+w+' ORDER BY price DESC LIMIT '+n).all();console.log(JSON.stringify([...q(\"language='DE' AND price>=5\",8),...q(\"language='EN' AND price>=5\",4),...q(\"language='DE' AND price<1\",3),...q(\"rarity LIKE '%Secret%'\",3)]))"
```
Ergebnis plus `SDJ-G001`/`Ultra Rare` und `MAMO-DE020`/`Ultra Rare` als Liste `DRUCKE` ins Skript übernehmen (Duplikate entfernen).

- [ ] **Step 2: Messskript anlegen**

```js
// messung.mjs — Wegwerf-Werkzeug eBay E1 Task 1 (nicht eingecheckt). Node >= 20 (fetch).
// Start (Nutzer, im eigenen Terminal):  $env:EBAY_ID="..."; $env:EBAY_SECRET="..."; node messung.mjs
// Schreibt titles-roh.json, messung-roh.md. Gibt NIE Zugangsdaten oder Tokens aus.
import fs from 'node:fs';
const ID = process.env.EBAY_ID, SECRET = process.env.EBAY_SECRET;
if (!ID || !SECRET) { console.error('EBAY_ID/EBAY_SECRET fehlen'); process.exit(1); }
const DRUCKE = [/* aus Step 1: { set_code, rarity } */];
const basic = 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64');
async function token(scope) {
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST',
    headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString() });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, token: j.access_token, error: j.error, error_description: j.error_description };
}
const out = [];
const base = await token('https://api.ebay.com/oauth/api_scope');
if (!base.token) { console.error('Basis-Token fehlgeschlagen', base.status, base.error); process.exit(1); }
const ins = await token('https://api.ebay.com/oauth/api_scope/buy.marketplace.insights');
out.push(`## Token mit Insights-Scope\nstatus ${ins.status}, error ${ins.error}, description ${ins.error_description}, token ${ins.token ? 'ERHALTEN' : 'keins'}\n`);
const H = { Authorization: `Bearer ${base.token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE', 'Accept-Language': 'de-DE' };
const sug = await (await fetch('https://api.ebay.com/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=' + encodeURIComponent('Yu-Gi-Oh Einzelkarten'), { headers: H })).json();
out.push('## Kategorie-Vorschläge (Baum 77 = EBAY_DE)\n' + (sug.categorySuggestions || []).slice(0, 8)
  .map((s) => `- ${s.category.categoryId} ${s.category.categoryName} <- ${(s.categoryTreeNodeAncestors || []).map((a) => a.categoryName).join(' / ')}`).join('\n') + '\n');
const titles = [];
for (const d of DRUCKE) {
  const u = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  u.searchParams.set('q', d.set_code); u.searchParams.set('limit', '50');
  const j = await (await fetch(u, { headers: H })).json();
  for (const s of j.itemSummaries || []) titles.push({ set_code: d.set_code, rarity: d.rarity, title: s.title, conditionId: String(s.conditionId ?? ''), categoryId: (s.categories || [])[0]?.categoryId ?? null, price: s.price?.value ?? null });
  out.push(`- ${d.set_code} (${d.rarity}): ${(j.itemSummaries || []).length} Angebote`);
  await new Promise((r) => setTimeout(r, 500));
}
fs.writeFileSync(new URL('./titles-roh.json', import.meta.url), JSON.stringify(titles, null, 2));
fs.writeFileSync(new URL('./messung-roh.md', import.meta.url), out.join('\n'));
console.log('fertig:', titles.length, 'Titel');
```

- [ ] **Step 3: Nutzer startet die Messung**

Dem Nutzer den Befehl geben (Pfad `docs/superpowers/ledgers/2026-10-05-ebay-sold/`), er setzt `EBAY_ID`/`EBAY_SECRET` aus dem eBay Developer Portal (Production-Keyset) in seinem Terminal und startet `node messung.mjs`.
Expected: `fertig: <N> Titel` mit N > 100; `messung-roh.md` enthält den Insights-Token-Status (erwartet: kein Token, `error` z. B. `invalid_scope`).

- [ ] **Step 4: Auswerten**

1. **Kategorie:** die Id der Yu-Gi-Oh!-Einzelkarten aus den Vorschlägen; gegenprüfen mit der häufigsten `categoryId` in `titles-roh.json`. → `YGO_CATEGORY_ID`.
2. **Scope-Fehler:** `status`/`error` der Insights-Token-Anfrage notieren (Task 2 erkennt genau diesen Code).
3. **Messkorb:** aus `titles-roh.json` ~80 Titel wählen (alle Drucke vertreten, gezielt Grenzfälle: gegradet, Lot, „1x", andere Rarity, 1. Auflage, ohne Set-Code, anderer Druck mit ähnlichem Code), je Titel von Hand `expect.ok` (gehört genau zu diesem Druck, Einzelkarte, ungegradet, echt) und `expect.first` (Titel sagt 1. Auflage) setzen. Ohne `price`/`categoryId` als `supabase/functions/ebay-sold-prices/fixtures/titles.json` speichern; keine Verkäufernamen (Browse liefert sie nicht im Titel; trotzdem prüfen).
4. **Graded-conditionId:** welche `conditionId` tragen gegradete Angebote (erwartet `2750`)?
5. Kennzahlen in `messung.md`: Anteil Titel mit Set-Code, Anteil mit erkennbarer 1. Auflage, gefundene Wortformen für Ausschlüsse.

- [ ] **Step 5: Commit (nur Fixture)**

```bash
rtk git add supabase/functions/ebay-sold-prices/fixtures/titles.json
rtk git commit -m "test(ebay-sold): Messkorb echter eBay-Titel mit erwarteter Zuordnung"
```

---

### Task 2: eBay-Client: Scope, Scope-Erkennung, Verkaufssuche

**Files:**
- Modify: `supabase/functions/_shared/ebay-client.ts` (Klasse `EbayError` Z. 28–32, `toError` Z. 68–76, `appToken` Z. 119–122, Ende der Datei)
- Test: `supabase/functions/_shared/ebay-client_test.ts`

**Interfaces:**
- Consumes: Scope-Fehlercode aus Task 1 (`messung.md`). Falls dort **nicht** `invalid_scope` steht, den gemessenen Code zusätzlich in die Bedingung `SCOPE_ERRORS` aufnehmen und einen Test-Fall mit genau diesem Rumpf ergänzen.
- Produces:
  - `export const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"`
  - `EbayError` bekommt 5. Konstruktor-Feld `readonly scopeMissing = false`
  - `appToken(fetchFn, env, c, scope = APP_SCOPE): Promise<string>`
  - `export type SoldItem = { itemId: string; title: string; price: number | null; currency: string | null; soldAt: string | null; url: string | null; conditionId: string | null }`
  - `searchSold(fetchFn, env, token, q: string, categoryId: string): Promise<SoldItem[]>` — 403 an der Suche → `EbayError` mit `scopeMissing = true`

- [ ] **Step 1: Failing tests schreiben** (an `ebay-client_test.ts` anhängen; Import-Zeile um `INSIGHTS_SCOPE, searchSold` ergänzen)

```ts
Deno.test("appToken mit Insights-Scope sendet genau diesen Scope", async () => {
  const f = fakeFetch({ [`POST ${TOKEN}`]: { body: { access_token: "AT", expires_in: 7200 } } });
  assertEquals(await appToken(f.fetchFn, "production", CREDS, INSIGHTS_SCOPE), "AT");
  assertEquals(new URLSearchParams(f.calls[0].body!).get("scope"), INSIGHTS_SCOPE);
});

Deno.test("Scope nicht freigeschaltet (invalid_scope) -> scopeMissing, nicht auth, nicht vorübergehend", async () => {
  const f = fakeFetch({ [`POST ${TOKEN}`]: { status: 400, body: { error: "invalid_scope", error_description: "The requested scope is invalid, unknown, malformed, or exceeds the scope granted to the client" } } });
  const e = await assertRejects(() => appToken(f.fetchFn, "production", CREDS, INSIGHTS_SCOPE), EbayError);
  assertEquals([e.scopeMissing, e.auth, e.transient], [true, false, false]);
  assert(!e.message.includes("AT"));
});

const SOLD = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
Deno.test("searchSold: Abfrage mit Set-Code, Kategorie, EBAY_DE; Felder gemappt", async () => {
  const f = fakeFetch({ [`GET ${SOLD}`]: { body: { itemSales: [
    { itemId: "v1|1|0", title: "Red-Eyes B. Dragon SDJ-G001 Ultra Rare", lastSoldPrice: { value: "7.50", currency: "EUR" },
      lastSoldDate: "2026-09-28T14:03:00.000Z", itemWebUrl: "https://www.ebay.de/itm/1", conditionId: "4000" },
    { itemId: "v1|2|0", title: "ohne Preis" },
  ] } } });
  const r = await searchSold(f.fetchFn, "production", "TOK", "SDJ-G001", "183454");
  const u = new URL(f.calls[0].url);
  assertEquals([u.searchParams.get("q"), u.searchParams.get("category_ids"), u.searchParams.get("limit")], ["SDJ-G001", "183454", "200"]);
  assertEquals(f.calls[0].headers["x-ebay-c-marketplace-id"], "EBAY_DE");
  assertEquals(f.calls[0].headers["authorization"], "Bearer TOK");
  assertEquals(r, [
    { itemId: "v1|1|0", title: "Red-Eyes B. Dragon SDJ-G001 Ultra Rare", price: 7.5, currency: "EUR", soldAt: "2026-09-28T14:03:00.000Z", url: "https://www.ebay.de/itm/1", conditionId: "4000" },
    { itemId: "v1|2|0", title: "ohne Preis", price: null, currency: null, soldAt: null, url: null, conditionId: null },
  ]);
});

Deno.test("searchSold: keine Treffer -> leere Liste; 403 -> scopeMissing; 429 -> vorübergehend", async () => {
  assertEquals(await searchSold(fakeFetch({ [`GET ${SOLD}`]: { body: { total: 0 } } }).fetchFn, "production", "T", "X-DE001", "1"), []);
  const e403 = await assertRejects(() => searchSold(fakeFetch({ [`GET ${SOLD}`]: { status: 403, body: { errors: [{ message: "Insufficient permissions" }] } } }).fetchFn, "production", "T", "X", "1"), EbayError);
  assertEquals(e403.scopeMissing, true);
  const e429 = await assertRejects(() => searchSold(fakeFetch({ [`GET ${SOLD}`]: { status: 429, body: {} } }).fetchFn, "production", "T", "X", "1"), EbayError);
  assertEquals([e429.transient, e429.scopeMissing], [true, false]);
});
```

`CREDS`/`TOKEN` existieren in der Testdatei (prüfen; sonst wie dort definiert: `TOKEN = "https://api.ebay.com/identity/v1/oauth2/token"`, `CREDS = { clientId: "id", clientSecret: "sec", ruName: "ru" }`). `assert`, `assertRejects` aus `jsr:@std/assert@1` importieren, falls noch nicht.

- [ ] **Step 2: Fehlschlag prüfen**

Run: `deno test --allow-read supabase/functions/_shared/ebay-client_test.ts`
Expected: FAIL — `INSIGHTS_SCOPE`/`searchSold` nicht exportiert.

- [ ] **Step 3: Implementierung**

`EbayError` (Z. 28–32) ersetzen:
```ts
export class EbayError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean, readonly auth: boolean, readonly scopeMissing = false) {
    super(message);
  }
}
```
Nach `APP_SCOPE` (Z. 26):
```ts
// eBay „zuletzt verkauft" (Spec 2026-10-05 §5): Marketplace Insights, Limited Release -- nur nach Freischaltung durch eBay.
export const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
// Antwortcodes des Token-Endpunkts, wenn der App ein angefragter Scope (noch) nicht gewährt ist (Messung 05.10.).
const SCOPE_ERRORS = new Set(["invalid_scope"]);
```
In `toError` vor `const auth = …`:
```ts
  if (oauth && SCOPE_ERRORS.has(code)) {
    return new EbayError("eBay hat den Zugang zu den Verkaufsdaten (noch) nicht freigeschaltet.", status, false, false, true);
  }
```
`appToken` (Z. 119–122) ersetzen:
```ts
export async function appToken(fetchFn: Fetch, env: Env, c: Creds, scope = APP_SCOPE): Promise<string> {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "client_credentials", scope });
  return String(requireField(b, "access_token"));
}
```
Am Dateiende:
```ts
// eBay „zuletzt verkauft" §4: verkaufte Artikel der letzten 90 Tage zu einem Suchbegriff (Set-Code) in einer Kategorie.
export type SoldItem = { itemId: string; title: string; price: number | null; currency: string | null; soldAt: string | null; url: string | null; conditionId: string | null };
export async function searchSold(fetchFn: Fetch, env: Env, token: string, q: string, categoryId: string): Promise<SoldItem[]> {
  const p = new URLSearchParams({ q, category_ids: categoryId, limit: "200" });
  let b: any;
  try {
    b = await send(fetchFn, `${HOSTS[env].api}/buy/marketplace_insights/v1_beta/item_sales/search?${p.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE },
    });
  } catch (e) {
    // 403: Token gültig, aber die App ist für die API nicht freigeschaltet -> wie fehlender Scope behandeln.
    if (e instanceof EbayError && e.status === 403) throw new EbayError(e.message, 403, false, false, true);
    throw e;
  }
  const num = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return ((b?.itemSales ?? []) as any[]).map((s) => ({
    itemId: String(s.itemId ?? ""), title: String(s.title ?? ""),
    price: num(s.lastSoldPrice?.value), currency: str(s.lastSoldPrice?.currency),
    soldAt: str(s.lastSoldDate), url: str(s.itemWebUrl), conditionId: str(s.conditionId),
  }));
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `deno test --allow-read supabase/functions/_shared/` 
Expected: PASS (alle, auch die bestehenden `ebay-client`-, `ebay-sync`-nahen Tests in `_shared`). Zusätzlich `deno test --allow-read supabase/functions/ebay-sync/` → PASS (EbayError-Signatur abwärtskompatibel).

- [ ] **Step 5: Commit**

```bash
rtk git add supabase/functions/_shared/ebay-client.ts supabase/functions/_shared/ebay-client_test.ts
rtk git commit -m "feat(ebay-sold): eBay-Client mit Insights-Scope, Scope-Erkennung und Verkaufssuche"
```

---

### Task 3: Titelfilter und Wert (reine Module)

**Files:**
- Create: `supabase/functions/ebay-sold-prices/match.ts`, `match_test.ts`, `summarize.ts`, `summarize_test.ts`

**Interfaces:**
- Consumes: `SoldItem` (Task 2), `fixtures/titles.json` (Task 1), Graded-`conditionId` aus `messung.md` (erwartet `"2750"`; falls anders, `GRADED_CONDITION_IDS` entsprechend setzen).
- Produces:
  - `export type Printing = { card_id: string; set_code: string; language: string; rarity: string }`
  - `matchSale(title: string, conditionId: string | null, p: Printing): { ok: boolean; first: boolean }`
  - `export type SaleEntry = { title: string; price: number; sold_at: string; url: string | null; first: boolean }`
  - `export type Summary = { median_all: number | null; n_all: number; median_first: number | null; n_first: number; last_sold_at: string | null; last_sold_price: number | null; sales: SaleEntry[]; status: "ok" | "zu_wenig" }`
  - `median3(xs: number[]): number | null`
  - `summarizeSales(items: SoldItem[], p: Printing): Summary`

- [ ] **Step 1: Failing tests `match_test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { matchSale, type Printing } from "./match.ts";

const P = (set_code: string, rarity: string): Printing => ({ card_id: "1", set_code, language: "DE", rarity });
const ok = (t: string, p: Printing, c: string | null = "4000") => matchSale(t, c, p).ok;

Deno.test("Set-Code muss im Titel stehen, Schreibvarianten zählen, Teilstrings nicht", () => {
  const p = P("LOB-DE001", "Ultra Rare");
  assertEquals(ok("Blauäugiger w. Drache LOB-DE001 Ultra Rare", p), true);
  assertEquals(ok("Blauäugiger LOBDE001", p), true);
  assertEquals(ok("Blauäugiger LOB DE001", p), true);
  assertEquals(ok("blauäugiger lob-de001", p), true);
  assertEquals(ok("Blauäugiger LOB-DE0012", p), false);
  assertEquals(ok("Blauäugiger XLOB-DE001", p), false);
  assertEquals(ok("Blauäugiger weißer Drache Ultra Rare", p), false);
  assertEquals(ok("Red-Eyes SDJ-G001 1. Auflage", P("SDJ-G001", "Ultra Rare")), true);
});

Deno.test("Fremde Rarity raus, keine Rarity bleibt drin, QCSR ist nicht Secret Rare", () => {
  const sr = P("RA01-DE001", "Secret Rare");
  assertEquals(ok("Karte RA01-DE001 Secret Rare", sr), true);
  assertEquals(ok("Karte RA01-DE001", sr), true);
  assertEquals(ok("Karte RA01-DE001 Ultra Rare", sr), false);
  assertEquals(ok("Karte RA01-DE001 Quarter Century Secret Rare", sr), false);
  assertEquals(ok("Karte RA01-DE001 QCSR", sr), false);
  assertEquals(ok("Karte RA01-DE001 Quarter Century Secret Rare", P("RA01-DE001", "Quarter Century Secret Rare")), true);
  assertEquals(ok("Karte RA01-DE001 UR", P("RA01-DE001", "Ultra Rare")), true);
  assertEquals(ok("Karte RA01-DE001 Super Rare", P("RA01-DE001", "Ultra Rare")), false);
});

Deno.test("Ausschlüsse: gegradet, Mengen, Unechtes, Verändert; 1x ist ein Einzelstück", () => {
  const p = P("MAMO-DE020", "Ultra Rare");
  for (const t of ["MAMO-DE020 PSA 10", "MAMO-DE020 BGS 9.5", "MAMO-DE020 CGC", "MAMO-DE020 Beckett", "MAMO-DE020 graded", "MAMO-DE020 gegradet",
    "MAMO-DE020 Lot", "MAMO-DE020 Konvolut", "MAMO-DE020 Sammlung", "MAMO-DE020 Bundle", "MAMO-DE020 Playset", "3x MAMO-DE020", "MAMO-DE020 x3", "MAMO-DE020 3 x",
    "MAMO-DE020 Proxy", "MAMO-DE020 Orica", "MAMO-DE020 Replica", "MAMO-DE020 Fan Made", "MAMO-DE020 Custom", "MAMO-DE020 Altered", "MAMO-DE020 Signed", "MAMO-DE020 signiert"]) {
    assertEquals(ok(t, p), false, t);
  }
  assertEquals(ok("1x MAMO-DE020 Ultra Rare", p), true);
  assertEquals(ok("MAMO-DE020 x1", p), true);
  assertEquals(ok("MAMO-DE020", p, "2750"), false, "eBay-Zustand gegradet");
});

Deno.test("Auflage aus dem Titel", () => {
  const p = P("SDJ-G001", "Ultra Rare");
  for (const t of ["SDJ-G001 1. Auflage", "SDJ-G001 1.Auflage", "SDJ-G001 1 Auflage", "SDJ-G001 1st Edition", "SDJ-G001 1st Ed", "SDJ-G001 Erstauflage", "SDJ-G001 First Edition"]) {
    assertEquals(matchSale(t, "4000", p).first, true, t);
  }
  assertEquals(matchSale("SDJ-G001 Unlimitiert", "4000", p).first, false);
  assertEquals(matchSale("SDJ-G001", "4000", p).first, false);
});

Deno.test("Messkorb: jede von Hand bewertete Zuordnung stimmt", () => {
  const korb = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/titles.json", import.meta.url)));
  const falsch: string[] = [];
  for (const k of korb) {
    const r = matchSale(k.title, k.conditionId || null, { card_id: "x", set_code: k.set_code, language: "DE", rarity: k.rarity });
    if (r.ok !== k.expect.ok || (k.expect.ok && r.first !== k.expect.first)) falsch.push(`${k.set_code} | ${k.title} -> ${JSON.stringify(r)}`);
  }
  assertEquals(falsch, []);
});
```

- [ ] **Step 2: Failing tests `summarize_test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { median3, summarizeSales } from "./summarize.ts";
import type { SoldItem } from "../_shared/ebay-client.ts";

const P = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };
const it = (title: string, price: number | null, soldAt: string, extra: Partial<SoldItem> = {}): SoldItem =>
  ({ itemId: title, title, price, currency: "EUR", soldAt, url: `https://www.ebay.de/itm/${price}`, conditionId: "4000", ...extra });

Deno.test("median3: unter 3 null, ungerade, gerade, auf Cent", () => {
  assertEquals(median3([]), null);
  assertEquals(median3([1, 2]), null);
  assertEquals(median3([3, 1, 2]), 2);
  assertEquals(median3([4, 1, 2, 3]), 2.5);
  assertEquals(median3([1.111, 2.221, 3.333, 4.444]), 2.78);
});

Deno.test("summarizeSales: nur passende EUR-Verkäufe mit Preis, 1. Auflage getrennt, jüngster Verkauf", () => {
  const s = summarizeSales([
    it("SDJ-G001 1. Auflage", 9, "2026-09-20T10:00:00Z"),
    it("SDJ-G001 1st Edition", 10, "2026-09-21T10:00:00Z"),
    it("SDJ-G001 Erstauflage", 8, "2026-09-22T10:00:00Z"),
    it("SDJ-G001", 6, "2026-09-28T14:03:00Z"),
    it("SDJ-G001 PSA 10", 200, "2026-09-29T10:00:00Z"),
    it("SDJ-G001", 5, "2026-09-25T10:00:00Z", { currency: "USD" }),
    it("SDJ-G001", null, "2026-09-26T10:00:00Z"),
    it("LOB-DE001", 50, "2026-09-27T10:00:00Z"),
  ], P);
  assertEquals([s.status, s.n_all, s.median_all, s.n_first, s.median_first], ["ok", 4, 8.5, 3, 9]);
  assertEquals([s.last_sold_at, s.last_sold_price], ["2026-09-28T14:03:00Z", 6]);
  assertEquals(s.sales.map((x) => x.price), [6, 8, 10, 9]);
  assertEquals(s.sales[0], { title: "SDJ-G001", price: 6, sold_at: "2026-09-28T14:03:00Z", url: "https://www.ebay.de/itm/6", first: false });
});

Deno.test("summarizeSales: 0-2 passende -> zu_wenig, Mediane null, Belege trotzdem", () => {
  const s = summarizeSales([it("SDJ-G001", 6, "2026-09-28T14:03:00Z"), it("SDJ-G001", 7, "2026-09-27T14:03:00Z")], P);
  assertEquals([s.status, s.n_all, s.median_all, s.median_first, s.sales.length], ["zu_wenig", 2, null, null, 2]);
  assertEquals(summarizeSales([], P), { median_all: null, n_all: 0, median_first: null, n_first: 0, last_sold_at: null, last_sold_price: null, sales: [], status: "zu_wenig" });
});

Deno.test("summarizeSales: höchstens 20 Belege, jüngste zuerst; Verkäufe ohne Datum zählen, aber hinten", () => {
  const many = Array.from({ length: 25 }, (_, i) => it("SDJ-G001", i + 1, `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
  many.push(it("SDJ-G001", 99, null as unknown as string, { soldAt: null }));
  const s = summarizeSales(many, P);
  assertEquals([s.n_all, s.sales.length, s.sales[0].price, s.last_sold_price], [26, 20, 25, 25]);
});
```

- [ ] **Step 3: Fehlschlag prüfen**

Run: `deno test --allow-read supabase/functions/ebay-sold-prices/`
Expected: FAIL — Module `./match.ts`/`./summarize.ts` fehlen.

- [ ] **Step 4: Implementierung `match.ts`**

```ts
// supabase/functions/ebay-sold-prices/match.ts
// eBay „zuletzt verkauft" §4 -- gehört ein verkaufter Artikel genau zu diesem Druck? Reine Funktion, am Messkorb
// (fixtures/titles.json, Messung 05.10.2026) geprüft. Wortlisten nur mit neuem Korb-Fall ändern.
export type Printing = { card_id: string; set_code: string; language: string; rarity: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "MAMO-DE020" -> MAMO, Trenner (- / Leerzeichen / nichts), DE020; links und rechts kein Buchstabe/keine Ziffer.
function codePattern(setCode: string): RegExp {
  const i = setCode.indexOf("-");
  const head = i < 0 ? setCode : setCode.slice(0, i), tail = i < 0 ? "" : setCode.slice(i + 1);
  return new RegExp(`(^|[^A-Za-z0-9])${esc(head)}[\\s-]?${esc(tail)}($|[^A-Za-z0-9])`, "i");
}

const normRarity = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
// Reihenfolge egal; "secretrare" wird gestrichen, wenn eine speziellere Secret-Variante erkannt ist.
const RARITIES: [string, RegExp][] = [
  ["quartercenturysecretrare", /quarter\s*century|\bqcsr\b|\bqcscr\b/i],
  ["prismaticsecretrare", /prismatic/i],
  ["platinumsecretrare", /platinum\s*secret/i],
  ["starlightrare", /starlight/i],
  ["ghostrare", /\bghost\b/i],
  ["collectorsrare", /collector'?s\s*rare/i],
  ["ultimaterare", /ultimate\s*rare/i],
  ["goldrare", /gold\s*rare/i],
  ["secretrare", /secret\s*rare|\bscr\b/i],
  ["ultrarare", /ultra\s*rare|\bur\b/i],
  ["superrare", /super\s*rare/i],
  ["common", /\bcommon\b/i],
];
const SPECIFIC_SECRET = new Set(["quartercenturysecretrare", "prismaticsecretrare", "platinumsecretrare"]);

function mentionedRarities(title: string): Set<string> {
  const m = new Set(RARITIES.filter(([, re]) => re.test(title)).map(([k]) => k));
  if ([...m].some((k) => SPECIFIC_SECRET.has(k))) m.delete("secretrare");
  return m;
}

const EXCLUDE = /\b(psa|bgs|cgc|beckett|graded|gegradet|lot|konvolut|sammlung|bundle|playset|proxy|orica|replica|fan\s*made|custom|altered|signed|signiert)\b|\b([2-9]|\d{2,})\s*x\b|\bx\s*([2-9]|\d{2,})\b/i;
const GRADED_CONDITION_IDS = new Set(["2750"]);
const FIRST = /\b1\.?\s*auflage\b|\b1st\b|\berstauflage\b|\bfirst\s*edition\b/i;

export function matchSale(title: string, conditionId: string | null, p: Printing): { ok: boolean; first: boolean } {
  const t = String(title || "");
  const first = FIRST.test(t);
  if (!codePattern(p.set_code).test(t)) return { ok: false, first };
  if (EXCLUDE.test(t) || (conditionId != null && GRADED_CONDITION_IDS.has(conditionId))) return { ok: false, first };
  const m = mentionedRarities(t);
  if (m.size > 0 && !m.has(normRarity(p.rarity))) return { ok: false, first };
  return { ok: true, first };
}
```

- [ ] **Step 5: Implementierung `summarize.ts`**

```ts
// supabase/functions/ebay-sold-prices/summarize.ts
// eBay „zuletzt verkauft" §4 -- Wert eines Drucks aus seinen verkauften Artikeln: Median ab 3 Verkäufen, 1. Auflage getrennt.
import type { SoldItem } from "../_shared/ebay-client.ts";
import { matchSale, type Printing } from "./match.ts";

export type SaleEntry = { title: string; price: number; sold_at: string; url: string | null; first: boolean };
export type Summary = {
  median_all: number | null; n_all: number; median_first: number | null; n_first: number;
  last_sold_at: string | null; last_sold_price: number | null; sales: SaleEntry[]; status: "ok" | "zu_wenig";
};
export const MIN_SALES = 3;
export const MAX_ENTRIES = 20;

export function median3(xs: number[]): number | null {
  if (xs.length < MIN_SALES) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 100) / 100;
}

export function summarizeSales(items: SoldItem[], p: Printing): Summary {
  const hits: SaleEntry[] = [];
  for (const i of items) {
    if (i.currency !== "EUR" || !(typeof i.price === "number" && i.price > 0)) continue;
    const r = matchSale(i.title, i.conditionId, p);
    if (r.ok) hits.push({ title: i.title, price: i.price, sold_at: i.soldAt ?? "", url: i.url, first: r.first });
  }
  // Jüngste zuerst; ohne Datum ("") ans Ende.
  hits.sort((a, b) => (b.sold_at > a.sold_at ? 1 : b.sold_at < a.sold_at ? -1 : 0));
  const firsts = hits.filter((h) => h.first);
  const median_all = median3(hits.map((h) => h.price));
  const latest = hits.find((h) => h.sold_at !== "") ?? null;
  return {
    median_all, n_all: hits.length,
    median_first: median3(firsts.map((h) => h.price)), n_first: firsts.length,
    last_sold_at: latest ? latest.sold_at : null, last_sold_price: latest ? latest.price : null,
    sales: hits.slice(0, MAX_ENTRIES).map((h) => ({ ...h })),
    status: median_all != null ? "ok" : "zu_wenig",
  };
}
```

Hinweis zum Test „höchstens 20 Belege": der Verkauf ohne Datum hat `sold_at: ""`; im Beleg steht dann `""`. Das ist gewollt (Anzeige zeigt dann kein Datum).

- [ ] **Step 6: Tests laufen lassen**

Run: `deno test --allow-read supabase/functions/ebay-sold-prices/`
Expected: PASS. Scheitert nur der Messkorb-Test, die Liste `falsch` lesen: Liegt die Regel falsch, Regel/Wortliste anpassen (und einen benannten Einzelfall in den passenden Test oben aufnehmen); ist die Hand-Bewertung falsch, `titles.json` korrigieren und in `messung.md` begründen. Nie beides gleichzeitig blind „passend machen".

- [ ] **Step 7: Commit**

```bash
rtk git add supabase/functions/ebay-sold-prices/match.ts supabase/functions/ebay-sold-prices/match_test.ts supabase/functions/ebay-sold-prices/summarize.ts supabase/functions/ebay-sold-prices/summarize_test.ts supabase/functions/ebay-sold-prices/fixtures/titles.json
rtk git commit -m "feat(ebay-sold): Titelfilter und Median je Druck (am Messkorb geprüft)"
```

---

### Task 4: Cloud-Schema, Kandidaten-RPC, Store

**Files:**
- Create: `supabase/ebay_sold_schema.sql`, `supabase/ebay_sold_cron.sql`
- Create: `supabase/functions/ebay-sold-prices/sold-store.ts`, `fake-sold-store.ts`, `fake-sold-store_test.ts`

**Interfaces:**
- Consumes: `Printing`, `Summary` (Task 3).
- Produces:
  - `export type Access = "unbekannt" | "aktiv" | "fehlt"`
  - `export type State = { access: Access; last_error: string | null; last_run_at: string | null; calls_today: number; calls_day: string | null }`
  - `export type SoldRow = Printing & Summary & { status: "ok" | "zu_wenig" | "fehler"; checked_at: string }`
  - `export interface SoldStore { candidates(minPrice: number, freshBefore: string, limit: number): Promise<Printing[]>; upsert(row: SoldRow): Promise<void>; state(): Promise<State>; setState(patch: Partial<State>): Promise<void>; }`
  - `supabaseSoldStore(sb: SupabaseClient): SoldStore`
  - `fakeSoldStore(init?: { candidates?: Printing[]; state?: Partial<State> }): { store: SoldStore; rows: Map<string, SoldRow>; state: State; candidateCalls: { minPrice: number; freshBefore: string; limit: number }[] }` (Schlüssel `card_id|set_code|language|rarity`)

- [ ] **Step 1: Failing test für den nachgebauten Store**

`fake-sold-store_test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeSoldStore } from "./fake-sold-store.ts";

const P = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };
Deno.test("fakeSoldStore: Kandidaten mit Grenze, Upsert je Druck, Statuszeile patchen", async () => {
  const f = fakeSoldStore({ candidates: [P, { ...P, card_id: "2" }] });
  assertEquals(await f.store.candidates(5, "2026-09-28T00:00:00Z", 1), [P]);
  assertEquals(f.candidateCalls, [{ minPrice: 5, freshBefore: "2026-09-28T00:00:00Z", limit: 1 }]);
  const row = { ...P, median_all: 7.5, n_all: 3, median_first: null, n_first: 0, last_sold_at: null, last_sold_price: null, sales: [], status: "ok" as const, checked_at: "2026-10-05T00:00:00Z" };
  await f.store.upsert(row); await f.store.upsert({ ...row, n_all: 4 });
  assertEquals([f.rows.size, f.rows.get("1|SDJ-G001|DE|Ultra Rare")!.n_all], [1, 4]);
  assertEquals((await f.store.state()).access, "unbekannt");
  await f.store.setState({ access: "fehlt" });
  assertEquals(f.state.access, "fehlt");
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `deno test --allow-read supabase/functions/ebay-sold-prices/fake-sold-store_test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `sold-store.ts`**

```ts
// supabase/functions/ebay-sold-prices/sold-store.ts
// eBay „zuletzt verkauft" §5/§6 -- schmaler Datenbank-Zugang der Funktion; Tests nutzen fake-sold-store.ts.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Printing } from "./match.ts";
import type { Summary } from "./summarize.ts";

export type Access = "unbekannt" | "aktiv" | "fehlt";
export type State = { access: Access; last_error: string | null; last_run_at: string | null; calls_today: number; calls_day: string | null };
export type SoldRow = Printing & Omit<Summary, "status"> & { status: "ok" | "zu_wenig" | "fehler"; checked_at: string };
export interface SoldStore {
  candidates(minPrice: number, freshBefore: string, limit: number): Promise<Printing[]>;
  upsert(row: SoldRow): Promise<void>;
  state(): Promise<State>;
  setState(patch: Partial<State>): Promise<void>;
}
export const rowKey = (p: Printing) => `${p.card_id}|${p.set_code}|${p.language}|${p.rarity}`;

export function supabaseSoldStore(sb: SupabaseClient): SoldStore {
  return {
    async candidates(minPrice, freshBefore, limit) {
      const { data, error } = await sb.rpc("ebay_sold_candidates", { min_price: minPrice, fresh_before: freshBefore, max_rows: limit });
      if (error) throw new Error(`Kandidaten: ${error.message}`);
      return (data ?? []) as Printing[];
    },
    async upsert(row) {
      const { error } = await sb.from("ebay_sold_prices").upsert(row, { onConflict: "card_id,set_code,language,rarity" });
      if (error) throw new Error(`Speichern: ${error.message}`);
    },
    async state() {
      const { data, error } = await sb.from("ebay_insights_state").select("access,last_error,last_run_at,calls_today,calls_day").eq("id", 1).maybeSingle();
      if (error) throw new Error(`Status: ${error.message}`);
      return (data ?? { access: "unbekannt", last_error: null, last_run_at: null, calls_today: 0, calls_day: null }) as State;
    },
    async setState(patch) {
      const { error } = await sb.from("ebay_insights_state").update(patch).eq("id", 1);
      if (error) throw new Error(`Status speichern: ${error.message}`);
    },
  };
}
```

- [ ] **Step 4: `fake-sold-store.ts`**

```ts
// supabase/functions/ebay-sold-prices/fake-sold-store.ts -- NUR für Tests: Store im Speicher.
import type { Printing } from "./match.ts";
import { rowKey, type SoldRow, type SoldStore, type State } from "./sold-store.ts";

export function fakeSoldStore(init: { candidates?: Printing[]; state?: Partial<State> } = {}) {
  const rows = new Map<string, SoldRow>();
  const state: State = { access: "unbekannt", last_error: null, last_run_at: null, calls_today: 0, calls_day: null, ...init.state };
  const candidateCalls: { minPrice: number; freshBefore: string; limit: number }[] = [];
  const store: SoldStore = {
    candidates: (minPrice, freshBefore, limit) => {
      candidateCalls.push({ minPrice, freshBefore, limit });
      return Promise.resolve((init.candidates ?? []).slice(0, limit));
    },
    upsert: (row) => { rows.set(rowKey(row), structuredClone(row)); return Promise.resolve(); },
    state: () => Promise.resolve({ ...state }),
    setState: (patch) => { Object.assign(state, patch); return Promise.resolve(); },
  };
  return { store, rows, state, candidateCalls };
}
```

- [ ] **Step 5: `supabase/ebay_sold_schema.sql`**

```sql
-- supabase/ebay_sold_schema.sql -- eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §5/§6).
-- Voraussetzung: public.set_updated_at() aus schema.sql, public.cards, public.card_copies, public.listing_items.
-- Idempotent. Einspielen VOR Installer/APK (sonst protokolliert der PC-Pull nur einen Fehler).

-- 1. Wert je Druck (nur die Funktion schreibt; Geräte lesen)
create table if not exists public.ebay_sold_prices (
  card_id         text not null,
  set_code        text not null,
  language        text not null,
  rarity          text not null,
  median_all      numeric,
  n_all           integer not null default 0,
  median_first    numeric,
  n_first         integer not null default 0,
  last_sold_at    timestamptz,
  last_sold_price numeric,
  sales           jsonb not null default '[]'::jsonb,
  status          text not null check (status in ('ok', 'zu_wenig', 'fehler')),
  checked_at      timestamptz not null,
  updated_at      timestamptz not null default now(),
  primary key (card_id, set_code, language, rarity)
);
create index if not exists ebay_sold_prices_updated_idx on public.ebay_sold_prices (updated_at);
create index if not exists ebay_sold_prices_checked_idx on public.ebay_sold_prices (checked_at);
drop trigger if exists trg_ebay_sold_prices_updated_at on public.ebay_sold_prices;
create trigger trg_ebay_sold_prices_updated_at before insert or update on public.ebay_sold_prices
  for each row execute function public.set_updated_at();
alter table public.ebay_sold_prices enable row level security;
drop policy if exists ebay_sold_prices_authenticated_read on public.ebay_sold_prices;
create policy ebay_sold_prices_authenticated_read on public.ebay_sold_prices for select to authenticated using (true);
revoke insert, update, delete on public.ebay_sold_prices from anon, authenticated;

-- 2. Zugangsstatus (eine Zeile)
create table if not exists public.ebay_insights_state (
  id          integer primary key check (id = 1),
  access      text not null default 'unbekannt' check (access in ('unbekannt', 'aktiv', 'fehlt')),
  last_error  text,
  last_run_at timestamptz,
  calls_today integer not null default 0,
  calls_day   date
);
insert into public.ebay_insights_state (id) values (1) on conflict (id) do nothing;
alter table public.ebay_insights_state enable row level security;
drop policy if exists ebay_insights_state_authenticated_read on public.ebay_insights_state;
create policy ebay_insights_state_authenticated_read on public.ebay_insights_state for select to authenticated using (true);
revoke insert, update, delete on public.ebay_insights_state from anon, authenticated;

-- 3. Kandidaten des Zeitplan-Laufs: lebende Drucke ab Mindestwert, mit 1.-Auflage-Exemplar, auf der Verkaufsliste
--    oder in einem Angebot; ältester eBay-Stand zuerst, nur ausserhalb der Frische-Frist.
create or replace function public.ebay_sold_candidates(min_price numeric, fresh_before timestamptz, max_rows integer)
returns table (card_id text, set_code text, language text, rarity text)
language sql stable as $$
  select c.id, c.set_code, c.language, c.rarity
    from public.cards c
    left join public.ebay_sold_prices s
      on s.card_id = c.id and s.set_code = c.set_code and s.language = c.language and s.rarity = c.rarity
   where c.deleted = false and coalesce(c.quantity, 0) > 0 and c.set_code <> 'Unknown'
     and (s.checked_at is null or s.checked_at < fresh_before)
     and (coalesce(c.price, 0) >= min_price
          or exists (select 1 from public.card_copies cp
                      where cp.card_id = c.id and cp.set_code = c.set_code and cp.language = c.language and cp.rarity = c.rarity
                        and cp.deleted = false and (cp.edition = 'first' or cp.for_sale))
          or exists (select 1 from public.listing_items li
                      where li.card_id = c.id and li.set_code = c.set_code and li.language = c.language and li.rarity = c.rarity
                        and li.deleted = false))
   order by s.checked_at asc nulls first, c.id, c.set_code, c.language, c.rarity
   limit max_rows;
$$;
revoke execute on function public.ebay_sold_candidates(numeric, timestamptz, integer) from public, anon, authenticated;
```

Vor dem Schreiben prüfen: Typ von `listing_items.deleted` in `supabase/listings_schema.sql` (boolean erwartet; ist es integer, `li.deleted = 0` bzw. `= false` passend schreiben).

- [ ] **Step 6: `supabase/ebay_sold_cron.sql`**

```sql
-- supabase/ebay_sold_cron.sql -- eBay „zuletzt verkauft": täglicher Lauf 04:30 UTC (vor refresh-cardmarket-prices 05:00).
-- <EBAY_CRON_SECRET> durch denselben Wert ersetzen wie beim Job 'ebay-sync' (README_ebay_cloud.md). Idempotent.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'ebay-sold-prices';
select cron.schedule('ebay-sold-prices', '30 4 * * *', $$
  select net.http_post(
    url     := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-sold-prices',
    headers := '{"Content-Type": "application/json", "x-ebay-secret": "<EBAY_CRON_SECRET>"}'::jsonb,
    body    := '{"minPrice": 5, "budget": 50}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
```

- [ ] **Step 7: Tests + Typprüfung**

Run: `deno test --allow-read supabase/functions/ebay-sold-prices/` → PASS
Run: `deno check supabase/functions/ebay-sold-prices/sold-store.ts` → keine Fehler

- [ ] **Step 8: Commit**

```bash
rtk git add supabase/ebay_sold_schema.sql supabase/ebay_sold_cron.sql supabase/functions/ebay-sold-prices/sold-store.ts supabase/functions/ebay-sold-prices/fake-sold-store.ts supabase/functions/ebay-sold-prices/fake-sold-store_test.ts
rtk git commit -m "feat(ebay-sold): Cloud-Tabellen, Kandidaten-RPC, Cron-Eintrag und Store"
```

---

### Task 5: Ablauf, Handler, Verdrahtung

**Files:**
- Create: `supabase/functions/ebay-sold-prices/run.ts`, `run_test.ts`, `handler.ts`, `handler_test.ts`, `index.ts`
- Modify: `supabase/README_ebay_cloud.md` (neuer Abschnitt am Ende)

**Interfaces:**
- Consumes: `appToken`, `searchSold`, `credsFor`, `EbayError`, `INSIGHTS_SCOPE`, `Fetch` (Task 2); `summarizeSales`, `Printing` (Task 3); `SoldStore`, `SoldRow`, `State` (Task 4); `json`, `jsonBody`, `safeEqual` aus `_shared/http.ts`; `serviceDeps().verifyUser` aus `_shared/supabase-deps.ts`; `YGO_CATEGORY_ID` (Task 1).
- Produces:
  - `export const YGO_CATEGORY_ID = "<Wert aus messung.md>"` in `run.ts`
  - `export type RunOpts = { mode: "cron"; minPrice: number; budget: number } | { mode: "single"; printing: Printing }`
  - `export type RunResult = { ok: boolean; access: Access; checked: number; error?: string; row?: SoldRow }`
  - `runSold(d: { store: SoldStore; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date }, o: RunOpts): Promise<RunResult>`
  - `handleSold(req: Request, d: { cronSecret: string | undefined; verifyUser: (a: string | null) => Promise<boolean>; run: (o: RunOpts) => Promise<RunResult> }): Promise<Response>`

- [ ] **Step 1: Failing tests `run_test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeFetch } from "../_shared/fake-fetch.ts";
import { fakeSoldStore } from "./fake-sold-store.ts";
import { runSold, YGO_CATEGORY_ID } from "./run.ts";

const NOW = new Date("2026-10-05T04:30:00Z");
const ENV: Record<string, string> = { EBAY_PROD_CLIENT_ID: "id", EBAY_PROD_CLIENT_SECRET: "sec", EBAY_PROD_RUNAME: "ru" };
const TOKEN = "https://api.ebay.com/identity/v1/oauth2/token";
const SOLD = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const P1 = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };
const P2 = { card_id: "2", set_code: "MAMO-DE020", language: "DE", rarity: "Ultra Rare" };
const sale = (code: string, price: number, day: number) =>
  ({ itemId: `${code}-${price}`, title: `Karte ${code}`, lastSoldPrice: { value: String(price), currency: "EUR" }, lastSoldDate: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`, itemWebUrl: "https://www.ebay.de/itm/1", conditionId: "4000" });
const tokenOk = { body: { access_token: "AT", expires_in: 7200 } };
const salesFor = (c: { url: string }) => {
  const q = new URL(c.url).searchParams.get("q");
  return { body: { itemSales: q === "SDJ-G001" ? [sale("SDJ-G001", 5, 1), sale("SDJ-G001", 6, 2), sale("SDJ-G001", 7, 3)] : [sale("MAMO-DE020", 60, 4)] } };
};
const deps = (st: ReturnType<typeof fakeSoldStore>, f: ReturnType<typeof fakeFetch>) => ({ store: st.store, fetch: f.fetchFn, env: (k: string) => ENV[k], now: () => NOW });

Deno.test("Scope fehlt -> access fehlt, keine Suche, keine Kandidatenabfrage, nichts gespeichert", async () => {
  const st = fakeSoldStore({ candidates: [P1] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: { status: 400, body: { error: "invalid_scope" } } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, r.checked], [false, "fehlt", 0]);
  assertEquals([st.state.access, st.state.last_run_at, st.candidateCalls.length, st.rows.size], ["fehlt", NOW.toISOString(), 0, 0]);
  assertEquals(f.calls.filter((c) => c.url.startsWith(SOLD)).length, 0);
});

Deno.test("Scope da -> aktiv; Kandidaten mit Frist 7 Tage und Budget; Werte gespeichert; Zähler", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2], state: { access: "fehlt", last_error: "alt", calls_day: "2026-10-05", calls_today: 3 } });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, r.checked], [true, "aktiv", 2]);
  assertEquals(st.candidateCalls, [{ minPrice: 5, freshBefore: "2026-09-28T04:30:00.000Z", limit: 50 }]);
  const a = st.rows.get("1|SDJ-G001|DE|Ultra Rare")!, b = st.rows.get("2|MAMO-DE020|DE|Ultra Rare")!;
  assertEquals([a.status, a.median_all, a.n_all, a.checked_at], ["ok", 6, 3, NOW.toISOString()]);
  assertEquals([b.status, b.median_all, b.n_all], ["zu_wenig", null, 1]);
  assertEquals([st.state.access, st.state.last_error, st.state.calls_today, st.state.calls_day], ["aktiv", null, 5, "2026-10-05"]);
  assertEquals(new URL(f.calls.find((c) => c.url.startsWith(SOLD))!.url).searchParams.get("category_ids"), YGO_CATEGORY_ID);
});

Deno.test("Tageswechsel setzt calls_today zurück", async () => {
  const st = fakeSoldStore({ candidates: [P1], state: { calls_day: "2026-10-04", calls_today: 40 } });
  await runSold(deps(st, fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor })), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([st.state.calls_today, st.state.calls_day], [1, "2026-10-05"]);
});

Deno.test("429 an der Suche: Lauf bricht ab, bisherige bleiben, last_error gesetzt, kein fehler-Status", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: (c) => new URL(c.url).searchParams.get("q") === "SDJ-G001" ? salesFor(c) : { status: 429, body: {} } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.checked, st.rows.size], [false, 1, 1]);
  assertEquals(typeof st.state.last_error, "string");
});

Deno.test("403 an der Suche (Scope entzogen): access fehlt, Lauf endet, kein Druck auf fehler", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: { status: 403, body: { errors: [{ message: "Insufficient permissions" }] } } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, st.state.access, st.rows.size], [false, "fehlt", "fehlt", 0]);
});

Deno.test("401 an der Suche: Token einmal neu, dann weiter", async () => {
  const st = fakeSoldStore({ candidates: [P1] });
  let n = 0;
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: (c) => (++n === 1 ? { status: 401, body: {} } : salesFor(c)) });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.checked, f.calls.filter((c) => c.url === TOKEN).length], [true, 1, 2]);
});

Deno.test("Unerwartete Antwort bei einem Druck: status fehler mit Zeitstempel, nächster läuft weiter", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: (c) => new URL(c.url).searchParams.get("q") === "SDJ-G001" ? { status: 400, body: { errors: [{ message: "bad q" }] } } : salesFor(c) });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.checked], [true, 2]);
  const a = st.rows.get("1|SDJ-G001|DE|Ultra Rare")!;
  assertEquals([a.status, a.checked_at, a.n_all], ["fehler", NOW.toISOString(), 0]);
});

Deno.test("Einzelabruf: nur dieser Druck, ohne Kandidatenabfrage; Antwort enthält die Zeile", async () => {
  const st = fakeSoldStore({ candidates: [P2] });
  const r = await runSold(deps(st, fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor })), { mode: "single", printing: P1 });
  assertEquals([r.ok, r.checked, st.candidateCalls.length, r.row?.median_all], [true, 1, 0, 6]);
});

Deno.test("Secrets fehlen: Einrichtungsfehler in last_error, kein Netz", async () => {
  const st = fakeSoldStore();
  const f = fakeFetch({});
  const r = await runSold({ store: st.store, fetch: f.fetchFn, env: () => undefined, now: () => NOW }, { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, f.calls.length], [false, 0]);
  assertEquals(st.state.last_error?.includes("fehlen"), true);
});
```

- [ ] **Step 2: Failing tests `handler_test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { handleSold } from "./handler.ts";
import type { RunOpts } from "./run.ts";

const FN = "https://x/functions/v1/ebay-sold-prices";
function world(cronSecret: string | undefined = "s3cret") {
  const runs: RunOpts[] = [];
  const d = { cronSecret, verifyUser: (h: string | null) => Promise.resolve(h === "Bearer JWT"),
    run: (o: RunOpts) => { runs.push(o); return Promise.resolve({ ok: true, access: "aktiv" as const, checked: 0 }); } };
  return { runs, d };
}
const req = (headers: Record<string, string>, body: unknown, method = "POST") => new Request(FN, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
const P = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };

Deno.test("Zeitplan mit Secret: cron mit Standardwerten bzw. Body-Werten in Grenzen", async () => {
  const w = world();
  await handleSold(req({ "x-ebay-secret": "s3cret" }, {}), w.d);
  await handleSold(req({ "x-ebay-secret": "s3cret" }, { minPrice: 10, budget: 9999 }), w.d);
  assertEquals(w.runs, [{ mode: "cron", minPrice: 5, budget: 50 }, { mode: "cron", minPrice: 10, budget: 500 }]);
});

Deno.test("Angemeldeter Nutzer: nur Einzelabruf; ohne gültigen Druck 400; nie Zeitplan", async () => {
  const w = world();
  assertEquals((await handleSold(req({ authorization: "Bearer JWT" }, { printing: P }), w.d)).status, 200);
  assertEquals((await handleSold(req({ authorization: "Bearer JWT" }, { minPrice: 1 }), w.d)).status, 400);
  assertEquals((await handleSold(req({ authorization: "Bearer JWT" }, { printing: { ...P, set_code: "" } }), w.d)).status, 400);
  assertEquals(w.runs, [{ mode: "single", printing: P }]);
});

Deno.test("Ohne Secret und ohne Login 401; falsches Secret 401; ohne gesetztes Secret ist der Zeitplan zu; nur POST", async () => {
  const w = world();
  assertEquals((await handleSold(req({}, {}), w.d)).status, 401);
  assertEquals((await handleSold(req({ "x-ebay-secret": "falsch" }, {}), w.d)).status, 401);
  assertEquals((await handleSold(req({ "x-ebay-secret": "" }, {}), world(undefined).d)).status, 401);
  assertEquals((await handleSold(req({}, null, "GET"), w.d)).status, 405);
  assertEquals(w.runs.length, 0);
});
```

- [ ] **Step 3: Fehlschlag prüfen**

Run: `deno test --allow-read supabase/functions/ebay-sold-prices/`
Expected: FAIL — `run.ts`/`handler.ts` fehlen.

- [ ] **Step 4: `run.ts`**

```ts
// supabase/functions/ebay-sold-prices/run.ts
// eBay „zuletzt verkauft" §5/§6 -- ein Lauf: Token MIT Insights-Scope (schaltet sich so selbst ein), Kandidaten oder
// ein Druck, je Druck Suche -> Filter -> Median -> speichern. Nie Tokens/Secrets protokollieren.
import { appToken, credsFor, EbayError, type Fetch, INSIGHTS_SCOPE, searchSold, type SoldItem } from "../_shared/ebay-client.ts";
import type { Printing } from "./match.ts";
import type { Access, SoldRow, SoldStore } from "./sold-store.ts";
import { summarizeSales } from "./summarize.ts";

// Kategorie Yu-Gi-Oh!-Einzelkarten auf EBAY_DE (Messung 05.10.2026, Ledger messung.md).
export const YGO_CATEGORY_ID = "<Wert aus messung.md>";
export const FRESH_MS = 7 * 24 * 3600 * 1000;

export type RunOpts = { mode: "cron"; minPrice: number; budget: number } | { mode: "single"; printing: Printing };
export type RunResult = { ok: boolean; access: Access; checked: number; error?: string; row?: SoldRow };
export type RunDeps = { store: SoldStore; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date };

export async function runSold(d: RunDeps, o: RunOpts): Promise<RunResult> {
  const nowIso = d.now().toISOString(), today = nowIso.slice(0, 10);
  const st = await d.store.state();
  let calls = st.calls_day === today ? st.calls_today : 0;
  const finish = async (r: RunResult, err: string | null) => {
    await d.store.setState({ access: r.access, last_error: err, last_run_at: nowIso, calls_today: calls, calls_day: today });
    return err ? { ...r, error: err } : r;
  };

  let creds;
  try { creds = credsFor("production", d.env); }
  catch (e) { return finish({ ok: false, access: st.access, checked: 0 }, (e as Error).message); }

  const getToken = () => appToken(d.fetch, "production", creds, INSIGHTS_SCOPE);
  let token: string;
  try { token = await getToken(); }
  catch (e) {
    if (e instanceof EbayError && e.scopeMissing) return finish({ ok: false, access: "fehlt", checked: 0 }, null);
    return finish({ ok: false, access: st.access, checked: 0 }, (e as Error).message);
  }

  const list = o.mode === "single" ? [o.printing]
    : await d.store.candidates(o.minPrice, new Date(d.now().getTime() - FRESH_MS).toISOString(), o.budget);
  let checked = 0, lastRow: SoldRow | undefined;
  for (const p of list) {
    let items: SoldItem[];
    try {
      calls++;
      try { items = await searchSold(d.fetch, "production", token, p.set_code, YGO_CATEGORY_ID); }
      catch (e) {
        if (!(e instanceof EbayError && e.auth)) throw e;
        token = await getToken(); // 401: Token einmal erneuern
        calls++;
        items = await searchSold(d.fetch, "production", token, p.set_code, YGO_CATEGORY_ID);
      }
    } catch (e) {
      if (e instanceof EbayError && e.scopeMissing) return finish({ ok: false, access: "fehlt", checked }, null);
      if (e instanceof EbayError && (e.transient || e.auth)) return finish({ ok: false, access: "aktiv", checked }, e.message);
      lastRow = { ...p, median_all: null, n_all: 0, median_first: null, n_first: 0, last_sold_at: null, last_sold_price: null, sales: [], status: "fehler", checked_at: nowIso };
      await d.store.upsert(lastRow);
      checked++;
      continue;
    }
    lastRow = { ...p, ...summarizeSales(items, p), checked_at: nowIso };
    await d.store.upsert(lastRow);
    checked++;
  }
  return finish({ ok: true, access: "aktiv", checked, ...(o.mode === "single" && lastRow ? { row: lastRow } : {}) }, null);
}
```

`YGO_CATEGORY_ID` mit dem gemessenen Wert aus `messung.md` (Task 1 Step 4.1) belegen.

- [ ] **Step 5: `handler.ts`**

```ts
// supabase/functions/ebay-sold-prices/handler.ts
// eBay „zuletzt verkauft" §6 -- pg_cron (x-ebay-secret = EBAY_CRON_SECRET) startet den Zeitplan-Lauf; angemeldete Geräte
// nur den Einzelabruf eines Drucks. Ohne gesetzten EBAY_CRON_SECRET ist der Zeitplan-Weg zu (nie offen).
import { json, jsonBody, safeEqual } from "../_shared/http.ts";
import type { Printing } from "./match.ts";
import type { RunOpts, RunResult } from "./run.ts";

export type SoldHandlerDeps = {
  cronSecret: string | undefined;
  verifyUser: (authorization: string | null) => Promise<boolean>;
  run: (o: RunOpts) => Promise<RunResult>;
};
const intIn = (v: unknown, def: number, lo: number, hi: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, n)) : def;
};
const str = (v: unknown) => typeof v === "string" && v.trim() !== "";
function printingOf(v: unknown): Printing | null {
  const p = v as Record<string, unknown> | null;
  if (!p || !str(p.card_id) || !str(p.set_code) || !str(p.language) || !str(p.rarity)) return null;
  return { card_id: String(p.card_id), set_code: String(p.set_code), language: String(p.language), rarity: String(p.rarity) };
}

export async function handleSold(req: Request, d: SoldHandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  const cron = !!d.cronSecret && safeEqual(req.headers.get("x-ebay-secret"), d.cronSecret);
  if (!cron && !(await d.verifyUser(req.headers.get("authorization")))) return json({ ok: false, error: "Nicht angemeldet." }, 401);
  const body = await jsonBody(req) as Record<string, unknown>;
  if (cron) return json(await d.run({ mode: "cron", minPrice: intIn(body.minPrice, 5, 0, 100000), budget: intIn(body.budget, 50, 1, 500) }));
  const printing = printingOf(body.printing);
  if (!printing) return json({ ok: false, error: "Druck fehlt." }, 400);
  return json(await d.run({ mode: "single", printing }));
}
```

- [ ] **Step 6: `index.ts`**

```ts
// supabase/functions/ebay-sold-prices/index.ts
// Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy ebay-sold-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
// Secrets: EBAY_PROD_CLIENT_ID/_SECRET/_RUNAME und EBAY_CRON_SECRET (wie ebay-sync). Keine Tokens in Protokollen.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleSold } from "./handler.ts";
import { runSold } from "./run.ts";
import { supabaseSoldStore } from "./sold-store.ts";

Deno.serve((req) => {
  const s = serviceDeps();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return handleSold(req, {
    cronSecret: Deno.env.get("EBAY_CRON_SECRET"),
    verifyUser: s.verifyUser,
    run: (o) => runSold({ store: supabaseSoldStore(sb), fetch, env: (k) => Deno.env.get(k), now: () => new Date() }, o),
  });
});
```

- [ ] **Step 7: README-Abschnitt**

An `supabase/README_ebay_cloud.md` anhängen:
```markdown
## eBay „zuletzt verkauft" (Spec 2026-10-05, E1)

1. `supabase/ebay_sold_schema.sql` im SQL-Editor ausführen (Tabellen `ebay_sold_prices`, `ebay_insights_state`, RPC `ebay_sold_candidates`).
2. `supabase functions deploy ebay-sold-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn` (gleiche Secrets wie `ebay-sync`).
3. `supabase/ebay_sold_cron.sql` mit eingesetztem `EBAY_CRON_SECRET` ausführen; prüfen: `select jobname, schedule from cron.job;`
4. Nach dem ersten Lauf: `select * from public.ebay_insights_state;` — vor der Freischaltung durch eBay steht `access = 'fehlt'`.
   Sobald eBay den Scope `buy.marketplace.insights` freigibt, setzt der nächste tägliche Lauf `aktiv` und füllt die Werte selbst.
```

- [ ] **Step 8: Tests + Typprüfung**

Run: `deno test --allow-read supabase/functions/ebay-sold-prices/ supabase/functions/_shared/ supabase/functions/ebay-sync/` → PASS
Run: `deno check supabase/functions/ebay-sold-prices/index.ts` → keine Fehler

- [ ] **Step 9: Commit**

```bash
rtk git add supabase/functions/ebay-sold-prices/run.ts supabase/functions/ebay-sold-prices/run_test.ts supabase/functions/ebay-sold-prices/handler.ts supabase/functions/ebay-sold-prices/handler_test.ts supabase/functions/ebay-sold-prices/index.ts supabase/README_ebay_cloud.md
rtk git commit -m "feat(ebay-sold): Edge Function ebay-sold-prices mit Zeitplan, Einzelabruf und Selbst-Einschalten"
```

---

### Task 6: PC — Nur-Lese-Spiegel und IPC

**Files:**
- Modify: `desktop/electron/ebay-schema.cjs` (Spaltenliste + `CREATE TABLE`, Export)
- Modify: `desktop/electron/sync.cjs` (Import Z. 13, `READ_ONLY_STREAMS` Z. 331ff, `readOnlyValue`, `pullEbaySafe` Z. 792ff)
- Create: `desktop/electron/ebay-sold.cjs`, `desktop/electron/ebay-sold.test.cjs`
- Modify: `desktop/electron/main.cjs` (nach `ipcMain.handle('ebay-orders'…)`), `desktop/electron/preload.cjs` (eBay-Block Z. 131ff), `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Produces:
  - `EBAY_SOLD_COLS` (Array der Spaltennamen, Reihenfolge wie Cloud)
  - `soldRowFor(db, printing: { card_id, set_code, language, rarity }) -> object|null` (`sales` als Array geparst, Zahlen als Number)
  - `insightsAccess(db) -> 'unbekannt'|'aktiv'|'fehlt'` (aus `settings.ebay_insights_state`)
  - `pullInsightsState(c, db) -> boolean` (in `sync.cjs`, true bei Änderung)
  - IPC `ebay-sold-get` (printing) → `{ row, access }`; `ebay-sold-check` (printing) → `{ ok, access?, error?, row? }` (danach Pull)
  - preload: `ebaySoldGet(printing)`, `ebaySoldCheck(printing)`

- [ ] **Step 1: Failing test `ebay-sold.test.cjs`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureEbaySchema, EBAY_SOLD_COLS } = require('./ebay-schema.cjs');
const { soldRowFor, insightsAccess } = require('./ebay-sold.cjs');
const sync = require('./sync.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  ensureEbaySchema(db);
  return db;
}
function fakeClient(pages) {
  const calls = []; const q = {};
  for (const m of ['select', 'gt', 'order', 'eq']) q[m] = (...a) => { calls.push(m); return q; };
  q.range = () => Promise.resolve({ data: pages.shift() ?? [], error: null });
  q.maybeSingle = () => Promise.resolve({ data: pages.shift() ?? null, error: null });
  return { calls, from: (t) => { calls.push(`from:${t}`); return q; } };
}
const P = { card_id: '74677422', set_code: 'SDJ-G001', language: 'DE', rarity: 'Ultra Rare' };
const CLOUD = { ...P, median_all: '7.5', n_all: 12, median_first: null, n_first: 0, last_sold_at: '2026-09-28T14:03:00+00:00', last_sold_price: '6',
  sales: [{ title: 'SDJ-G001', price: 6, sold_at: '2026-09-28T14:03:00Z', url: 'https://www.ebay.de/itm/1', first: false }],
  status: 'ok', checked_at: '2026-10-05T04:30:00+00:00', updated_at: '2026-10-05T04:30:01+00:00' };

test('ebay_sold_prices ist ein Nur-Lese-Strom (nie gepusht)', () => {
  assert.ok(sync._READ_ONLY_TABLES.includes('ebay_sold_prices'));
  assert.ok(!sync._PUSHED_TABLES.includes('ebay_sold_prices'));
  assert.deepEqual(EBAY_SOLD_COLS.slice(0, 4), ['card_id', 'set_code', 'language', 'rarity']);
});

test('Pull: Zahlen als Number, sales als JSON-Text; soldRowFor liefert geparst; Cursor gesetzt', async () => {
  const db = freshDb();
  assert.equal(await sync._pullReadOnlyTable(fakeClient([[CLOUD]]), db, 'ebay_sold_prices'), 1);
  const r = soldRowFor(db, P);
  assert.equal(r.median_all, 7.5);
  assert.equal(r.last_sold_price, 6);
  assert.deepEqual(r.sales, CLOUD.sales);
  assert.equal(soldRowFor(db, { ...P, rarity: 'Common' }), null);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'sync_ebay_sold_last_pull'").get().value, CLOUD.updated_at);
});

test('soldRowFor: kaputtes sales-JSON -> leere Liste statt Absturz', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO ebay_sold_prices (card_id, set_code, language, rarity, n_all, n_first, sales, status, checked_at, updated_at)
              VALUES (?, ?, ?, ?, 0, 0, '{kaputt', 'zu_wenig', 'x', 'x')`).run(P.card_id, P.set_code, P.language, P.rarity);
  assert.deepEqual(soldRowFor(db, P).sales, []);
});

test('Zugangsstatus: Pull speichert, insightsAccess liest; ohne Stand unbekannt', async () => {
  const db = freshDb();
  assert.equal(insightsAccess(db), 'unbekannt');
  assert.equal(await sync._pullInsightsState(fakeClient([{ access: 'fehlt', last_error: null, last_run_at: '2026-10-05T04:30:00+00:00' }]), db), true);
  assert.equal(insightsAccess(db), 'fehlt');
  assert.equal(await sync._pullInsightsState(fakeClient([{ access: 'fehlt', last_error: null, last_run_at: '2026-10-05T04:30:00+00:00' }]), db), false);
});

test('Fehlende Cloud-Tabelle: Pull wirft (Aufrufer protokolliert), lokale Abfrage bleibt null', async () => {
  const db = freshDb();
  const c = { from: () => ({ select() { return this; }, gt() { return this; }, order() { return this; },
    range: () => Promise.resolve({ data: null, error: { message: 'relation "public.ebay_sold_prices" does not exist' } }) }) };
  await assert.rejects(() => sync._pullReadOnlyTable(c, db, 'ebay_sold_prices'), /ebay_sold_prices/);
  assert.equal(soldRowFor(db, P), null);
});
```

In `ipc-channels.test.cjs` vor der `for`-Schleife ergänzen und in die Schleife aufnehmen:
```js
// eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §7): Zeile eines Drucks lesen, Einzelabruf.
const EBAY_SOLD_CHANNELS = ['ebay-sold-get', 'ebay-sold-check'];
```
(`...EBAY_SOLD_CHANNELS` an das Array der `for`-Schleife anhängen.)

- [ ] **Step 2: Fehlschlag prüfen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/ebay-sold.test.cjs electron/ipc-channels.test.cjs`
Expected: FAIL — `ebay-sold.cjs` fehlt, Kanäle fehlen.

- [ ] **Step 3: `ebay-schema.cjs`**

Nach den bestehenden `*_COLS`-Konstanten:
```js
// eBay „zuletzt verkauft" E1: NUR-LESE-Spiegel wie ebay_listings (sync.cjs READ_ONLY_STREAMS); sales = JSON-Text.
const EBAY_SOLD_COLS = ['card_id', 'set_code', 'language', 'rarity', 'median_all', 'n_all', 'median_first', 'n_first',
  'last_sold_at', 'last_sold_price', 'sales', 'status', 'checked_at', 'updated_at'];
```
Im `db.exec` von `ensureEbaySchema` anhängen:
```sql
      CREATE TABLE IF NOT EXISTS ebay_sold_prices (
        card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL, rarity TEXT NOT NULL,
        median_all REAL, n_all INTEGER, median_first REAL, n_first INTEGER, last_sold_at TEXT, last_sold_price REAL,
        sales TEXT, status TEXT, checked_at TEXT, updated_at TEXT,
        PRIMARY KEY (card_id, set_code, language, rarity));
```
`EBAY_SOLD_COLS` in `module.exports` aufnehmen.

- [ ] **Step 4: `sync.cjs`**

Import Z. 13 um `EBAY_SOLD_COLS` ergänzen. In `READ_ONLY_STREAMS`:
```js
  ebay_sold_prices: { cols: EBAY_SOLD_COLS, key: 'card_id', cursor: 'sync_ebay_sold_last_pull',
    nums: new Set(['median_all', 'median_first', 'last_sold_price']), jsons: new Set(['sales']) },
```
In `readOnlyValue` als erste Zeile:
```js
  if (s.jsons && s.jsons.has(k)) return v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
```
Nach `pullEbayStatus`:
```js
// eBay „zuletzt verkauft" E1: Zugangsstatus (eine Zeile) -> settings.ebay_insights_state; true bei Änderung.
async function pullInsightsState(c, db) {
  const { data, error } = await c.from('ebay_insights_state').select('access,last_error,last_run_at').eq('id', 1).maybeSingle();
  if (error) throw new Error('Pull ebay_insights_state failed: ' + error.message);
  const next = JSON.stringify(data ?? null);
  const changed = getSetting(db, 'ebay_insights_state') !== next;
  setSetting(db, 'ebay_insights_state', next);
  return changed;
}
```
In `pullEbaySafe` nach der `ebay_orders`-Zeile:
```js
    try { changed = (await pullReadOnlyTable(c, db, 'ebay_sold_prices')) > 0 || changed; } catch (e) { console.error('[sync] ebay_sold_prices pull:', e.message); }
    try { changed = (await pullInsightsState(c, db)) || changed; } catch (e) { console.error('[sync] ebay_insights_state pull:', e.message); }
```
Test-Export neben `_pullReadOnlyTable`: `_pullInsightsState: pullInsightsState,`.

- [ ] **Step 5: `ebay-sold.cjs`**

```js
// desktop/electron/ebay-sold.cjs
// eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §7): lokale Leser des Nur-Lese-Spiegels für die IPC-Kanäle.
function soldRowFor(db, p) {
  const r = db.prepare('SELECT * FROM ebay_sold_prices WHERE card_id = ? AND set_code = ? AND language = ? AND rarity = ?')
    .get(String(p.card_id), p.set_code, p.language || 'DE', p.rarity);
  if (!r) return null;
  let sales = [];
  try { const s = JSON.parse(r.sales ?? '[]'); if (Array.isArray(s)) sales = s; } catch { /* kaputter Text -> keine Belege */ }
  return { ...r, sales };
}

function insightsAccess(db) {
  try {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'ebay_insights_state'").get()?.value;
    const a = raw ? JSON.parse(raw)?.access : null;
    return a === 'aktiv' || a === 'fehlt' ? a : 'unbekannt';
  } catch { return 'unbekannt'; }
}

module.exports = { soldRowFor, insightsAccess };
```

- [ ] **Step 6: IPC in `main.cjs` + `preload.cjs`**

`main.cjs` oben bei den Requires: `const { soldRowFor, insightsAccess } = require('./ebay-sold.cjs');`. Nach `ipcMain.handle('ebay-orders', …)`:
```js
// eBay „zuletzt verkauft" E1 §7: Zeile eines Drucks aus dem Nur-Lese-Spiegel; Einzelabruf über die Edge Function.
const soldPrinting = (p) => ({ card_id: String(p?.card_id ?? p?.id ?? ''), set_code: String(p?.set_code ?? ''), language: String(p?.language || 'DE'), rarity: String(p?.rarity ?? '') });
ipcMain.handle('ebay-sold-get', (event, p) => ({ row: soldRowFor(db, soldPrinting(p)), access: insightsAccess(db) }));
ipcMain.handle('ebay-sold-check', async (event, p) => {
    try {
        const printing = soldPrinting(p);
        const r = await invokeEbay('ebay-sold-prices', { printing });
        if (sync) await sync.syncNow();
        return { ...r, row: soldRowFor(db, printing), access: insightsAccess(db) };
    } catch (e) { console.error('[ebay-sold-check]', e.message); return { ok: false, error: 'eBay-Abruf fehlgeschlagen.' }; }
});
```
`preload.cjs` im eBay-Block:
```js
  ebaySoldGet: (printing) => ipcRenderer.invoke('ebay-sold-get', printing),
  ebaySoldCheck: (printing) => ipcRenderer.invoke('ebay-sold-check', printing),
```

- [ ] **Step 7: Tests**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/ebay-sold.test.cjs electron/ipc-channels.test.cjs electron/ebay-sync.test.cjs` → PASS

- [ ] **Step 8: Commit**

```bash
rtk git add desktop/electron/ebay-schema.cjs desktop/electron/sync.cjs desktop/electron/ebay-sold.cjs desktop/electron/ebay-sold.test.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
rtk git commit -m "feat(ebay-sold): PC-Spiegel der eBay-Verkaufswerte und IPC-Kanäle"
```

---

### Task 7: Anzeigezeile als Zwilling (JS + Kotlin)

**Files:**
- Create: `docs/fixtures/ebay/sold-line.json`
- Create: `desktop/src/utils/ebaySold.js`, `desktop/src/utils/ebaySold.test.mjs`
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/EbaySold.kt`, `android/app/src/test/java/com/example/yugiohscanner/EbaySoldTest.kt`

**Interfaces:**
- Produces:
  - JS: `ebaySoldLine(access: string, row: object|null) -> string`, `ebaySoldCanCheck(access: string) -> boolean`
  - Kotlin: `object EbaySold { data class SoldRow(val status: String, val medianAll: Double?, val nAll: Int, val medianFirst: Double?, val nFirst: Int, val lastSoldAt: String?, val sales: List<Sale>); data class Sale(val title: String, val price: Double, val soldAt: String, val url: String?, val first: Boolean); fun line(access: String, row: SoldRow?): String; fun canCheck(access: String): Boolean }`

- [ ] **Step 1: Fixture `docs/fixtures/ebay/sold-line.json`**

```json
{
  "_comment": "eBay „zuletzt verkauft" E1 §8 -- Anzeigezeile im Karten-Detail. ZWILLING: desktop/src/utils/ebaySold.js (ebaySold.test.mjs) und android/.../cloud/EbaySold.kt (EbaySoldTest.kt). Wer eine Fassung ändert, ändert beide.",
  "line": [
    { "name": "Zugang fehlt schlägt alles", "access": "fehlt", "row": { "status": "ok", "median_all": 7.5, "n_all": 12, "median_first": null, "n_first": 0, "last_sold_at": "2026-09-28T14:03:00+00:00" }, "line": "eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet", "canCheck": false },
    { "name": "noch nie geprüft (aktiv)", "access": "aktiv", "row": null, "line": "eBay: noch nicht geprüft", "canCheck": true },
    { "name": "noch nie geprüft (unbekannt)", "access": "unbekannt", "row": null, "line": "eBay: noch nicht geprüft", "canCheck": true },
    { "name": "Wert", "access": "aktiv", "row": { "status": "ok", "median_all": 7.5, "n_all": 12, "median_first": null, "n_first": 0, "last_sold_at": "2026-09-28T14:03:00+00:00" }, "line": "eBay verkauft: 7,50 € · 12 Verkäufe · zuletzt 28.09.", "canCheck": true },
    { "name": "Wert mit 1. Auflage", "access": "aktiv", "row": { "status": "ok", "median_all": 7.5, "n_all": 12, "median_first": 9, "n_first": 4, "last_sold_at": "2026-09-28T14:03:00Z" }, "line": "eBay verkauft: 7,50 € · 12 Verkäufe · zuletzt 28.09. · 1. Aufl. 9,00 € (4)", "canCheck": true },
    { "name": "Tausenderpunkt, ohne Datum", "access": "aktiv", "row": { "status": "ok", "median_all": 1234.5, "n_all": 3, "median_first": null, "n_first": 0, "last_sold_at": null }, "line": "eBay verkauft: 1.234,50 € · 3 Verkäufe", "canCheck": true },
    { "name": "zu wenig", "access": "aktiv", "row": { "status": "zu_wenig", "median_all": null, "n_all": 2, "median_first": null, "n_first": 0, "last_sold_at": "2026-09-28T14:03:00Z" }, "line": "eBay: zu wenig Verkäufe (2)", "canCheck": true },
    { "name": "keiner", "access": "aktiv", "row": { "status": "zu_wenig", "median_all": null, "n_all": 0, "median_first": null, "n_first": 0, "last_sold_at": null }, "line": "eBay: zu wenig Verkäufe (0)", "canCheck": true },
    { "name": "fehler", "access": "aktiv", "row": { "status": "fehler", "median_all": null, "n_all": 0, "median_first": null, "n_first": 0, "last_sold_at": null }, "line": "eBay: Abruf fehlgeschlagen", "canCheck": true }
  ]
}
```

- [ ] **Step 2: Failing JS test `ebaySold.test.mjs`**

```js
import assert from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';
import { ebaySoldLine, ebaySoldCanCheck } from './ebaySold.js';

const FIX = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/ebay/sold-line.json', import.meta.url), 'utf8'));
test('Fixture eBay-Zeile (Zwilling EbaySold.kt)', () => {
  for (const c of FIX.line) {
    // Intl setzt ein geschütztes Leerzeichen vor das Euro-Zeichen; die Fixture schreibt ein normales.
    assert.strictEqual(ebaySoldLine(c.access, c.row).replace(/ /g, ' '), c.line, c.name);
    assert.strictEqual(ebaySoldCanCheck(c.access), c.canCheck, c.name);
  }
});
```

- [ ] **Step 3: Failing Kotlin test `EbaySoldTest.kt`**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.EbaySold
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class EbaySoldTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/ebay/sold-line.json"))

    private fun row(o: JSONObject?): EbaySold.SoldRow? = o?.let {
        EbaySold.SoldRow(
            status = it.getString("status"),
            medianAll = if (it.isNull("median_all")) null else it.getDouble("median_all"),
            nAll = it.getInt("n_all"),
            medianFirst = if (it.isNull("median_first")) null else it.getDouble("median_first"),
            nFirst = it.getInt("n_first"),
            lastSoldAt = if (it.isNull("last_sold_at")) null else it.getString("last_sold_at"),
            sales = emptyList(),
        )
    }

    @Test
    fun `Fixture eBay-Zeile`() {
        val cases = fix.getJSONArray("line")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val r = if (c.isNull("row")) null else row(c.getJSONObject("row"))
            assertEquals(c.getString("name"), c.getString("line"), EbaySold.line(c.getString("access"), r))
            assertEquals(c.getString("name"), c.getBoolean("canCheck"), EbaySold.canCheck(c.getString("access")))
        }
    }
}
```

- [ ] **Step 4: Fehlschlag prüfen**

Run (in `desktop/`): `node --test src/utils/ebaySold.test.mjs` → FAIL (Modul fehlt)
Run (in `android/`): `./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.EbaySoldTest"` → FAIL (unresolved reference EbaySold)

- [ ] **Step 5: `desktop/src/utils/ebaySold.js`**

```js
// eBay „zuletzt verkauft" E1 §8 -- Anzeigezeile im Karten-Detail. ZWILLING: android/.../cloud/EbaySold.kt,
// gemeinsame Fixture docs/fixtures/ebay/sold-line.json. Datum aus den ersten 10 Zeichen des ISO-Textes (UTC-Tag),
// damit beide Plattformen ohne Zeitzonen-Umrechnung dasselbe zeigen.
import { fmtEUR } from './format.js';

const dayMonth = (iso) => (typeof iso === 'string' && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : null);

export function ebaySoldLine(access, row) {
  if (access === 'fehlt') return 'eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet';
  if (!row) return 'eBay: noch nicht geprüft';
  if (row.status === 'fehler') return 'eBay: Abruf fehlgeschlagen';
  if (row.status !== 'ok' || row.median_all == null) return `eBay: zu wenig Verkäufe (${Number(row.n_all) || 0})`;
  let line = `eBay verkauft: ${fmtEUR(row.median_all)} · ${row.n_all} Verkäufe`;
  const d = dayMonth(row.last_sold_at);
  if (d) line += ` · zuletzt ${d}`;
  if (row.median_first != null) line += ` · 1. Aufl. ${fmtEUR(row.median_first)} (${row.n_first})`;
  return line;
}

export const ebaySoldCanCheck = (access) => access !== 'fehlt';
```

- [ ] **Step 6: `EbaySold.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import java.util.Locale

/**
 * eBay „zuletzt verkauft" E1 §8 -- Anzeigezeile im Karten-Detail. ZWILLING: desktop/src/utils/ebaySold.js,
 * gemeinsame Fixture docs/fixtures/ebay/sold-line.json. Datum aus den ersten 10 Zeichen des ISO-Textes (UTC-Tag).
 */
object EbaySold {
    data class Sale(val title: String, val price: Double, val soldAt: String, val url: String?, val first: Boolean)
    data class SoldRow(
        val status: String, val medianAll: Double?, val nAll: Int, val medianFirst: Double?, val nFirst: Int,
        val lastSoldAt: String?, val sales: List<Sale>,
    )

    private fun eur(v: Double) = String.format(Locale.GERMANY, "%,.2f €", v)
    private fun dayMonth(iso: String?) = if (iso != null && iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}." else null

    fun line(access: String, row: SoldRow?): String {
        if (access == "fehlt") return "eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet"
        if (row == null) return "eBay: noch nicht geprüft"
        if (row.status == "fehler") return "eBay: Abruf fehlgeschlagen"
        val median = row.medianAll
        if (row.status != "ok" || median == null) return "eBay: zu wenig Verkäufe (${row.nAll})"
        val sb = StringBuilder("eBay verkauft: ${eur(median)} · ${row.nAll} Verkäufe")
        dayMonth(row.lastSoldAt)?.let { sb.append(" · zuletzt $it") }
        row.medianFirst?.let { sb.append(" · 1. Aufl. ${eur(it)} (${row.nFirst})") }
        return sb.toString()
    }

    fun canCheck(access: String) = access != "fehlt"
}
```

- [ ] **Step 7: Tests laufen lassen**

Run (in `desktop/`): `node --test src/utils/ebaySold.test.mjs` → PASS
Run (in `android/`): `./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.EbaySoldTest"` → PASS

- [ ] **Step 8: Commit**

```bash
rtk git add docs/fixtures/ebay/sold-line.json desktop/src/utils/ebaySold.js desktop/src/utils/ebaySold.test.mjs android/app/src/main/java/com/example/yugiohscanner/cloud/EbaySold.kt android/app/src/test/java/com/example/yugiohscanner/EbaySoldTest.kt
rtk git commit -m "feat(ebay-sold): Anzeigezeile als Zwilling JS/Kotlin mit gemeinsamer Fixture"
```

---

### Task 8: Anzeige am PC (Karten-Detail)

**Files:**
- Create: `desktop/src/components/EbaySoldRow.jsx`
- Modify: `desktop/src/components/CardDetailPanel.jsx` (Import; im `localVariants.map` direkt nach der Preiszeile `firstEdLine(variant) ?? …`, Z. ~308)
- Test: `desktop/src/utils/theme.test.js`, `desktop/src/utils/noLegacyColors.test.js` (bestehend, müssen grün bleiben)

**Interfaces:**
- Consumes: `window.api.ebaySoldGet`, `window.api.ebaySoldCheck`, `window.api.openExternal` (Task 6, bestehend); `ebaySoldLine`, `ebaySoldCanCheck` (Task 7); `fmtEUR` aus `../utils/format`.
- Produces: `<EbaySoldRow variant={variant} />` — `variant` hat `id`, `set_code`, `language`, `rarity`.

- [ ] **Step 1: Komponente**

```jsx
// eBay „zuletzt verkauft" E1 §8 -- Zeile je Druck im Karten-Detail: Wert/Zustand, aufklappbare Belege, Knopf
// "jetzt bei eBay prüfen". Text-Regel im Zwilling utils/ebaySold.js (Gegenstück ui/EbaySoldRow.kt).
import { useEffect, useState } from 'react';
import { ebaySoldLine, ebaySoldCanCheck } from '../utils/ebaySold';
import { fmtEUR } from '../utils/format';

const printingOf = (v) => ({ card_id: String(v.id), set_code: v.set_code, language: v.language || 'DE', rarity: v.rarity });

export default function EbaySoldRow({ variant }) {
  const [state, setState] = useState({ row: null, access: 'unbekannt', loaded: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const key = `${variant.id}|${variant.set_code}|${variant.language}|${variant.rarity}`;

  useEffect(() => {
    let alive = true;
    if (!window.api?.ebaySoldGet) return undefined;
    window.api.ebaySoldGet(printingOf(variant))
      .then((r) => { if (alive) setState({ row: r?.row ?? null, access: r?.access ?? 'unbekannt', loaded: true }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, loaded: true })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!state.loaded) return null;
  const sales = state.row?.sales ?? [];
  const check = async () => {
    setBusy(true); setError(null);
    try {
      const r = await window.api.ebaySoldCheck(printingOf(variant));
      setState({ row: r?.row ?? state.row, access: r?.access ?? state.access, loaded: true });
      if (r && r.ok === false && r.access !== 'fehlt') setError(r.error || 'eBay-Abruf fehlgeschlagen.');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button type="button" className="text-xs text-muted text-left disabled:cursor-default"
          disabled={sales.length === 0} onClick={() => setOpen((o) => !o)}>
          {ebaySoldLine(state.access, state.row)}{sales.length > 0 ? (open ? ' ▾' : ' ▸') : ''}
        </button>
        {ebaySoldCanCheck(state.access) && (
          <button type="button" className="text-xs text-accent hover:underline disabled:opacity-50" disabled={busy} onClick={check}>
            {busy ? 'prüfe …' : 'jetzt bei eBay prüfen'}
          </button>
        )}
      </div>
      {error && <span className="text-xs text-bad">{error}</span>}
      {open && sales.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-2 border-l border-line">
          {sales.map((s, i) => (
            <li key={i} className="text-xs text-muted flex gap-2">
              <span className="font-mono">{s.sold_at ? `${s.sold_at.slice(8, 10)}.${s.sold_at.slice(5, 7)}.` : '–'}</span>
              <span className="font-mono">{fmtEUR(s.price)}</span>
              {s.first && <span>1. Aufl.</span>}
              {s.url
                ? <button type="button" className="truncate text-left hover:underline" onClick={() => window.api?.openExternal?.(s.url)}>{s.title}</button>
                : <span className="truncate">{s.title}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Farb-Token laut `tailwind.config.js`: `surface line text muted accent accent-fg good warn bad` — nur diese verwenden.

- [ ] **Step 2: In `CardDetailPanel.jsx` einbinden**

Import oben: `import EbaySoldRow from './EbaySoldRow';`
Direkt nach `<span className="text-xs text-text">{firstEdLine(variant) ?? fmtEUR(variant.price || 0)}</span>`:
```jsx
                <EbaySoldRow variant={variant} />
```

- [ ] **Step 3: Tests + Lint + Build**

Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → PASS (inkl. `theme.test.js`, `noLegacyColors.test.js`)
Run: `rtk npm run lint` → genau 5 Altfehler
Run: `rtk npm run build` → erfolgreich

- [ ] **Step 4: Sichtprüfung im Dev-Fenster**

`npm run electron:dev` (Controller), Karte SDJ-G001 öffnen: unter der Preiszeile steht „eBay: noch nicht geprüft" mit Knopf (vor eingespieltem SQL) — kein Absturz, keine Konsolenfehler. Screenshot ins Ledger.

- [ ] **Step 5: Commit**

```bash
rtk git add desktop/src/components/EbaySoldRow.jsx desktop/src/components/CardDetailPanel.jsx
rtk git commit -m "feat(ebay-sold): eBay-Verkaufszeile im Karten-Detail (PC)"
```

---

### Task 9: Anzeige auf dem Handy

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/EbaySoldRepository.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/EbaySoldRepositoryTest.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/EbaySoldRow.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt` (nach der `Valuation.firstEdLine(v)`-Zeile, Z. ~225)

**Interfaces:**
- Consumes: `EbaySold.SoldRow`, `EbaySold.Sale`, `EbaySold.line`, `EbaySold.canCheck` (Task 7); `SupabaseCloud.base()/key()/token()/http()/signIn()/jsonMedia`; `EbayRepository.invoke(name, body)` (bestehend); `openWebLink` (`ml/WebLink.kt`); `CardRow` (`id`, `setCode`, `language`, `rarity`).
- Produces:
  - `EbaySoldRepository.parseRow(json: String): EbaySold.SoldRow?` (erste Zeile eines PostgREST-Arrays)
  - `EbaySoldRepository.parseAccess(json: String): String`
  - `suspend fun EbaySoldRepository.load(card: CardRow): Pair<String, EbaySold.SoldRow?>` (access, row)
  - `suspend fun EbaySoldRepository.check(card: CardRow): Pair<String, String?>` (access, Fehlermeldung oder null)
  - `@Composable fun EbaySoldRow(card: CardRow)`

- [ ] **Step 1: Failing test `EbaySoldRepositoryTest.kt`**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.EbaySoldRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EbaySoldRepositoryTest {
    @Test
    fun `Zeile aus PostgREST-Array, Zahlen als Text, Belege`() {
        val r = EbaySoldRepository.parseRow("""[{"status":"ok","median_all":"7.5","n_all":12,"median_first":null,"n_first":0,
            "last_sold_at":"2026-09-28T14:03:00+00:00","sales":[{"title":"SDJ-G001","price":6,"sold_at":"2026-09-28T14:03:00Z","url":"https://www.ebay.de/itm/1","first":false}]}]""")!!
        assertEquals("ok", r.status); assertEquals(7.5, r.medianAll!!, 0.0); assertEquals(12, r.nAll)
        assertNull(r.medianFirst); assertEquals(1, r.sales.size); assertEquals(6.0, r.sales[0].price, 0.0)
        assertEquals("https://www.ebay.de/itm/1", r.sales[0].url)
    }

    @Test
    fun `leeres Array oder Unsinn -> null`() {
        assertNull(EbaySoldRepository.parseRow("[]"))
        assertNull(EbaySoldRepository.parseRow("kein json"))
    }

    @Test
    fun `Zugangsstatus`() {
        assertEquals("fehlt", EbaySoldRepository.parseAccess("""[{"access":"fehlt"}]"""))
        assertEquals("unbekannt", EbaySoldRepository.parseAccess("[]"))
        assertEquals("unbekannt", EbaySoldRepository.parseAccess("""[{"access":"komisch"}]"""))
    }
}
```

- [ ] **Step 2: Fehlschlag prüfen**

Run (in `android/`): `./gradlew testDebugUnitTest --tests "com.example.yugiohscanner.EbaySoldRepositoryTest"` → FAIL (unresolved reference)

- [ ] **Step 3: `EbaySoldRepository.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/**
 * eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §7/§8): liest die Zeile EINES Drucks beim Öffnen des Details
 * (E1 braucht den Wert nur dort; der volle Spiegel kommt mit E2) und stößt den Einzelabruf an.
 */
object EbaySoldRepository {
    private const val COLS = "status,median_all,n_all,median_first,n_first,last_sold_at,sales"

    private fun numOrNull(o: JSONObject, k: String): Double? =
        if (!o.has(k) || o.isNull(k)) null else o.optString(k).toDoubleOrNull()

    fun parseRow(json: String): EbaySold.SoldRow? = runCatching {
        val arr = JSONArray(json)
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        val s = o.optJSONArray("sales") ?: JSONArray()
        val sales = (0 until s.length()).mapNotNull { i ->
            val x = s.optJSONObject(i) ?: return@mapNotNull null
            val price = numOrNull(x, "price") ?: return@mapNotNull null
            EbaySold.Sale(x.optString("title"), price, x.optString("sold_at"), if (x.isNull("url")) null else x.optString("url"), x.optBoolean("first"))
        }
        EbaySold.SoldRow(
            status = o.optString("status"), medianAll = numOrNull(o, "median_all"), nAll = o.optInt("n_all"),
            medianFirst = numOrNull(o, "median_first"), nFirst = o.optInt("n_first"),
            lastSoldAt = if (o.isNull("last_sold_at")) null else o.optString("last_sold_at"), sales = sales,
        )
    }.getOrNull()

    fun parseAccess(json: String): String = runCatching {
        val a = JSONArray(json).optJSONObject(0)?.optString("access")
        if (a == "aktiv" || a == "fehlt") a else "unbekannt"
    }.getOrDefault("unbekannt")

    private suspend fun get(table: String, params: List<Pair<String, String>>): String = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder().apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        fun req() = Request.Builder().url(url).addHeader("apikey", SupabaseCloud.key()).addHeader("Authorization", "Bearer ${SupabaseCloud.token()}").build()
        var r = SupabaseCloud.http().newCall(req()).execute()
        if (r.code == 401) { r.close(); SupabaseCloud.signIn(); r = SupabaseCloud.http().newCall(req()).execute() }
        r.use { if (it.isSuccessful) it.body?.string().orEmpty() else "[]" } // fehlende Tabelle (SQL nicht eingespielt) -> leer
    }

    suspend fun load(card: CardRow): Pair<String, EbaySold.SoldRow?> {
        val access = parseAccess(get("ebay_insights_state", listOf("select" to "access", "id" to "eq.1")))
        val row = parseRow(get("ebay_sold_prices", listOf("select" to COLS, "card_id" to "eq.${card.id}", "set_code" to "eq.${card.setCode}",
            "language" to "eq.${card.language}", "rarity" to "eq.${card.rarity ?: ""}")))
        return access to row
    }

    suspend fun check(card: CardRow): Pair<String, String?> {
        val r = EbayRepository.invoke("ebay-sold-prices", JSONObject().put("printing", JSONObject()
            .put("card_id", card.id).put("set_code", card.setCode).put("language", card.language).put("rarity", card.rarity ?: "")))
        val access = r.optString("access", "unbekannt")
        val err = if (r.optBoolean("ok") || access == "fehlt") null else r.optString("error", "eBay-Abruf fehlgeschlagen.")
        return access to err
    }
}
```

- [ ] **Step 4: `ui/EbaySoldRow.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.EbaySold
import com.example.yugiohscanner.cloud.EbaySoldRepository
import com.example.yugiohscanner.ml.openWebLink
import kotlinx.coroutines.launch
import java.util.Locale

/** eBay „zuletzt verkauft" E1 §8 -- Gegenstück zu desktop/src/components/EbaySoldRow.jsx; Text aus EbaySold.line. */
@Composable
fun EbaySoldRow(card: CardRow) {
    val key = card.printingKey()
    var access by remember(key) { mutableStateOf("unbekannt") }
    var row by remember(key) { mutableStateOf<EbaySold.SoldRow?>(null) }
    var loaded by remember(key) { mutableStateOf(false) }
    var open by remember(key) { mutableStateOf(false) }
    var busy by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    LaunchedEffect(key) {
        runCatching { EbaySoldRepository.load(card) }.onSuccess { (a, r) -> access = a; row = r }
        loaded = true
    }
    if (!loaded) return
    val sales = row?.sales.orEmpty()
    Column {
        Row {
            Text(EbaySold.line(access, row) + if (sales.isEmpty()) "" else if (open) " ▾" else " ▸",
                style = MaterialTheme.typography.bodySmall, color = Muted,
                modifier = Modifier.weight(1f).clickable(enabled = sales.isNotEmpty()) { open = !open })
            if (EbaySold.canCheck(access)) {
                TextButton(enabled = !busy, onClick = {
                    scope.launch {
                        busy = true; error = null
                        runCatching { EbaySoldRepository.check(card) }
                            .onSuccess { (a, e) -> access = a; error = e }
                            .onFailure { error = it.message ?: "eBay-Abruf fehlgeschlagen." }
                        runCatching { EbaySoldRepository.load(card) }.onSuccess { (a, r) -> access = a; row = r }
                        busy = false
                    }
                }) { Text(if (busy) "prüfe …" else "jetzt bei eBay prüfen", style = MaterialTheme.typography.labelSmall) }
            }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        if (open) sales.forEach { s ->
            Row(Modifier.padding(start = 8.dp).clickable(enabled = s.url != null) { openWebLink(ctx, s.url) }) {
                val d = if (s.soldAt.length >= 10) "${s.soldAt.substring(8, 10)}.${s.soldAt.substring(5, 7)}." else "–"
                Text(d, style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
                Spacer(Modifier.width(6.dp))
                Text(String.format(Locale.GERMANY, "%,.2f €", s.price), style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
                Spacer(Modifier.width(6.dp))
                Text((if (s.first) "1. Aufl. " else "") + s.title, style = MaterialTheme.typography.labelSmall, color = Muted, maxLines = 1)
            }
        }
    }
}
```

Vor dem Schreiben prüfen: `Muted` und `MonoFontFamily` sind in `ui/` sichtbar (werden in `CardDetailScreen.kt` ohne Import genutzt → gleiches Paket); `CardRow.printingKey()` existiert (in `CardDetailScreen.kt` genutzt). `Modifier.weight` braucht den `RowScope` — steht innerhalb `Row { }`.

- [ ] **Step 5: In `CardDetailScreen.kt` einbinden**

Direkt nach dem Block `Valuation.firstEdLine(v)?.let { … }`:
```kotlin
                        // eBay „zuletzt verkauft" E1 §8 (Gegenstück zu EbaySoldRow.jsx).
                        EbaySoldRow(v)
```

- [ ] **Step 6: Tests + Build**

Run (in `android/`): `./gradlew testDebugUnitTest` → PASS (alle)
Run: `./gradlew assembleRelease` → BUILD SUCCESSFUL

- [ ] **Step 7: Commit**

```bash
rtk git add android/app/src/main/java/com/example/yugiohscanner/cloud/EbaySoldRepository.kt android/app/src/test/java/com/example/yugiohscanner/EbaySoldRepositoryTest.kt android/app/src/main/java/com/example/yugiohscanner/ui/EbaySoldRow.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt
rtk git commit -m "feat(ebay-sold): eBay-Verkaufszeile im Karten-Detail (Handy)"
```

---

### Task 10: Gesamtlauf, Einspielen, Abnahme (Controller + Nutzer)

**Files:** keine neuen; Ledger fortschreiben.

- [ ] **Step 1: Alle Tests**

Run (Wurzel): `deno test --allow-read supabase/functions/` → PASS
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → PASS
Run: `node --test src/utils/*.test.js src/utils/*.test.mjs` → PASS
Run: `rtk npm run lint` → 5 Altfehler
Run (in `android/`): `./gradlew testDebugUnitTest` → PASS

- [ ] **Step 2: Bauen**

Installer aus dem Hauptordner: `rtk npm run dist` (in `desktop/`). APK: `./gradlew assembleRelease`; per `adb install -r` aufs Handy, App starten, `adb logcat -b crash -d` leer.

- [ ] **Step 3: Einspielen (Nutzer, Anleitung README_ebay_cloud.md)**

1. `supabase/ebay_sold_schema.sql` ausführen.
2. `supabase functions deploy ebay-sold-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn`.
3. `supabase/ebay_sold_cron.sql` mit Secret ausführen; `select jobname, schedule from cron.job;` zeigt `ebay-sold-prices`.
4. Installer + APK installieren.

- [ ] **Step 4: Abnahme vor der Freischaltung**

1. PC-Detail SDJ-G001: „eBay: noch nicht geprüft" + Knopf. Knopf drücken → Zeile wechselt zu „eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet", Knopf verschwindet.
2. `select * from public.ebay_insights_state;` → `access = 'fehlt'`.
3. Handy-Detail SDJ-G001 nach Sync: gleiche Zeile.
4. Nach dem nächsten Cron-Lauf (04:30 UTC) `last_run_at` gesetzt, weiterhin `fehlt`, keine Zeilen in `ebay_sold_prices`.

- [ ] **Step 5: Abnahme nach der Freischaltung (später, eigener Termin)**

1. Nächster Lauf → `access = 'aktiv'`, Zeilen in `ebay_sold_prices`.
2. „jetzt bei eBay prüfen" bei SDJ-G001 → Wert + Belege; eine echte `item_sales`-Antwort (aus den Funktions-Logs oder per Einzelabruf) mit dem nachgebauten Format in `ebay-client_test.ts` vergleichen; Abweichungen → Fix-Aufgabe.
3. Stichprobe 5 Drucke: Belege gehören zum richtigen Druck.

- [ ] **Step 6: Merge nach Freigabe** (superpowers:finishing-a-development-branch)
