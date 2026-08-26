-- Yu-Gi-Oh! collection mirror. Keyed identically to the desktop SQLite cards table.
create table if not exists public.cards (
  id          text not null,
  set_code    text not null default 'Unknown',
  language    text not null default 'DE',
  name        text,
  type        text,
  "desc"      text,
  image_url   text,
  atk         integer,
  def         integer,
  level       integer,
  race        text,
  attribute   text,
  quantity    integer default 1,
  rarity      text,
  price       double precision,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (id, set_code, language)
);

-- Server-stamped updated_at on every write, so PC and phone clocks never disagree.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cards_updated_at on public.cards;
create trigger trg_cards_updated_at
  before insert or update on public.cards
  for each row execute function public.set_updated_at();

-- Single-user app: any authenticated session may read/write.
alter table public.cards enable row level security;

drop policy if exists cards_authenticated_all on public.cards;
create policy cards_authenticated_all on public.cards
  for all to authenticated using (true) with check (true);
