-- One-time migration: switch deal_alerts dedup from (source, listing_id) to
-- (watch_id, source, listing_id), so two different watches that match the same
-- listing each get their own alert row (the old key silently dropped the second).
-- Run once in the Supabase SQL editor, THEN redeploy the scrape-deals function.

alter table public.deal_alerts
  drop constraint if exists deal_alerts_source_listing_id_key;

alter table public.deal_alerts
  add constraint deal_alerts_watch_id_source_listing_id_key
  unique (watch_id, source, listing_id);
