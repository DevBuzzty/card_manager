# eBay as a Deals Source — Design Spec

**Date:** 2026-09-01
**Status:** Approved for planning
**Author:** Sebastian + Claude

## Goal

Add eBay as a second marketplace source for the Deals price-alert feature, alongside the
existing Kleinanzeigen scraper. Unlike the Cardmarket price scraper (which needs a real
browser + residential IP and therefore only runs on the desktop), eBay exposes an official
**Browse API**, so it fits cleanly inside the existing Supabase Edge Function — no browser,
no Cloudflare, no residential IP, shared with the phone.

## Scope

**In scope:**
- An `ebay` adapter inside `supabase/functions/scrape-deals/index.ts` using the eBay Browse API.
- OAuth client-credentials token flow (app token), fetched once per function run.
- A per-watch **condition** filter (`new` / `used` / `any`) — honored by eBay only.
- Fixed-price (Buy-It-Now) listings only.
- Marketplace `EBAY_DE`, currency EUR, delivery to Germany (includes EU sellers who ship to DE).
- Client UI (desktop `Deals.jsx` + phone `DealsScreen.kt`) to choose eBay as a source and pick a condition when creating a watch.

**Explicitly out of scope:**
- Cardmarket as a deal source (only feasible via the desktop browser scraper — a separate later effort).
- Auctions / best-offer (fixed-price only).
- Amazon, TCGplayer, Vinted, Facebook (no usable API / wrong region / ToS-hostile).
- Touching the disabled legacy desktop deal poller (`desktop/electron/deals/{kleinanzeigen,poller}.cjs`) — the cloud Edge Function is authoritative.

## Architecture

The Edge Function already uses an adapter map:

```ts
const ADAPTERS: Record<string, (q: string) => Promise<Item[]>> = { kleinanzeigen: scrapeKleinanzeigen };
```

Two changes:
1. **Adapter signature** widens from `(query) => Promise<Item[]>` to `(query, watch) => Promise<Item[]>`,
   where `watch` is the `deal_watches` row (so an adapter can read `max_price` and `condition`).
   `scrapeKleinanzeigen` ignores the second argument (unchanged behavior).
2. **New `ebay` adapter** added to the map.

Everything downstream is unchanged: the main loop still applies the `price <= max_price` guard,
`matchesQuery(title, query)`, and the idempotent `deal_alerts` upsert on
`(watch_id, source, listing_id)`.

### eBay adapter

**OAuth (client-credentials / app token):**
- On the **first** eBay use within a function run, POST to
  `https://api.ebay.com/identity/v1/oauth2/token`:
  - Header `Authorization: Basic base64(EBAY_CLIENT_ID:EBAY_CLIENT_SECRET)`
  - Header `Content-Type: application/x-www-form-urlencoded`
  - Body `grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope`
- Cache the returned `access_token` in a **run-scoped** variable (a module-level `let ebayToken`
  reset is unnecessary — the Deno isolate for one invocation is short-lived; a closure/module var
  that lives for the request is enough, and a fresh token per run is acceptable: one token call per run).
- **Graceful degradation:** if `EBAY_CLIENT_ID` or `EBAY_CLIENT_SECRET` is unset, the adapter returns
  `[]` immediately (eBay silently disabled). If the token request fails (non-2xx), log and return `[]`.

**Search request:**
- `GET https://api.ebay.com/buy/browse/v1/item_summary/search`
- Query params:
  - `q` = the watch query
  - `limit` = `50`
  - `filter` = comma-joined:
    - `buyingOptions:{FIXED_PRICE}`
    - `price:[..<max_price>],priceCurrency:EUR`
    - `deliveryCountry:DE`
    - condition:
      - `new`  → request filter `conditionIds:{1000|1500}` (New, New other)
      - `used` → **no** condition filter in the request; the adapter instead **drops** any item whose
        `conditionId` is `1000` or `1500` (i.e. keep everything non-new: used, refurbished, for-parts).
        This avoids brittle enumeration of every non-new conditionId and matches "alles Nicht-Neue".
      - `any`  → no condition filter, no post-filter
- Headers:
  - `Authorization: Bearer <token>`
  - `X-EBAY-C-MARKETPLACE-ID: EBAY_DE`
- Non-2xx response → log and return `[]`.

**Result mapping** — each `itemSummaries[]` entry → `Item`:
- `source: "ebay"`
- `listingId: itemId`
- `title: title`
- `price:` `Number(price.value)` when `price.currency === "EUR"`, else `null` (the loop drops null-priced items)
- `url: itemWebUrl`
- `imageUrl: image?.imageUrl ?? thumbnailImages?.[0]?.imageUrl`

### Condition (per watch)

- New column: `deal_watches.condition text not null default 'any'` — allowed values `new` | `used` | `any`.
- Migration file `supabase/deals_condition_migration.sql` (idempotent `add column if not exists`).
- Only the eBay adapter reads `condition`. Kleinanzeigen ignores it (its listing HTML does not carry a
  reliable structured condition).
- Existing watches (no column value) default to `any` — no behavior change for them.

### Clients

**Desktop** (`desktop/src/components/Deals.jsx`, `desktop/electron/main.cjs`, `desktop/electron/preload.cjs`):
- Add-watch form: a source selection that includes **eBay** and **Kleinanzeigen**, plus a **condition**
  `<select>`: `Egal` (any) / `Neu` (new) / `Gebraucht` (used).
- `add-deal-watch` IPC handler + its `preload` wrapper carry a new `condition` field through to the
  cloud insert. Default `any` when omitted (back-compat).
- Alerts list already renders `source`; add a small eBay label/badge next to Kleinanzeigen.

**Phone** (`android/app/src/main/java/com/example/yugiohscanner/ui/DealsScreen.kt`,
`.../cloud/DealsRepository.kt`):
- `DealWatch` data class gains `condition: String = "any"`.
- Add-watch UI gains the same condition selector and includes `condition` in the insert payload.
- Source selection includes eBay.

## Data flow

```
User creates a watch (query, max_price, sources=[…,"ebay"], condition) on desktop or phone
      → row in Supabase public.deal_watches
pg_cron → scrape-deals Edge Function (service role)
      → for each active watch, for each source adapter:
            kleinanzeigen: scrape HTML
            ebay: app-token → Browse API search (fixed-price, EUR, deliveryCountry DE, conditionIds)
      → price<=max & matchesQuery → upsert deal_alerts (idempotent per watch,source,listing_id)
Phone & desktop read deal_alerts (RLS: own rows only) → notification / list
```

## Error handling

- Per-source `try/catch` already wraps each adapter call; an eBay failure logs and continues to the
  next source/watch. No single source can 500 the run.
- Missing eBay secrets → adapter returns `[]` (feature simply inactive until secrets are set).
- Token or search non-2xx → logged, `[]` returned.
- A malformed `sources` value already falls back to all adapters (existing behavior).

## Testing

The repo has no JS test suite; the Edge Function is Deno. Verification:

1. **Pure-helper Deno test** (`supabase/functions/scrape-deals/ebay_test.ts` or inline): the
   `condition → conditionIds` mapping and the `itemSummary → Item` mapping (including the EUR-only
   price guard and the image fallback) against a captured sample `item_summary/search` JSON response.
2. **Live smoke test:** set `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` secrets, run the condition
   migration, `supabase functions deploy scrape-deals`, create an eBay watch (e.g. `Yugioh Display`,
   max `90`, `Neu`), trigger a scrape, and confirm a `deal_alerts` row with `source = 'ebay'` and a
   valid `itemWebUrl`.

## Rollout steps (user-run)

1. Set Supabase function secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` (never committed; the
   assistant never stores them).
2. Run `supabase/deals_condition_migration.sql` in the Supabase SQL editor.
3. `supabase functions deploy scrape-deals --no-verify-jwt`.
4. Rebuild the desktop installer and the phone APK.

## Security & compliance notes

- eBay credentials live **only** in Supabase function secrets. The Cert ID (client secret) is a
  password-equivalent; it is not written to the repo, memory, or any client. (User to rotate the
  secret shown earlier in chat.)
- eBay Browse API usage is official and ToS-compliant (unlike the HTML scrapers). Default Browse
  rate limit (~5,000 calls/day) far exceeds a few watches polled on a cron.
