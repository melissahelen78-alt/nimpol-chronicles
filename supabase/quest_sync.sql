-- NimpolXP — quest claims + session progress
-- Paste into Supabase Dashboard → SQL Editor → Run
-- (Run after profiles.sql)

-- ─────────────────────────────────────────────
-- 1. quest_claims — one row per quest claimed per day
-- ─────────────────────────────────────────────
create table if not exists public.quest_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quest_id text not null,
  reward_xp integer not null default 0 check (reward_xp >= 0),
  claim_date date not null,
  claimed_at timestamptz not null default now(),

  unique (user_id, quest_id, claim_date)
);

create index if not exists quest_claims_user_date_idx
  on public.quest_claims (user_id, claim_date);

comment on table public.quest_claims is 'Daily quest reward claims for NimpolXP';

-- ─────────────────────────────────────────────
-- 2. quest_progress — current session / UI state
-- ─────────────────────────────────────────────
create table if not exists public.quest_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,

  selected_subject text,
  highlighted_quest_id text,
  chat_step integer not null default 1 check (chat_step between 1 and 4),
  chat_feeling text,
  chat_approach text,
  last_wheel_result jsonb,
  wheel_spins integer not null default 0 check (wheel_spins >= 0),
  wheel_rotation double precision not null default 0,
  last_reset_date date not null default (timezone('utc', now()))::date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quest_progress is 'In-progress quest session state for NimpolXP';

-- ─────────────────────────────────────────────
-- 3. updated_at trigger for quest_progress
-- ─────────────────────────────────────────────
create or replace function public.set_quest_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quest_progress_set_updated_at on public.quest_progress;

create trigger quest_progress_set_updated_at
before update on public.quest_progress
for each row
execute function public.set_quest_progress_updated_at();

-- ─────────────────────────────────────────────
-- 4. Auto-create quest_progress on signup
-- ─────────────────────────────────────────────
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, player_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'player_name', 'NIMPOL')
  )
  on conflict (id) do nothing;

  insert into public.quest_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- 5. Row Level Security
-- ─────────────────────────────────────────────
alter table public.quest_claims enable row level security;
alter table public.quest_progress enable row level security;

drop policy if exists "Quest claims: users read own" on public.quest_claims;
create policy "Quest claims: users read own"
on public.quest_claims
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Quest claims: users insert own" on public.quest_claims;
create policy "Quest claims: users insert own"
on public.quest_claims
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Quest progress: users read own" on public.quest_progress;
create policy "Quest progress: users read own"
on public.quest_progress
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Quest progress: users insert own" on public.quest_progress;
create policy "Quest progress: users insert own"
on public.quest_progress
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Quest progress: users update own" on public.quest_progress;
create policy "Quest progress: users update own"
on public.quest_progress
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Backfill quest_progress for existing users who only have profiles
insert into public.quest_progress (user_id)
select id from public.profiles
on conflict (user_id) do nothing;
