-- Build Week Progression — Phase 2
-- Server-authoritative initialization and quest-claim RPCs.
-- Run manually in the Supabase SQL Editor after Phase 1.
--
-- Verified source identity:
-- public.quest_claims.id is a UUID primary key generated once with
-- gen_random_uuid(). It is stable and is stored as growth_events.source_id
-- using quest_claims.id::text.

begin;

-- Persist before/after values on each delta so retries can return the exact
-- original reward summary without relying on current player state.
alter table public.growth_event_deltas
  add column previous_xp integer not null,
  add column new_xp integer not null,
  add column previous_level integer,
  add column new_level integer,
  add constraint growth_event_deltas_xp_transition check (
    new_xp = previous_xp + xp_delta
  ),
  add constraint growth_event_deltas_level_transition_shape check (
    (kind = 'overall' and previous_level is null and new_level is null)
    or
    (
      kind = 'attribute'
      and previous_level is not null
      and new_level is not null
      and previous_level >= 1
      and new_level >= previous_level
    )
  );

-- Internal snapshot builder. It is not exposed to browser roles.
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
        'is_mana', is_mana,
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
      d.is_mana,
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

-- Internal reward-summary builder. Every value comes from the persisted
-- growth event and its deltas, so duplicate calls return the original result.
create or replace function public._build_growth_reward_summary(p_growth_event_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_total_xp_gained integer;
  v_attributes jsonb;
  v_attribute_count integer;
begin
  select ged.xp_delta
  into v_total_xp_gained
  from public.growth_event_deltas ged
  where ged.growth_event_id = p_growth_event_id
    and ged.kind = 'overall';

  if not found then
    raise exception
      'Growth event % is missing its overall XP delta',
      p_growth_event_id;
  end if;

  select
    count(*),
    jsonb_agg(
      jsonb_build_object(
        'attribute_key', d.slug,
        'display_name', d.label,
        'xp_gained', ged.xp_delta,
        'previous_xp', ged.previous_xp,
        'new_xp', ged.new_xp,
        'previous_level', ged.previous_level,
        'new_level', ged.new_level,
        'level_up', ged.new_level > ged.previous_level
      )
      order by d.sort_order, d.slug
    )
  into v_attribute_count, v_attributes
  from public.growth_event_deltas ged
  join public.attribute_definitions d
    on d.id = ged.attribute_id
  where ged.growth_event_id = p_growth_event_id
    and ged.kind = 'attribute';

  if v_attribute_count = 0 then
    raise exception
      'Growth event % is missing attribute reward deltas',
      p_growth_event_id;
  end if;

  return jsonb_build_object(
    'total_xp_gained', v_total_xp_gained,
    'attributes', v_attributes
  );
end;
$$;

revoke all on function public._build_growth_reward_summary(uuid)
from public, anon, authenticated;

-- Initializes the authenticated profile exactly once. Legacy values are
-- conversion inputs only; existing Player Domain XP is never reduced.
create or replace function public.initialize_player_progression()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_progression public.player_progression%rowtype;
  v_conversion_event_id uuid;
  v_claimed_xp bigint;
  v_converted_total_xp integer;
  v_required_attribute_count integer;
  v_level_one_count integer;
  v_knowledge_id uuid;
  v_knowledge_level_two_xp integer;
  v_knowledge_xp integer;
  v_world_state jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  -- The profile lock serializes initialization and claims for this profile.
  select p.*
  into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found then
    raise exception 'Profile % does not exist', v_user_id;
  end if;

  select count(*)
  into v_required_attribute_count
  from public.attribute_definitions d
  where d.slug in (
    'mana',
    'knowledge',
    'perception',
    'creativity',
    'stamina',
    'resolve'
  );

  if v_required_attribute_count <> 6 then
    raise exception
      'Required Build Week attribute definitions are incomplete: expected 6, found %',
      v_required_attribute_count;
  end if;

  select count(*)
  into v_level_one_count
  from public.attribute_definitions d
  where exists (
    select 1
    from public.attribute_progression_levels apl
    where apl.attribute_id = d.id
      and apl.level = 1
      and apl.cumulative_xp = 0
  );

  if v_level_one_count <> (select count(*) from public.attribute_definitions) then
    raise exception 'Every attribute definition must have a Level 1 threshold at 0 XP';
  end if;

  if not exists (
    select 1
    from public.rank_levels rl
    where rl.minimum_total_xp = 0
  ) then
    raise exception 'A rank threshold at 0 total XP is required';
  end if;

  select d.id
  into v_knowledge_id
  from public.attribute_definitions d
  where d.slug = 'knowledge';

  select apl.cumulative_xp
  into v_knowledge_level_two_xp
  from public.attribute_progression_levels apl
  where apl.attribute_id = v_knowledge_id
    and apl.level = 2;

  if v_knowledge_level_two_xp is null then
    raise exception 'Knowledge Level 2 threshold is missing';
  end if;

  select qp.world_state
  into v_world_state
  from public.quest_progress qp
  where qp.user_id = v_user_id
  for update;

  if not found then
    raise exception 'quest_progress is missing for authenticated profile %', v_user_id;
  end if;

  insert into public.player_progression (
    profile_id,
    total_xp,
    schema_version
  )
  values (
    v_user_id,
    0,
    0
  )
  on conflict (profile_id) do nothing;

  select pp.*
  into v_progression
  from public.player_progression pp
  where pp.profile_id = v_user_id
  for update;

  if v_progression.schema_version > 1 then
    raise exception
      'Unsupported player progression schema version % for profile %',
      v_progression.schema_version,
      v_user_id;
  end if;

  -- Phase 1 has no is_active column; every definition is currently active.
  insert into public.player_attributes (
    profile_id,
    attribute_id,
    attribute_xp
  )
  select v_user_id, d.id, 0
  from public.attribute_definitions d
  on conflict (profile_id, attribute_id) do nothing;

  if v_progression.schema_version = 0 then
    select coalesce(sum(qc.reward_xp), 0)
    into v_claimed_xp
    from public.quest_claims qc
    where qc.user_id = v_user_id;

    if v_claimed_xp > 2147483647 then
      raise exception 'Confirmed legacy claim XP exceeds the supported integer range';
    end if;

    v_converted_total_xp := greatest(
      v_progression.total_xp,
      v_profile.xp_current,
      v_claimed_xp::integer,
      0
    );

    update public.player_progression pp
    set total_xp = greatest(pp.total_xp, v_converted_total_xp)
    where pp.profile_id = v_user_id;

    update public.player_attributes pa
    set attribute_xp = greatest(
      pa.attribute_xp,
      case d.slug
        when 'mana' then greatest(v_profile.mana_current, 0)
        when 'knowledge' then greatest(v_profile.intellect_current, 0)
        when 'perception' then greatest(v_profile.perception_current, 0)
        when 'creativity' then greatest(v_profile.lore_current, 0)
        when 'stamina' then greatest(v_profile.stamina_current, 0)
        when 'resolve' then greatest(v_profile.charisma_current, 0)
        else pa.attribute_xp
      end
    )
    from public.attribute_definitions d
    where pa.profile_id = v_user_id
      and pa.attribute_id = d.id;

    insert into public.growth_events (
      profile_id,
      source_type,
      source_id
    )
    values (
      v_user_id,
      'conversion',
      'progression_schema_v1'
    )
    on conflict (profile_id, source_type, source_id) do nothing
    returning id into v_conversion_event_id;

    if v_conversion_event_id is null then
      select ge.id
      into v_conversion_event_id
      from public.growth_events ge
      where ge.profile_id = v_user_id
        and ge.source_type = 'conversion'
        and ge.source_id = 'progression_schema_v1';
    end if;

    if v_conversion_event_id is null then
      raise exception 'Could not create or recover the progression conversion event';
    end if;

    insert into public.growth_event_deltas (
      growth_event_id,
      kind,
      attribute_id,
      xp_delta,
      previous_xp,
      new_xp,
      previous_level,
      new_level
    )
    select
      v_conversion_event_id,
      'overall',
      null,
      pp.total_xp,
      0,
      pp.total_xp,
      null,
      null
    from public.player_progression pp
    where pp.profile_id = v_user_id
    on conflict (growth_event_id) where kind = 'overall' do nothing;

    insert into public.growth_event_deltas (
      growth_event_id,
      kind,
      attribute_id,
      xp_delta,
      previous_xp,
      new_xp,
      previous_level,
      new_level
    )
    select
      v_conversion_event_id,
      'attribute',
      pa.attribute_id,
      pa.attribute_xp,
      0,
      pa.attribute_xp,
      previous_level.level,
      new_level.level
    from public.player_attributes pa
    join lateral (
      select apl.level
      from public.attribute_progression_levels apl
      where apl.attribute_id = pa.attribute_id
        and apl.cumulative_xp <= 0
      order by apl.cumulative_xp desc, apl.level desc
      limit 1
    ) previous_level on true
    join lateral (
      select apl.level
      from public.attribute_progression_levels apl
      where apl.attribute_id = pa.attribute_id
        and apl.cumulative_xp <= pa.attribute_xp
      order by apl.cumulative_xp desc, apl.level desc
      limit 1
    ) new_level on true
    where pa.profile_id = v_user_id
    on conflict (growth_event_id, attribute_id) where kind = 'attribute' do nothing;

    select pa.attribute_xp
    into v_knowledge_xp
    from public.player_attributes pa
    where pa.profile_id = v_user_id
      and pa.attribute_id = v_knowledge_id;

    if v_knowledge_xp is null then
      raise exception 'Knowledge player attribute is missing after initialization';
    end if;

    if v_knowledge_xp >= v_knowledge_level_two_xp then
      v_world_state := jsonb_set(
        v_world_state,
        '{knowledge_library_eligible}',
        'true'::jsonb,
        true
      );

      update public.quest_progress qp
      set world_state = v_world_state
      where qp.user_id = v_user_id;
    end if;

    update public.player_progression pp
    set
      schema_version = 1,
      initialized_at = coalesce(pp.initialized_at, now())
    where pp.profile_id = v_user_id;
  end if;

  return public._build_player_progression_snapshot(v_user_id);
end;
$$;

revoke all on function public.initialize_player_progression()
from public, anon;
grant execute on function public.initialize_player_progression()
to authenticated;

-- Claims one persisted active quest and applies all database-defined rewards.
-- p_verification_input is used only for parent_code verification.
create or replace function public.claim_quest_and_award_progression(
  p_active_quest_id uuid,
  p_verification_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_active_quest record;
  v_existing_claim public.quest_claims%rowtype;
  v_claim public.quest_claims%rowtype;
  v_growth_event_id uuid;
  v_mapping_count integer;
  v_invalid_reward_count integer;
  v_threshold_count integer;
  v_updated_attribute_count integer;
  v_inserted_attribute_delta_count integer;
  v_existing_delta_count integer;
  v_knowledge_id uuid;
  v_knowledge_level_two_xp integer;
  v_knowledge_xp integer;
  v_world_state jsonb;
  v_completed_quest_ids jsonb;
  v_story_progressed boolean := false;
  v_today date := (timezone('utc', statement_timestamp()))::date;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_active_quest_id is null then
    raise exception 'An active quest ID is required';
  end if;

  -- Initializes if needed and locks this profile before any claim processing.
  perform public.initialize_player_progression();

  select
    aq.id as active_quest_id,
    aq.user_id,
    aq.template_id,
    aq.quest_date,
    aq.status,
    aq.timer_started_at,
    aq.timer_ready_at,
    aq.claimed_at,
    qt.slug,
    qt.subject,
    qt.reward_xp,
    qt.verification_type,
    qt.is_active
  into v_active_quest
  from public.active_quests aq
  join public.quest_templates qt
    on qt.id = aq.template_id
  where aq.id = p_active_quest_id
    and aq.user_id = v_user_id
  for update of aq;

  if not found then
    raise exception
      'Active quest % was not found for the authenticated profile',
      p_active_quest_id;
  end if;

  select qc.*
  into v_existing_claim
  from public.quest_claims qc
  where qc.user_id = v_user_id
    and qc.quest_id = v_active_quest.slug
    and qc.claim_date = v_active_quest.quest_date;

  if found then
    select ge.id
    into v_growth_event_id
    from public.growth_events ge
    where ge.profile_id = v_user_id
      and ge.source_type = 'quest_claim'
      and ge.source_id = v_existing_claim.id::text;

    if v_growth_event_id is null then
      raise exception
        'Quest claim % already exists without a progression growth event; reconciliation is required',
        v_existing_claim.id;
    end if;

    select count(*)
    into v_existing_delta_count
    from public.growth_event_deltas ged
    where ged.growth_event_id = v_growth_event_id
      and ged.kind = 'overall';

    if v_existing_delta_count <> 1 then
      raise exception
        'Existing quest claim % has an invalid overall growth delta count: %',
        v_existing_claim.id,
        v_existing_delta_count;
    end if;

    return jsonb_build_object(
      'status', 'existing',
      'awarded', false,
      'claim_id', v_existing_claim.id,
      'quest_id', v_existing_claim.quest_id,
      'active_quest_id', p_active_quest_id,
      'reward_xp', v_existing_claim.reward_xp,
      'rewards', public._build_growth_reward_summary(v_growth_event_id),
      'story_progressed', false,
      'world_state', (
        select qp.world_state
        from public.quest_progress qp
        where qp.user_id = v_user_id
      ),
      'progression', public._build_player_progression_snapshot(v_user_id)
    );
  end if;

  if v_active_quest.quest_date <> v_today then
    raise exception
      'Active quest % belongs to %, but the current UTC claim date is %',
      p_active_quest_id,
      v_active_quest.quest_date,
      v_today;
  end if;

  if not v_active_quest.is_active then
    raise exception 'Quest template % is inactive', v_active_quest.slug;
  end if;

  if v_active_quest.status = 'claimed' then
    raise exception
      'Active quest % is marked claimed but has no persisted quest_claims row',
      p_active_quest_id;
  end if;

  case v_active_quest.verification_type
    when 'instant' then
      null;
    when 'parent_code' then
      if p_verification_input is null
         or btrim(p_verification_input) = ''
         or not exists (
           select 1
           from public.profiles p
           where p.id = v_user_id
             and btrim(p.parent_pin) = btrim(p_verification_input)
         ) then
        raise exception 'Parent verification failed';
      end if;
    when 'time_delay' then
      if not (
        v_active_quest.status in ('in_progress', 'ready')
        and v_active_quest.timer_started_at is not null
        and v_active_quest.timer_ready_at is not null
        and v_active_quest.timer_ready_at <= statement_timestamp()
      ) then
        raise exception 'Quest timer verification is not complete';
      end if;
    else
      raise exception
        'Unsupported verification method % for quest %',
        v_active_quest.verification_type,
        v_active_quest.slug;
  end case;

  if v_active_quest.reward_xp is null or v_active_quest.reward_xp <= 0 then
    raise exception
      'Quest template % must define a positive reward_xp',
      v_active_quest.slug;
  end if;

  select
    count(*),
    count(*) filter (where aar.xp_amount is null or aar.xp_amount <= 0),
    count(*) filter (
      where not exists (
        select 1
        from public.attribute_progression_levels apl
        where apl.attribute_id = aar.attribute_id
          and apl.level = 1
          and apl.cumulative_xp = 0
      )
    )
  into v_mapping_count, v_invalid_reward_count, v_threshold_count
  from public.activity_attribute_rewards aar
  where aar.template_id = v_active_quest.template_id;

  if v_mapping_count = 0 then
    raise exception
      'Quest template % has no attribute reward mappings',
      v_active_quest.slug;
  end if;

  if v_invalid_reward_count <> 0 then
    raise exception
      'Quest template % has % non-positive attribute rewards',
      v_active_quest.slug,
      v_invalid_reward_count;
  end if;

  if v_threshold_count <> 0 then
    raise exception
      'Quest template % maps rewards to % attributes without a Level 1 threshold at 0 XP',
      v_active_quest.slug,
      v_threshold_count;
  end if;

  select d.id
  into v_knowledge_id
  from public.attribute_definitions d
  where d.slug = 'knowledge';

  if v_knowledge_id is null then
    raise exception 'Knowledge attribute definition is missing';
  end if;

  select apl.cumulative_xp
  into v_knowledge_level_two_xp
  from public.attribute_progression_levels apl
  where apl.attribute_id = v_knowledge_id
    and apl.level = 2;

  if v_knowledge_level_two_xp is null then
    raise exception 'Knowledge Level 2 threshold is missing';
  end if;

  select qp.world_state
  into v_world_state
  from public.quest_progress qp
  where qp.user_id = v_user_id
  for update;

  if not found then
    raise exception 'quest_progress is missing for authenticated profile %', v_user_id;
  end if;

  insert into public.quest_claims (
    user_id,
    quest_id,
    reward_xp,
    claim_date
  )
  values (
    v_user_id,
    v_active_quest.slug,
    v_active_quest.reward_xp,
    v_active_quest.quest_date
  )
  returning * into v_claim;

  insert into public.growth_events (
    profile_id,
    source_type,
    source_id
  )
  values (
    v_user_id,
    'quest_claim',
    v_claim.id::text
  )
  returning id into v_growth_event_id;

  insert into public.growth_event_deltas (
    growth_event_id,
    kind,
    attribute_id,
    xp_delta,
    previous_xp,
    new_xp,
    previous_level,
    new_level
  )
  select
    v_growth_event_id,
    'overall',
    null,
    v_active_quest.reward_xp,
    pp.total_xp,
    pp.total_xp + v_active_quest.reward_xp,
    null,
    null
  from public.player_progression pp
  where pp.profile_id = v_user_id
    and pp.schema_version = 1;

  if not found then
    raise exception
      'Initialized player_progression row is missing for profile %',
      v_user_id;
  end if;

  insert into public.growth_event_deltas (
    growth_event_id,
    kind,
    attribute_id,
    xp_delta,
    previous_xp,
    new_xp,
    previous_level,
    new_level
  )
  select
    v_growth_event_id,
    'attribute',
    aar.attribute_id,
    aar.xp_amount,
    pa.attribute_xp,
    pa.attribute_xp + aar.xp_amount,
    previous_level.level,
    new_level.level
  from public.activity_attribute_rewards aar
  join public.player_attributes pa
    on pa.profile_id = v_user_id
   and pa.attribute_id = aar.attribute_id
  join lateral (
    select apl.level
    from public.attribute_progression_levels apl
    where apl.attribute_id = aar.attribute_id
      and apl.cumulative_xp <= pa.attribute_xp
    order by apl.cumulative_xp desc, apl.level desc
    limit 1
  ) previous_level on true
  join lateral (
    select apl.level
    from public.attribute_progression_levels apl
    where apl.attribute_id = aar.attribute_id
      and apl.cumulative_xp <= pa.attribute_xp + aar.xp_amount
    order by apl.cumulative_xp desc, apl.level desc
    limit 1
  ) new_level on true
  where aar.template_id = v_active_quest.template_id;

  get diagnostics v_inserted_attribute_delta_count = row_count;

  if v_inserted_attribute_delta_count <> v_mapping_count then
    raise exception
      'Expected to persist % attribute reward deltas for quest %, persisted %',
      v_mapping_count,
      v_active_quest.slug,
      v_inserted_attribute_delta_count;
  end if;

  update public.player_progression pp
  set total_xp = pp.total_xp + v_active_quest.reward_xp
  where pp.profile_id = v_user_id
    and pp.schema_version = 1;

  if not found then
    raise exception
      'Initialized player_progression row is missing for profile %',
      v_user_id;
  end if;

  update public.player_attributes pa
  set attribute_xp = pa.attribute_xp + aar.xp_amount
  from public.activity_attribute_rewards aar
  where pa.profile_id = v_user_id
    and pa.attribute_id = aar.attribute_id
    and aar.template_id = v_active_quest.template_id;

  get diagnostics v_updated_attribute_count = row_count;

  if v_updated_attribute_count <> v_mapping_count then
    raise exception
      'Expected to update % player attributes for quest %, updated %',
      v_mapping_count,
      v_active_quest.slug,
      v_updated_attribute_count;
  end if;

  select pa.attribute_xp
  into v_knowledge_xp
  from public.player_attributes pa
  where pa.profile_id = v_user_id
    and pa.attribute_id = v_knowledge_id;

  if v_knowledge_xp is null then
    raise exception 'Knowledge player attribute is missing';
  end if;

  if v_knowledge_xp >= v_knowledge_level_two_xp then
    v_world_state := jsonb_set(
      v_world_state,
      '{knowledge_library_eligible}',
      'true'::jsonb,
      true
    );
  end if;

  -- Preserve the existing Build Week Math completion transition only.
  -- Eligibility does not unlock Reading or bypass subsequent narrative stages.
  if v_active_quest.slug in (
       'math-ba-online',
       'math-ba-workbook',
       'math-morning-sheet'
     )
     and coalesce((v_world_state ->> 'step')::integer, 0) = 1 then
    v_completed_quest_ids := coalesce(
      v_world_state -> 'completed_quest_ids',
      '[]'::jsonb
    );

    if jsonb_typeof(v_completed_quest_ids) <> 'array' then
      raise exception 'world_state.completed_quest_ids must be a JSON array';
    end if;

    if not (v_completed_quest_ids @> jsonb_build_array(v_active_quest.slug)) then
      v_completed_quest_ids :=
        v_completed_quest_ids || jsonb_build_array(v_active_quest.slug);
    end if;

    v_world_state := jsonb_set(v_world_state, '{step}', '2'::jsonb, true);
    v_world_state := jsonb_set(v_world_state, '{stage_turns}', '0'::jsonb, true);
    v_world_state := jsonb_set(
      v_world_state,
      '{pending_story_key}',
      to_jsonb(
        (
          'completion-ack:'
          || v_active_quest.slug
          || ':'
          || v_claim.id::text
        )::text
      ),
      true
    );
    v_world_state := jsonb_set(
      v_world_state,
      '{completed_quest_ids}',
      v_completed_quest_ids,
      true
    );
    v_story_progressed := true;
  end if;

  update public.quest_progress qp
  set world_state = v_world_state
  where qp.user_id = v_user_id;

  update public.active_quests aq
  set
    status = 'claimed',
    claimed_at = coalesce(aq.claimed_at, now())
  where aq.id = p_active_quest_id
    and aq.user_id = v_user_id;

  return jsonb_build_object(
    'status', 'awarded',
    'awarded', true,
    'claim_id', v_claim.id,
    'quest_id', v_claim.quest_id,
    'active_quest_id', p_active_quest_id,
    'reward_xp', v_claim.reward_xp,
    'rewards', public._build_growth_reward_summary(v_growth_event_id),
    'story_progressed', v_story_progressed,
    'world_state', v_world_state,
    'progression', public._build_player_progression_snapshot(v_user_id)
  );
end;
$$;

revoke all on function public.claim_quest_and_award_progression(uuid, text)
from public, anon;
grant execute on function public.claim_quest_and_award_progression(uuid, text)
to authenticated;

commit;
