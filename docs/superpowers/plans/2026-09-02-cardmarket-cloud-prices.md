# Cardmarket Cloud Price Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily Supabase Edge Function updates `cards.price` from Cardmarket's free `price_guide_3.json` for every printing whose `cm_product_id` the desktop has mirrored, so the phone shows current prices even when the desktop is off.

**Architecture:** One SQL migration (new `cm_product_id` column, `price_locked` → smallint, an `apply_cardmarket_prices(jsonb)` RPC that updates only changed rows in one statement). The desktop's `sync.cjs` mirrors two more columns and does a one-time backfill touch. A Deno Edge Function collects the needed ids, parses the guide, and calls the RPC; pg_cron triggers it daily at 05:00 UTC.

**Tech Stack:** Supabase (Postgres 17, Edge Functions on Deno 2, pg_cron + pg_net), Deno `jsr:@supabase/supabase-js@2`, `jsr:@std/assert@1` for tests; desktop side Node/CommonJS `.cjs`.

**Spec:** `docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md`

## Global Constraints

- Repo root: `C:\Users\Buzzty\Downloads\yugi`. Desktop commands run in `desktop/`; Deno commands run at the repo root.
- Desktop main-process files are CommonJS `.cjs`; do not convert. Desktop tests run with Electron's Node: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` (PowerShell: `$env:ELECTRON_RUN_AS_NODE=1; .\node_modules\.bin\electron electron\test-sync.cjs`).
- Deno tests: `deno test supabase/functions/refresh-cardmarket-prices/` from the repo root (Deno 2.9 is installed).
- Supabase project ref: `uirfqwklvavgjklgqpnn` (region eu-west-1). Function URL: `https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices`. Deploy: `supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn` (CLI 2.116 is installed and logged in; the project is NOT linked, hence `--project-ref`).
- SQL migrations are applied by the **user** in the Supabase SQL editor (that is how every previous migration in `supabase/*.sql` was applied). Never attempt to run them from the CLI.
- **Ordering:** the cloud migration (Task 1) must be applied before a desktop running Task 2's code syncs; otherwise `price_locked = 2` hits a boolean column and the push fails.
- `price_locked` semantics everywhere: `0` unlocked, `1` Cardmarket-priced, `2` manual. Cron time `0 5 * * *` (UTC). Secret header name `x-cm-secret`, env `CM_TRIGGER_SECRET` (optional).
- Git via `rtk` prefix; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Surgical edits only.

## File structure

| File | Responsibility |
|---|---|
| `supabase/cardmarket_cloud_prices_migration.sql` (new) | `cm_product_id` column, `price_locked` type change, index, RPC |
| `supabase/README_cardmarket_cloud.md` (new) | apply SQL, deploy, optional secret, cron, verification |
| `desktop/electron/sync.cjs` (modify) | mirror `cm_product_id` + `price_locked`; one-time backfill |
| `desktop/electron/test-sync.cjs` (modify) | mapping assertions for the two new columns |
| `supabase/functions/refresh-cardmarket-prices/prices.ts` (new, pure) | `pickTrends(guide, ids)` |
| `supabase/functions/refresh-cardmarket-prices/prices_test.ts` (new) | Deno tests |
| `supabase/functions/refresh-cardmarket-prices/index.ts` (new) | handler: ids → guide → RPC |

---

### Task 1: Cloud SQL migration + README

**Files:**
- Create: `supabase/cardmarket_cloud_prices_migration.sql`
- Create: `supabase/README_cardmarket_cloud.md`

**Interfaces:**
- Produces: column `public.cards.cm_product_id integer`; `public.cards.price_locked smallint not null default 0`; function `public.apply_cardmarket_prices(prices jsonb) returns integer` whose JSON elements are `{ "id_product": <int>, "trend": <number> }`.

- [ ] **Step 1: Write the migration**

Create `supabase/cardmarket_cloud_prices_migration.sql`:

```sql
-- supabase/cardmarket_cloud_prices_migration.sql
-- Cloud side of the Cardmarket price refresh (see docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md).
-- Apply ONCE in the Supabase SQL editor BEFORE running a desktop build that mirrors these columns.

-- 1. The Cardmarket product id per printing (resolved on the desktop, mirrored by sync).
alter table public.cards add column if not exists cm_product_id integer;

-- 2. price_locked: boolean -> smallint (0 = unlocked, 1 = Cardmarket-priced, 2 = manual).
--    Idempotent: only converts when the column is still boolean.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'cards'
       and column_name = 'price_locked' and data_type = 'boolean'
  ) then
    alter table public.cards alter column price_locked drop default;
    alter table public.cards alter column price_locked type smallint
      using (case when price_locked then 1 else 0 end);
    alter table public.cards alter column price_locked set default 0;
    alter table public.cards alter column price_locked set not null;
  end if;
end $$;

-- 3. Lookup index for the daily update.
create index if not exists cards_cm_product_id_idx
  on public.cards (cm_product_id) where cm_product_id is not null;

-- 4. One-statement price update. prices = [{"id_product": 102800, "trend": 0.42}, ...]
--    Touches only rows whose price actually changes (so updated_at moves only for real changes),
--    never manual prices (price_locked = 2), never deleted rows, never non-positive trends.
create or replace function public.apply_cardmarket_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.cards c
     set price = v.trend,
         cm_updated_at = now()
    from jsonb_to_recordset(prices) as v(id_product integer, trend double precision)
   where c.cm_product_id = v.id_product
     and c.deleted = false
     and coalesce(c.price_locked, 0) <> 2
     and v.trend > 0
     and c.price is distinct from v.trend;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_prices(jsonb) from public;
grant execute on function public.apply_cardmarket_prices(jsonb) to service_role;
```

- [ ] **Step 2: Write the README**

Create `supabase/README_cardmarket_cloud.md`:

```markdown
# Cardmarket cloud price refresh

Keeps `cards.price` current on the phone even when the desktop is off. The desktop still owns the
`cm_product_id` mapping (file resolver + scraper); the cloud only applies Cardmarket's daily `trend`.
Design: `docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md`.

## 1. Apply the SQL (once, BEFORE the desktop mirrors the new columns)

SQL editor → paste `supabase/cardmarket_cloud_prices_migration.sql` → Run.
Check: `select column_name, data_type from information_schema.columns where table_name = 'cards' and column_name in ('cm_product_id','price_locked');`
→ `cm_product_id integer`, `price_locked smallint`.

## 2. Deploy the Edge Function

```bash
supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
Optional hardening: `supabase secrets set CM_TRIGGER_SECRET=<random> --project-ref uirfqwklvavgjklgqpnn`
— then every caller (cron included) must send header `x-cm-secret: <random>`.

## 3. Test it by hand

```bash
curl -s -X POST https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices
```
→ `{"needed":<n>,"found":<n>,"updated":<k>}`. `needed` = distinct `cm_product_id`s in the cloud
(0 until the desktop has pushed the backfill), `found` = ids present in today's guide with a
positive trend, `updated` = rows whose price actually changed (0 when the desktop already priced
them today — that is the expected idempotent result).

## 4. Schedule it (daily 05:00 UTC; Cardmarket rewrites the file ~00:45 UTC)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('refresh-cardmarket-prices', '0 5 * * *', $$
  select net.http_post(
    url     := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
```
If you set `CM_TRIGGER_SECRET`, add `"x-cm-secret": "<random>"` to the headers object.
Inspect runs: `select * from cron.job_run_details order by start_time desc limit 5;`
Unschedule: `select cron.unschedule('refresh-cardmarket-prices');`

## How it converges with the desktop

Cloud writes `trend` → desktop pull only applies quantity/deleted (no-op). Desktop bulk computes
the same `trend` → its "only if changed" guard skips the row → nothing is pushed. Manual prices
(`price_locked = 2`) are skipped everywhere.
```

- [ ] **Step 3: Sanity-check the SQL parses**

There is no local Postgres. Read the file once more against the spec's RPC block; confirm the `do $$ … $$` block and the function body use distinct dollar-quoting scopes (they do: the function uses `$$` only after the `do` block has closed). Nothing to run.

- [ ] **Step 4: Commit**

```bash
rtk git add supabase/cardmarket_cloud_prices_migration.sql supabase/README_cardmarket_cloud.md
rtk git commit -m "feat(cloud): Cardmarket price refresh — cards.cm_product_id, price_locked smallint, apply_cardmarket_prices RPC + README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Desktop sync mirrors `cm_product_id` + `price_locked`, one-time backfill

**Files:**
- Modify: `desktop/electron/sync.cjs` (`MIRROR_COLS` lines 4–6, `rowToRemote` lines 9–16, `startSync` — insert the backfill right after `let running = false;`)
- Modify: `desktop/electron/test-sync.cjs`

**Interfaces:**
- Consumes: cloud columns from Task 1 (must be applied before this code syncs).
- Produces: upsert payloads containing `cm_product_id` (int|null) and `price_locked` (0/1/2); setting key `cm_cloud_backfill_done`.

- [ ] **Step 1: Add the failing assertions**

In `desktop/electron/test-sync.cjs`, after the existing `assert.ok(!('updated_at' in remote), …)` line, add:

```js
// New mirrored columns: cm_product_id passes through (null when unresolved), price_locked is an
// integer 0/1/2 (2 = manual) — never a boolean, never undefined.
assert.strictEqual(remote.cm_product_id, null, 'unresolved printing mirrors cm_product_id = null');
assert.strictEqual(remote.price_locked, 0, 'missing price_locked mirrors as 0');
const locked = rowToRemote({ ...local, cm_product_id: 102801, price_locked: 2 });
assert.strictEqual(locked.cm_product_id, 102801);
assert.strictEqual(locked.price_locked, 2, 'manual lock (2) survives the mapping');
assert.strictEqual(rowToRemote({ ...local, price_locked: 1 }).price_locked, 1);
```

- [ ] **Step 2: Run to verify it fails**

Run (from `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
Expected: `AssertionError … unresolved printing mirrors cm_product_id = null` (the key is absent → `undefined`).

- [ ] **Step 3: Implement the mapping**

In `desktop/electron/sync.cjs` change `MIRROR_COLS` to:

```js
// Columns mirrored to the cloud (desktop is authoritative for all of them).
// cm_product_id + price_locked let the cloud's daily Cardmarket refresh (Edge Function) price the
// phone's rows and skip manual prices (price_locked = 2) without the desktop being on.
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute', 'quantity',
  'rarity', 'price', 'deleted', 'cm_product_id', 'price_locked'];
```

and `rowToRemote` to:

```js
function rowToRemote(row) {
  const out = {};
  for (const c of MIRROR_COLS) {
    if (c === 'deleted') out.deleted = !!row.deleted;
    else if (c === 'price_locked') out.price_locked = Number(row.price_locked) || 0; // cloud column is smallint 0/1/2
    else if (c === 'cm_product_id') out.cm_product_id = row.cm_product_id ?? null;
    else out[c] = row[c];
  }
  return out;
}
```

- [ ] **Step 4: Add the one-time backfill**

In `startSync`, directly after `let running = false;` insert:

```js
  // One-time backfill (2026-09-02): rows resolved before cm_product_id/price_locked were mirrored
  // were already pushed without them. Touch them once so the normal dirty-row push re-uploads
  // them with the new columns. Guarded by a setting so it never runs twice.
  if (getSetting(db, 'cm_cloud_backfill_done') !== 'true') {
    try {
      const info = db.prepare(
        "UPDATE cards SET updated_at = CURRENT_TIMESTAMP WHERE cm_product_id IS NOT NULL OR price_locked = 2"
      ).run();
      setSetting(db, 'cm_cloud_backfill_done', 'true');
      console.log(`[sync] cloud backfill: marked ${info.changes} rows dirty for cm_product_id/price_locked`);
    } catch (e) { console.error('[sync] cloud backfill failed:', e.message); }
  }
```

- [ ] **Step 5: Run the tests**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
Expected: `sync mapping test: PASS`.
Also run the other sync scripts to make sure nothing else broke: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync-insert.cjs` (expected: its PASS line).

- [ ] **Step 6: Commit**

```bash
rtk git add electron/sync.cjs electron/test-sync.cjs
rtk git commit -m "feat(sync): mirror cm_product_id + price_locked to Supabase, one-time backfill touch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Edge Function `refresh-cardmarket-prices`

**Files:**
- Create: `supabase/functions/refresh-cardmarket-prices/prices.ts`
- Create: `supabase/functions/refresh-cardmarket-prices/prices_test.ts`
- Create: `supabase/functions/refresh-cardmarket-prices/index.ts`

**Interfaces:**
- Consumes: RPC `apply_cardmarket_prices(prices jsonb) → integer` (Task 1); cloud columns `cm_product_id`, `price_locked`, `deleted`.
- Produces: `pickTrends(guide: unknown, ids: Set<number>): Array<{ id_product: number; trend: number }>`; HTTP `POST /functions/v1/refresh-cardmarket-prices` → `{ needed, found, updated }`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/refresh-cardmarket-prices/prices_test.ts`:

```ts
// supabase/functions/refresh-cardmarket-prices/prices_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { pickTrends } from "./prices.ts";

const guide = {
  version: 1,
  priceGuides: [
    { idProduct: 102801, trend: 0.42, low: 0.1 },
    { idProduct: 741145, trend: 12.5, low: 9 },
    { idProduct: 102800, trend: null, low: 20 },   // no trend -> skipped
    { idProduct: 999001, trend: 0, low: 0.02 },     // 0 means "no trend" -> skipped
    { idProduct: 741145, trend: 12.5, low: 9 },     // duplicate -> once
    { idProduct: 555555, trend: 3.3 },              // not needed -> skipped
  ],
};

Deno.test("pickTrends keeps only needed ids with a positive trend, de-duplicated", () => {
  const out = pickTrends(guide, new Set([102801, 741145, 102800, 999001, 123]));
  assertEquals(out, [
    { id_product: 102801, trend: 0.42 },
    { id_product: 741145, trend: 12.5 },
  ]);
});

Deno.test("pickTrends: empty ids -> []", () => {
  assertEquals(pickTrends(guide, new Set()), []);
});

Deno.test("pickTrends: malformed guide -> []", () => {
  assertEquals(pickTrends(null, new Set([1])), []);
  assertEquals(pickTrends({}, new Set([1])), []);
  assertEquals(pickTrends({ priceGuides: "nope" }, new Set([1])), []);
});

Deno.test("pickTrends: non-numeric trend is skipped", () => {
  assertEquals(pickTrends({ priceGuides: [{ idProduct: 1, trend: "0.5" }, { idProduct: 2, trend: NaN }] }, new Set([1, 2])), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (repo root): `deno test supabase/functions/refresh-cardmarket-prices/`
Expected: FAIL — `Module not found "…/prices.ts"`.

- [ ] **Step 3: Implement `prices.ts`**

```ts
// supabase/functions/refresh-cardmarket-prices/prices.ts
// Pure: pick the Cardmarket `trend` for the product ids we need. Cardmarket's price_guide_3.json
// is { priceGuides: [{ idProduct, trend, avg, low, ... }] }; `trend` is null or 0 when there is
// no trend — both are skipped (0 would otherwise be written as a real €0 price).
export type TrendRow = { id_product: number; trend: number };

export function pickTrends(guide: unknown, ids: Set<number>): TrendRow[] {
  const list = (guide as { priceGuides?: unknown } | null)?.priceGuides;
  if (!Array.isArray(list) || ids.size === 0) return [];
  const seen = new Set<number>();
  const out: TrendRow[] = [];
  for (const g of list as Array<{ idProduct?: unknown; trend?: unknown }>) {
    const id = Number(g?.idProduct);
    if (!ids.has(id) || seen.has(id)) continue;
    const t = g?.trend;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
    seen.add(id);
    out.push({ id_product: id, trend: t });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `deno test supabase/functions/refresh-cardmarket-prices/`
Expected: 4 passed, 0 failed.

- [ ] **Step 5: Implement `index.ts`**

```ts
// supabase/functions/refresh-cardmarket-prices/index.ts
// Supabase Edge Function: apply Cardmarket's daily `trend` price to every cloud row whose
// cm_product_id the desktop has mirrored, so the phone stays current without the desktop.
// Deploy:  supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
//   (--no-verify-jwt so pg_cron can call it; optional secret below)
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//   Optional hardening: set CM_TRIGGER_SECRET to require header `x-cm-secret` on every call.
// See supabase/README_cardmarket_cloud.md and docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { pickTrends } from "./prices.ts";

const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0";
const PAGE = 1000; // PostgREST default max rows per request

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CM_TRIGGER_SECRET");
  if (secret && req.headers.get("x-cm-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Every distinct Cardmarket product id we must price (skip deleted rows and manual prices).
  const ids = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("cards")
      .select("cm_product_id")
      .not("cm_product_id", "is", null)
      .eq("deleted", false)
      .neq("price_locked", 2)
      .range(from, from + PAGE - 1);
    if (error) return json({ error: `select: ${error.message}` }, 500);
    for (const r of data ?? []) if (r.cm_product_id != null) ids.add(Number(r.cm_product_id));
    if (!data || data.length < PAGE) break;
  }
  if (ids.size === 0) return json({ needed: 0, found: 0, updated: 0 });

  // 2. Today's price guide (≈17 MB; parses in well under the 2 s CPU limit).
  const res = await fetch(GUIDE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) return json({ error: `guide HTTP ${res.status}` }, 502);
  let guide: unknown;
  try { guide = await res.json(); } catch (e) { return json({ error: `guide parse: ${(e as Error).message}` }, 502); }
  const prices = pickTrends(guide, ids);
  if (prices.length === 0) return json({ needed: ids.size, found: 0, updated: 0 });

  // 3. One UPDATE for everything; only rows whose price actually changes are touched.
  const { data: updated, error: rpcErr } = await supabase.rpc("apply_cardmarket_prices", { prices });
  if (rpcErr) return json({ error: `rpc: ${rpcErr.message}` }, 500);

  const body = { needed: ids.size, found: prices.length, updated: Number(updated ?? 0) };
  console.log("[refresh-cardmarket-prices]", JSON.stringify(body));
  return json(body);
});
```

- [ ] **Step 6: Type-check the function**

Run (repo root): `deno check supabase/functions/refresh-cardmarket-prices/index.ts`
Expected: no errors (Deno resolves `jsr:` specifiers on first run; needs network).

- [ ] **Step 7: Commit**

```bash
rtk git add supabase/functions/refresh-cardmarket-prices
rtk git commit -m "feat(cloud): refresh-cardmarket-prices Edge Function (ids -> price guide -> apply_cardmarket_prices)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Deploy, backfill, verify, schedule (controller + user)

This task is executed by the controller with the user, not by an implementer subagent.

- [ ] **Step 1: User applies the SQL** — paste `supabase/cardmarket_cloud_prices_migration.sql` into the SQL editor and run. Verify with the column query from the README (expects `cm_product_id integer`, `price_locked smallint`).

- [ ] **Step 2: Deploy the function**

```bash
supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
```
Expected: "Deployed Functions on project uirfqwklvavgjklgqpnn: refresh-cardmarket-prices".

- [ ] **Step 3: First call (before backfill)**

```bash
curl -s -X POST https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices
```
Expected: `{"needed":0,"found":0,"updated":0}` (cloud has no `cm_product_id` yet).

- [ ] **Step 4: Backfill from the desktop** — run the desktop once (`npm run electron:dev` from `desktop/`, installed app closed). Console shows `[sync] cloud backfill: marked ~1060 rows dirty …` and a sync cycle pushes them (≤ 20 s). Verify in the SQL editor: `select count(*) from cards where cm_product_id is not null;` ≈ 1060, and `select price_locked, count(*) from cards group by 1;`.

- [ ] **Step 5: Second call**

Same curl. Expected: `needed ≈ 1060`, `found ≈ 1060`, `updated: 0` (the desktop already priced these rows with today's trend — idempotence proven). If `updated > 0`, spot-check one changed row against the desktop value; a mismatch means the desktop and cloud read different guide versions (file rewritten between runs) — acceptable, re-run once.

- [ ] **Step 6: Schedule** — user runs the `cron.schedule` block from the README in the SQL editor. Verify with `select jobname, schedule, active from cron.job;`.

- [ ] **Step 7: Docs + commit** — in `CLAUDE.md` (repo root), append one sentence to the *Price source* bullet: "The Supabase Edge Function `refresh-cardmarket-prices` (pg_cron, daily 05:00 UTC) applies the same `trend` to the cloud rows so the phone stays current without the desktop; `cm_product_id` and `price_locked` (0/1/2) are mirrored via `sync.cjs`." Flip the spec status to `Implemented 2026-09-02`.

```bash
rtk git add CLAUDE.md docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md
rtk git commit -m "docs: Cardmarket cloud price refresh — CLAUDE.md + spec status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
