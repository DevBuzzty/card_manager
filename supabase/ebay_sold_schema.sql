-- supabase/ebay_sold_schema.sql -- eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §5/§6).
-- Voraussetzung: public.set_updated_at() aus schema.sql, public.cards, public.card_copies, public.listing_items.
-- Idempotent. Einspielen VOR Installer/APK (sonst protokolliert der PC-Pull nur einen Fehler).

-- 1. Wert je Druck (nur die Funktion schreibt; Geräte lesen)
create table if not exists public.ebay_sold_prices (
  card_id         text not null,
  set_code        text not null,
  language        text not null,
  rarity          text not null,
  median_all      numeric,
  n_all           integer not null default 0,
  median_first    numeric,
  n_first         integer not null default 0,
  last_sold_at    timestamptz,
  last_sold_price numeric,
  sales           jsonb not null default '[]'::jsonb,
  status          text not null check (status in ('ok', 'zu_wenig', 'fehler')),
  checked_at      timestamptz not null,
  updated_at      timestamptz not null default now(),
  primary key (card_id, set_code, language, rarity)
);
create index if not exists ebay_sold_prices_updated_idx on public.ebay_sold_prices (updated_at);
create index if not exists ebay_sold_prices_checked_idx on public.ebay_sold_prices (checked_at);
drop trigger if exists trg_ebay_sold_prices_updated_at on public.ebay_sold_prices;
create trigger trg_ebay_sold_prices_updated_at before insert or update on public.ebay_sold_prices
  for each row execute function public.set_updated_at();
alter table public.ebay_sold_prices enable row level security;
drop policy if exists ebay_sold_prices_authenticated_read on public.ebay_sold_prices;
create policy ebay_sold_prices_authenticated_read on public.ebay_sold_prices for select to authenticated using (true);
revoke insert, update, delete on public.ebay_sold_prices from anon, authenticated;

-- 2. Zugangsstatus (eine Zeile)
create table if not exists public.ebay_insights_state (
  id          integer primary key check (id = 1),
  access      text not null default 'unbekannt' check (access in ('unbekannt', 'aktiv', 'fehlt')),
  last_error  text,
  last_run_at timestamptz,
  calls_today integer not null default 0,
  calls_day   date
);
insert into public.ebay_insights_state (id) values (1) on conflict (id) do nothing;
alter table public.ebay_insights_state enable row level security;
drop policy if exists ebay_insights_state_authenticated_read on public.ebay_insights_state;
create policy ebay_insights_state_authenticated_read on public.ebay_insights_state for select to authenticated using (true);
revoke insert, update, delete on public.ebay_insights_state from anon, authenticated;

-- 3. Kandidaten des Zeitplan-Laufs: lebende Drucke ab Mindestwert, mit 1.-Auflage-Exemplar, auf der Verkaufsliste
--    oder in einem Angebot; ältester eBay-Stand zuerst, nur ausserhalb der Frische-Frist.
create or replace function public.ebay_sold_candidates(min_price numeric, fresh_before timestamptz, max_rows integer)
returns table (card_id text, set_code text, language text, rarity text)
language sql stable as $$
  select c.id, c.set_code, c.language, c.rarity
    from public.cards c
    left join public.ebay_sold_prices s
      on s.card_id = c.id and s.set_code = c.set_code and s.language = c.language and s.rarity = c.rarity
   where c.deleted = false and coalesce(c.quantity, 0) > 0 and c.set_code <> 'Unknown'
     and (s.checked_at is null or s.checked_at < fresh_before)
     and (coalesce(c.price, 0) >= min_price
          or exists (select 1 from public.card_copies cp
                      where cp.card_id = c.id and cp.set_code = c.set_code and cp.language = c.language and cp.rarity = c.rarity
                        and cp.deleted = false and (cp.edition = 'first' or cp.for_sale))
          or exists (select 1 from public.listing_items li
                      where li.card_id = c.id and li.set_code = c.set_code and li.language = c.language and li.rarity = c.rarity
                        and li.deleted = false))
   order by s.checked_at asc nulls first, c.id, c.set_code, c.language, c.rarity
   limit max_rows;
$$;
revoke execute on function public.ebay_sold_candidates(numeric, timestamptz, integer) from public, anon, authenticated;
