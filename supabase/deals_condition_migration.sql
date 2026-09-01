-- supabase/deals_condition_migration.sql
-- Per-watch condition filter for the eBay Deals source. Run once in the Supabase SQL editor.
-- Only the eBay adapter honors it; Kleinanzeigen ignores it. Existing watches default to 'any'.
alter table public.deal_watches
  add column if not exists condition text not null default 'any';
