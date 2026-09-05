-- Portfolio value over time: one snapshot per user per day. The phone upserts today's total
-- when the Wert screen loads, so a history builds up over time for the value chart.
-- Run once in the SQL editor.

create table if not exists public.portfolio_snapshots (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null default current_date,
  total_value numeric not null,
  card_count  integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.portfolio_snapshots enable row level security;

drop policy if exists "snapshots are private" on public.portfolio_snapshots;
create policy "snapshots are private" on public.portfolio_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
