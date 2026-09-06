-- supabase/catalog_versions_schema.sql — Spec D1. Einmal im Supabase-SQL-Editor ausführen.
-- Eine Zeile pro Artefaktart: welche Version aktuell ist und wo sie liegt.
-- Der Katalog ist kein Nutzerdatum -> Lesen für alle, Schreiben nur für den angemeldeten Desktop.

create table if not exists public.catalog_versions (
  kind       text primary key check (kind in ('catalog','index','embedder','detector')),
  version    integer not null,
  url        text not null,
  bytes      bigint not null default 0,
  sha256     text,
  built_at   timestamptz not null default now()
);

alter table public.catalog_versions enable row level security;

drop policy if exists catalog_versions_read on public.catalog_versions;
create policy catalog_versions_read on public.catalog_versions
  for select using (true);

drop policy if exists catalog_versions_write on public.catalog_versions;
create policy catalog_versions_write on public.catalog_versions
  for all to authenticated using (true) with check (true);

-- Storage-Bucket. Öffentlich lesbar, damit das Handy ohne Token laden kann.
insert into storage.buckets (id, name, public)
values ('catalog', 'catalog', true)
on conflict (id) do update set public = true;

drop policy if exists catalog_objects_read on storage.objects;
create policy catalog_objects_read on storage.objects
  for select using (bucket_id = 'catalog');

drop policy if exists catalog_objects_write on storage.objects;
create policy catalog_objects_write on storage.objects
  for all to authenticated using (bucket_id = 'catalog') with check (bucket_id = 'catalog');
