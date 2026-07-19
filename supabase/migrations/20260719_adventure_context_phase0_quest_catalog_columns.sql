-- Adventure Context Phase 0 (quest catalog columns)
-- Captures subject display columns from supabase/quest_catalog_expand.sql
-- that were not yet represented in supabase/migrations/.

begin;

alter table public.quest_templates
  add column if not exists subject_label text,
  add column if not exists subject_icon text,
  add column if not exists subject_sort_order integer not null default 0;

commit;
