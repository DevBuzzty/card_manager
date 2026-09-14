-- supabase/price_alerts_cron.sql — Spec G2 §3/§11. Erst NACH dem Deploy der Funktion einspielen.
-- Stuendlich um :15 (die Cardmarket-Aktualisierung laeuft um 05:00 UTC, der 05:15-Lauf sieht sie also).
-- Idempotent: ein vorhandener Job gleichen Namens wird zuerst entfernt.
-- Ist das Secret ALERTS_TRIGGER_SECRET gesetzt, im headers-JSON zusaetzlich
--   "x-alerts-secret": "<geheimnis>"
-- eintragen.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'evaluate-price-alerts';

select cron.schedule(
  'evaluate-price-alerts',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/evaluate-price-alerts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
