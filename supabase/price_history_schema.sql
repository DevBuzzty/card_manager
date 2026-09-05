-- supabase/price_history_schema.sql — Spec A. Apply ONCE after card_copies_schema.sql.
create table if not exists public.price_history (
  card_id     text not null,
  set_code    text not null,
  language    text not null,
  rarity      text not null,
  variant     text not null default 'base',      -- 'base' | 'first' (Spec G)
  day         date not null,
  price       double precision not null,
  source      text not null,                     -- ygoprodeck | cm_bulk | cm_scrape | manual | cloud
  recorded_at timestamptz not null default now(),
  primary key (card_id, set_code, language, rarity, variant, day)
);
create index if not exists price_history_printing_idx on public.price_history (card_id, set_code, language, rarity, day desc);

alter table public.price_history enable row level security;
drop policy if exists price_history_authenticated_all on public.price_history;
create policy price_history_authenticated_all on public.price_history
  for all to authenticated using (true) with check (true);

-- The daily Cardmarket refresh also records history for the rows it changes (source = 'cloud').
create or replace function public.apply_cardmarket_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with changed as (
    update public.cards c
       set price = v.trend,
           cm_updated_at = now()
      from jsonb_to_recordset(prices) as v(id_product integer, trend double precision)
     where c.cm_product_id = v.id_product
       and c.deleted = false
       and coalesce(c.price_locked, 0) <> 2
       and v.trend > 0
       and c.price is distinct from v.trend
     returning c.id, c.set_code, c.language, c.rarity, v.trend
  )
  insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
  select id, set_code, language, rarity, 'base', current_date, trend, 'cloud' from changed
  on conflict (card_id, set_code, language, rarity, variant, day)
  do update set price = excluded.price, source = excluded.source, recorded_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_prices(jsonb) from public;
grant execute on function public.apply_cardmarket_prices(jsonb) to service_role;
