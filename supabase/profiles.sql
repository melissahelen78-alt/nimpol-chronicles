-- NimpolXP — profiles table
-- Paste into Supabase Dashboard → SQL Editor → Run

-- ─────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  player_name text not null default 'NIMPOL',
  rank_ribbon text not null default 'Wanderer',

  xp_current integer not null default 1448 check (xp_current >= 0),
  xp_max     integer not null default 2000 check (xp_max > 0),

  mana_current       integer not null default 62  check (mana_current >= 0),
  mana_max           integer not null default 100 check (mana_max > 0),
  intellect_current  integer not null default 88  check (intellect_current >= 0),
  intellect_max      integer not null default 100 check (intellect_max > 0),
  lore_current       integer not null default 30  check (lore_current >= 0),
  lore_max           integer not null default 100 check (lore_max > 0),
  perception_current integer not null default 71  check (perception_current >= 0),
  perception_max     integer not null default 100 check (perception_max > 0),
  charisma_current   integer not null default 45  check (charisma_current >= 0),
  charisma_max       integer not null default 100 check (charisma_max > 0),
  stamina_current    integer not null default 50  check (stamina_current >= 0),
  stamina_max        integer not null default 100 check (stamina_max > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint xp_current_lte_max check (xp_current <= xp_max),
  constraint mana_current_lte_max check (mana_current <= mana_max),
  constraint intellect_current_lte_max check (intellect_current <= intellect_max),
  constraint lore_current_lte_max check (lore_current <= lore_max),
  constraint perception_current_lte_max check (perception_current <= perception_max),
  constraint charisma_current_lte_max check (charisma_current <= charisma_max),
  constraint stamina_current_lte_max check (stamina_current <= stamina_max)
);

comment on table public.profiles is 'Player RPG profile synced with NimpolXP dashboard';

-- ─────────────────────────────────────────────
-- 2. updated_at trigger
-- ─────────────────────────────────────────────
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

-- ─────────────────────────────────────────────
-- 3. Auto-create profile on signup
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

-- ─────────────────────────────────────────────
-- 4. Row Level Security
-- ─────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "Profiles: users read own row" on public.profiles;
create policy "Profiles: users read own row"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Profiles: users update own row" on public.profiles;
create policy "Profiles: users update own row"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Profiles: users insert own row" on public.profiles;
create policy "Profiles: users insert own row"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

-- Optional: allow anon read of a demo profile during prototyping
-- (Remove this policy before production if you do not need public reads.)
drop policy if exists "Profiles: anon read demo" on public.profiles;
-- create policy "Profiles: anon read demo"
-- on public.profiles
-- for select
-- to anon
-- using (true);

-- ─────────────────────────────────────────────
-- 5. Seed example (replace UUID after creating a user in Auth)
-- ─────────────────────────────────────────────
-- insert into public.profiles (
--   id,
--   player_name,
--   rank_ribbon,
--   xp_current,
--   xp_max,
--   mana_current, mana_max,
--   intellect_current, intellect_max,
--   lore_current, lore_max,
--   perception_current, perception_max,
--   charisma_current, charisma_max,
--   stamina_current, stamina_max
-- ) values (
--   '754f9746-bb75-41be-9f76-abce9c9449e8',
--   'NIMPOL',
--   'Wanderer',
--   1448, 2000,
--   62, 100,
--   88, 100,
--   30, 100,
--   71, 100,
--   45, 100,
--   50, 100
-- )
-- on conflict (id) do update set
--   player_name = excluded.player_name,
--   rank_ribbon = excluded.rank_ribbon,
--   xp_current = excluded.xp_current,
--   xp_max = excluded.xp_max,
--   mana_current = excluded.mana_current,
--   mana_max = excluded.mana_max,
--   intellect_current = excluded.intellect_current,
--   intellect_max = excluded.intellect_max,
--   lore_current = excluded.lore_current,
--   lore_max = excluded.lore_max,
--   perception_current = excluded.perception_current,
--   perception_max = excluded.perception_max,
--   charisma_current = excluded.charisma_current,
--   charisma_max = excluded.charisma_max,
--   stamina_current = excluded.stamina_current,
--   stamina_max = excluded.stamina_max;
