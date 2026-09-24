-- supabase/cards_quantity_on_insert.sql -- einmal im Supabase SQL Editor ausfuehren (wiederholbar).
--
-- Fehler (gefunden 24.09.2026, Handy zaehlte 30 Karten weniger als der PC): cards.quantity wird nur
-- nachgezaehlt, wenn sich ein Exemplar aendert (trg_card_copies_recount). Kommen die Exemplare eines
-- neuen Drucks VOR dem Druck in der Cloud an, findet recount_printing() keine Zeile; der Druck wird
-- danach ohne quantity eingefuegt (der PC schiebt quantity bewusst nicht) und behaelt den
-- Spaltenstandard 1 -- bis sich zufaellig wieder ein Exemplar dieses Drucks aendert.
--
-- 1) Beim Einfuegen eines Drucks zaehlt die Cloud selbst die schon vorhandenen lebenden Exemplare.
--    Gibt es noch keine (der Normalfall: Druck vor Exemplaren), bleibt die Zeile, wie sie kam;
--    trg_card_copies_recount korrigiert sie beim ersten Exemplar.
create or replace function public.cards_quantity_on_insert()
returns trigger language plpgsql as $$
declare n integer;
begin
  select count(*) into n from public.card_copies c
   where c.card_id = new.id and c.set_code = new.set_code and c.language = new.language
     and c.rarity = new.rarity and c.deleted = false;
  if n > 0 then
    new.quantity := n;
    new.deleted := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_cards_quantity_on_insert on public.cards;
create trigger trg_cards_quantity_on_insert
  before insert on public.cards
  for each row execute function public.cards_quantity_on_insert();

-- 2) Einmalige Reparatur: jeden Druck, dessen Menge/Loeschmarke nicht zu seinen lebenden Exemplaren
--    passt, nachzaehlen. Nur abweichende Zeilen werden geschrieben (neuer updated_at -> Handy und PC
--    ziehen genau diese per Delta nach).
update public.cards k
   set quantity = n.live, deleted = (n.live = 0)
  from (
    select c.id, c.set_code, c.language, c.rarity,
           (select count(*) from public.card_copies cp
             where cp.card_id = c.id and cp.set_code = c.set_code and cp.language = c.language
               and cp.rarity = c.rarity and cp.deleted = false)::integer as live
      from public.cards c
  ) n
 where k.id = n.id and k.set_code = n.set_code and k.language = n.language and k.rarity = n.rarity
   and (k.quantity is distinct from n.live or k.deleted is distinct from (n.live = 0));

-- Kontrolle (soll 0 Zeilen liefern):
-- select c.id, c.set_code, c.rarity, c.quantity,
--        (select count(*) from public.card_copies cp where cp.card_id = c.id and cp.set_code = c.set_code
--           and cp.language = c.language and cp.rarity = c.rarity and cp.deleted = false) as live
--   from public.cards c where c.deleted = false
--  and c.quantity <> (select count(*) from public.card_copies cp where cp.card_id = c.id and cp.set_code = c.set_code
--           and cp.language = c.language and cp.rarity = c.rarity and cp.deleted = false);
