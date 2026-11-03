-- supabase/cm_resolve_schema.sql -- Spec 2026-11-03 §5.4. Einspielen VOR dem Deploy von resolve-cm-product (§11.1).
-- Idempotent. Voraussetzung: public.set_updated_at() aus schema.sql.
-- Cache der Live-Zuordnung Druck -> Cardmarket-Produkt(e). Gelesen und geschrieben nur von resolve-cm-product (Service-Rolle).
create table if not exists public.cm_resolve_cache (
  card_id     text not null,
  code_key    text not null,             -- CodeKey.of(set_code) ?: upper(set_code), z.B. 'LOB-1'
  rarity_key  text not null,             -- RarityNorm.key(rarity) ?: ''
  status      text not null check (status in ('resolved', 'ambiguous', 'not_found')),
  how         text check (how in ('real', 'unique', 'derived', 'blocks')),
  reason      text,
  cm          integer[] not null default '{}',
  index_date  date not null,
  checked_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name_norm   text not null default '',  -- normName des verwendeten Namens; Zeile gilt nur für denselben Namen (Spec §5.4)
  primary key (card_id, code_key, rarity_key)
);
-- Nachtrag (Review 2): Spalte auch in schon angelegten Tabellen. Alte Zeilen ('') gelten nie und werden neu berechnet.
alter table public.cm_resolve_cache add column if not exists name_norm text not null default '';
create index if not exists cm_resolve_cache_updated_idx on public.cm_resolve_cache (updated_at);   -- für die Aufräumzeile §11.6
drop trigger if exists trg_cm_resolve_cache_updated_at on public.cm_resolve_cache;
create trigger trg_cm_resolve_cache_updated_at before insert or update on public.cm_resolve_cache
  for each row execute function public.set_updated_at();
alter table public.cm_resolve_cache enable row level security;
-- Keine Policy: Geräte lesen die Tabelle nie, nur die Funktion (Service-Rolle umgeht RLS). Diagnose im SQL-Editor.
drop policy if exists cm_resolve_cache_authenticated_read on public.cm_resolve_cache;
revoke all on public.cm_resolve_cache from anon, authenticated;

-- Privater Bucket für den Cardmarket-Index (enthält aus der Sammlung abgeleitete Daten). Ohne Storage-Policy:
-- nur die Service-Rolle (refresh-cardmarket-prices schreibt, resolve-cm-product liest) kommt heran.
insert into storage.buckets (id, name, public)
values ('cm-index', 'cm-index', false)
on conflict (id) do update set public = false;
