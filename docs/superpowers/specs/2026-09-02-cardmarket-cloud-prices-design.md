# Cardmarket Cloud Price Refresh — Design

**Date:** 2026-09-02
**Status:** Approved (brainstorm), pending implementation plan
**Builds on:** `2026-09-02-cardmarket-bulk-prices-design.md` (desktop bulk refresh, merged to main at 1c088af)

## Purpose

The desktop refreshes every resolved printing's Cardmarket `trend` price daily from Cardmarket's free
`price_guide_3.json`. The phone only reads `cards.price` from Supabase, so when the desktop is off for
days the phone shows stale prices. This design moves the *daily price update* into the cloud so the
phone stays current without the desktop. The desktop remains the only place that creates the
`cm_product_id` mapping (file resolver + scraper) and the only place that can scrape.

Measured feasibility (2026-09-02, Node, the real 17 MB file): read 19 ms, `JSON.parse` 54 ms,
filter 3 ms, ~42 MB heap. Supabase Edge Function limits: 2 s CPU, 150 MB (Free) / 256 MB (Pro),
400 s wall clock. Comfortable margin.

## Non-goals

- No scraping in the cloud (Cloudflare blocks datacenter IPs; the desktop keeps that job).
- No resolution of `cm_product_id` in the cloud (needs the product files + the scraper fallback;
  desktop-only).
- No change to what the phone reads or how it renders prices (`price` column unchanged).
- No pulling of cloud prices back into the desktop's local DB: the desktop computes the same
  `trend` itself on its next start (30 s after launch), so the two sides converge without a new
  pull path. `applyRemoteRow` stays quantity/deleted-only.
- No portfolio-snapshot changes (the desktop keeps writing `portfolio_snapshots`).

## Architecture

```
pg_cron (daily 05:00 UTC) ─► pg_net POST ─► Edge Function refresh-cardmarket-prices
                                               │ 1. SELECT DISTINCT cm_product_id FROM cards
                                               │    WHERE cm_product_id IS NOT NULL AND deleted = false
                                               │      AND price_locked <> 2          (paginated, service role)
                                               │ 2. fetch price_guide_3.json → JSON.parse
                                               │    → [{ id_product, trend }] for needed ids, trend > 0   (pure: prices.ts)
                                               │ 3. rpc apply_cardmarket_prices(jsonb) → rows updated
                                               └─► JSON { needed, found, updated }

desktop sync.cjs ─ push ─► cards.cm_product_id, cards.price_locked now mirrored (one-time backfill touch)
```

### Cloud schema (`supabase/cardmarket_cloud_prices_migration.sql`, applied by the user in the SQL editor)

- `alter table public.cards add column if not exists cm_product_id integer;`
- `price_locked`: `boolean not null default false` → `smallint not null default 0`
  (`0` = unlocked, `1` = Cardmarket-priced, `2` = manual). Migration: drop default, alter type with
  `using (case when price_locked then 1 else 0 end)`, set default 0. The phone never reads
  `price_locked` (verified: no reference in `android/`), so the type change is safe.
- `create index if not exists cards_cm_product_id_idx on public.cards (cm_product_id) where cm_product_id is not null;`
- RPC `public.apply_cardmarket_prices(prices jsonb) returns integer`:

```sql
update public.cards c
   set price = v.trend, cm_updated_at = now()
  from jsonb_to_recordset(prices) as v(id_product integer, trend double precision)
 where c.cm_product_id = v.id_product
   and c.deleted = false
   and coalesce(c.price_locked, 0) <> 2
   and v.trend > 0
   and c.price is distinct from v.trend;
-- returns row_count
```
One statement for the whole collection; rows whose price is unchanged are not touched, so
`updated_at` (server trigger) only moves for real price changes → the desktop's next pull is small.

### Edge Function `supabase/functions/refresh-cardmarket-prices/`

- `index.ts` — handler (same shape as `scrape-deals/index.ts`): optional shared-secret gate
  (`CM_TRIGGER_SECRET` / header `x-cm-secret`), `createClient` with the injected
  `SUPABASE_SERVICE_ROLE_KEY`, steps 1–3 above, JSON response `{ needed, found, updated }` or
  `{ error }` with 5xx. Deployed with `--no-verify-jwt` like `scrape-deals` so pg_cron can call it.
- `prices.ts` — pure `pickTrends(guide, ids) → Array<{ id_product, trend }>`: keeps only ids in the
  set, `trend` a finite number `> 0`, de-duplicated by id. No I/O.
- `prices_test.ts` — `deno test` for `pickTrends` (present/absent ids, `trend: null`, `trend: 0`,
  duplicates, empty guide, malformed `priceGuides`).
- Schedule (README): `cron.schedule('refresh-cardmarket-prices', '0 5 * * *', …net.http_post…)`.
  Cardmarket regenerates the file around 00:45 UTC; 05:00 UTC leaves margin.

### Desktop sync (`desktop/electron/sync.cjs`)

- `MIRROR_COLS` gains `cm_product_id` and `price_locked`; `rowToRemote` sends
  `price_locked: Number(row.price_locked) || 0` and `cm_product_id: row.cm_product_id ?? null`.
- One-time backfill, guarded by setting `cm_cloud_backfill_done = 'true'`, run in `startSync`
  before the first cycle: `UPDATE cards SET updated_at = CURRENT_TIMESTAMP WHERE cm_product_id IS
  NOT NULL OR price_locked = 2` — marks the already-resolved rows dirty so the existing push
  uploads them with the two new columns. Pull path unchanged.
- **Ordering constraint:** the cloud migration must be applied before a desktop with this change
  syncs — otherwise the upsert sends `price_locked = 2` into a boolean column and the push fails
  ("invalid input syntax for type boolean"). The plan sequences this (SQL first).

### Convergence / no ping-pong

- Cloud writes `trend` → cloud `updated_at` bumps → desktop pull applies only quantity/deleted (no-op).
- Desktop bulk computes the same `trend` → its `AND price IS NOT ?` guard skips the row → no push.
- Both sides idempotent on the same daily file. Manual prices (`price_locked = 2`) are skipped by
  cloud RPC, desktop bulk, scraper and the YGOPRODeck poller alike.

## Error handling

| Situation | Behaviour |
|---|---|
| Guide download fails / non-200 | `{ error: "guide HTTP <status>" }`, 502; nothing written; next day's cron retries |
| Guide JSON malformed / no `priceGuides` array | `pickTrends` returns `[]` → RPC not called → `{ needed, found: 0, updated: 0 }` |
| Supabase select/RPC error | `{ error }`, 500 |
| No resolved rows in cloud yet (backfill not pushed) | `{ needed: 0, found: 0, updated: 0 }`, 200 |
| Desktop offline for weeks | irrelevant — cloud runs alone; desktop converges on next start |

## Testing

- `deno test supabase/functions/refresh-cardmarket-prices/` — pure `pickTrends` cases.
- Desktop: extend `desktop/electron/test-sync.cjs` (run with `ELECTRON_RUN_AS_NODE=1 …/electron
  electron/test-sync.cjs`): `rowToRemote` includes `cm_product_id` and an integer `price_locked`,
  `price_locked: 2` survives, `undefined` → `0`.
- Live (plan Task 4): apply SQL → deploy function → `curl -X POST …/refresh-cardmarket-prices`
  returns `{ needed: 0 … }` (no ids yet) → run the desktop once (backfill pushes ~1060 rows) →
  `curl` again returns `needed ≈ 1060, found ≈ 1060, updated: 0` (cloud already equals the
  desktop's trend, proving idempotence) → check `select count(*) from cards where cm_product_id
  is not null` in the dashboard → schedule the cron.

## Components (isolation)

- `supabase/cardmarket_cloud_prices_migration.sql` — schema + RPC.
- `supabase/functions/refresh-cardmarket-prices/prices.ts` — pure selection of trends.
- `supabase/functions/refresh-cardmarket-prices/index.ts` — orchestration + HTTP.
- `supabase/README_cardmarket_cloud.md` — deploy, secret, cron, verification.
- `desktop/electron/sync.cjs` — two mirrored columns + backfill.
