# Cardmarket cloud price refresh

Keeps `cards.price` current on the phone even when the desktop is off. The desktop still owns the
`cm_product_id` mapping (file resolver + scraper); the cloud only applies Cardmarket's daily `trend`.
Design: `docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md`.

## 1. Apply the SQL (once, BEFORE the desktop mirrors the new columns)

SQL editor → paste `supabase/cardmarket_cloud_prices_migration.sql` → Run.
Check: `select column_name, data_type from information_schema.columns where table_name = 'cards' and column_name in ('cm_product_id','price_locked');`
→ `cm_product_id integer`, `price_locked smallint`.
If a desktop with the new sync code runs before this SQL is applied, its push fails wholesale
(`column cards.cm_product_id does not exist` / `invalid input syntax for type boolean`) and ALL
card sync pauses; it resumes by itself once the SQL has run.

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
Prices are per Cardmarket product (`cm_product_id`), i.e. per printing+rarity as resolved on the
desktop; the cloud never changes the mapping.

## Spec A (2026-09): price history

`apply_cardmarket_prices` now also upserts one `price_history` row (source `cloud`, variant `base`, today) per card whose price changed.

**Apply order (on a fresh project):**
1. `portfolio_snapshots_schema.sql` (if not yet applied)
2. `card_copies_schema.sql`
3. `price_history_schema.sql`

The desktop backfills copies and pushes them on its next sync.

**Rollout order:** apply the cloud SQL first (steps 1-3 above), then run the updated desktop
build — it backfills `card_copies` locally and pushes them on its next sync — then install the
updated phone build. An old phone build still PATCHes `cards.quantity` directly; the new desktop
and cloud triggers simply ignore that field, so an out-of-order phone update is harmless, just
inert until the phone is updated too.

**Restoring an old backup:** restoring a pre-Spec-A `cards.db` (no `card_copies` rows) makes the
desktop re-run the backfill on next launch. If the cloud already holds copies for that
collection (e.g. sync had already delivered the Spec A migration before the restore), the next
pull would double them up. Restore only with sync disabled, and clear `card_copies` in the cloud
first — or ask for a reconcile before re-enabling sync.
