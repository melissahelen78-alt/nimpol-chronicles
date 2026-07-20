/**
 * Client-side story context helpers.
 * Full fallback context stays local for offline turns and story_history storage.
 * Only whitelisted runtime hints are sent to generate-story-turn.
 */

const RUNTIME_CONTEXT_KEYS = new Set([
  "lastChoice",
  "storyHistory",
  "recentCompletion",
  "inventory",
  "activity",
  "quests"
]);

function summarizeTemplatesBySubject(gameState, completedQuestIds, unlockedSubjectSlugs) {
  const map = new Map();
  for (const t of gameState.questTemplates ?? []) {
    if (
      !t.subject ||
      completedQuestIds.has(t.slug) ||
      !unlockedSubjectSlugs.has(t.subject)
    ) {
      continue;
    }
    if (!map.has(t.subject)) map.set(t.subject, []);
    map.get(t.subject).push({
      id: t.slug,
      title: t.title,
      toolName: t.tool_name,
      rewardXp: t.reward_xp
    });
  }
  return Object.fromEntries(map);
}

export function buildFallbackStoryContext(
  config,
  gameState,
  activity,
  history,
  lastChoice = null,
  inventory = []
) {
  const hoursSince = (iso) => {
    if (!iso) return null;
    return Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  };

  const worldState = gameState.worldState ?? {};
  const completedQuestIds = new Set(worldState.completedQuestIds ?? []);
  const unlockedSubjectSlugs = new Set(
    worldState.unlockedSubjects ?? (gameState.subjects ?? []).map((s) => s.slug)
  );
  const subjects = (gameState.subjects ?? [])
    .filter((s) => unlockedSubjectSlugs.has(s.slug))
    .map((s) => ({
      slug: s.slug,
      label: s.label,
      icon: s.icon,
      questCount: (gameState.questTemplates ?? []).filter(
        (t) => t.subject === s.slug && !completedQuestIds.has(t.slug)
      ).length
    }));
  const availableTemplates = (gameState.questTemplates ?? []).filter(
    (t) =>
      !completedQuestIds.has(t.slug) &&
      unlockedSubjectSlugs.has(t.subject)
  );

  return {
    player: {
      name: config.player.name,
      rank: config.player.rank,
      xp: gameState.xp,
      xpToNextRank: config.player.xpToNextRank,
      attributes: config.attributes.map((a) => ({
        id: a.id,
        label: a.label,
        current: a.current,
        max: a.max
      }))
    },
    subjects,
    quests: {
      selectedSubject: gameState.selectedSubject,
      claimedToday: gameState.claimedToday,
      highlightedQuestId: gameState.highlightedQuestId,
      wheelSpins: gameState.wheelSpins,
      lastWheelResult: gameState.lastWheelResult,
      activeQuests: (gameState.activeQuests ?? []).map((q) => ({
        id: q.id,
        title: q.title,
        toolName: q.toolName,
        subject: q.subject,
        status: q.status,
        verificationType: q.verificationType,
        reward: q.reward
      })).filter(
        (q) =>
          !completedQuestIds.has(q.id) &&
          unlockedSubjectSlugs.has(q.subject)
      ),
      templatesBySubject: summarizeTemplatesBySubject(
        gameState,
        completedQuestIds,
        unlockedSubjectSlugs
      ),
      availableTools: [...new Set(availableTemplates.map((t) => t.tool_name).filter(Boolean))]
    },
    worldState: {
      step: worldState.step ?? 0,
      stageTurns: worldState.stageTurns ?? 0,
      pendingStoryKey: worldState.pendingStoryKey ?? null,
      unlockedLocations: worldState.unlockedLocations ?? [],
      unlockedSubjects: [...unlockedSubjectSlugs]
    },
    buildWeek: {
      step: worldState.step ?? 0,
      stageTurns: worldState.stageTurns ?? 0,
      pendingStoryKey: worldState.pendingStoryKey ?? null
    },
    openingStoryText: config.defaultStory?.storyText ?? null,
    completedQuestIds: [...completedQuestIds],
    recentCompletion: gameState.recentCompletion ?? null,
    inventory: inventory.map((row) => ({
      slug: row.items?.slug ?? row.slug ?? null,
      name: row.items?.name ?? row.name,
      rarity: row.items?.rarity ?? row.rarity,
      quantity: row.quantity ?? 1
    })),
    activity: {
      lastDiscoveryViewedAt: activity?.last_discovery_viewed_at ?? null,
      hoursSinceDiscoveryView: hoursSince(activity?.last_discovery_viewed_at),
      lastDiscoveryTitle: activity?.last_discovery_fact_title ?? null,
      lastTransmissionWatchedAt: activity?.last_transmission_watched_at ?? null,
      hoursSinceTransmissionWatch: hoursSince(activity?.last_transmission_watched_at),
      lastTransmissionTitle: activity?.last_transmission_title ?? null
    },
    lastChoice,
    storyHistory: history.slice(-6).map((row) => ({
      turnIndex: row.turn_index,
      storyText: row.story_text,
      selectedChoiceId: row.selected_choice_id,
      selectedChoiceLabel: row.selected_choice_label
    }))
  };
}

/** @deprecated Use buildFallbackStoryContext */
export const buildStoryContext = buildFallbackStoryContext;

export function extractRuntimeContext(fallbackContext) {
  const activity = fallbackContext?.activity ?? {};
  const quests = fallbackContext?.quests ?? {};
  const lastChoice = fallbackContext?.lastChoice ?? null;

  const runtime = {
    lastChoice:
      lastChoice &&
      (lastChoice.id || lastChoice.label || lastChoice.action || lastChoice.value)
        ? {
            id: lastChoice.id ?? "",
            label: lastChoice.label ?? "",
            action: lastChoice.action ?? "continue",
            value: lastChoice.value ?? null
          }
        : null,
    storyHistory: (fallbackContext?.storyHistory ?? []).map((row) => ({
      turnIndex: row.turnIndex ?? row.turn_index ?? 0,
      storyText: row.storyText ?? row.story_text ?? "",
      selectedChoiceId: row.selectedChoiceId ?? row.selected_choice_id ?? null,
      selectedChoiceLabel:
        row.selectedChoiceLabel ?? row.selected_choice_label ?? null
    })),
    recentCompletion: fallbackContext?.recentCompletion ?? null,
    inventory: (fallbackContext?.inventory ?? []).map((row) => ({
      slug: row.slug ?? null,
      name: row.name ?? "",
      rarity: row.rarity ?? "common",
      quantity: row.quantity ?? 1
    })),
    activity: {
      lastDiscoveryTitle: activity.lastDiscoveryTitle ?? null,
      hoursSinceDiscoveryView: activity.hoursSinceDiscoveryView ?? null,
      lastTransmissionTitle: activity.lastTransmissionTitle ?? null,
      hoursSinceTransmissionWatch: activity.hoursSinceTransmissionWatch ?? null
    },
    quests: {
      selectedSubject: quests.selectedSubject ?? null,
      highlightedQuestId: quests.highlightedQuestId ?? null,
      wheelSpins: quests.wheelSpins ?? 0,
      lastWheelResult: quests.lastWheelResult ?? null,
      claimedToday: quests.claimedToday ?? []
    }
  };

  return runtime;
}

export function getRuntimeContextKeys() {
  return [...RUNTIME_CONTEXT_KEYS];
}

export function assertRuntimeOnlyPayload(context) {
  const keys = Object.keys(context ?? {});
  const extras = keys.filter((key) => !RUNTIME_CONTEXT_KEYS.has(key));
  if (extras.length) {
    throw new Error(`Runtime context contains non-whitelisted keys: ${extras.join(", ")}`);
  }
  return true;
}
