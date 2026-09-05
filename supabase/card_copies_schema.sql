-- supabase/card_copies_schema.sql — Spec A. Apply ONCE in the Supabase SQL editor.
-- One row per physical copy. cards.quantity / cards.deleted are derived from live copies by trigger.
-- No backfill here: the desktop creates the copies and pushes them (avoids duplicates).

create table if not exists public.card_copies (
  copy_id       text primary key,
  card_id       text not null,
  set_code      text not null default 'Unknown',
  language      text not null default 'DE',
  rarity        text not null default 'Unknown',
  edition       text not null default 'unknown' check (edition in ('first','unlimited','limited','unknown')),
  condition     text not null default 'NM' check (condition in ('MT','NM','EX','GD','LP','PL','PO')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false,
  container_id  text,
  page          integer,
  slot          integer,
  tags          text,
  note          text,
  needs_review  boolean not null default false,
  review_reason text,
  for_sale      boolean not null default false
);

create index if not exists card_copies_printing_idx on public.card_copies (card_id, set_code, language, rarity);
create index if not exists card_copies_updated_idx on public.card_copies (updated_at);

-- Server-stamped updated_at (same helper as cards).
drop trigger if exists trg_card_copies_updated_at on public.card_copies;
create trigger trg_card_copies_updated_at
  before insert or update on public.card_copies
  for each row execute function public.set_updated_at();

-- Recount one printing; only writes when something changes.
create or replace function public.recount_printing(p_card_id text, p_set_code text, p_language text, p_rarity text)
returns void language plpgsql as $$
declare n integer;
begin
  select count(*) into n from public.card_copies c
   where c.card_id = p_card_id and c.set_code = p_set_code and c.language = p_language and c.rarity = p_rarity and c.deleted = false;
  update public.cards set quantity = n, deleted = (n = 0)
   where id = p_card_id and set_code = p_set_code and language = p_language and rarity = p_rarity
     and (quantity is distinct from n or deleted is distinct from (n = 0));
end $$;

create or replace function public.card_copies_recount()
returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.recount_printing(new.card_id, new.set_code, new.language, new.rarity);
  end if;
  if tg_op in ('UPDATE','DELETE') and (tg_op = 'DELETE'
      or old.card_id <> new.card_id or old.set_code <> new.set_code or old.language <> new.language or old.rarity <> new.rarity) then
    perform public.recount_printing(old.card_id, old.set_code, old.language, old.rarity);
  end if;
  return null;
end $$;

drop trigger if exists trg_card_copies_recount on public.card_copies;
create trigger trg_card_copies_recount
  after insert or update or delete on public.card_copies
  for each row execute function public.card_copies_recount();

-- Cross-spec columns pre-created (Spec G).
alter table public.cards add column if not exists price_first_ed double precision;
alter table public.cards add column if not exists cm_first_ed_updated_at timestamptz;
alter table public.portfolio_snapshots add column if not exists sealed_value numeric not null default 0;

-- Single-user app: any authenticated session may read/write (same policy as cards).
alter table public.card_copies enable row level security;
drop policy if exists card_copies_authenticated_all on public.card_copies;
create policy card_copies_authenticated_all on public.card_copies
  for all to authenticated using (true) with check (true);
