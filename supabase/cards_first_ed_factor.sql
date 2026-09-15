-- supabase/cards_first_ed_factor.sql — Spec G4 §5. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer: der Push sendet cm_first_ed_factor, ohne Spalte scheitert jeder Push.
-- price_first_ed = round(price x cm_first_ed_factor, 2), nachgefuehrt per Trigger. Die Edge Function
-- refresh-cardmarket-prices setzt nur price; dieser Trigger rechnet den 1st-Ed-Preis mit demselben Faktor nach.
-- ZWILLING: desktop/electron/copies-schema.cjs (FIRST_ED_SQL, trg_cards_first_ed_ins/_upd).
-- Rundung exakt in numeric (price::numeric), damit ,xx5 kaufmaennisch rundet wie SQLite mit + 1e-7.
-- Abnahme-Fixture: docs/fixtures/valuation/first-ed.json, Abschnitt trigger.

alter table public.cards add column if not exists cm_first_ed_factor numeric;

create or replace function public.cards_price_first_ed()
returns trigger language plpgsql as $$
begin
  new.price_first_ed := case
    when new.cm_first_ed_factor is not null and new.price is not null
      then round(new.price::numeric * new.cm_first_ed_factor, 2)::double precision
  end;
  return new;
end $$;

drop trigger if exists trg_cards_price_first_ed on public.cards;
create trigger trg_cards_price_first_ed
  before insert or update on public.cards
  for each row execute function public.cards_price_first_ed();

-- Einmaliges Nachrechnen; aendert nur abweichende Zeilen (der Trigger setzt den Wert beim UPDATE selbst).
update public.cards
   set price_first_ed = case
         when cm_first_ed_factor is not null and price is not null
           then round(price::numeric * cm_first_ed_factor, 2)::double precision
       end
 where price_first_ed is distinct from case
         when cm_first_ed_factor is not null and price is not null
           then round(price::numeric * cm_first_ed_factor, 2)::double precision
       end;

-- Abnahme (Nutzer, von Hand): Fixture-Faelle pruefen, erwartet 77.87 | 10.01 | null | null
-- select round(73.85::numeric * 1.0545, 2)::double precision, round(10::numeric * 1.0005, 2)::double precision;
