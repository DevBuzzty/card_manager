-- supabase/decks_format_role.sql — Spec E3 §4/§6/§9. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer und der APK.
-- decks.format: Legalitaetsformat je Deck (tcg | ocg | free), Standard tcg -- bestehende Decks werden TCG.
-- deck_cards.role: 'starter' fuer Starthand-Ziele (nur Desktop setzt es), leer = normal.
-- Die bestehenden Policies "decks are private" und "deck_cards are private" decken Lesen und Schreiben ab.

alter table public.decks add column if not exists format text not null default 'tcg';
alter table public.decks drop constraint if exists decks_format_check;
alter table public.decks add constraint decks_format_check check (format in ('tcg', 'ocg', 'free'));

alter table public.deck_cards add column if not exists role text;
alter table public.deck_cards drop constraint if exists deck_cards_role_check;
alter table public.deck_cards add constraint deck_cards_role_check check (role in ('starter'));

-- Abnahme (Nutzer, von Hand):
--   select id, name, format from public.decks order by id desc limit 5;
--   select deck_id, card_id, count, section, role from public.deck_cards where role is not null limit 10;
