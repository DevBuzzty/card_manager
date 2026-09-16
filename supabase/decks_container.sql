-- supabase/decks_container.sql — Spec E1 §3. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer und der APK (Spec §10).
-- Ein Deck hat hoechstens eine Deckbox, eine Deckbox gehoert hoechstens einem Deck. Kein Fremdschluessel:
-- Behaelter werden nur soft-geloescht; eine geloeschte oder umgestellte Box gilt in der App als "keine Box",
-- die Spalte wird nicht automatisch geleert. Die bestehende Policy "decks are private" deckt das Update ab.

alter table public.decks add column if not exists container_id text;   -- Deckbox, optional
create unique index if not exists decks_container_unique
  on public.decks (container_id) where container_id is not null;

-- Abnahme (Nutzer, von Hand): select id, name, container_id from public.decks order by id;
