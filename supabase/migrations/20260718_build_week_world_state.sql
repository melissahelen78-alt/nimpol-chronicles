-- Build Week demo: durable one-step world progression.
-- Run this statement manually in the live Supabase SQL Editor.

alter table public.quest_progress
  add column if not exists world_state jsonb not null
  default '{"step":0,"unlocked_locations":[],"unlocked_subjects":["math"],"completed_quest_ids":[]}'::jsonb;

-- Idempotent safety backfill for databases where the column previously allowed nulls.
update public.quest_progress
set world_state = '{"step":0,"unlocked_locations":[],"unlocked_subjects":["math"],"completed_quest_ids":[]}'::jsonb
where world_state is null;

alter table public.quest_progress
  alter column world_state set default '{"step":0,"unlocked_locations":[],"unlocked_subjects":["math"],"completed_quest_ids":[]}'::jsonb,
  alter column world_state set not null;
