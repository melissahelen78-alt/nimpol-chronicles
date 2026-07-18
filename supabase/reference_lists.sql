-- NimpolXP — AI reference lists (Scroll of Knowledge + Transmissions)
-- Paste into Supabase Dashboard → SQL Editor → Run

-- ─────────────────────────────────────────────
-- 1. discovery_facts — Scroll of Knowledge pool
-- ─────────────────────────────────────────────
create table if not exists public.discovery_facts (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  content_text text not null,
  attribute_type text not null check (
    attribute_type in ('Mana', 'Intellect', 'Lore', 'Perception', 'Charisma', 'Stamina')
  ),
  created_at timestamptz not null default now()
);

create index if not exists discovery_facts_attribute_type_idx
  on public.discovery_facts (attribute_type);

comment on table public.discovery_facts is
  'Reference pool for Scroll of Knowledge insights; AI picks by attribute_type or at random.';

-- ─────────────────────────────────────────────
-- 2. approved_transmissions — WATCH TRANSMISSION pool
-- ─────────────────────────────────────────────
create table if not exists public.approved_transmissions (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  video_url text not null,
  category text not null,
  created_at timestamptz not null default now(),

  constraint approved_transmissions_video_url_check
    check (video_url ~* '^https?://')
);

create index if not exists approved_transmissions_category_idx
  on public.approved_transmissions (category);

comment on table public.approved_transmissions is
  'Curated video links for the Watch Transmission button in the adventure hub.';

-- ─────────────────────────────────────────────
-- 3. Helper RPC — random discovery fact (optionally filtered)
-- ─────────────────────────────────────────────
create or replace function public.get_random_discovery_fact(p_attribute_type text default null)
returns public.discovery_facts
language sql
stable
as $$
  select df.*
  from public.discovery_facts df
  where p_attribute_type is null
     or df.attribute_type = p_attribute_type
  order by random()
  limit 1;
$$;

comment on function public.get_random_discovery_fact(text) is
  'Returns one random discovery_facts row; pass attribute_type to filter (e.g. Lore).';

-- ─────────────────────────────────────────────
-- 4. Row Level Security (read-only for signed-in users)
-- ─────────────────────────────────────────────
alter table public.discovery_facts enable row level security;
alter table public.approved_transmissions enable row level security;

drop policy if exists "Discovery facts: authenticated read" on public.discovery_facts;
create policy "Discovery facts: authenticated read"
on public.discovery_facts
for select
to authenticated
using (true);

drop policy if exists "Approved transmissions: authenticated read" on public.approved_transmissions;
create policy "Approved transmissions: authenticated read"
on public.approved_transmissions
for select
to authenticated
using (true);

-- ─────────────────────────────────────────────
-- 5. Seed data (matches current hardcoded Scroll of Knowledge)
-- ─────────────────────────────────────────────
insert into public.discovery_facts (title, content_text, attribute_type)
values
  (
    'Granite Foundations',
    'Granite is an igneous rock formed by cooling magma underground; it is incredibly durable and forms the core of major mountain ranges.',
    'Lore'
  ),
  (
    'Basalt Columns',
    'Basalt columns form when cooling lava contracts into geometric cracks — clues to ancient volcanic activity.',
    'Lore'
  ),
  (
    'Ultraviolet Minerals',
    'Many minerals glow under ultraviolet light because their crystal structure re-emits stored energy.',
    'Intellect'
  ),
  (
    'Ancient Riverbeds',
    'Sedimentary rocks can preserve ripple marks from old rivers, helping scientists map ancient landscapes.',
    'Perception'
  )
on conflict (title) do nothing;

insert into public.approved_transmissions (title, video_url, category)
values
  (
    'How Mountains Form',
    'https://www.youtube.com/watch?v=d7uQn2f4J4I',
    'Geology'
  ),
  (
    'The Rock Cycle',
    'https://www.youtube.com/watch?v=IKXPqSapVnM',
    'Geology'
  ),
  (
    'Reading for Meaning',
    'https://www.youtube.com/watch?v=example',
    'Reading'
  )
on conflict (title) do nothing;

-- ─────────────────────────────────────────────
-- Grant RPC to authenticated users
-- ─────────────────────────────────────────────
grant execute on function public.get_random_discovery_fact(text) to authenticated;
