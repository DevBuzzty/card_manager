-- supabase/cards_price_lock_migration.sql
-- Trusted per-rarity prices (Cardmarket scrape or manual) sync from desktop; the phone just reads them.
alter table public.cards add column if not exists cm_url text;
alter table public.cards add column if not exists cm_updated_at timestamptz;
alter table public.cards add column if not exists price_locked boolean not null default false;
