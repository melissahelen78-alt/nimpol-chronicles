-- Adventure Context Phase 0
-- Capture the manually-created World Domain tables and story-facing quest
-- template columns in repository-managed, additive SQL.
--
-- The column set below was verified against the linked PostgREST schema.
-- Existing live rows win: seed inserts never overwrite canonical content.

begin;

create table if not exists public.worlds (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_definitions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_id, slug)
);

create table if not exists public.location_definitions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_id, slug)
);

alter table public.quest_templates
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists story_context text,
  add column if not exists location_slug text,
  add column if not exists story_weight integer,
  add column if not exists prerequisite_tags jsonb not null default '[]'::jsonb;

insert into public.worlds (slug, name, description, metadata, status)
select
  'dragon-realm',
  'Dragon Realm',
  null,
  '{}'::jsonb,
  'active'
where not exists (
  select 1
  from public.worlds w
  where w.slug = 'dragon-realm'
     or w.name = 'Dragon Realm'
);

insert into public.character_definitions (
  world_id,
  slug,
  name,
  description,
  metadata,
  status
)
select
  w.id,
  'nutty',
  'Nutty',
  'A friendly squirrel guide and Chronicle Keeper.',
  '{"role":"companion","is_guide":true}'::jsonb,
  'active'
from public.worlds w
where (w.slug = 'dragon-realm' or w.name = 'Dragon Realm')
  and not exists (
    select 1
    from public.character_definitions cd
    where cd.world_id = w.id
      and (cd.slug = 'nutty' or cd.name = 'Nutty')
  );

insert into public.location_definitions (
  world_id,
  slug,
  name,
  description,
  metadata,
  status
)
select
  w.id,
  seed.slug,
  seed.name,
  seed.description,
  '{}'::jsonb,
  'active'
from public.worlds w
cross join (
  values
    (
      'hidden_treehouse',
      'Hidden Treehouse',
      null::text
    ),
    (
      'tree-of-life-and-death',
      'Tree of Life and Death',
      null
    ),
    (
      'starlit-library',
      'Starlit Library',
      null
    ),
    (
      'whispering-forest',
      'Whispering Forest',
      null
    )
) as seed(slug, name, description)
where (w.slug = 'dragon-realm' or w.name = 'Dragon Realm')
  and not exists (
    select 1
    from public.location_definitions ld
    where ld.world_id = w.id
      and (ld.slug = seed.slug or ld.name = seed.name)
  );

alter table public.worlds enable row level security;
alter table public.character_definitions enable row level security;
alter table public.location_definitions enable row level security;

grant select on public.worlds to authenticated;
grant select on public.character_definitions to authenticated;
grant select on public.location_definitions to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'worlds'
      and policyname = 'Worlds: authenticated read'
  ) then
    create policy "Worlds: authenticated read"
    on public.worlds for select to authenticated using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'character_definitions'
      and policyname = 'Character definitions: authenticated read'
  ) then
    create policy "Character definitions: authenticated read"
    on public.character_definitions for select to authenticated using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'location_definitions'
      and policyname = 'Location definitions: authenticated read'
  ) then
    create policy "Location definitions: authenticated read"
    on public.location_definitions for select to authenticated using (true);
  end if;
end;
$$;

commit;
