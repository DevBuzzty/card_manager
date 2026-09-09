-- Spec B1: Behaelter (Binder, Box, Deckbox). Gegenstueck zu desktop/electron/containers-schema.cjs.
-- Vom Nutzer im Supabase-Dashboard anzuwenden.

create table if not exists public.containers (
  container_id     text primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null,
  kind             text not null check (kind in ('binder','box','deckbox')),
  pockets_per_page integer,
  color            text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);

create index if not exists containers_user_updated_idx
  on public.containers (user_id, updated_at);

alter table public.containers enable row level security;

drop policy if exists "containers sind privat" on public.containers;
create policy "containers sind privat" on public.containers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at wird IMMER serverseitig gestempelt: der Cursor des Clients liest gegen diese
-- Spalte, ein vom Client mitgeschickter Wert koennte einen Pull ueberspringen lassen.
drop trigger if exists containers_touch_updated_at on public.containers;
create trigger containers_touch_updated_at
  before insert or update on public.containers
  for each row execute function public.set_updated_at();

-- Der Standort-Index auf card_copies. Die fuenf Spalten selbst existieren bereits (Spec A).
create index if not exists card_copies_location_idx
  on public.card_copies (container_id, page, slot);
