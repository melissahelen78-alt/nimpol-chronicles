/**
 * Supabase sync for quest session state, active quests, verification, and claims.
 */

export const BUILD_WEEK_SUBJECT_ORDER = ["brain", "math", "reading"];

const BUILD_WEEK_STORY_QUESTS = new Set([
  "math-ba-online",
  "math-ba-workbook",
  "math-ba-puzzle"
]);

const DEFAULT_WORLD_STATE = {
  step: 0,
  stageTurns: 0,
  pendingStoryKey: null,
  scrollComplete: false,
  targetQuestSlug: null,
  targetSubject: null,
  unlockedLocations: [],
  unlockedSubjects: ["brain"],
  completedQuestIds: [],
  knowledgeLibraryEligible: false
};

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
}

export function normalizeWorldState(value = null) {
  const source = value && typeof value === "object" ? value : {};
  return {
    step: Number.isFinite(Number(source.step)) ? Number(source.step) : DEFAULT_WORLD_STATE.step,
    stageTurns: Number.isFinite(Number(source.stageTurns ?? source.stage_turns))
      ? Math.max(0, Number(source.stageTurns ?? source.stage_turns))
      : DEFAULT_WORLD_STATE.stageTurns,
    pendingStoryKey:
      source.pendingStoryKey ?? source.pending_story_key ?? DEFAULT_WORLD_STATE.pendingStoryKey,
    scrollComplete: Boolean(
      source.scrollComplete ?? source.scroll_complete ?? DEFAULT_WORLD_STATE.scrollComplete
    ),
    targetQuestSlug:
      source.targetQuestSlug ?? source.target_quest_slug ?? DEFAULT_WORLD_STATE.targetQuestSlug,
    targetSubject:
      source.targetSubject ?? source.target_subject ?? DEFAULT_WORLD_STATE.targetSubject,
    unlockedLocations: uniqueStrings(
      source.unlockedLocations ?? source.unlocked_locations ?? DEFAULT_WORLD_STATE.unlockedLocations
    ),
    unlockedSubjects: uniqueStrings(
      source.unlockedSubjects ?? source.unlocked_subjects ?? DEFAULT_WORLD_STATE.unlockedSubjects
    ),
    completedQuestIds: uniqueStrings(
      source.completedQuestIds ?? source.completed_quest_ids ?? DEFAULT_WORLD_STATE.completedQuestIds
    ),
    knowledgeLibraryEligible: Boolean(
      source.knowledgeLibraryEligible
      ?? source.knowledge_library_eligible
      ?? DEFAULT_WORLD_STATE.knowledgeLibraryEligible
    )
  };
}

function serializeWorldState(value) {
  const worldState = normalizeWorldState(value);
  return {
    step: worldState.step,
    stage_turns: worldState.stageTurns,
    pending_story_key: worldState.pendingStoryKey,
    scroll_complete: worldState.scrollComplete,
    target_quest_slug: worldState.targetQuestSlug,
    target_subject: worldState.targetSubject,
    unlocked_locations: worldState.unlockedLocations,
    unlocked_subjects: worldState.unlockedSubjects,
    completed_quest_ids: worldState.completedQuestIds,
    knowledge_library_eligible: worldState.knowledgeLibraryEligible
  };
}

export async function getSessionUser(client) {
  const {
    data: { session },
    error
  } = await client.auth.getSession();

  if (error) throw error;
  return session?.user ?? null;
}

export async function fetchTodayClaims(client, userId, claimDate) {
  const { data, error } = await client
    .from("quest_claims")
    .select("quest_id")
    .eq("user_id", userId)
    .eq("claim_date", claimDate);

  if (error) throw error;
  return (data ?? []).map((row) => row.quest_id);
}

export async function fetchQuestProgress(client, userId) {
  const { data, error } = await client
    .from("quest_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchQuestTemplates(client) {
  const { data, error } = await client
    .from("quest_templates")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;
  return data ?? [];
}

export function compareBuildWeekQuestOrder(a, b) {
  const subjectRank = (subject) => {
    const index = BUILD_WEEK_SUBJECT_ORDER.indexOf(subject);
    return index === -1 ? 999 : index;
  };
  return (
    subjectRank(a.subject) - subjectRank(b.subject) ||
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    String(a.id).localeCompare(String(b.id))
  );
}

export function isBuildWeekPlanSubject(subject) {
  return BUILD_WEEK_SUBJECT_ORDER.includes(subject);
}

export function getNextIncompleteQuest(gameState) {
  const completed = new Set([
    ...(gameState.worldState?.completedQuestIds ?? []),
    ...(gameState.claimedToday ?? [])
  ]);

  const candidates = (gameState.activeQuests ?? []).filter(
    (quest) =>
      quest.activeQuestId &&
      quest.status !== "claimed" &&
      !completed.has(quest.id) &&
      isBuildWeekPlanSubject(quest.subject)
  );

  return [...candidates].sort(compareBuildWeekQuestOrder)[0] ?? null;
}

export function getQuestTarget(gameState, slug = gameState.worldState?.targetQuestSlug) {
  const completed = new Set([
    ...(gameState.worldState?.completedQuestIds ?? []),
    ...(gameState.claimedToday ?? [])
  ]);

  if (slug) {
    const assigned = (gameState.activeQuests ?? []).find(
      (quest) =>
        quest.id === slug &&
        quest.activeQuestId &&
        quest.status !== "claimed" &&
        !completed.has(quest.id)
    );
    if (assigned) return assigned;
  }

  return getNextIncompleteQuest(gameState);
}

/**
 * Build Week subject completion: a subject is "done" for story progression
 * purposes once the player has claimed ANY one quest from that subject.
 * Other assigned quests in that subject remain valid, unclaimed options.
 *
 * Claimed quests may no longer appear in active_quests (daily plan filters
 * completed slugs), so completion also checks quest_templates + completed ids.
 */
export function isSubjectComplete(gameState, subject) {
  if (!subject) return false;
  const completed = new Set([
    ...(gameState.worldState?.completedQuestIds ?? []),
    ...(gameState.claimedToday ?? [])
  ]);

  const fromActive = (gameState.activeQuests ?? []).some(
    (quest) =>
      quest.subject === subject &&
      (quest.status === "claimed" || completed.has(quest.id))
  );
  if (fromActive) return true;

  return (gameState.questTemplates ?? []).some(
    (template) => template.subject === subject && completed.has(template.slug)
  );
}

export function getNextIncompleteSubject(gameState) {
  return BUILD_WEEK_SUBJECT_ORDER.find((subject) => !isSubjectComplete(gameState, subject)) ?? null;
}

export function getTargetSubject(gameState, subject = gameState.worldState?.targetSubject) {
  if (subject && isBuildWeekPlanSubject(subject) && !isSubjectComplete(gameState, subject)) {
    return subject;
  }
  return getNextIncompleteSubject(gameState);
}

export function getSubjectLabel(gameState, subjectSlug) {
  const match = (gameState.subjects ?? []).find((s) => s.slug === subjectSlug);
  return match?.label ?? titleCaseSubject(subjectSlug);
}

export function isBuildWeekStoryQuest(slug) {
  return BUILD_WEEK_STORY_QUESTS.has(slug);
}

/**
 * Ensure today's Build Week plan assigns brain → math → reading quests up front.
 */
export async function ensureBuildWeekDailyPlan(
  client,
  userId,
  questDate,
  completedQuestIds = []
) {
  const templates = await fetchQuestTemplates(client);
  const completed = new Set(completedQuestIds ?? []);
  const planSubjects = new Set(BUILD_WEEK_SUBJECT_ORDER);

  const filtered = templates
    .filter((template) => planSubjects.has(template.subject) && !completed.has(template.slug))
    .sort(
      (a, b) =>
        BUILD_WEEK_SUBJECT_ORDER.indexOf(a.subject) -
          BUILD_WEEK_SUBJECT_ORDER.indexOf(b.subject) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        String(a.slug).localeCompare(String(b.slug))
    );

  if (!filtered.length) return [];

  const rows = filtered.map((template) => ({
    user_id: userId,
    template_id: template.id,
    quest_date: questDate,
    status: "assigned"
  }));

  const { error } = await client
    .from("active_quests")
    .upsert(rows, { onConflict: "user_id,template_id,quest_date", ignoreDuplicates: true });

  if (error) throw error;

  return fetchActiveQuests(client, userId, questDate);
}

export function titleCaseSubject(slug) {
  if (!slug) return "";
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Derive subject list from active quest_templates (no separate subjects table).
 */
export function buildSubjectsFromTemplates(templates) {
  const bySubject = new Map();

  for (const t of templates ?? []) {
    if (!t.subject) continue;
    const existing = bySubject.get(t.subject);
    if (!existing) {
      bySubject.set(t.subject, {
        slug: t.subject,
        label: t.subject_label ?? titleCaseSubject(t.subject),
        icon: t.subject_icon ?? "📚",
        sortOrder: t.subject_sort_order ?? 999,
        questCount: 1,
        tools: t.tool_name ? [t.tool_name] : []
      });
    } else {
      existing.questCount += 1;
      if (t.tool_name && !existing.tools.includes(t.tool_name)) {
        existing.tools.push(t.tool_name);
      }
      if (t.subject_label) existing.label = t.subject_label;
      if (t.subject_icon) existing.icon = t.subject_icon;
      if (t.subject_sort_order != null && t.subject_sort_order < existing.sortOrder) {
        existing.sortOrder = t.subject_sort_order;
      }
    }
  }

  return [...bySubject.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
  );
}

export async function fetchSubjects(client) {
  const templates = await fetchQuestTemplates(client);
  return buildSubjectsFromTemplates(templates);
}

export function isValidSubjectSlug(gameState, slug) {
  if (!slug) return false;
  const subjects = gameState.subjects ?? [];
  if (subjects.length) return subjects.some((s) => s.slug === slug);
  return (gameState.questTemplates ?? []).some((t) => t.subject === slug);
}

export async function fetchActiveQuests(client, userId, questDate) {
  const { data, error } = await client
    .from("active_quests")
    .select("*, quest_templates(*)")
    .eq("user_id", userId)
    .eq("quest_date", questDate)
    .order("created_at");

  if (error) throw error;
  return data ?? [];
}

export async function fetchParentPin(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("parent_pin")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.parent_pin ?? "1234";
}

export function mapActiveQuestToCard(row) {
  const t = row.quest_templates ?? {};
  return {
    id: t.slug ?? row.id,
    activeQuestId: row.id,
    templateId: row.template_id,
    subject: t.subject,
    toolName: t.tool_name,
    icon: t.icon ?? "📜",
    title: t.title ?? "Quest",
    description: t.description ?? "",
    reward: t.reward_xp ?? 0,
    portalUrl: t.portal_url ?? null,
    verificationType: t.verification_type ?? "instant",
    delayMinutes: t.delay_minutes ?? 0,
    sortOrder: t.sort_order ?? 0,
    subjectSortOrder: t.subject_sort_order ?? 999,
    status: row.status,
    timerStartedAt: row.timer_started_at,
    timerReadyAt: row.timer_ready_at,
    claimedAt: row.claimed_at
  };
}

export function applyDailyReset(gameState, todayKey) {
  if (gameState.lastResetDate === todayKey) return false;

  gameState.claimedToday = [];
  gameState.highlightedQuestId = null;
  gameState.lastResetDate = todayKey;

  return true;
}

export function applyQuestProgressRow(row, gameState) {
  if (!row) return;

  gameState.selectedSubject = row.selected_subject ?? null;
  gameState.highlightedQuestId = row.highlighted_quest_id ?? null;
  gameState.lastWheelResult = row.last_wheel_result ?? null;
  gameState.wheelSpins = row.wheel_spins ?? 0;
  gameState.wheelRotation = row.wheel_rotation ?? 0;
  gameState.lastResetDate = row.last_reset_date ?? gameState.lastResetDate;
  gameState.worldState = normalizeWorldState(row.world_state);

  // Build Week: a subject stored before the demo migration must not bypass its unlock.
  if (
    gameState.selectedSubject &&
    !gameState.worldState.unlockedSubjects.includes(gameState.selectedSubject)
  ) {
    gameState.selectedSubject = null;
  }
}

export function applyActiveQuests(rows, gameState) {
  gameState.activeQuests = (rows ?? []).map(mapActiveQuestToCard).sort(compareBuildWeekQuestOrder);
  gameState.claimedToday = gameState.activeQuests
    .filter((q) => q.status === "claimed")
    .map((q) => q.id);
}

export function questProgressPayload(userId, gameState) {
  const payload = {
    user_id: userId,
    selected_subject: gameState.selectedSubject,
    highlighted_quest_id: gameState.highlightedQuestId,
    chat_step: 1,
    chat_feeling: null,
    chat_approach: null,
    last_wheel_result: gameState.lastWheelResult,
    wheel_spins: gameState.wheelSpins ?? 0,
    wheel_rotation: gameState.wheelRotation ?? 0,
    last_reset_date: gameState.lastResetDate
  };

  // Build Week stage state is written only by persistWorldState(). Keeping it
  // out of generic UI sync prevents a stale tab from regressing the story.
  return payload;
}

export async function upsertQuestProgress(client, userId, gameState) {
  const { error } = await client
    .from("quest_progress")
    .upsert(questProgressPayload(userId, gameState), { onConflict: "user_id" });

  if (error) throw error;
}

/**
 * Persist one Build Week world-state transition.
 * This helper does not decide stages; storyEngine owns story transitions and
 * The claim RPC owns the successful Math-completion transition.
 */
export async function persistWorldState(client, userId, value) {
  const worldState = normalizeWorldState(value);
  const { error } = await client
    .from("quest_progress")
    .upsert(
      {
        user_id: userId,
        world_state: serializeWorldState(worldState)
      },
      { onConflict: "user_id" }
    );

  if (error) throw error;
  return worldState;
}

/**
 * Ensure today's active_quest rows exist for a subject (or all subjects if null).
 */
export async function ensureDailyQuests(
  client,
  userId,
  questDate,
  subject = null,
  completedQuestIds = []
) {
  const templates = await fetchQuestTemplates(client);
  const completed = new Set(completedQuestIds ?? []);
  // Build Week: lifetime-completed templates are never assigned again on a new day.
  const filtered = templates.filter(
    (t) => (!subject || t.subject === subject) && !completed.has(t.slug)
  );

  if (!filtered.length) return [];

  const rows = filtered.map((t) => ({
    user_id: userId,
    template_id: t.id,
    quest_date: questDate,
    status: "assigned"
  }));

  const { error } = await client
    .from("active_quests")
    .upsert(rows, { onConflict: "user_id,template_id,quest_date", ignoreDuplicates: true });

  if (error) throw error;

  return fetchActiveQuests(client, userId, questDate);
}

export function getQuestTimerRemainingMs(quest) {
  if (!quest?.timerReadyAt) return 0;
  return Math.max(0, new Date(quest.timerReadyAt).getTime() - Date.now());
}

export function isQuestClaimable(quest) {
  if (quest.status === "claimed") return false;
  if (quest.verificationType === "instant") return true;
  if (quest.verificationType === "parent_code") return quest.status === "ready";
  if (quest.verificationType === "time_delay") {
    return quest.status === "ready" || getQuestTimerRemainingMs(quest) <= 0;
  }
  return false;
}

export function syncQuestTimerStatus(quest) {
  if (quest.verificationType !== "time_delay") return quest;
  if (quest.status === "claimed") return quest;
  if (quest.status === "in_progress" && getQuestTimerRemainingMs(quest) <= 0) {
    quest.status = "ready";
  }
  return quest;
}

export async function startQuestTimer(client, activeQuestId) {
  const { data: row, error: readError } = await client
    .from("active_quests")
    .select("*, quest_templates(*)")
    .eq("id", activeQuestId)
    .single();

  if (readError) throw readError;

  const delayMinutes = row.quest_templates?.delay_minutes ?? 10;
  const now = new Date();
  const readyAt = new Date(now.getTime() + delayMinutes * 60 * 1000);

  const { data, error } = await client
    .from("active_quests")
    .update({
      status: "in_progress",
      timer_started_at: now.toISOString(),
      timer_ready_at: readyAt.toISOString()
    })
    .eq("id", activeQuestId)
    .select("*, quest_templates(*)")
    .single();

  if (error) throw error;
  return mapActiveQuestToCard(data);
}

export async function markQuestReady(client, activeQuestId) {
  const { data, error } = await client
    .from("active_quests")
    .update({ status: "ready" })
    .eq("id", activeQuestId)
    .select("*, quest_templates(*)")
    .single();

  if (error) throw error;
  return mapActiveQuestToCard(data);
}

export async function verifyParentPin(client, userId, pin) {
  const expected = await fetchParentPin(client, userId);
  return String(pin).trim() === String(expected).trim();
}

async function persistQuestCompletionRecovery(client, userId, currentWorldState, questId) {
  const worldState = {
    ...currentWorldState,
    step: 0,
    stageTurns: 0,
    pendingStoryKey: `completion-ack:${questId}:${Date.now()}`,
    completedQuestIds: uniqueStrings([
      ...currentWorldState.completedQuestIds,
      questId
    ])
  };
  return persistWorldState(client, userId, worldState);
}

export async function claimQuestAndAwardProgression(
  client,
  activeQuestId,
  verificationInput = null
) {
  if (!activeQuestId) throw new Error("An active quest is required.");

  const { data, error } = await client.rpc("claim_quest_and_award_progression", {
    p_active_quest_id: activeQuestId,
    p_verification_input: verificationInput
  });

  if (error) throw error;
  if (!data?.progression) {
    throw new Error("Quest claim returned no progression state.");
  }

  return {
    ...data,
    rewardXp: data.reward_xp,
    storyProgressed: Boolean(data.story_progressed),
    worldState: normalizeWorldState(data.world_state)
  };
}

export async function hydrateQuestState(client, gameState, todayKey, session = null) {
  const user = session?.user || await getSessionUser(client);
  if (!user) return false;

  const [claims, progress, templates] = await Promise.all([
    fetchTodayClaims(client, user.id, todayKey),
    fetchQuestProgress(client, user.id),
    fetchQuestTemplates(client)
  ]);

  applyQuestProgressRow(progress, gameState);
  applyDailyReset(gameState, todayKey);

  gameState.questTemplates = templates;
  gameState.subjects = buildSubjectsFromTemplates(templates);
  gameState.worldState = normalizeWorldState(gameState.worldState);

  const planRows = await ensureBuildWeekDailyPlan(
    client,
    user.id,
    todayKey,
    gameState.worldState.completedQuestIds
  );
  applyActiveQuests(planRows, gameState);

  const nextSubject = getNextIncompleteSubject(gameState);
  if (nextSubject) {
    const currentSubjectTarget = gameState.worldState.targetSubject;
    const targetSubjectStillValid = currentSubjectTarget
      ? !isSubjectComplete(gameState, currentSubjectTarget)
      : false;
    if (!targetSubjectStillValid) {
      gameState.worldState = normalizeWorldState({
        ...gameState.worldState,
        targetSubject: nextSubject
      });
    }
  }

  if (gameState.selectedSubject) {
    await ensureDailyQuests(
      client,
      user.id,
      todayKey,
      gameState.selectedSubject,
      gameState.worldState.completedQuestIds
    );
    const activeRows = await fetchActiveQuests(client, user.id, todayKey);
    applyActiveQuests(activeRows, gameState);
  }

  const completedPlanQuest = claims.find((questId) => {
    const subject = templates.find((template) => template.slug === questId)?.subject ?? "";
    return isBuildWeekPlanSubject(subject);
  });
  if (gameState.worldState.step === 1 && completedPlanQuest) {
    gameState.worldState = await persistQuestCompletionRecovery(
      client,
      user.id,
      gameState.worldState,
      completedPlanQuest
    );
  }

  return true;
}

export async function syncQuestState(client, gameState, todayKey) {
  const user = await getSessionUser(client);
  if (!user) return false;

  applyDailyReset(gameState, todayKey);
  await upsertQuestProgress(client, user.id, gameState);
  return true;
}

export function getQuestsForSubject(gameState, subject) {
  return (gameState.activeQuests ?? []).filter((q) => q.subject === subject);
}

export function getQuestBySlug(gameState, slug) {
  return (gameState.activeQuests ?? []).find((q) => q.id === slug) ?? null;
}
