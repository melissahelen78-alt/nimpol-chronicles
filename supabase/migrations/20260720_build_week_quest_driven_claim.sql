-- Build Week: quest-driven story progression on claim (replaces math-only gate).
-- Run manually in Supabase SQL Editor when ready; not deployed by default.

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

  -- Build Week: any brain / math / reading claim while quest cards are open.
  if v_active_quest.subject in ('brain', 'math', 'reading')
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

    v_world_state := jsonb_set(v_world_state, '{step}', '0'::jsonb, true);
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
