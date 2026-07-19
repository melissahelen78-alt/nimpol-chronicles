/**
 * Supabase sync for quest session state, active quests, verification, and claims.
 */

// Build Week demo progression: only these existing Math templates advance the demo.
const BUILD_WEEK_MATH_QUESTS = new Set([
  "math-ba-online",
  "math-ba-workbook",
  "math-morning-sheet"
]);
const DEFAULT_WORLD_STATE = {
  step: 0,
  stageTurns: 0,
  pendingStoryKey: null,
  unlockedLocations: [],
  unlockedSubjects: ["math"],
  completedQuestIds: []
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
    unlockedLocations: uniqueStrings(
      source.unlockedLocations ?? source.unlocked_locations ?? DEFAULT_WORLD_STATE.unlockedLocations
    ),
    unlockedSubjects: uniqueStrings(
      source.unlockedSubjects ?? source.unlocked_subjects ?? DEFAULT_WORLD_STATE.unlockedSubjects
    ),
    completedQuestIds: uniqueStrings(
      source.completedQuestIds ?? source.completed_quest_ids ?? DEFAULT_WORLD_STATE.completedQuestIds
    )
  };
}

function serializeWorldState(value) {
  const worldState = normalizeWorldState(value);
  return {
    step: worldState.step,
    stage_turns: worldState.stageTurns,
    pending_story_key: worldState.pendingStoryKey,
    unlocked_locations: worldState.unlockedLocations,
    unlocked_subjects: worldState.unlockedSubjects,
    completed_quest_ids: worldState.completedQuestIds
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
  gameState.activeQuests = (rows ?? []).map(mapActiveQuestToCard);
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
 * recordQuestClaim owns only the successful Math-completion transition.
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

async function persistMathCompletionTransition(client, userId, currentWorldState, questId) {
  const worldState = {
    ...currentWorldState,
    step: 2,
    stageTurns: 0,
    pendingStoryKey: `completion-ack:${questId}:${Date.now()}`,
    completedQuestIds: uniqueStrings([
      ...currentWorldState.completedQuestIds,
      questId
    ])
  };
  return persistWorldState(client, userId, worldState);
}

export async function recordQuestClaim(
  client,
  userId,
  questId,
  rewardXp,
  claimDate,
  newXpTotal,
  activeQuestId = null
) {
  const { error: claimError } = await client.from("quest_claims").insert({
    user_id: userId,
    quest_id: questId,
    reward_xp: rewardXp,
    claim_date: claimDate
  });

  if (claimError) throw claimError;

  if (activeQuestId) {
    const { error: aqError } = await client
      .from("active_quests")
      .update({ status: "claimed", claimed_at: new Date().toISOString() })
      .eq("id", activeQuestId);

    if (aqError) throw aqError;
  }

  const { error: xpError } = await client
    .from("profiles")
    .update({ xp_current: newXpTotal })
    .eq("id", userId);

  if (xpError) throw xpError;

  if (!BUILD_WEEK_MATH_QUESTS.has(questId)) {
    return { worldState: null, demoProgressed: false };
  }

  // Build Week: this is a separate, fallible write after the normal claim writes.
  // It is deliberately not described as atomic because no database RPC is used.
  const progress = await fetchQuestProgress(client, userId);
  const currentWorldState = normalizeWorldState(progress?.world_state);

  if (currentWorldState.step !== 1) {
    return { worldState: null, demoProgressed: false };
  }

  const persistedWorldState = await persistMathCompletionTransition(
    client,
    userId,
    currentWorldState,
    questId
  );
  return { worldState: persistedWorldState, demoProgressed: true };
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

  if (gameState.selectedSubject) {
    await ensureDailyQuests(
      client,
      user.id,
      todayKey,
      gameState.selectedSubject,
      gameState.worldState.completedQuestIds
    );
  }

  const activeRows = await fetchActiveQuests(client, user.id, todayKey);
  applyActiveQuests(activeRows, gameState);

  // Build Week: recover when the claim/status write succeeded but the separate
  // world-state transition failed. Today's claim audit is the source of truth.
  const completedMathQuest = claims.find((questId) => BUILD_WEEK_MATH_QUESTS.has(questId));
  if (gameState.worldState.step === 1 && completedMathQuest) {
    gameState.worldState = await persistMathCompletionTransition(
      client,
      user.id,
      gameState.worldState,
      completedMathQuest
    );
  }

  if (gameState.lastResetDate === todayKey && !gameState.activeQuests.length && gameState.selectedSubject) {
    const ensured = await ensureDailyQuests(
      client,
      user.id,
      todayKey,
      gameState.selectedSubject,
      gameState.worldState.completedQuestIds
    );
    applyActiveQuests(ensured, gameState);
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
