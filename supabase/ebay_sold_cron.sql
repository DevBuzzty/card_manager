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
