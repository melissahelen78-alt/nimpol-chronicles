-- Living Magic: attribute inscriptions and enriched progression snapshot metadata.
-- Safe when live columns already exist (added manually in Supabase).

alter table public.attribute_definitions
  add column if not exists world_inscription text,
  add column if not exists growth_description text;

create or replace function public._build_player_progression_snapshot(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_progression public.player_progression%rowtype;
  v_current_rank public.rank_levels%rowtype;
  v_next_rank public.rank_levels%rowtype;
  v_attributes jsonb;
  v_definition_count integer;
  v_attribute_count integer;
  v_snapshot_count integer;
  v_world_state jsonb;
begin
  select pp.*
  into v_progression
  from public.player_progression pp
  where pp.profile_id = p_profile_id;

  if not found then
    raise exception 'Progression state is missing for authenticated profile %', p_profile_id;
  end if;

  select rl.*
  into v_current_rank
  from public.rank_levels rl
  where rl.minimum_total_xp <= v_progression.total_xp
  order by rl.minimum_total_xp desc, rl.sort_order desc
  limit 1;

  if not found then
    raise exception 'No rank threshold exists at or below total XP %', v_progression.total_xp;
  end if;

  select rl.*
  into v_next_rank
  from public.rank_levels rl
  where rl.minimum_total_xp > v_progression.total_xp
  order by rl.minimum_total_xp, rl.sort_order
  limit 1;

  select count(*)
  into v_definition_count
  from public.attribute_definitions;

  select count(*)
  into v_attribute_count
  from public.player_attributes pa
  where pa.profile_id = p_profile_id;

  if v_definition_count = 0 then
    raise exception 'No attribute definitions exist';
  end if;

  if v_attribute_count <> v_definition_count then
    raise exception
      'Progression snapshot is incomplete for profile %: expected % player attribute rows, found %',
      p_profile_id,
      v_definition_count,
      v_attribute_count;
  end if;

  select
    count(*),
    jsonb_agg(
      jsonb_build_object(
        'id', attribute_id,
        'slug', slug,
        'label', label,
        'sort_order', sort_order,
        'diamond_key', diamond_key,
        'bar_class', bar_class,
        'is_mana', is_mana,
        'world_inscription', world_inscription,
        'growth_description', growth_description,
        'attribute_xp', attribute_xp,
        'level', current_level,
        'level_minimum_xp', current_minimum_xp,
        'next_level', next_level,
        'next_level_minimum_xp', next_minimum_xp,
        'progress_xp', attribute_xp - current_minimum_xp,
        'xp_to_next_level',
          case
            when next_minimum_xp is null then null
            else next_minimum_xp - attribute_xp
          end,
        'level_span_xp',
          case
            when next_minimum_xp is null then null
            else next_minimum_xp - current_minimum_xp
          end
      )
      order by sort_order, slug
    )
  into v_snapshot_count, v_attributes
  from (
    select
      d.id as attribute_id,
      d.slug,
      d.label,
      d.sort_order,
      d.diamond_key,
      d.bar_class,
      d.is_mana,
      d.world_inscription,
      d.growth_description,
      pa.attribute_xp,
      current_level.level as current_level,
      current_level.cumulative_xp as current_minimum_xp,
      next_level.level as next_level,
      next_level.cumulative_xp as next_minimum_xp
    from public.attribute_definitions d
    join public.player_attributes pa
      on pa.profile_id = p_profile_id
     and pa.attribute_id = d.id
    join lateral (
      select apl.level, apl.cumulative_xp
      from public.attribute_progression_levels apl
      where apl.attribute_id = d.id
        and apl.cumulative_xp <= pa.attribute_xp
      order by apl.cumulative_xp desc, apl.level desc
      limit 1
    ) current_level on true
    left join lateral (
      select apl.level, apl.cumulative_xp
      from public.attribute_progression_levels apl
      where apl.attribute_id = d.id
        and apl.cumulative_xp > pa.attribute_xp
      order by apl.cumulative_xp, apl.level
      limit 1
    ) next_level on true
  ) attribute_state;

  if v_snapshot_count <> v_definition_count then
    raise exception
      'Attribute thresholds are incomplete: expected % derived attribute states, found %',
      v_definition_count,
      v_snapshot_count;
  end if;

  select qp.world_state
  into v_world_state
  from public.quest_progress qp
  where qp.user_id = p_profile_id;

  if not found then
    raise exception 'quest_progress is missing for authenticated profile %', p_profile_id;
  end if;

  return jsonb_build_object(
    'profile_id', v_progression.profile_id,
    'schema_version', v_progression.schema_version,
    'initialized_at', v_progression.initialized_at,
    'total_xp', v_progression.total_xp,
    'rank', jsonb_build_object(
      'id', v_current_rank.id,
      'name', v_current_rank.name,
      'sort_order', v_current_rank.sort_order,
      'minimum_total_xp', v_current_rank.minimum_total_xp,
      'next_rank_name', v_next_rank.name,
      'next_rank_minimum_total_xp', v_next_rank.minimum_total_xp,
      'progress_xp', v_progression.total_xp - v_current_rank.minimum_total_xp,
      'xp_to_next_rank',
        case
          when v_next_rank.id is null then null
          else v_next_rank.minimum_total_xp - v_progression.total_xp
        end,
      'rank_span_xp',
        case
          when v_next_rank.id is null then null
          else v_next_rank.minimum_total_xp - v_current_rank.minimum_total_xp
        end
    ),
    'attributes', coalesce(v_attributes, '[]'::jsonb),
    'knowledge_library_eligible',
      coalesce((v_world_state ->> 'knowledge_library_eligible')::boolean, false)
  );
end;
$$;

revoke all on function public._build_player_progression_snapshot(uuid)
from public, anon, authenticated;
