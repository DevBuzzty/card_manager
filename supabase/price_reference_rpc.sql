-- supabase/price_reference_rpc.sql — Spec G1 §4.3. Einmal einspielen (idempotent).
-- Pro Printing die letzte price_history-Zeile (Variante base) mit day <= heute - days;
-- gibt es keine, die frueheste (daraus rechnet das Handy "Bewegungen erscheinen ab TT.MM.").
-- Gewichtung und Quellenfamilie stehen bewusst NICHT hier, sondern in ml/Movers.kt bzw. electron/movers.cjs.
-- Gleiche Auswahl wie desktop/electron/price-reference.cjs#referenceRows.
create or replace function public.price_reference(days integer)
returns table (card_id text, set_code text, language text, rarity text, day date, price double precision, source text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (h.card_id, h.set_code, h.language, h.rarity)
         h.card_id, h.set_code, h.language, h.rarity, h.day, h.price, h.source
    from public.price_history h
   where h.variant = 'base'
   order by h.card_id, h.set_code, h.language, h.rarity,
            (h.day <= current_date - days) desc,
            case when h.day <= current_date - days then h.day end desc nulls last,
            h.day asc
$$;

revoke all on function public.price_reference(integer) from public;
revoke all on function public.price_reference(integer) from anon;
grant execute on function public.price_reference(integer) to authenticated;
