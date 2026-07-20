```sql
-- Build Week Progression — Phase 1
-- Chapter 10–aligned definition tables + Player Domain growth state.
-- FOR REVIEW. Do not apply until explicitly approved.
--
-- Provisional Build Week balancing seeds (may be retuned later):
--   Ranks: Wanderer 0, Seeker 100, Pathfinder 250, Wayfinder 500, Lorekeeper 900
--   Primary attribute levels: 0 / 40 / 100 / 200 / 350
--   Mana levels: 0 / 100 / 250 / 500 / 900
--   Math reward: 100 overall, 40 Knowledge, 10 Mana
--
-- Includes:
--   attribute_definitions, attribute_progression_levels, rank_levels
--   player_progression, player_attributes
--   growth_events, growth_event_deltas
--   activity_attribute_rewards
--   Math template reward_xp = 100 + Knowledge/Mana attribute rewards
--   world_state.knowledge_library_eligible default/backfill
--
-- Does NOT include:
--   RPCs (Phase 2)
--   player_id / chronicle_id columns
--   new progression columns on profiles
--   Identity / Chronicle tables
--
-- ─────────────────────────────────────────────
-- Live-schema assumptions (verified against repo SQL seeds)
-- ─────────────────────────────────────────────
-- profiles.id
--   uuid primary key references auth.users (id) on delete cascade
--   Build Week ownership: profile_id = auth.uid() on Player Domain tables
--
-- quest_templates.id
--   uuid primary key default gen_random_uuid()
--
-- quest_templates.reward_xp
--   integer not null default 50 check (reward_xp >= 0)
--
-- Math Build Week template slugs (must all exist before reward seeding):
--   math-ba-online, math-ba-workbook, math-morning-sheet
--
-- quest_progress.world_state
--   jsonb not null (added by 20260718_build_week_world_state.sql)
--   Persisted keys use snake_case via questSync.serializeWorldState():
--     step, stage_turns, pending_story_key, unlocked_locations,
--     unlocked_subjects, completed_quest_ids
--   In-memory JS uses camelCase; normalizeWorldState() reads both forms.
--   This migration adds only knowledge_library_eligible (snake_case).
--
-- gen_random_uuid()
--   Used throughout existing repo migrations; available on Supabase (pgcrypto).
--
-- quest_claims duplicate constraint
--   unique (user_id, quest_id, claim_date)
--   quest_id is text (template slug), not quest_claims.id
--   growth_events quest_claim source_id uses quest_claims.id (uuid), not slug.
--
-- growth_events source identity (enforced by unique index below):
--   quest_claim  → source_id = quest_claims.id::text (one event per persisted claim)
--   conversion   → source_id = 'progression_schema_v1' (one event per profile/schema)
--   Phase 2 security-definer RPCs are the only writers; they must set source_id.
--
-- growth_event_deltas uniqueness (partial unique indexes below):
--   at most one overall delta per growth_event
--   at most one attribute delta per (growth_event, attribute_id)
--
-- ─────────────────────────────────────────────
-- Transaction behavior
-- ─────────────────────────────────────────────
-- Supabase CLI (`supabase db push` / `migration up`) wraps each migration file
-- in an implicit BEGIN/COMMIT. This repository has no supabase/config.toml and
-- Build Week migrations have been applied via the SQL Editor paste path, which
-- does NOT automatically wrap a multi-statement script in a transaction.
-- Therefore this file uses an explicit BEGIN/COMMIT so validation failures
-- roll back all schema and seed changes when applied manually.
-- If you later apply via the CLI instead, remove the outer BEGIN/COMMIT first
-- (an explicit COMMIT inside the CLI's outer transaction ends it early).

begin;

-- ─────────────────────────────────────────────
-- 1. attribute_definitions
-- ─────────────────────────────────────────────
create table if not exists public.attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  sort_order integer not null default 0,
  diamond_key text not null,
  bar_class text not null,
  is_mana boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.attribute_definitions is
  'World-defined attributes (Build Week subset of Chapter 10 attribute_definitions).';

insert into public.attribute_definitions (slug, label, sort_order, diamond_key, bar_class, is_mana)
values
  ('mana', 'Mana', 1, 'mana', 'bar-mana', true),
  ('knowledge', 'Knowledge', 2, 'knowledge', 'bar-knowledge', false),
  ('perception', 'Perception', 3, 'perception', 'bar-perception', false),
  ('creativity', 'Creativity', 4, 'creativity', 'bar-creativity', false),
  ('stamina', 'Stamina', 5, 'stamina', 'bar-stamina', false),
  ('resolve', 'Resolve', 6, 'resolve', 'bar-resolve', false)
on conflict (slug) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  diamond_key = excluded.diamond_key,
  bar_class = excluded.bar_class,
  is_mana = excluded.is_mana;

-- ─────────────────────────────────────────────
-- 2. attribute_progression_levels
-- ─────────────────────────────────────────────
create table if not exists public.attribute_progression_levels (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attribute_definitions (id) on delete cascade,
  level integer not null check (level >= 1),
  cumulative_xp integer not null check (cumulative_xp >= 0),
  created_at timestamptz not null default now(),
  unique (attribute_id, level)
);

comment on table public.attribute_progression_levels is
  'Provisional Build Week cumulative XP thresholds per attribute level. XP is never discarded on level-up.';

create index if not exists attribute_progression_levels_attr_idx
  on public.attribute_progression_levels (attribute_id, level);

-- Primary attributes: 0 / 40 / 100 / 200 / 350
insert into public.attribute_progression_levels (attribute_id, level, cumulative_xp)
select d.id, lvl.level, lvl.cumulative_xp
from public.attribute_definitions d
cross join (
  values
    (1, 0),
    (2, 40),
    (3, 100),
    (4, 200),
    (5, 350)
) as lvl(level, cumulative_xp)
where d.is_mana = false
on conflict (attribute_id, level) do update set
  cumulative_xp = excluded.cumulative_xp;

-- Mana: 0 / 100 / 250 / 500 / 900
insert into public.attribute_progression_levels (attribute_id, level, cumulative_xp)
select d.id, lvl.level, lvl.cumulative_xp
from public.attribute_definitions d
cross join (
  values
    (1, 0),
    (2, 100),
    (3, 250),
    (4, 500),
    (5, 900)
) as lvl(level, cumulative_xp)
where d.is_mana = true
on conflict (attribute_id, level) do update set
  cumulative_xp = excluded.cumulative_xp;

-- ─────────────────────────────────────────────
-- 3. rank_levels
-- ─────────────────────────────────────────────
create table if not exists public.rank_levels (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null unique,
  name text not null unique,
  minimum_total_xp integer not null check (minimum_total_xp >= 0),
  created_at timestamptz not null default now()
);

comment on table public.rank_levels is
  'Provisional Build Week overall ranks. Current rank is derived from player_progression.total_xp.';

insert into public.rank_levels (sort_order, name, minimum_total_xp)
values
  (1, 'Wanderer', 0),
  (2, 'Seeker', 100),
  (3, 'Pathfinder', 250),
  (4, 'Wayfinder', 500),
  (5, 'Lorekeeper', 900)
on conflict (name) do update set
  sort_order = excluded.sort_order,
  minimum_total_xp = excluded.minimum_total_xp;

-- ─────────────────────────────────────────────
-- 4. player_progression
-- ─────────────────────────────────────────────
create table if not exists public.player_progression (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  -- 0 = not initialized / not converted; 1 = Build Week progression schema active
  schema_version integer not null default 0 check (schema_version >= 0),
  initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.player_progression is
  'Player Domain cumulative overall XP and conversion/init state. Build Week ownership is profile_id only.';

comment on column public.player_progression.schema_version is
  '0 = awaiting initialize_profile_progression; 1 = converted/initialized. Prevents repeat conversion.';

create or replace function public.set_player_progression_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_progression_set_updated_at on public.player_progression;
create trigger player_progression_set_updated_at
before update on public.player_progression
for each row
execute function public.set_player_progression_updated_at();

-- ─────────────────────────────────────────────
-- 5. player_attributes
-- ─────────────────────────────────────────────
create table if not exists public.player_attributes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attribute_id uuid not null references public.attribute_definitions (id) on delete cascade,
  attribute_xp integer not null default 0 check (attribute_xp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, attribute_id)
);

comment on table public.player_attributes is
  'Player Domain cumulative attribute XP. Levels are derived from attribute_progression_levels.';

create index if not exists player_attributes_profile_idx
  on public.player_attributes (profile_id);

create or replace function public.set_player_attributes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_attributes_set_updated_at on public.player_attributes;
create trigger player_attributes_set_updated_at
before update on public.player_attributes
for each row
execute function public.set_player_attributes_updated_at();

-- ─────────────────────────────────────────────
-- 6. growth_events + growth_event_deltas
-- ─────────────────────────────────────────────
create table if not exists public.growth_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  source_type text not null
    check (source_type in ('quest_claim', 'conversion')),
  -- Required. See header comments for source identity strategy.
  source_id text not null,
  created_at timestamptz not null default now()
);

comment on table public.growth_events is
  'One logical growth occurrence (e.g. one quest claim or one conversion). XP amounts live in growth_event_deltas only.';

comment on column public.growth_events.source_id is
  'Stable source identity. quest_claim: quest_claims.id::text. conversion: progression_schema_v1 (matches schema_version 1).';

create index if not exists growth_events_profile_created_idx
  on public.growth_events (profile_id, created_at desc);

create unique index if not exists growth_events_source_identity_uniq
  on public.growth_events (profile_id, source_type, source_id);

create table if not exists public.growth_event_deltas (
  id uuid primary key default gen_random_uuid(),
  growth_event_id uuid not null references public.growth_events (id) on delete cascade,
  kind text not null check (kind in ('overall', 'attribute')),
  attribute_id uuid references public.attribute_definitions (id) on delete restrict,
  xp_delta integer not null,
  created_at timestamptz not null default now(),
  constraint growth_event_deltas_attribute_shape check (
    (kind = 'overall' and attribute_id is null)
    or (kind = 'attribute' and attribute_id is not null)
  )
);

comment on table public.growth_event_deltas is
  'Individual overall/attribute XP changes belonging to a single growth_events occurrence.';

create index if not exists growth_event_deltas_event_idx
  on public.growth_event_deltas (growth_event_id);

-- At most one overall delta and one delta per attribute within a growth_event.
create unique index if not exists growth_event_deltas_one_overall_uniq
  on public.growth_event_deltas (growth_event_id)
  where kind = 'overall';

create unique index if not exists growth_event_deltas_one_attribute_uniq
  on public.growth_event_deltas (growth_event_id, attribute_id)
  where kind = 'attribute';

-- ─────────────────────────────────────────────
-- 7. activity_attribute_rewards
-- ─────────────────────────────────────────────
create table if not exists public.activity_attribute_rewards (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.quest_templates (id) on delete cascade,
  attribute_id uuid not null references public.attribute_definitions (id) on delete cascade,
  xp_amount integer not null check (xp_amount >= 0),
  created_at timestamptz not null default now(),
  unique (template_id, attribute_id)
);

comment on table public.activity_attribute_rewards is
  'Build Week stand-in for Chapter 10 activity_attribute_rewards, linked to quest_templates.';

create index if not exists activity_attribute_rewards_template_idx
  on public.activity_attribute_rewards (template_id);

-- Required attributes must exist before Math reward seeding.
do $$
declare
  required_attr_count integer;
begin
  select count(*)
  into required_attr_count
  from public.attribute_definitions
  where slug in ('knowledge', 'mana');

  if required_attr_count <> 2 then
    raise exception
      'Phase 1 migration validation failed: expected attribute_definitions rows for knowledge and mana before reward seeding, found % matching slugs',
      required_attr_count;
  end if;
end;
$$;

-- Provisional Math rewards: 40 Knowledge + 10 Mana on each Math gate template.
insert into public.activity_attribute_rewards (template_id, attribute_id, xp_amount)
select t.id, d.id, v.xp_amount
from public.quest_templates t
cross join (
  values
    ('knowledge', 40),
    ('mana', 10)
) as v(attr_slug, xp_amount)
join public.attribute_definitions d on d.slug = v.attr_slug
where t.slug in ('math-ba-online', 'math-ba-workbook', 'math-morning-sheet')
on conflict (template_id, attribute_id) do update set
  xp_amount = excluded.xp_amount;

-- Provisional overall XP for Math Build Week claims.
update public.quest_templates
set reward_xp = 100
where slug in ('math-ba-online', 'math-ba-workbook', 'math-morning-sheet');

-- ─────────────────────────────────────────────
-- Post-seed validation: Math templates and reward mappings
-- ─────────────────────────────────────────────
do $$
declare
  math_template_count integer;
  math_reward_row_count integer;
  math_reward_xp_count integer;
begin
  select count(*)
  into math_template_count
  from public.quest_templates
  where slug in ('math-ba-online', 'math-ba-workbook', 'math-morning-sheet');

  if math_template_count <> 3 then
    raise exception
      'Phase 1 migration validation failed: expected 3 Math quest templates (math-ba-online, math-ba-workbook, math-morning-sheet), found %',
      math_template_count;
  end if;

  select count(*)
  into math_reward_row_count
  from public.activity_attribute_rewards aar
  join public.quest_templates t on t.id = aar.template_id
  where t.slug in ('math-ba-online', 'math-ba-workbook', 'math-morning-sheet');

  if math_reward_row_count <> 6 then
    raise exception
      'Phase 1 migration validation failed: expected 6 activity_attribute_rewards rows (3 Math templates × 2 attributes), found %',
      math_reward_row_count;
  end if;

  select count(*)
  into math_reward_xp_count
  from public.quest_templates
  where slug in ('math-ba-online', 'math-ba-workbook', 'math-morning-sheet')
    and reward_xp = 100;

  if math_reward_xp_count <> 3 then
    raise exception
      'Phase 1 migration validation failed: expected reward_xp = 100 on all 3 Math templates, found % matching rows',
      math_reward_xp_count;
  end if;
end;
$$;

-- ─────────────────────────────────────────────
-- 8. world_state: knowledge_library_eligible
-- ─────────────────────────────────────────────
-- Preserve existing persisted snake_case keys from 20260718_build_week_world_state.sql.
-- serializeWorldState() writes stage_turns / pending_story_key on persist; they are not
-- part of the column default. Add only knowledge_library_eligible here.
alter table public.quest_progress
  alter column world_state set default
  '{"step":0,"unlocked_locations":[],"unlocked_subjects":["math"],"completed_quest_ids":[],"knowledge_library_eligible":false}'::jsonb;

update public.quest_progress
set world_state = coalesce(world_state, '{}'::jsonb)
  || jsonb_build_object('knowledge_library_eligible', false)
where world_state is null
   or not (world_state ? 'knowledge_library_eligible');

-- ─────────────────────────────────────────────
-- 9. Row Level Security
-- ─────────────────────────────────────────────
-- Player Domain progression tables are read-only for authenticated browser clients.
-- Phase 2 security-definer RPCs are the only authoritative writers and must validate
-- auth.uid() internally before inserting or updating these rows.

alter table public.attribute_definitions enable row level security;
alter table public.attribute_progression_levels enable row level security;
alter table public.rank_levels enable row level security;
alter table public.player_progression enable row level security;
alter table public.player_attributes enable row level security;
alter table public.growth_events enable row level security;
alter table public.growth_event_deltas enable row level security;
alter table public.activity_attribute_rewards enable row level security;

-- Catalog / definition tables: authenticated read
drop policy if exists "Attribute definitions: authenticated read" on public.attribute_definitions;
create policy "Attribute definitions: authenticated read"
on public.attribute_definitions
for select
to authenticated
using (true);

drop policy if exists "Attribute progression levels: authenticated read" on public.attribute_progression_levels;
create policy "Attribute progression levels: authenticated read"
on public.attribute_progression_levels
for select
to authenticated
using (true);

drop policy if exists "Rank levels: authenticated read" on public.rank_levels;
create policy "Rank levels: authenticated read"
on public.rank_levels
for select
to authenticated
using (true);

drop policy if exists "Activity attribute rewards: authenticated read" on public.activity_attribute_rewards;
create policy "Activity attribute rewards: authenticated read"
on public.activity_attribute_rewards
for select
to authenticated
using (true);

-- Player growth tables: own-row SELECT only (no authenticated INSERT/UPDATE)
drop policy if exists "Player progression: users read own" on public.player_progression;
create policy "Player progression: users read own"
on public.player_progression
for select
to authenticated
using (auth.uid() = profile_id);

drop policy if exists "Player progression: users insert own" on public.player_progression;
drop policy if exists "Player progression: users update own" on public.player_progression;

drop policy if exists "Player attributes: users read own" on public.player_attributes;
create policy "Player attributes: users read own"
on public.player_attributes
for select
to authenticated
using (auth.uid() = profile_id);

drop policy if exists "Player attributes: users insert own" on public.player_attributes;
drop policy if exists "Player attributes: users update own" on public.player_attributes;

drop policy if exists "Growth events: users read own" on public.growth_events;
create policy "Growth events: users read own"
on public.growth_events
for select
to authenticated
using (auth.uid() = profile_id);

drop policy if exists "Growth events: users insert own" on public.growth_events;

drop policy if exists "Growth event deltas: users read own" on public.growth_event_deltas;
create policy "Growth event deltas: users read own"
on public.growth_event_deltas
for select
to authenticated
using (
  exists (
    select 1
    from public.growth_events ge
    where ge.id = growth_event_id
      and ge.profile_id = auth.uid()
  )
);

drop policy if exists "Growth event deltas: users insert own" on public.growth_event_deltas;

commit;
```