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
