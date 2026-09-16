-- supabase/decks_notes.sql — Spec E2 §5/§8. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer und der APK.
-- Notizen je Deck: beim Import landen nicht uebernommene Zeilen hier ("Nicht übernommen beim Import:" plus je eine
-- Zeile); am Desktop frei bearbeitbar, am Handy nur Anzeige. Die bestehende Policy "decks are private" deckt
-- Lesen und Schreiben ab.

alter table public.decks add column if not exists notes text;

-- Abnahme (Nutzer, von Hand): select id, name, notes from public.decks order by id desc limit 5;
