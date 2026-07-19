-- Adventure Context Phase 1A
-- Read-only authenticated progression snapshot for story context assembly.

begin;

create or replace function public.get_player_progression_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not exists (
    select 1
    from public.player_progression pp
    where pp.profile_id = v_user_id
  ) then
    raise exception 'Player progression is not initialized';
  end if;

  return public._build_player_progression_snapshot(v_user_id);
end;
$$;

revoke all on function public.get_player_progression_snapshot()
from public, anon;

grant execute on function public.get_player_progression_snapshot()
to authenticated;

commit;
