-- NimpolXP — quest templates, active quests, inventory, parent PIN
-- Paste into Supabase Dashboard → SQL Editor → Run (after prior migrations)

-- ─────────────────────────────────────────────
-- 1. Parent PIN on profiles
-- ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists parent_pin text not null default '1234';

comment on column public.profiles.parent_pin is
  '4-digit PIN parent gives Nimpol to verify offline worksheet/workbook quests.';

-- ─────────────────────────────────────────────
-- 2. quest_templates — master activity catalog
-- ─────────────────────────────────────────────
create table if not exists public.quest_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  subject text not null check (subject in ('math', 'reading', 'typing')),
  tool_name text not null,
  title text not null,
  description text not null default '',
  icon text not null default '📜',
  reward_xp integer not null default 50 check (reward_xp >= 0),
  portal_url text,
  verification_type text not null default 'instant'
    check (verification_type in ('instant', 'time_delay', 'parent_code')),
  delay_minutes integer not null default 0 check (delay_minutes >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists quest_templates_subject_idx
  on public.quest_templates (subject, is_active);

-- ─────────────────────────────────────────────
-- 3. active_quests — today's assigned quests + timer state
-- ─────────────────────────────────────────────
create table if not exists public.active_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references public.quest_templates (id) on delete cascade,
  quest_date date not null,

  status text not null default 'assigned'
    check (status in ('assigned', 'in_progress', 'ready', 'claimed')),

  timer_started_at timestamptz,
  timer_ready_at timestamptz,
  claimed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, template_id, quest_date)
);

create index if not exists active_quests_user_date_idx
  on public.active_quests (user_id, quest_date);

-- ─────────────────────────────────────────────
-- 4. items — RPG loot catalog
-- ─────────────────────────────────────────────
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  icon text not null default '🎁',
  rarity text not null default 'common'
    check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  drop_weight integer not null default 10 check (drop_weight > 0),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 5. user_inventory
-- ─────────────────────────────────────────────
create table if not exists public.user_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  acquired_at timestamptz not null default now(),
  source text,

  unique (user_id, item_id)
);

create index if not exists user_inventory_user_idx
  on public.user_inventory (user_id);

-- ─────────────────────────────────────────────
-- 6. story_history — loot awarded column
-- ─────────────────────────────────────────────
alter table public.story_history
  add column if not exists loot_awarded jsonb;

-- ─────────────────────────────────────────────
-- 7. updated_at trigger for active_quests
-- ─────────────────────────────────────────────
create or replace function public.set_active_quests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists active_quests_set_updated_at on public.active_quests;

create trigger active_quests_set_updated_at
before update on public.active_quests
for each row
execute function public.set_active_quests_updated_at();

-- ─────────────────────────────────────────────
-- 8. Row Level Security
-- ─────────────────────────────────────────────
alter table public.quest_templates enable row level security;
alter table public.active_quests enable row level security;
alter table public.items enable row level security;
alter table public.user_inventory enable row level security;

drop policy if exists "Quest templates: authenticated read" on public.quest_templates;
create policy "Quest templates: authenticated read"
on public.quest_templates for select to authenticated using (true);

drop policy if exists "Active quests: read own" on public.active_quests;
create policy "Active quests: read own"
on public.active_quests for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Active quests: insert own" on public.active_quests;
create policy "Active quests: insert own"
on public.active_quests for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Active quests: update own" on public.active_quests;
create policy "Active quests: update own"
on public.active_quests for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Items: authenticated read" on public.items;
create policy "Items: authenticated read"
on public.items for select to authenticated using (true);

drop policy if exists "Inventory: read own" on public.user_inventory;
create policy "Inventory: read own"
on public.user_inventory for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Inventory: insert own" on public.user_inventory;
create policy "Inventory: insert own"
on public.user_inventory for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Inventory: update own" on public.user_inventory;
create policy "Inventory: update own"
on public.user_inventory for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 9. Seed quest templates (Glide-style tools)
-- ─────────────────────────────────────────────
insert into public.quest_templates (slug, subject, tool_name, title, description, icon, reward_xp, portal_url, verification_type, delay_minutes, sort_order)
values
  ('math-ba-online', 'math', 'Beast Academy Online', 'Vault of Arithmancy', 'Complete the next Beast Academy online lesson.', '🔢', 72, 'https://beastacademy.com', 'time_delay', 15, 1),
  ('math-ba-workbook', 'math', 'Beast Academy Workbook', 'Workbook Quest', 'Finish one Beast Academy workbook page set.', '📘', 68, null, 'parent_code', 0, 2),
  ('math-morning-sheet', 'math', 'Morning Worksheet', 'Morning Math Runes', 'Complete today''s morning math worksheet.', '📝', 55, null, 'parent_code', 0, 3),
  ('reading-comp', 'reading', 'Reading Comprehension Worksheet', 'Scroll of Main Ideas', 'Read and answer comprehension questions.', '📖', 48, null, 'parent_code', 0, 1),
  ('reading-ba-online', 'reading', 'Beast Academy Online', 'Runes of Inference', 'Complete a Beast Academy reading activity online.', '📚', 55, 'https://beastacademy.com', 'time_delay', 15, 2),
  ('reading-maze', 'reading', 'Maze Book', 'Labyrinth of Letters', 'Complete one maze book reading path.', '🌀', 45, null, 'parent_code', 0, 3),
  ('typing-ttrs', 'typing', 'TTRS', 'Rhythm Forge', 'Complete a TTRS spelling/reading lesson.', '⌨️', 40, 'https://www.ttrs.com', 'time_delay', 10, 1),
  ('typing-accuracy', 'typing', 'TTRS', 'Accuracy Crystal', 'Beat your accuracy target on TTRS.', '🎯', 44, 'https://www.ttrs.com', 'time_delay', 10, 2),
  ('typing-speed', 'typing', 'TTRS', 'Speed Run', 'Improve your WPM on TTRS.', '⚡', 50, 'https://www.ttrs.com', 'time_delay', 12, 3)
on conflict (slug) do update set
  tool_name = excluded.tool_name,
  title = excluded.title,
  description = excluded.description,
  reward_xp = excluded.reward_xp,
  portal_url = excluded.portal_url,
  verification_type = excluded.verification_type,
  delay_minutes = excluded.delay_minutes;

-- ─────────────────────────────────────────────
-- 10. Seed items
-- ─────────────────────────────────────────────
insert into public.items (slug, name, description, icon, rarity, drop_weight)
values
  ('focus-crystal-shard', 'Focus Crystal Shard', 'A sliver of glowing crystal that sharpens your mind.', '💎', 'common', 40),
  ('mana-potion', 'Mini Mana Potion', 'Restores a spark of magical energy.', '🧪', 'common', 35),
  ('ancient-scroll', 'Ancient Scroll', 'A rolled parchment humming with old knowledge.', '📜', 'uncommon', 20),
  ('wizard-hat-patch', 'Wizard Hat Patch', 'A stitched star for your hat — proof of progress.', '🌟', 'uncommon', 15),
  ('enchanted-quill', 'Enchanted Quill', 'Writes answers in shimmering ink.', '✒️', 'rare', 8),
  ('dragon-scale', 'Dragon Scale', 'Tough and iridescent — a true treasure.', '🐉', 'rare', 6),
  ('starlight-gem', 'Starlight Gem', 'Pulses with the light of distant constellations.', '✨', 'epic', 3),
  ('chronicle-crown', 'Chronicle Crown', 'Reserved for the most dedicated wizards.', '👑', 'legendary', 1)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  rarity = excluded.rarity,
  drop_weight = excluded.drop_weight;
