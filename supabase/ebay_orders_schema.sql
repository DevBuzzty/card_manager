-- supabase/ebay_orders_schema.sql — Spec H3b §7 (H3b2). Einmal im Dashboard einspielen (idempotent), BEVOR die neue
-- ebay-sync deployt wird und bevor der neue PC-/Handy-Build läuft. Setzt voraus: ebay_schema.sql (H3b1),
-- sales_schema.sql (H2: book_sale/update_sale/cancel_sale), public.set_updated_at() (schema.sql).
-- Nur die Funktion (Dienstrolle) schreibt ebay_orders und legt Hinweise an; Geräte lesen und dürfen an einem Hinweis
-- nur `dismissed` setzen (Wegtippen, Plan-Abweichung A5).

-- 1. Abgeholte eBay-Bestellungen (nie doppelt buchen; Marke „Gebühren vorläufig“ = gebucht und fees_final = false)
create table if not exists public.ebay_orders (
  order_id         text primary key,
  environment      text not null check (environment in ('sandbox', 'production')),
  sale_id          text,
  status           text not null check (status in ('gebucht', 'storniert', 'fehler', 'fremd')),
  fees_provisional numeric(12,2),
  fees_final       boolean not null default false,
  raw_total        numeric(12,2),
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ebay_orders_updated_idx on public.ebay_orders (updated_at);
create index if not exists ebay_orders_open_fees_idx on public.ebay_orders (status, fees_final);
drop trigger if exists trg_ebay_orders_updated_at on public.ebay_orders;
create trigger trg_ebay_orders_updated_at before insert or update on public.ebay_orders
  for each row execute function public.set_updated_at();
alter table public.ebay_orders enable row level security;
drop policy if exists ebay_orders_authenticated_read on public.ebay_orders;
create policy ebay_orders_authenticated_read on public.ebay_orders for select to authenticated using (true);
revoke insert, update, delete on public.ebay_orders from anon, authenticated;

-- 2. Hinweise (Start + Banner „Angebote“, PC zusätzlich Windows-Benachrichtigung). notice_id ist fest je Anlass
--    (z. B. ship-<sale_id>), damit derselbe Hinweis nie zweimal entsteht.
create table if not exists public.sale_notices (
  notice_id  text primary key,
  kind       text not null check (kind in ('reminder', 'shipping', 'error', 'token')),
  text       text not null,
  sale_id    text,
  listing_id text,
  dismissed  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sale_notices_updated_idx on public.sale_notices (updated_at);
drop trigger if exists trg_sale_notices_updated_at on public.sale_notices;
create trigger trg_sale_notices_updated_at before insert or update on public.sale_notices
  for each row execute function public.set_updated_at();
alter table public.sale_notices enable row level security;
drop policy if exists sale_notices_authenticated_read on public.sale_notices;
create policy sale_notices_authenticated_read on public.sale_notices for select to authenticated using (true);
drop policy if exists sale_notices_authenticated_dismiss on public.sale_notices;
create policy sale_notices_authenticated_dismiss on public.sale_notices for update to authenticated using (true) with check (true);
-- Spaltenrecht: Geräte dürfen NUR dismissed ändern (und nichts anlegen oder löschen).
revoke insert, update, delete on public.sale_notices from anon, authenticated;
grant update (dismissed) on public.sale_notices to authenticated;

-- 3. Die Funktion bucht über die H2-Funktionen (keine zweite Buchungslogik). Sicherheitshalber ausdrücklich für die
--    Dienstrolle freigeben (sales_schema.sql gibt sie nur authenticated).
grant execute on function public.book_sale(jsonb, jsonb) to service_role;
grant execute on function public.update_sale(jsonb, jsonb, text[]) to service_role;
grant execute on function public.cancel_sale(text) to service_role;

-- Prüfabfragen:
-- select table_name as tabelle, count(*) as spalten from information_schema.columns
--  where table_schema = 'public' and table_name in ('ebay_orders', 'sale_notices') group by 1 order by 1;
--   erwartet: ebay_orders 10, sale_notices 8
-- select tablename as tabelle, policyname as regel from pg_policies
--  where schemaname = 'public' and tablename in ('ebay_orders', 'sale_notices') order by 1, 2;
--   erwartet: ebay_orders_authenticated_read, sale_notices_authenticated_dismiss, sale_notices_authenticated_read
-- select has_table_privilege('authenticated', 'public.ebay_orders', 'insert') as geraet_schreibt_bestellung,
--        has_column_privilege('authenticated', 'public.sale_notices', 'dismissed', 'update') as geraet_tippt_weg,
--        has_column_privilege('authenticated', 'public.sale_notices', 'text', 'update') as geraet_aendert_text,
--        has_function_privilege('service_role', 'public.book_sale(jsonb, jsonb)', 'execute') as funktion_bucht;
--   erwartet: false | true | false | true
