-- Koreanische Karten (Spec docs/superpowers/specs/2026-10-01-koreanische-karten-design.md).
-- VOR dem neuen Desktop-Installer und der neuen APK ausfuehren: beide senden name_ko/cm_lang_factor,
-- ohne die Spalten scheitert jeder Push. Idempotent.
alter table public.cards add column if not exists name_ko text;
alter table public.cards add column if not exists cm_lang_factor double precision;

-- Tagesaktualisierung: Trend x Sprachfaktor (KR), auf Cent gerundet. Ohne Faktor = Trend wie bisher.
create or replace function public.apply_cardmarket_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with v as (
    select x.id_product, x.trend
      from jsonb_to_recordset(prices) as x(id_product integer, trend double precision)
     where x.trend > 0
  ), changed as (
    update public.cards c
       set price = round(v.trend::numeric * coalesce(c.cm_lang_factor, 1)::numeric, 2)::double precision,
           cm_updated_at = now()
      from v
     where c.cm_product_id = v.id_product
       and c.deleted = false
       and coalesce(c.price_locked, 0) <> 2
       and c.price is distinct from round(v.trend::numeric * coalesce(c.cm_lang_factor, 1)::numeric, 2)::double precision
     returning c.id, c.set_code, c.language, c.rarity, c.price
  )
  insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
  select id, set_code, language, rarity, 'base', current_date, price, 'cloud' from changed
  on conflict (card_id, set_code, language, rarity, variant, day)
  do update set price = excluded.price, source = excluded.source, recorded_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_prices(jsonb) from public, anon, authenticated;
grant execute on function public.apply_cardmarket_prices(jsonb) to service_role;

-- Pruefen (erwartet 0.08, 7.5, 3.33):
-- select round(0.15::numeric * 0.5::numeric, 2), round(12.5::numeric * 0.6::numeric, 2), round(3.33::numeric * 1::numeric, 2);
-- select has_function_privilege('anon', 'public.apply_cardmarket_prices(jsonb)', 'execute'); -- erwartet: false
