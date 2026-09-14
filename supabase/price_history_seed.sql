-- supabase/price_history_seed.sql — Spec G1 §4.2/§4.10. Absicherung, NACH price_reference_rpc.sql und
-- nachdem der neue Desktop-Build einmal lief. Fuegt nichts hinzu, wenn der Desktop die Startzeilen schon
-- hochgeschoben hat. Gleiche Regel wie desktop/electron/price-history.cjs#seedPriceHistory: Schluessel
-- normalisiert wie recordPrice (set_code/rarity leer oder NULL -> 'Unknown', language leer oder NULL -> 'DE').
insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
select c.id, coalesce(nullif(c.set_code,''),'Unknown'), coalesce(nullif(c.language,''),'DE'),
       coalesce(nullif(c.rarity,''),'Unknown'), 'base', current_date, c.price,
       case coalesce(c.price_locked, 0) when 1 then 'cm_bulk' when 2 then 'manual' else 'ygoprodeck' end
  from public.cards c
 where c.deleted = false
   and c.price > 0
   and exists (select 1 from public.card_copies cp
                where cp.card_id = c.id
                  and cp.set_code = coalesce(nullif(c.set_code,''),'Unknown')
                  and cp.language = coalesce(nullif(c.language,''),'DE')
                  and cp.rarity = coalesce(nullif(c.rarity,''),'Unknown') and cp.deleted = false)
   and not exists (select 1 from public.price_history h
                    where h.card_id = c.id
                      and h.set_code = coalesce(nullif(c.set_code,''),'Unknown')
                      and h.language = coalesce(nullif(c.language,''),'DE')
                      and h.rarity = coalesce(nullif(c.rarity,''),'Unknown') and h.variant = 'base')
on conflict (card_id, set_code, language, rarity, variant, day) do nothing;
