-- NimpolXP — expand quest_templates for dynamic subject catalog
-- Paste into Supabase Dashboard → SQL Editor → Run (after quest_inventory.sql)

-- Drop rigid subject enum so new subjects can be added via Table Editor
alter table public.quest_templates
  drop constraint if exists quest_templates_subject_check;

-- Subject display metadata (same values on all rows sharing a subject slug)
alter table public.quest_templates
  add column if not exists subject_label text,
  add column if not exists subject_icon text,
  add column if not exists subject_sort_order integer not null default 0;

comment on column public.quest_templates.subject_label is 'Display name for subject picker, e.g. Math';
comment on column public.quest_templates.subject_icon is 'Emoji for subject picker button';
comment on column public.quest_templates.subject_sort_order is 'Sort order for subject in picker (lower first)';

-- Backfill math / reading / typing
update public.quest_templates set
  subject_label = 'Math',
  subject_icon = '🔢',
  subject_sort_order = 1
where subject = 'math';

update public.quest_templates set
  subject_label = 'Reading',
  subject_icon = '📖',
  subject_sort_order = 2
where subject = 'reading';

update public.quest_templates set
  subject_label = 'Typing',
  subject_icon = '⌨️',
  subject_sort_order = 3
where subject = 'typing';
