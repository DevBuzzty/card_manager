-- supabase/sales_schema.sql — Spec H2 §4.2. Einmal im Dashboard einspielen (idempotent), BEVOR der neue PC-Build
-- installiert wird (der PC schickt ab dann card_copies.sold_in mit). Setzt voraus: public.set_updated_at() (schema.sql),
-- public.card_copies (card_copies_schema.sql). Einzelnutzer-Modell wie card_copies: keine user_id.
-- Gegenstueck lokal: desktop/electron/sales-schema.cjs und sales.cjs (Rueckkehr-Regel dort wortgleich beschrieben).

create table if not exists public.sale_channels (
  channel_id  text primary key,
  name        text not null,
  fee_percent numeric(5,2) not null default 0 check (fee_percent >= 0 and fee_percent <= 100),
  builtin     boolean not null default false,
  sort        integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
insert into public.sale_channels (channel_id, name, fee_percent, builtin, sort) values
  ('cardmarket', 'Cardmarket', 5, true, 1), ('ebay', 'eBay', 0, true, 2), ('kleinanzeigen', 'Kleinanzeigen', 0, true, 3),
  ('tausch', 'Tausch', 0, true, 4), ('privat', 'Privat', 0, true, 5)
on conflict (channel_id) do nothing;

create table if not exists public.sales (
  sale_id      text primary key,
  sold_on      date not null,
  channel_id   text not null,
  channel_name text not null,
  gross        numeric(12,2) not null check (gross >= 0),
  fees         numeric(12,2) check (fees is null or fees >= 0),
  shipping     numeric(12,2) check (shipping is null or shipping >= 0),
  status       text not null default 'aktiv' check (status in ('aktiv', 'storniert')),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.sale_items (
  sale_id       text not null,
  copy_id       text not null,
  value_at_sale numeric(12,2) not null default 0,
  share         numeric(12,2) not null default 0,
  was_for_sale  boolean not null default false,
  card_id       text not null,
  set_code      text not null,
  language      text not null,
  rarity        text not null,
  edition       text not null,
  condition     text not null,
  name          text,
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false,
  primary key (sale_id, copy_id)
);

alter table public.card_copies add column if not exists sold_in text;

create index if not exists sale_channels_updated_idx on public.sale_channels (updated_at);
create index if not exists sales_updated_idx on public.sales (updated_at);
create index if not exists sale_items_updated_idx on public.sale_items (updated_at);
create index if not exists sale_items_copy_idx on public.sale_items (copy_id);

drop trigger if exists trg_sale_channels_updated_at on public.sale_channels;
create trigger trg_sale_channels_updated_at before insert or update on public.sale_channels
  for each row execute function public.set_updated_at();
drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at before insert or update on public.sales
  for each row execute function public.set_updated_at();
drop trigger if exists trg_sale_items_updated_at on public.sale_items;
create trigger trg_sale_items_updated_at before insert or update on public.sale_items
  for each row execute function public.set_updated_at();

alter table public.sale_channels enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
drop policy if exists sale_channels_authenticated_all on public.sale_channels;
create policy sale_channels_authenticated_all on public.sale_channels for all to authenticated using (true) with check (true);
drop policy if exists sales_authenticated_all on public.sales;
create policy sales_authenticated_all on public.sales for all to authenticated using (true) with check (true);
drop policy if exists sale_items_authenticated_all on public.sale_items;
create policy sale_items_authenticated_all on public.sale_items for all to authenticated using (true) with check (true);

-- Rueckkehr eines Exemplars aus dem Verkauf p_sale_id (Spec H2 §6.3, Plan-Abweichung 2). Zeigt sold_in nicht auf
-- diesen Verkauf, bleibt das Exemplar unberuehrt. Beansprucht ein anderer aktiver Verkauf es noch mit einer lebenden
-- Position, wandert sold_in dorthin. Sonst: deleted = false, sold_in = null, for_sale = was_for_sale; ist das Fach
-- (container_id, page, slot) inzwischen von einem lebenden Exemplar belegt, page/slot leeren und needs_review setzen.
create or replace function public.sale_return_copy(p_sale_id text, p_copy_id text, p_was_for_sale boolean)
returns void language plpgsql set search_path = public as $$
declare
  cc public.card_copies%rowtype;
  other text;
begin
  select * into cc from public.card_copies where copy_id = p_copy_id for update;
  if not found or cc.sold_in is distinct from p_sale_id then return; end if;
  select si.sale_id into other
    from public.sale_items si join public.sales s on s.sale_id = si.sale_id
   where si.copy_id = p_copy_id and si.sale_id <> p_sale_id and si.deleted = false
     and s.status = 'aktiv' and s.deleted = false
   order by s.created_at, s.sale_id limit 1;
  if other is not null then
    update public.card_copies set sold_in = other where copy_id = p_copy_id;
    return;
  end if;
  if cc.page is not null and cc.slot is not null and exists (
       select 1 from public.card_copies o
        where o.copy_id <> p_copy_id and o.deleted = false and o.container_id = cc.container_id
          and o.page = cc.page and o.slot = cc.slot) then
    update public.card_copies
       set deleted = false, sold_in = null, for_sale = p_was_for_sale, page = null, slot = null,
           needs_review = true, review_reason = 'Fach inzwischen belegt'
     where copy_id = p_copy_id;
  else
    update public.card_copies set deleted = false, sold_in = null, for_sale = p_was_for_sale where copy_id = p_copy_id;
  end if;
end $$;

create or replace function public.book_sale(p_sale jsonb, p_items jsonb)
returns void language plpgsql set search_path = public as $$
declare
  it jsonb;
  n integer;
  sid text := p_sale->>'sale_id';
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Mindestens eine Karte auswählen.';
  end if;
  insert into public.sales (sale_id, sold_on, channel_id, channel_name, gross, fees, shipping, note)
  values (sid, (p_sale->>'sold_on')::date, p_sale->>'channel_id', p_sale->>'channel_name',
          (p_sale->>'gross')::numeric, nullif(p_sale->>'fees', '')::numeric, nullif(p_sale->>'shipping', '')::numeric,
          nullif(p_sale->>'note', ''));
  for it in select value from jsonb_array_elements(p_items) loop
    insert into public.sale_items (sale_id, copy_id, value_at_sale, share, was_for_sale, card_id, set_code, language,
                                   rarity, edition, condition, name, image_url)
    select sid, cc.copy_id, (it->>'value_at_sale')::numeric, (it->>'share')::numeric, cc.for_sale, cc.card_id,
           cc.set_code, cc.language, cc.rarity, cc.edition, cc.condition, c.name, c.image_url
      from public.card_copies cc
      left join public.cards c on c.id = cc.card_id and c.set_code = cc.set_code
                              and c.language = cc.language and c.rarity = cc.rarity
     where cc.copy_id = it->>'copy_id' and cc.deleted = false and cc.sold_in is null;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Karte bereits verkauft oder gelöscht (%).', it->>'copy_id'; end if;
    update public.card_copies set deleted = true, sold_in = sid, for_sale = false where copy_id = it->>'copy_id';
  end loop;
end $$;

create or replace function public.update_sale(p_sale jsonb, p_shares jsonb, p_returned text[])
returns void language plpgsql set search_path = public as $$
declare
  sid text := p_sale->>'sale_id';
  st text;
  r record;
begin
  select status into st from public.sales where sale_id = sid and deleted = false for update;
  if st is null then raise exception 'Verkauf nicht gefunden.'; end if;
  if st <> 'aktiv' then raise exception 'Ein stornierter Verkauf lässt sich nicht ändern.'; end if;
  update public.sales
     set sold_on = (p_sale->>'sold_on')::date, channel_id = p_sale->>'channel_id', channel_name = p_sale->>'channel_name',
         gross = (p_sale->>'gross')::numeric, fees = nullif(p_sale->>'fees', '')::numeric,
         shipping = nullif(p_sale->>'shipping', '')::numeric, note = nullif(p_sale->>'note', '')
   where sale_id = sid;
  for r in select copy_id, was_for_sale from public.sale_items
            where sale_id = sid and deleted = false and copy_id = any(coalesce(p_returned, '{}')) loop
    update public.sale_items set deleted = true, share = 0 where sale_id = sid and copy_id = r.copy_id;
    perform public.sale_return_copy(sid, r.copy_id, r.was_for_sale);
  end loop;
  if not exists (select 1 from public.sale_items where sale_id = sid and deleted = false) then
    raise exception 'Mindestens eine Karte muss im Verkauf bleiben – sonst stornieren.';
  end if;
  update public.sale_items si set share = (x->>'share')::numeric
    from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) x
   where si.sale_id = sid and si.copy_id = x->>'copy_id' and si.deleted = false;
end $$;

create or replace function public.cancel_sale(p_sale_id text)
returns void language plpgsql set search_path = public as $$
declare
  st text;
  r record;
begin
  select status into st from public.sales where sale_id = p_sale_id and deleted = false for update;
  if st is null then raise exception 'Verkauf nicht gefunden.'; end if;
  if st <> 'aktiv' then return; end if;
  update public.sales set status = 'storniert' where sale_id = p_sale_id;
  for r in select copy_id, was_for_sale from public.sale_items where sale_id = p_sale_id and deleted = false loop
    perform public.sale_return_copy(p_sale_id, r.copy_id, r.was_for_sale);
  end loop;
end $$;

revoke all on function public.sale_return_copy(text, text, boolean) from public, anon;
grant execute on function public.sale_return_copy(text, text, boolean) to authenticated;
revoke all on function public.book_sale(jsonb, jsonb) from public, anon;
revoke all on function public.update_sale(jsonb, jsonb, text[]) from public, anon;
revoke all on function public.cancel_sale(text) from public, anon;
grant execute on function public.book_sale(jsonb, jsonb) to authenticated;
grant execute on function public.update_sale(jsonb, jsonb, text[]) to authenticated;
grant execute on function public.cancel_sale(text) to authenticated;
