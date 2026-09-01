-- Make RARITY part of a printing's identity, so the SAME set code held in two rarities
-- (e.g. Secret Rare + Ultra Rare) are two distinct rows with their own quantity/price instead
-- of collapsing into one. Mirrors the desktop SQLite change. Run once in the Supabase SQL editor.

alter table public.cards alter column rarity set default 'Unknown';
update public.cards set rarity = 'Unknown' where rarity is null;
alter table public.cards alter column rarity set not null;

alter table public.cards drop constraint cards_pkey;
alter table public.cards add primary key (id, set_code, language, rarity);
