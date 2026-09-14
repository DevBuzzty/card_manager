-- supabase/price_history_seed.sql — Spec G1 §4.2/§4.10. Absicherung, NACH price_reference_rpc.sql und
-- nachdem der neue Desktop-Build einmal lief. Fuegt nichts hinzu, wenn der Desktop die Startzeilen schon
-- hochgeschoben hat. Gleiche Regel wie desktop/electron/price-history.cjs#seedPriceHistory.
insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
select c.id, c.set_code, c.language, c.rarity, 'base', current_date, c.price,
       case coalesce(c.price_locked, 0) when 1 then 'cm_bulk' when 2 then 'manual' else 'ygoprodeck' end
  from public.cards c
 where c.deleted = false
   and c.price > 0
   and exists (select 1 from public.card_copies cp
                where cp.card_id = c.id and cp.set_code = c.set_code
                  and cp.language = c.language and cp.rarity = c.rarity and cp.deleted = false)
   and not exists (select 1 from public.price_history h
                    where h.card_id = c.id and h.set_code = c.set_code
                      and h.language = c.language and h.rarity = c.rarity and h.variant = 'base')
on conflict (card_id, set_code, language, rarity, variant, day) do nothing;
