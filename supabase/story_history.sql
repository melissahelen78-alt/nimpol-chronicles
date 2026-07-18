-- NimpolXP — AI story continuity (Chronicles interaction panel)
-- Paste into Supabase Dashboard → SQL Editor → Run

-- ─────────────────────────────────────────────
-- 1. player_activity — discovery / transmission engagement
-- ─────────────────────────────────────────────
create table if not exists public.player_activity (
  user_id uuid primary key references auth.users (id) on delete cascade,

  last_discovery_viewed_at timestamptz,
  last_discovery_fact_id uuid references public.discovery_facts (id) on delete set null,
  last_discovery_fact_title text,

  last_transmission_watched_at timestamptz,
  last_transmission_id uuid references public.approved_transmissions (id) on delete set null,
  last_transmission_title text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.player_activity is
  'Tracks when the player last viewed a Scroll fact or watched a transmission (AI context).';

-- ─────────────────────────────────────────────
-- 2. story_history — sequential narrative turns
-- ─────────────────────────────────────────────
create table if not exists public.story_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  turn_index integer not null check (turn_index >= 0),

  story_text text not null,
  choices jsonb not null default '[]'::jsonb,

  selected_choice_id text,
  selected_choice_label text,

  ai_context jsonb,
  source text not null default 'ai' check (source in ('ai', 'fallback', 'restored')),

  created_at timestamptz not null default now(),

  unique (user_id, turn_index),
  constraint story_history_choices_array check (jsonb_typeof(choices) = 'array')
);

create index if not exists story_history_user_turn_idx
  on public.story_history (user_id, turn_index desc);

comment on table public.story_history is
  'Chronicles dialogue turns; unset selected_choice_id means the active turn on refresh.';

-- ─────────────────────────────────────────────
-- 3. updated_at trigger for player_activity
-- ─────────────────────────────────────────────
create or replace function public.set_player_activity_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_activity_set_updated_at on public.player_activity;

create trigger player_activity_set_updated_at
before update on public.player_activity
for each row
execute function public.set_player_activity_updated_at();

-- ─────────────────────────────────────────────
-- 4. Auto-create player_activity on signup
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

  insert into public.player_activity (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- 5. Row Level Security
-- ─────────────────────────────────────────────
alter table public.player_activity enable row level security;
alter table public.story_history enable row level security;

drop policy if exists "Player activity: read own" on public.player_activity;
create policy "Player activity: read own"
on public.player_activity for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Player activity: insert own" on public.player_activity;
create policy "Player activity: insert own"
on public.player_activity for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Player activity: update own" on public.player_activity;
create policy "Player activity: update own"
on public.player_activity for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Story history: read own" on public.story_history;
create policy "Story history: read own"
on public.story_history for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Story history: insert own" on public.story_history;
create policy "Story history: insert own"
on public.story_history for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Story history: update own" on public.story_history;
create policy "Story history: update own"
on public.story_history for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Backfill player_activity for existing users
insert into public.player_activity (user_id)
select id from public.profiles
on conflict (user_id) do nothing;
