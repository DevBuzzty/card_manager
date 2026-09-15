-- supabase/sealed_items_schema.sql — Spec G3 §4.1/§5. Einmal im Dashboard einspielen (idempotent).
-- Gegenstueck zu desktop/electron/sealed-items.cjs. Setzt voraus: public.set_updated_at() (supabase/schema.sql).
-- Einzelnutzer-Modell wie card_copies: keine user_id, jede angemeldete Sitzung darf lesen und schreiben.
-- Nur Soft-Delete (deleted = true); Menge >= 1.

create table if not exists public.sealed_items (
  sealed_id        text primary key,               -- UUID, vom anlegenden Geraet erzeugt
  cm_product_id    integer not null,               -- Cardmarket idProduct
  name             text not null,                  -- englischer Cardmarket-Name beim Anlegen
  kind             text not null check (kind in ('display', 'booster', 'tin', 'deck', 'special', 'other')),
  quantity         integer not null check (quantity >= 1),
  price            double precision,               -- Cardmarket-Trend pro Einheit, null = kein Trend
  price_updated_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);

create index if not exists sealed_items_updated_idx on public.sealed_items (updated_at);
create index if not exists sealed_items_product_idx on public.sealed_items (cm_product_id) where deleted = false;

-- updated_at wird IMMER serverseitig gestempelt: der Desktop-Sync zieht ueber `updated_at > cursor`.
drop trigger if exists trg_sealed_items_updated_at on public.sealed_items;
create trigger trg_sealed_items_updated_at
  before insert or update on public.sealed_items
  for each row execute function public.set_updated_at();

alter table public.sealed_items enable row level security;
drop policy if exists sealed_items_authenticated_all on public.sealed_items;
create policy sealed_items_authenticated_all on public.sealed_items
  for all to authenticated using (true) with check (true);

-- Taegliche Cardmarket-Aktualisierung (Edge Function refresh-cardmarket-prices). Keine Historie (Spec G3 §1).
-- Nur Zeilen, deren Preis sich wirklich aendert; price_updated_at = now(); gibt die Anzahl zurueck.
create or replace function public.apply_cardmarket_sealed_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.sealed_items s
     set price = v.trend,
         price_updated_at = now()
    from jsonb_to_recordset(prices) as v(id_product integer, trend double precision)
   where s.cm_product_id = v.id_product
     and s.deleted = false
     and v.trend > 0
     and s.price is distinct from v.trend;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_sealed_prices(jsonb) from public;
grant execute on function public.apply_cardmarket_sealed_prices(jsonb) to service_role;
