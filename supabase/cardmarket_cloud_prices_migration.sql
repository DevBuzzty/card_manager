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
