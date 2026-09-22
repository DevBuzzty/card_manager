-- supabase/ebay_schema.sql — Spec H3b1 §4.2/§5.1/§6/§8. Einmal im Dashboard einspielen (idempotent), BEVOR ebay-auth/ebay-sync
-- deployt werden und bevor der neue PC-/Handy-Build läuft. Setzt voraus: public.set_updated_at() (schema.sql),
-- public.listings/listing_items (listings_schema.sql), public.card_copies (card_copies_schema.sql).
-- Einzelnutzer-Modell wie listings: keine user_id. Tokens stehen NUR in ebay_account; dafür gibt es KEINE Regel für
-- authenticated/anon (nur die Dienstrolle der Funktionen liest/schreibt). Geräte lesen ebay_status (ohne Tokens).

-- 1. Konto (eine Zeile, id = 1)
create table if not exists public.ebay_account (
  id                      smallint primary key default 1 check (id = 1),
  environment             text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  marketplace             text not null default 'EBAY_DE',
  refresh_token           text,
  refresh_expires_at      timestamptz,
  access_token            text,
  access_expires_at       timestamptz,
  oauth_state             text,
  oauth_state_expires_at  timestamptz,
  payment_policy_id       text,
  payment_policy_name     text,
  fulfillment_policy_id   text,
  fulfillment_policy_name text,
  return_policy_id        text,
  return_policy_name      text,
  location_key            text,
  orders_cursor           text,
  sync_lock_holder        text,
  sync_lock_until         timestamptz,
  last_run_at             timestamptz,
  last_run_summary        text,
  last_error              text,
  connected_at            timestamptz,
  updated_at              timestamptz not null default now()
);
insert into public.ebay_account (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_ebay_account_updated_at on public.ebay_account;
create trigger trg_ebay_account_updated_at before insert or update on public.ebay_account
  for each row execute function public.set_updated_at();

alter table public.ebay_account enable row level security;
revoke all on public.ebay_account from anon, authenticated;

-- 2. Stand für die Geräte (ohne Tokens). Die Ansicht gehört postgres und liest ebay_account daher trotz RLS.
create or replace view public.ebay_status as
select a.environment,
       (a.refresh_token is not null and (a.refresh_expires_at is null or a.refresh_expires_at > now())) as connected,
       a.refresh_expires_at,
       a.payment_policy_id is not null     as has_payment_policy,
       a.fulfillment_policy_id is not null as has_fulfillment_policy,
       a.return_policy_id is not null      as has_return_policy,
       a.location_key is not null          as has_location,
       a.payment_policy_id, a.payment_policy_name,
       a.fulfillment_policy_id, a.fulfillment_policy_name,
       a.return_policy_id, a.return_policy_name,
       a.location_key,
       a.last_run_at, a.last_run_summary, a.last_error, a.connected_at, a.updated_at
  from public.ebay_account a
 where a.id = 1;
revoke all on public.ebay_status from anon;
grant select on public.ebay_status to authenticated;

-- 3. eBay-Stand je Angebot (nur die Funktion schreibt; Geräte lesen)
create table if not exists public.ebay_listings (
  listing_id    text primary key,
  environment   text not null check (environment in ('sandbox', 'production')),
  state         text not null check (state in ('wartet', 'online', 'fehler', 'beendet')),
  sku           text,
  offer_id      text,
  item_id       text,
  item_url      text,
  published_qty integer,
  synced_hash   text,
  failed_hash   text,
  sold_seen     integer,
  error         text,
  synced_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ebay_listings_updated_idx on public.ebay_listings (updated_at);
drop trigger if exists trg_ebay_listings_updated_at on public.ebay_listings;
create trigger trg_ebay_listings_updated_at before insert or update on public.ebay_listings
  for each row execute function public.set_updated_at();
alter table public.ebay_listings enable row level security;
drop policy if exists ebay_listings_authenticated_read on public.ebay_listings;
create policy ebay_listings_authenticated_read on public.ebay_listings for select to authenticated using (true);

-- 4. Eigene Fotos (Strom in beide Richtungen wie listings; weiches Löschen)
create table if not exists public.listing_photos (
  photo_id   text primary key,
  listing_id text not null,
  path       text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);
create index if not exists listing_photos_updated_idx on public.listing_photos (updated_at);
create index if not exists listing_photos_listing_idx on public.listing_photos (listing_id);
drop trigger if exists trg_listing_photos_updated_at on public.listing_photos;
create trigger trg_listing_photos_updated_at before insert or update on public.listing_photos
  for each row execute function public.set_updated_at();
alter table public.listing_photos enable row level security;
drop policy if exists listing_photos_authenticated_all on public.listing_photos;
create policy listing_photos_authenticated_all on public.listing_photos for all to authenticated using (true) with check (true);

-- 5. Speicher listing-photos: öffentlich lesbar (eBay lädt die Bilder selbst), hochladen nur angemeldet,
--    nur JPEG bis 2 MB (die Geräte verkleinern auf < 500 KB). Kein Löschen/Überschreiben (Dateinamen sind UUIDs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];
drop policy if exists listing_photos_objects_insert on storage.objects;
create policy listing_photos_objects_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'listing-photos');

-- 6. Nur ein ebay-sync gleichzeitig (Spec §8, Abweichung 2): Mietsperre in ebay_account statt pg_try_advisory_lock,
--    weil jeder PostgREST-Aufruf eine eigene Verbindung/Transaktion ist. Läuft nach p_seconds von selbst ab.
create or replace function public.ebay_try_lock(p_holder text, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.ebay_account
     set sync_lock_holder = p_holder, sync_lock_until = now() + make_interval(secs => p_seconds)
   where id = 1 and (sync_lock_until is null or sync_lock_until < now());
  return found;
end;
$$;
create or replace function public.ebay_unlock(p_holder text)
returns void language sql security definer set search_path = public as $$
  update public.ebay_account set sync_lock_holder = null, sync_lock_until = null where id = 1 and sync_lock_holder = p_holder;
$$;
revoke all on function public.ebay_try_lock(text, integer) from public, anon, authenticated;
revoke all on function public.ebay_unlock(text) from public, anon, authenticated;
grant execute on function public.ebay_try_lock(text, integer) to service_role;
grant execute on function public.ebay_unlock(text) to service_role;
