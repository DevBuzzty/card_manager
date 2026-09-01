# eBay Deals Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eBay (official Browse API) as a second Deals source in the Supabase Edge Function, with a per-watch condition filter (new / used / any).

**Architecture:** Extend the Edge Function's adapter map with an `ebay` adapter (OAuth app-token → Browse API search, fixed-price/EUR/ship-to-DE). Widen the adapter signature to receive the watch row so eBay can read `max_price` + a new `condition` column. Everything downstream (price guard, `matchesQuery`, idempotent `deal_alerts` upsert) is unchanged. Clients gain only a condition selector; the source shows up automatically (watches already default to all adapters, and both UIs render `source` generically).

**Tech Stack:** Supabase Edge Function (Deno/TypeScript), Postgres migration, Electron (CommonJS main + React renderer), Android/Kotlin (Compose).

## Global Constraints

- The Edge Function is **Deno**. Do not change the existing `scrapeKleinanzeigen` regexes, `normalize`, or `matchesQuery`.
- eBay adapter: **fixed-price only** (`buyingOptions:{FIXED_PRICE}`), marketplace **`EBAY_DE`**, currency **EUR**, **`deliveryCountry:DE`** (includes EU sellers who ship to DE).
- Condition values: `new` | `used` | `any` (column default `any`). Mapping:
  - `new` → request filter `conditionIds:{1000|1500}`.
  - `used` → **no** request condition filter; the adapter drops any item whose `conditionId` is `1000` or `1500` (everything else — used, refurbished, for-parts — is kept). "Gebraucht = alles Nicht-Neue".
  - `any` → no filter, no post-filter.
- Secrets `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` live only in Supabase function secrets. If either is missing, the eBay adapter returns `[]` (silently disabled). **Never** write these secrets to the repo, memory, or any client.
- Only the eBay adapter honors `condition`; Kleinanzeigen ignores it.
- Back-compat: existing watches (no `condition`) behave as `any`; the whole feature degrades to "Kleinanzeigen only" if eBay secrets are unset.
- `desktop/electron/preload.cjs` `addDealWatch: (data) => invoke('add-deal-watch', data)` passes the object straight through — **no preload edit needed**; the new `condition` field rides along.
- Do **not** touch the disabled legacy desktop poller (`desktop/electron/deals/*.cjs`).

---

## File Structure

- **Create** `supabase/deals_condition_migration.sql` — adds `deal_watches.condition`.
- **Create** `supabase/functions/scrape-deals/ebay.ts` — eBay OAuth + adapter + pure helpers.
- **Create** `supabase/functions/scrape-deals/ebay_test.ts` — Deno unit tests for the pure helpers.
- **Modify** `supabase/functions/scrape-deals/index.ts` — widen adapter signature, register `ebay`, pass the watch row.
- **Modify** `desktop/electron/main.cjs` — `add-deal-watch` inserts `condition`.
- **Modify** `desktop/src/components/Deals.jsx` — condition `<select>` in the add-watch form.
- **Modify** `android/app/src/main/java/com/example/yugiohscanner/cloud/DealsRepository.kt` — `DealWatch.condition` + `addWatch(query, maxPrice, condition)`.
- **Modify** `android/app/src/main/java/com/example/yugiohscanner/ui/DealsScreen.kt` — condition selector + `eBay` badge label.

---

### Task 1: Cloud schema — `condition` column

**Files:**
- Create: `supabase/deals_condition_migration.sql`

**Interfaces:**
- Produces: `deal_watches.condition text not null default 'any'` read by the Edge Function and written by both clients.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/deals_condition_migration.sql
-- Per-watch condition filter for the eBay Deals source. Run once in the Supabase SQL editor.
-- Only the eBay adapter honors it; Kleinanzeigen ignores it. Existing watches default to 'any'.
alter table public.deal_watches
  add column if not exists condition text not null default 'any';
```

- [ ] **Step 2: Verify (self-check, no DB access in CI)**

Confirm the statement is idempotent (`add column if not exists`) and the default makes existing rows read as `any`. (User runs it in the Supabase SQL editor at rollout.)

- [ ] **Step 3: Commit**

```bash
git add supabase/deals_condition_migration.sql
git commit -m "feat(deals): deal_watches.condition column for eBay filter"
```

---

### Task 2: eBay adapter in the Edge Function (with unit tests)

**Files:**
- Create: `supabase/functions/scrape-deals/ebay.ts`
- Create: `supabase/functions/scrape-deals/ebay_test.ts`
- Modify: `supabase/functions/scrape-deals/index.ts`

**Interfaces:**
- Consumes: `Item` type from `index.ts` (type-only import), env `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`.
- Produces: `scrapeEbay(query: string, watch: any): Promise<Item[]>`; pure helpers `ebayFilter(maxPrice: number, condition: string): string`, `mapEbayItem(summary: any): Item | null`, `shouldDropForUsed(summary: any, condition: string): boolean`, `isNewConditionId(id: string | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/scrape-deals/ebay_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { ebayFilter, mapEbayItem, shouldDropForUsed, isNewConditionId } from "./ebay.ts";

Deno.test("ebayFilter: base filters always present, fixed-price + ship-to-DE", () => {
  const f = ebayFilter(0, "any");
  assertEquals(f.includes("buyingOptions:{FIXED_PRICE}"), true);
  assertEquals(f.includes("deliveryCountry:DE"), true);
  assertEquals(f.includes("conditionIds"), false);
  assertEquals(f.includes("price:"), false);
});

Deno.test("ebayFilter: price range added when max > 0, EUR currency", () => {
  const f = ebayFilter(90, "any");
  assertEquals(f.includes("price:[..90]"), true);
  assertEquals(f.includes("priceCurrency:EUR"), true);
});

Deno.test("ebayFilter: 'new' adds conditionIds, 'used'/'any' do not", () => {
  assertEquals(ebayFilter(50, "new").includes("conditionIds:{1000|1500}"), true);
  assertEquals(ebayFilter(50, "used").includes("conditionIds"), false);
  assertEquals(ebayFilter(50, "any").includes("conditionIds"), false);
});

Deno.test("isNewConditionId: only 1000 and 1500 are new", () => {
  assertEquals(isNewConditionId("1000"), true);
  assertEquals(isNewConditionId("1500"), true);
  assertEquals(isNewConditionId("3000"), false);
  assertEquals(isNewConditionId("7000"), false);
  assertEquals(isNewConditionId(undefined), false);
});

Deno.test("shouldDropForUsed: drops new items only when condition is 'used'", () => {
  assertEquals(shouldDropForUsed({ conditionId: "1000" }, "used"), true);
  assertEquals(shouldDropForUsed({ conditionId: "1500" }, "used"), true);
  assertEquals(shouldDropForUsed({ conditionId: "3000" }, "used"), false);
  assertEquals(shouldDropForUsed({ conditionId: "1000" }, "any"), false);
  assertEquals(shouldDropForUsed({ conditionId: "1000" }, "new"), false);
});

Deno.test("mapEbayItem: maps EUR item, keeps id/title/url/image", () => {
  const it = mapEbayItem({
    itemId: "v1|123|0", title: "Yugioh Display",
    price: { value: "79.90", currency: "EUR" },
    itemWebUrl: "https://www.ebay.de/itm/123",
    image: { imageUrl: "https://i.ebayimg.com/x.jpg" },
  });
  assertEquals(it, {
    source: "ebay", listingId: "v1|123|0", title: "Yugioh Display",
    price: 79.9, url: "https://www.ebay.de/itm/123",
    imageUrl: "https://i.ebayimg.com/x.jpg",
  });
});

Deno.test("mapEbayItem: non-EUR price -> price null (loop drops it)", () => {
  const it = mapEbayItem({
    itemId: "1", title: "x", price: { value: "80", currency: "USD" },
    itemWebUrl: "https://www.ebay.de/itm/1",
  });
  assertEquals(it?.price, null);
});

Deno.test("mapEbayItem: image falls back to thumbnailImages", () => {
  const it = mapEbayItem({
    itemId: "1", title: "x", price: { value: "5", currency: "EUR" },
    itemWebUrl: "https://www.ebay.de/itm/1",
    thumbnailImages: [{ imageUrl: "https://thumb/1.jpg" }],
  });
  assertEquals(it?.imageUrl, "https://thumb/1.jpg");
});

Deno.test("mapEbayItem: missing itemId or url -> null", () => {
  assertEquals(mapEbayItem({ title: "x", itemWebUrl: "u" }), null);
  assertEquals(mapEbayItem({ itemId: "1", title: "x" }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/scrape-deals/ebay_test.ts`
Expected: FAIL — `ebay.ts` does not exist yet.

- [ ] **Step 3: Write `ebay.ts`**

```ts
// supabase/functions/scrape-deals/ebay.ts
// eBay Browse API adapter for the Deals scraper. Official API (no scraping): OAuth app token
// (client-credentials) -> item_summary/search. Fixed-price, EBAY_DE, EUR, ship-to-DE.
// Missing EBAY_CLIENT_ID/SECRET -> scrapeEbay returns [] (eBay silently disabled).
import type { Item } from "./index.ts"; // type-only: not executed at runtime (no Deno.serve on import)

// Build the Browse `filter` value. `new` restricts to new condition ids; `used`/`any` do not
// (used is enforced by post-filtering, see shouldDropForUsed).
export function ebayFilter(maxPrice: number, condition: string): string {
  const parts = ["buyingOptions:{FIXED_PRICE}", "deliveryCountry:DE"];
  if (maxPrice > 0) parts.push(`price:[..${maxPrice}],priceCurrency:EUR`);
  if (condition === "new") parts.push("conditionIds:{1000|1500}");
  return parts.join(",");
}

export function isNewConditionId(id: string | undefined): boolean {
  return id === "1000" || id === "1500";
}

// For a 'used' watch we send no condition filter and instead drop the new items here, so
// "used" means everything non-new (used, refurbished, for-parts) without enumerating ids.
export function shouldDropForUsed(summary: any, condition: string): boolean {
  return condition === "used" && isNewConditionId(String(summary?.conditionId ?? ""));
}

export function mapEbayItem(s: any): Item | null {
  const id = s?.itemId, url = s?.itemWebUrl;
  if (!id || !url) return null;
  const price = s?.price?.currency === "EUR" ? Number(s.price.value) : null;
  return {
    source: "ebay",
    listingId: String(id),
    title: s.title ?? "",
    price: Number.isFinite(price as number) ? (price as number) : null,
    url,
    imageUrl: s?.image?.imageUrl ?? s?.thumbnailImages?.[0]?.imageUrl,
  };
}

// App token cached with expiry (a warm isolate is reused across cron runs; the token lives ~2h).
let tokenCache: { token: string; exp: number } | null = null;

export async function ebayToken(): Promise<string | null> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const id = Deno.env.get("EBAY_CLIENT_ID"), secret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) { console.error(`[ebay] token HTTP ${res.status}`); return null; }
  const j = await res.json();
  if (!j.access_token) return null;
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in ?? 7200) - 60) * 1000 };
  return tokenCache.token;
}

export async function scrapeEbay(query: string, watch: any): Promise<Item[]> {
  const token = await ebayToken();
  if (!token) return []; // secrets missing or token failed -> eBay disabled for this run
  const condition = (watch?.condition ?? "any") as string;
  const max = Number(watch?.max_price) || 0;
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("filter", ebayFilter(max, condition));
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE" },
  });
  if (res.status === 401) { tokenCache = null; } // force refresh next run
  if (!res.ok) { console.error(`[ebay] search HTTP ${res.status} for "${query}"`); return []; }
  const j = await res.json();
  const out: Item[] = [];
  for (const s of j.itemSummaries ?? []) {
    if (shouldDropForUsed(s, condition)) continue;
    const it = mapEbayItem(s);
    if (it) out.push(it);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/scrape-deals/ebay_test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Wire `ebay` into `index.ts`**

In `supabase/functions/scrape-deals/index.ts`:

Add the import near the top (after the existing `createClient` import):
```ts
import { scrapeEbay } from "./ebay.ts";
```

Widen the adapter map type and register eBay (replace the existing `ADAPTERS` block):
```ts
const ADAPTERS: Record<string, (q: string, w: any) => Promise<Item[]>> = {
  kleinanzeigen: scrapeKleinanzeigen, // ignores the 2nd arg
  ebay: scrapeEbay,
};
```

Pass the watch row into the adapter call (change the single call site):
```ts
try { items = await adapter(w.query, w); }
```

- [ ] **Step 6: Type/lint check the function**

Run: `deno check supabase/functions/scrape-deals/index.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/scrape-deals/ebay.ts supabase/functions/scrape-deals/ebay_test.ts supabase/functions/scrape-deals/index.ts
git commit -m "feat(deals): eBay Browse API adapter (fixed-price, EUR, ship-to-DE, per-watch condition)"
```

---

### Task 3: Desktop — condition on the add-watch form

**Files:**
- Modify: `desktop/electron/main.cjs` (the `add-deal-watch` handler, ~line 175)
- Modify: `desktop/src/components/Deals.jsx`

**Interfaces:**
- Consumes: `deal_watches.condition` (Task 1).
- Produces: watches created from the desktop carry `condition`.

- [ ] **Step 1: Insert `condition` in the IPC handler**

In `desktop/electron/main.cjs`, replace the `add-deal-watch` handler body:
```js
ipcMain.handle('add-deal-watch', async (event, { query, maxPrice, sources, condition }) => {
    const c = await dealsClient();
    const { data, error } = await c.from('deal_watches')
        .insert({
            query: String(query || ''),
            max_price: Number(maxPrice) || 0,
            sources: sources ? JSON.stringify(sources) : null,
            condition: ['new', 'used', 'any'].includes(condition) ? condition : 'any',
        })
        .select('id').single();
    if (error) throw new Error(error.message);
    triggerCloudScrape(c);
    return data.id;
});
```

- [ ] **Step 2: Add the condition selector in `Deals.jsx`**

Add state next to the existing `maxPrice` state:
```jsx
const [condition, setCondition] = useState('any');
```

Pass it when adding a watch (update the `addWatch` call):
```jsx
await window.api.addDealWatch({ query: query.trim(), maxPrice: parseFloat(maxPrice), condition });
```

Add the selector inside the add-watch form's `flex flex-wrap` row, before the "Watch" button:
```jsx
<select
  value={condition} onChange={(e) => setCondition(e.target.value)}
  title="Zustand (nur eBay wertet das aus)"
  className="bg-obsidian border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-space-violet"
>
  <option value="any">Zustand: Egal</option>
  <option value="new">Neu</option>
  <option value="used">Gebraucht</option>
</select>
```

- [ ] **Step 3: Lint + verify build**

Run: `cd desktop && npm run lint` (no NEW errors from these files) and `npm run build` (succeeds).
Manual check: adding a watch with a chosen condition creates a `deal_watches` row whose `condition` matches (verify in the Deals tab after Task 1's migration is applied).

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/main.cjs desktop/src/components/Deals.jsx
git commit -m "feat(deals): desktop add-watch condition selector -> deal_watches.condition"
```

---

### Task 4: Phone — condition on the add-watch form

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/DealsRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/DealsScreen.kt`

**Interfaces:**
- Consumes: `deal_watches.condition` (Task 1).
- Produces: watches created from the phone carry `condition`.

- [ ] **Step 1: `DealWatch.condition` + `addWatch(condition)` in the repository**

In `DealsRepository.kt`, add the field to the data class:
```kotlin
data class DealWatch(
    val id: Long, val query: String, val maxPrice: Double,
    val active: Boolean, val condition: String = "any",
)
```

Include `condition` in the insert:
```kotlin
suspend fun addWatch(query: String, maxPrice: Double, condition: String = "any") = withContext(Dispatchers.IO) {
    val body = JSONObject()
        .put("query", query).put("max_price", maxPrice).put("condition", condition).toString()
    executeWithReauth {
        base("${SupabaseCloud.base()}/rest/v1/deal_watches".toHttpUrl())
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "return=minimal")
            .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
    }.use { r -> if (!r.isSuccessful) err("Watch anlegen", r) }
}
```

Parse it back in `parseWatch`:
```kotlin
private fun parseWatch(o: JSONObject) = DealWatch(
    id = o.optLong("id"), query = o.optString("query"),
    maxPrice = o.optDouble("max_price"), active = o.optBoolean("active", true),
    condition = o.optString("condition", "any"),
)
```

- [ ] **Step 2: Condition selector in `DealsScreen.kt`**

Add state next to `maxPrice`:
```kotlin
var condition by remember { mutableStateOf("any") }
```

Pass it in `addWatch` (the coroutine that calls the repository):
```kotlin
DealsRepository.addWatch(q, p, condition)
```

Add a compact selector after the price field (before the `FilledIconButton`), using a dropdown menu so it fits the single row:
```kotlin
var condMenu by remember { mutableStateOf(false) }
val condLabel = when (condition) { "new" -> "Neu"; "used" -> "Gebraucht"; else -> "Egal" }
Box {
    AssistChip(onClick = { condMenu = true }, label = { Text(condLabel) })
    DropdownMenu(expanded = condMenu, onDismissRequest = { condMenu = false }) {
        DropdownMenuItem(text = { Text("Egal") }, onClick = { condition = "any"; condMenu = false })
        DropdownMenuItem(text = { Text("Neu") }, onClick = { condition = "new"; condMenu = false })
        DropdownMenuItem(text = { Text("Gebraucht") }, onClick = { condition = "used"; condMenu = false })
    }
}
Spacer(Modifier.width(8.dp))
```
(Reset `condition = "any"` alongside the existing `query = ""; maxPrice = ""` reset after a successful add, so the next watch starts neutral.)

- [ ] **Step 3: Nicer eBay badge label**

In `SourceBadge`, add an explicit eBay case:
```kotlin
val label = when (source.lowercase()) {
    "kleinanzeigen" -> "Kleinanzeigen"
    "ebay" -> "eBay"
    else -> source.replaceFirstChar { it.uppercase() }
}
```

- [ ] **Step 4: Build the app module**

Run: `cd android && ./gradlew :app:assembleDebug` (or build from Android Studio).
Expected: BUILD SUCCESSFUL. Manual check: create a watch with a condition on the phone; the `deal_watches` row has the matching `condition`.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/DealsRepository.kt android/app/src/main/java/com/example/yugiohscanner/ui/DealsScreen.kt
git commit -m "feat(deals): phone add-watch condition selector + eBay badge"
```

---

## Rollout (user-run, after implementation)

1. Set Supabase function secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` (rotate the Cert ID first — it was shown in chat).
2. Run `supabase/deals_condition_migration.sql` in the Supabase SQL editor.
3. Deploy: `supabase functions deploy scrape-deals --no-verify-jwt`.
4. Rebuild the desktop installer (`npm run dist`) and the phone APK.
5. Smoke test: add an eBay watch (e.g. `Yugioh Display`, ≤ 90, Neu) → refresh → a `deal_alerts` row with `source = 'ebay'` and a valid `itemWebUrl`.

## Self-Review

- **Spec coverage:** eBay adapter (OAuth, search, mapping) — Task 2; condition column — Task 1; condition mapping incl. "used = all non-new" — Task 2 (`ebayFilter` + `shouldDropForUsed`); desktop UI — Task 3; phone UI — Task 4; graceful skip without secrets — Task 2 (`ebayToken` returns null → `scrapeEbay` returns `[]`); fixed-price/EUR/ship-to-DE — Task 2 (`ebayFilter`). All covered.
- **Type consistency:** `scrapeEbay(query, watch)` matches the widened `ADAPTERS` signature `(q, w)`; `mapEbayItem` returns the `index.ts` `Item` shape (`source, listingId, title, price, url, imageUrl`); `condition` string `'new'|'used'|'any'` consistent across migration, function, desktop handler, and Kotlin.
- **No placeholders:** every step carries concrete code.
