-- Build Week demo: use the existing parent approval flow for every Math quest.
-- Run manually in the live Supabase SQL Editor. delay_minutes is intentionally preserved.

update public.quest_templates
set verification_type = 'parent_code'
where slug = 'math-ba-online';
