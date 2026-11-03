-- supabase/cm_index_cron.sql -- Spec 2026-11-03 §5.1/§11.4. Erst NACH dem Deploy von refresh-cardmarket-prices mit dem
-- Schritt "cm-index" und dem ersten Index-Bau von Hand einspielen (README_cardmarket_cloud.md).
-- Taeglich 05:20 UTC (nach dem 05:00-Lauf, der unveraendert bleibt): baut nur cm-index.json.gz im privaten Bucket cm-index.
-- Idempotent: ein vorhandener Job gleichen Namens wird zuerst entfernt.
-- Ist das Secret CM_TRIGGER_SECRET gesetzt, den Platzhalter <geheimnis> ersetzen; sonst die Zeile "x-cm-secret" entfernen.
-- timeout_milliseconds: pg_net wartet sonst nur 5 s; mit dem Wert zeigt net._http_response den Body des Schritts.
-- Ueberwachung: Aenderungsdatum von cm-index/cm-index.json.gz bzw. Function-Logs ("[cm-index] ...").
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'refresh-cardmarket-cm-index';

select cron.schedule(
  'refresh-cardmarket-cm-index',
  '20 5 * * *',
  $$
  select net.http_post(
    url := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices',
    headers := '{"Content-Type": "application/json", "x-cm-secret": "<geheimnis>"}'::jsonb,
    body := '{"step": "cm-index"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
