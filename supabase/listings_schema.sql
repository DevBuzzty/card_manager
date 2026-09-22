-- supabase/listings_schema.sql — Spec H3a §4.2. Einmal im Dashboard einspielen (idempotent), BEVOR das Handy Angebote
-- nutzt; empfohlen vor dem neuen PC-Build (ohne die Tabellen protokolliert der PC-Abgleich nur für diese zwei Ströme
-- einen Fehler, alle anderen laufen weiter). Setzt voraus: public.set_updated_at() (schema.sql).
-- Einzelnutzer-Modell wie sales/card_copies: keine user_id. KEINE Datenbankfunktion (Spec §4.2): das Handy schreibt per
-- REST, "Verkauft" bucht über book_sale (sales_schema.sql). Gegenstück lokal: desktop/electron/listings-schema.cjs.

create table if not exists public.listings (
  listing_id   text primary key,
  channel_id   text not null,
  channel_name text not null,
  title        text,
  description  text,
  price        numeric(12,2) not null check (price > 0),
  status       text not null default 'aktiv' check (status in ('aktiv', 'verkauft', 'beendet')),
  listed_on    date not null,
  sale_id      text,
  external_url text,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.listing_items (
  listing_id text not null,
  copy_id    text not null,
  card_id    text not null,
  set_code   text not null,
  language   text not null,
  rarity     text not null,
  edition    text not null,
  condition  text not null,
  name       text,
  image_url  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (listing_id, copy_id)
);

create index if not exists listings_updated_idx on public.listings (updated_at);
create index if not exists listing_items_updated_idx on public.listing_items (updated_at);
create index if not exists listing_items_copy_idx on public.listing_items (copy_id);

drop trigger if exists trg_listings_updated_at on public.listings;
create trigger trg_listings_updated_at before insert or update on public.listings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_listing_items_updated_at on public.listing_items;
create trigger trg_listing_items_updated_at before insert or update on public.listing_items
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;
alter table public.listing_items enable row level security;
drop policy if exists listings_authenticated_all on public.listings;
create policy listings_authenticated_all on public.listings for all to authenticated using (true) with check (true);
drop policy if exists listing_items_authenticated_all on public.listing_items;
create policy listing_items_authenticated_all on public.listing_items for all to authenticated using (true) with check (true);
