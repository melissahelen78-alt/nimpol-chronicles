/**
 * AI-driven Chronicles interaction loop.
 */

import { getSessionUser, persistWorldState } from "./questSync.js";

const VALID_ACTIONS = new Set(["continue", "select_subject", "open_quests", "spin_wheel"]);
const BUILD_WEEK_MATH = "math";
const BUILD_WEEK_READING = "reading";
const BUILD_WEEK_LOCATION = "starlit-library";
const READY_CHOICE = {
  id: "im-ready",
  label: "I'm Ready",
  action: "select_subject",
  value: BUILD_WEEK_MATH
};

const BUILD_WEEK_FINAL_TURNS = {
  "math-intro-1": 1,
  "math-intro-2": 2,
  "completion-ack": 1,
  "discovery-1": 1,
  "discovery-2": 2,
  "library-reveal": 1
};

function pendingStoryKind(key) {
  return String(key ?? "").split(":")[0];
}

function uniqueValues(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

export function getValidSubjectSlugs(gameState) {
  const unlocked = gameState?.worldState?.unlockedSubjects;
  const isUnlocked = (slug) => !Array.isArray(unlocked) || unlocked.includes(slug);
  const fromSubjects = (gameState?.subjects ?? [])
    .map((s) => s.slug)
    .filter(isUnlocked);
  if (fromSubjects.length) return new Set(fromSubjects);
  const fromTemplates = (gameState?.questTemplates ?? [])
    .map((t) => t.subject)
    .filter((slug) => slug && isUnlocked(slug));
  return new Set(fromTemplates);
}

export function normalizeChoices(rawChoices, validSubjectSlugs = new Set()) {
  if (!Array.isArray(rawChoices)) return [];

  return rawChoices
    .slice(0, 4)
    .map((choice, index) => {
      const action = VALID_ACTIONS.has(choice?.action) ? choice.action : "continue";
      const isReadyChoice =
        choice?.id === READY_CHOICE.id &&
        action === READY_CHOICE.action &&
        choice?.value === READY_CHOICE.value;
      const value =
        (action === "select_subject" || action === "open_quests") &&
        (validSubjectSlugs.has(choice?.value) || isReadyChoice)
          ? choice.value
          : null;

      return {
        id: String(choice?.id ?? `choice-${index + 1}`),
        label: String(choice?.label ?? `Option ${index + 1}`),
        action,
        value
      };
    })
    .filter((choice) => choice.label.trim().length > 0);
}

export function validateStoryTurn(raw, validSubjectSlugs = new Set()) {
  if (!raw?.storyText?.trim()) {
    throw new Error("Invalid story turn: missing storyText");
  }

  const choices = normalizeChoices(raw.choices, validSubjectSlugs);
  if (choices.length < 1) {
    throw new Error("Invalid story turn: need at least 1 choice");
  }

  return {
    storyText: raw.storyText.trim(),
    choices
  };
}

export async function fetchPlayerActivity(client, userId) {
  const { data, error } = await client
    .from("player_activity")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchStoryHistory(client, userId, limit = 12) {
  const { data, error } = await client
    .from("story_history")
    .select("*")
    .eq("user_id", userId)
    .order("turn_index", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).reverse();
}

export async function getNextTurnIndex(client, userId) {
  const { data, error } = await client
    .from("story_history")
    .select("turn_index")
    .eq("user_id", userId)
    .order("turn_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? data.turn_index + 1 : 0;
}

export async function insertStoryTurn(client, userId, turnIndex, turn, aiContext, source = "ai", lootAwarded = null) {
  const { data, error } = await client
    .from("story_history")
    .insert({
      user_id: userId,
      turn_index: turnIndex,
      story_text: turn.storyText,
      choices: turn.choices,
      ai_context: aiContext,
      source,
      loot_awarded: lootAwarded
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function recordStoryChoice(client, turnId, choiceId, choiceLabel) {
  const { data, error } = await client
    .from("story_history")
    .update({
      selected_choice_id: choiceId,
      selected_choice_label: choiceLabel
    })
    .eq("id", turnId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

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

export function buildStoryContext(config, gameState, activity, history, lastChoice = null, inventory = []) {
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
    // Build Week: durable progression plus a one-shot completion event for Nutty.
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

function buildSubjectChoices(subjects, max = 4) {
  return (subjects ?? []).slice(0, max).map((s) => ({
    id: `subject-${s.slug}`,
    label: s.label ? `${s.label} Path` : `${s.slug} Path`,
    action: "select_subject",
    value: s.slug
  }));
}

function buildWeekTurn(context, validSubjectSlugs = new Set()) {
  const key = context.buildWeek?.pendingStoryKey ?? context.worldState?.pendingStoryKey;
  const kind = pendingStoryKind(key);
  const name = context.player?.name ?? "Nimpol";
  const questTitle = context.recentCompletion?.questTitle ?? "your Math quest";
  let raw = null;

  if (!key && context.worldState?.step === 0 && context.worldState?.stageTurns === 0) {
    raw = {
      storyText: String(
        context.openingStoryText ??
          "Good morning, Nimpol! Your focus crystal hums softly. How shall we begin today's chronicle?"
      ).replace(/\bNimpol\b/g, name),
      choices: [{ ...READY_CHOICE }]
    };
  } else if (kind === "math-intro-1") {
    raw = {
      storyText: "Nutty scampers beside you as stone numbers wake underfoot. A locked arch hums farther ahead.",
      choices: [
        { id: "inspect-number-runes", label: "Inspect the Runes", action: "continue" },
        { id: "follow-glowing-trail", label: "Follow the Trail", action: "continue" }
      ]
    };
  } else if (kind === "math-intro-2") {
    raw = {
      storyText: "The runes form three Math trials. Nutty nods: complete any one, and the strange arch may answer.",
      choices: [
        { id: "open-math-quests", label: "View Math Quests", action: "open_quests", value: BUILD_WEEK_MATH },
        { id: "accept-math-trial", label: "Accept a Trial", action: "open_quests", value: BUILD_WEEK_MATH }
      ]
    };
  } else if (kind === "completion-ack") {
    raw = {
      storyText: `Nutty cheers! You completed ${questTitle}. The Math runes lock into place, and a strange light flickers beyond the path.`,
      choices: [
        { id: "investigate-strange-light", label: "Investigate the Light", action: "continue" },
        { id: "ask-nutty-about-light", label: "Ask Nutty", action: "continue" }
      ]
    };
  } else if (kind === "discovery-1") {
    raw = {
      storyText: "The light gathers between two old trees. Nutty finds silver pawprints leading straight through the glow.",
      choices: [
        { id: "follow-silver-prints", label: "Follow the Prints", action: "continue" },
        { id: "study-the-glow", label: "Study the Glow", action: "continue" }
      ]
    };
  } else if (kind === "discovery-2") {
    raw = {
      storyText: "A doorway takes shape inside the light. Stars drift across its surface like letters waiting to be read.",
      choices: [
        { id: "touch-star-door", label: "Touch the Door", action: "continue" },
        { id: "read-star-symbols", label: "Read the Symbols", action: "continue" }
      ]
    };
  } else if (kind === "library-reveal") {
    raw = {
      storyText: "The doorway opens! Nutty reveals the Starlit Library, where living books whisper new Reading quests.",
      choices: [
        { id: "enter-starlit-library", label: "Enter the Library", action: "select_subject", value: BUILD_WEEK_READING },
        { id: "begin-reading-path", label: "Begin Reading Path", action: "select_subject", value: BUILD_WEEK_READING }
      ]
    };
  }

  return raw ? validateStoryTurn(raw, validSubjectSlugs) : null;
}

export function generateFallbackTurn(context, { skipped = false, validSubjectSlugs = new Set() } = {}) {
  const name = context.player?.name ?? "Nimpol";
  const discovery = context.activity?.lastDiscoveryTitle;
  const transmission = context.activity?.lastTransmissionTitle;
  const subject = context.quests?.selectedSubject;
  const lastLabel = context.lastChoice?.label;
  const subjects = context.subjects ?? [];
  const recentCompletion = context.recentCompletion;

  const stagedTurn = buildWeekTurn(context, validSubjectSlugs);
  if (stagedTurn) return stagedTurn;

  // Build Week: keep the core completion loop compelling even without OpenAI.
  if (recentCompletion) {
    const questTitle = recentCompletion.questTitle ?? "your quest";

    return validateStoryTurn(
      {
        storyText: `Nutty cheers! You completed ${questTitle}. The Math runes settle, and a strange light flickers beyond the path.`,
        choices: [
          { id: "investigate-light", label: "Investigate the Light", action: "continue" },
          { id: "ask-nutty", label: "Ask Nutty", action: "continue" }
        ]
      },
      validSubjectSlugs
    );
  }

  if (skipped && subjects.length) {
    return validateStoryTurn(
      {
        storyText: `${name}, the path splits before you. Choose where your adventure leads today.`,
        choices: buildSubjectChoices(subjects)
      },
      validSubjectSlugs
    );
  }

  if (subject) {
    const label =
      subjects.find((s) => s.slug === subject)?.label ?? subject;
    return validateStoryTurn(
      {
        storyText: `The ${label} path glows beneath your boots. Your quests await in the drawer below.`,
        choices: [
          { id: "open-quests", label: "View Quests", action: "open_quests" },
          { id: "spin-wheel", label: "Spin Wheel", action: "spin_wheel" },
          { id: "continue-story", label: "Press Onward", action: "continue" }
        ]
      },
      validSubjectSlugs
    );
  }

  let storyText = String(
    context.openingStoryText ??
      "Good morning, Nimpol! Your focus crystal hums softly. How shall we begin today's chronicle?"
  ).replace(/\bNimpol\b/g, name);

  if (lastLabel) {
    storyText = `You chose "${lastLabel}." The crystal pulses in reply — what is your next move, ${name}?`;
  } else if (discovery && context.activity?.hoursSinceDiscoveryView != null && context.activity.hoursSinceDiscoveryView < 24) {
    storyText = `After studying "${discovery}," your crystal glows brighter. How do you channel that new insight, ${name}?`;
  } else if (transmission && context.activity?.hoursSinceTransmissionWatch != null && context.activity.hoursSinceTransmissionWatch < 24) {
    storyText = `The transmission "${transmission}" still echoes in your mind. What path calls to you next, ${name}?`;
  }

  const subjectChoices = buildSubjectChoices(subjects);
  const choices =
    subjectChoices.length >= 2
      ? [
          ...subjectChoices.slice(0, 3),
          { id: "continue-story", label: "Press Onward", action: "continue" }
        ]
      : [
          { ...READY_CHOICE }
        ];

  return validateStoryTurn({ storyText, choices }, validSubjectSlugs);
}

export async function requestStoryTurn(client, context, validSubjectSlugs = new Set()) {
  try {
    const { data, error } = await client.functions.invoke("generate-story-turn", {
      body: { context }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return {
      turn: validateStoryTurn(data, validSubjectSlugs),
      source: "ai",
      lootAward: data.lootAward ?? null
    };
  } catch (err) {
    console.warn("AI story generation unavailable, using fallback:", err);
    return {
      turn: generateFallbackTurn(context, { validSubjectSlugs }),
      source: "fallback"
    };
  }
}

export function renderStoryTurn(turn) {
  const textEl = document.getElementById("dialogueText");
  if (textEl) {
    textEl.textContent = turn.storyText;
  }
  renderInteractionChoices(turn.choices);
}

export function renderInteractionChoices(choices) {
  const container = document.getElementById("interaction-buttons");
  if (!container) return;

  container.innerHTML = "";
  choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-emerald";
    btn.textContent = choice.label;
    btn.dataset.storyChoice = choice.id;
    btn.dataset.storyAction = choice.action || "continue";
    if (choice.value) btn.dataset.storyValue = choice.value;
    container.appendChild(btn);
  });
}

async function fetchLatestStoryTurn(client, userId) {
  const { data, error } = await client
    .from("story_history")
    .select("*")
    .eq("user_id", userId)
    .order("turn_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function fetchStoryTurnByIndex(client, userId, turnIndex) {
  const { data, error } = await client
    .from("story_history")
    .select("*")
    .eq("user_id", userId)
    .eq("turn_index", turnIndex)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function createStoryEngine(client, config, gameState, callbacks = {}) {
  let currentTurnRow = null;
  let loading = false;

  const {
    saveState = () => {},
    setSubject = () => {},
    renderQuestList = () => {},
    openWheelModal = () => {},
    openSubjectPicker = () => {},
    showToast = () => {},
    defaultTurn = null,
    fetchInventory = async () => [],
    awardItemBySlug = async () => null
  } = callbacks;

  const subjectSlugs = () => getValidSubjectSlugs(gameState);

  function renderStoryRow(row, hideChoices = false) {
    if (!row) return;
    renderStoryTurn({
      storyText: row.story_text,
      choices: hideChoices ? [] : normalizeChoices(row.choices, subjectSlugs())
    });
  }

  async function ensureReadyOpeningRow(row) {
    const worldState = gameState.worldState ?? {};
    const isOpening =
      row &&
      !row.selected_choice_id &&
      (worldState.step ?? 0) === 0 &&
      (worldState.stageTurns ?? 0) === 0 &&
      !gameState.selectedSubject;
    const alreadyReady =
      Array.isArray(row?.choices) &&
      row.choices.length === 1 &&
      row.choices[0]?.id === READY_CHOICE.id &&
      row.choices[0]?.action === READY_CHOICE.action &&
      row.choices[0]?.value === READY_CHOICE.value;
    if (!isOpening || alreadyReady) return row;

    const choices = normalizeChoices([{ ...READY_CHOICE }], subjectSlugs());
    const upgraded = { ...row, choices };
    const { data, error } = await client
      .from("story_history")
      .update({ choices })
      .eq("id", row.id)
      .select("*")
      .single();

    if (error) {
      console.warn("Opening choice upgrade could not be persisted:", error);
      return upgraded;
    }
    return data;
  }

  async function persistStoryWorld(userId, nextWorldState) {
    const persisted = await persistWorldState(client, userId, nextWorldState);
    gameState.worldState = persisted;
    return persisted;
  }

  function pendingWorldState(kind, targetWorldState) {
    return {
      ...targetWorldState,
      pendingStoryKey: `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    };
  }

  function finalWorldStateForPending(worldState) {
    const kind = pendingStoryKind(worldState.pendingStoryKey);
    return {
      ...worldState,
      stageTurns: BUILD_WEEK_FINAL_TURNS[kind] ?? worldState.stageTurns ?? 0,
      pendingStoryKey: null
    };
  }

  function buildRecentCompletion() {
    if (gameState.recentCompletion) return gameState.recentCompletion;
    const completedIds = gameState.worldState?.completedQuestIds ?? [];
    const questId = completedIds[completedIds.length - 1] ?? null;
    const template = (gameState.questTemplates ?? []).find((item) => item.slug === questId);
    return questId
      ? {
          questId,
          questTitle: template?.title ?? "your Math quest",
          subject: template?.subject ?? BUILD_WEEK_MATH
        }
      : null;
  }

  async function requestBuildWeekTurn(context, key) {
    const scriptedTurn = buildWeekTurn(context, subjectSlugs());
    if (!scriptedTurn) throw new Error(`Unknown Build Week story key: ${key}`);

    const generated = await requestStoryTurn(client, context, subjectSlugs());
    return {
      turn: {
        storyText: generated.turn.storyText,
        choices: scriptedTurn.choices
      },
      source: generated.source
    };
  }

  async function insertPendingStageTurn(user, key) {
    const [activity, history, inventory] = await Promise.all([
      fetchPlayerActivity(client, user.id),
      fetchStoryHistory(client, user.id),
      fetchInventory()
    ]);
    const kind = pendingStoryKind(key);
    const context = buildStoryContext(
      config,
      gameState,
      activity,
      history,
      null,
      inventory
    );
    context.recentCompletion = buildRecentCompletion();
    context.buildWeek.pendingStoryKey = key;
    context.worldState.pendingStoryKey = key;

    const { turn, source } = await requestBuildWeekTurn(context, key);
    const refreshedHistory = await fetchStoryHistory(client, user.id);
    const existingTurn = refreshedHistory.find(
      (row) => row.ai_context?.buildWeek?.pendingStoryKey === key
    );
    if (existingTurn) {
      currentTurnRow = existingTurn;
      renderStoryRow(existingTurn);
      await persistStoryWorld(user.id, finalWorldStateForPending(gameState.worldState));
      saveState();
      return true;
    }

    const turnIndex = await getNextTurnIndex(client, user.id);
    currentTurnRow = await insertStoryTurn(
      client,
      user.id,
      turnIndex,
      turn,
      context,
      source
    );
    renderStoryTurn(turn);

    const finalWorldState = finalWorldStateForPending(gameState.worldState);
    try {
      await persistStoryWorld(user.id, finalWorldState);
      saveState();
      return true;
    } catch (err) {
      console.warn(`Build Week ${kind} turn saved; final stage sync is pending:`, err);
      showToast("Story saved. Finishing progress sync on refresh.");
      saveState();
      return false;
    }
  }

  async function beginStageTurn(user, kind, targetWorldState, choice = null, sideEffect = null) {
    const pending = pendingWorldState(kind, targetWorldState);
    await persistStoryWorld(user.id, pending);
    saveState();

    if (sideEffect) await sideEffect();
    if (choice && currentTurnRow) {
      currentTurnRow = await recordStoryChoice(
        client,
        currentTurnRow.id,
        choice.id,
        choice.label
      );
    }

    return insertPendingStageTurn(user, pending.pendingStoryKey);
  }

  async function recoverPendingStageTurn(user, history) {
    const key = gameState.worldState?.pendingStoryKey;
    if (!key) return false;

    const existing = (history ?? []).find(
      (row) => row.ai_context?.buildWeek?.pendingStoryKey === key
    );
    if (!existing) {
      await insertPendingStageTurn(user, key);
      return true;
    }

    currentTurnRow = existing;
    renderStoryRow(existing);
    try {
      await persistStoryWorld(user.id, finalWorldStateForPending(gameState.worldState));
      saveState();
    } catch (err) {
      console.warn("Build Week pending story recovery could not finalize:", err);
      showToast("Story restored. Progress sync will retry on refresh.");
    }
    return true;
  }

  async function createInitialGreetingTurn(user) {
    const [activity, history, inventory] = await Promise.all([
      fetchPlayerActivity(client, user.id),
      fetchStoryHistory(client, user.id),
      fetchInventory()
    ]);
    const context = buildStoryContext(config, gameState, activity, history, null, inventory);
    const turn =
      defaultTurn ??
      generateFallbackTurn(context, { validSubjectSlugs: subjectSlugs() });
    const turnIndex = await getNextTurnIndex(client, user.id);
    currentTurnRow = await insertStoryTurn(
      client,
      user.id,
      turnIndex,
      turn,
      context,
      "fallback"
    );
    renderStoryTurn(turn);
  }

  async function pauseForQuestCards(user, choice, subject, step) {
    const nextWorldState = {
      ...gameState.worldState,
      step,
      stageTurns: 0,
      pendingStoryKey: null
    };
    await persistStoryWorld(user.id, nextWorldState);

    if (choice && currentTurnRow) {
      currentTurnRow = await recordStoryChoice(
        client,
        currentTurnRow.id,
        choice.id,
        choice.label
      );
    }
    await setSubject(subject, true);
    renderInteractionChoices([]);
    renderQuestList();
    saveState();
  }

  async function applySideEffects(choice) {
    if (choice.action === "select_subject" && choice.value) {
      await setSubject(choice.value, true);
      return;
    }
    if (choice.action === "open_quests") {
      if (choice.value) {
        await setSubject(choice.value, true);
      } else {
        renderQuestList();
      }
      showToast("Your quests are ready below.");
      return;
    }
    if (choice.action === "spin_wheel") {
      openWheelModal();
    }
  }

  async function handleBuildWeekChoice(user, choice) {
    const worldState = gameState.worldState ?? {};
    const step = worldState.step ?? 0;
    const stageTurns = worldState.stageTurns ?? 0;

    if (worldState.pendingStoryKey) {
      showToast("Story progress is still syncing.");
      return true;
    }

    if (
      step === 0 &&
      stageTurns === 0 &&
      choice.action === "select_subject" &&
      choice.value === BUILD_WEEK_MATH
    ) {
      await beginStageTurn(
        user,
        "math-intro-1",
        { ...worldState, step: 0, stageTurns: 0 },
        choice,
        () => setSubject(BUILD_WEEK_MATH, true)
      );
      return true;
    }

    if (step === 0 && stageTurns === 1 && choice.action === "continue") {
      await beginStageTurn(
        user,
        "math-intro-2",
        { ...worldState, step: 0, stageTurns: 1 },
        choice
      );
      return true;
    }

    if (
      step === 0 &&
      stageTurns === 2 &&
      choice.action === "open_quests" &&
      choice.value === BUILD_WEEK_MATH
    ) {
      await pauseForQuestCards(user, choice, BUILD_WEEK_MATH, 1);
      return true;
    }

    if (step === 2 && stageTurns === 1 && choice.action === "continue") {
      const completed = await beginStageTurn(
        user,
        "discovery-1",
        { ...worldState, step: 3, stageTurns: 0 },
        choice
      );
      if (completed) {
        gameState.recentCompletion = null;
        saveState();
      }
      return true;
    }

    if (step === 3 && stageTurns === 1 && choice.action === "continue") {
      await beginStageTurn(
        user,
        "discovery-2",
        { ...worldState, step: 3, stageTurns: 1 },
        choice
      );
      return true;
    }

    if (step === 3 && stageTurns === 2 && choice.action === "continue") {
      await beginStageTurn(
        user,
        "library-reveal",
        {
          ...worldState,
          step: 4,
          stageTurns: 0,
          unlockedLocations: uniqueValues([
            ...(worldState.unlockedLocations ?? []),
            BUILD_WEEK_LOCATION
          ]),
          unlockedSubjects: uniqueValues([
            ...(worldState.unlockedSubjects ?? []),
            BUILD_WEEK_READING
          ])
        },
        choice
      );
      return true;
    }

    if (
      step === 4 &&
      stageTurns === 1 &&
      choice.action === "select_subject" &&
      choice.value === BUILD_WEEK_READING
    ) {
      await pauseForQuestCards(user, choice, BUILD_WEEK_READING, 5);
      return true;
    }

    return false;
  }

  async function persistAndAdvance(choice) {
    if (!currentTurnRow || loading) return;
    loading = true;

    renderInteractionChoices(normalizeChoices(currentTurnRow.choices, subjectSlugs()));
    document.querySelectorAll("#interaction-buttons button").forEach((btn) => {
      btn.disabled = true;
    });

    try {
      const user = await getSessionUser(client);
      if (!user) throw new Error("Not signed in");

      if (await handleBuildWeekChoice(user, choice)) return;

      await recordStoryChoice(client, currentTurnRow.id, choice.id, choice.label);

      const [activity, history, inventory] = await Promise.all([
        fetchPlayerActivity(client, user.id),
        fetchStoryHistory(client, user.id),
        fetchInventory()
      ]);

      const context = buildStoryContext(
        config,
        gameState,
        activity,
        history,
        {
          id: choice.id,
          label: choice.label,
          action: choice.action,
          value: choice.value
        },
        inventory
      );

      await applySideEffects(choice);

      const { turn, source, lootAward } = await requestStoryTurn(client, context, subjectSlugs());
      const turnIndex = await getNextTurnIndex(client, user.id);

      let lootAwarded = null;
      if (lootAward?.itemSlug) {
        lootAwarded = await awardItemBySlug(lootAward.itemSlug);
        if (lootAwarded) showToast(`You found ${lootAwarded.icon ?? ""} ${lootAwarded.name}!`);
      }

      currentTurnRow = await insertStoryTurn(
        client,
        user.id,
        turnIndex,
        turn,
        context,
        source,
        lootAwarded
      );

      renderStoryTurn(turn);
      saveState();
    } catch (err) {
      console.warn("Story advance failed:", err);
      showToast("Story sync failed — try again.");
      renderStoryTurn({
        storyText: currentTurnRow.story_text,
        choices: normalizeChoices(currentTurnRow.choices, subjectSlugs())
      });
    } finally {
      loading = false;
    }
  }

  async function startNewTurn({ skipped = false, lastChoice = null } = {}) {
    loading = true;

    const immediateContext = buildStoryContext(config, gameState, null, [], lastChoice, []);
    const fallback = gameState.recentCompletion
      ? generateFallbackTurn(immediateContext, { validSubjectSlugs: subjectSlugs() })
      : defaultTurn ?? generateFallbackTurn({ player: { name: config.player.name } });
    renderStoryTurn(fallback);

    try {
      const user = await getSessionUser(client);
      if (!user) {
        currentTurnRow = null;
        return;
      }

      const [activity, history, inventory] = await Promise.all([
        fetchPlayerActivity(client, user.id),
        fetchStoryHistory(client, user.id),
        fetchInventory()
      ]);

      const context = buildStoryContext(config, gameState, activity, history, lastChoice, inventory);
      const slugs = subjectSlugs();
      const result = skipped
        ? {
            turn: generateFallbackTurn(context, { skipped: true, validSubjectSlugs: slugs }),
            source: "fallback",
            lootAward: null
          }
        : await requestStoryTurn(client, context, slugs);

      const { turn, source, lootAward } = result;
      const turnIndex = await getNextTurnIndex(client, user.id);

      let lootAwarded = null;
      if (lootAward?.itemSlug) {
        lootAwarded = await awardItemBySlug(lootAward.itemSlug);
        if (lootAwarded) showToast(`You found ${lootAwarded.icon ?? ""} ${lootAwarded.name}!`);
      }

      currentTurnRow = await insertStoryTurn(
        client,
        user.id,
        turnIndex,
        turn,
        context,
        source,
        lootAwarded
      );

      renderStoryTurn(turn);
      return true;
    } catch (err) {
      console.warn("Story bootstrap failed:", err);
      return false;
    } finally {
      loading = false;
    }
  }

  async function acknowledgeCompletion() {
    if (loading || pendingStoryKind(gameState.worldState?.pendingStoryKey) !== "completion-ack") {
      return false;
    }

    loading = true;
    try {
      const user = await getSessionUser(client);
      if (!user) return false;
      const history = await fetchStoryHistory(client, user.id);
      return await recoverPendingStageTurn(user, history);
    } catch (err) {
      console.warn("Completion acknowledgement failed:", err);
      showToast("Nutty's acknowledgement will retry on refresh.");
      return false;
    } finally {
      loading = false;
    }
  }

  async function bootstrap() {
    if (defaultTurn) {
      renderStoryTurn(defaultTurn);
    }

    loading = true;

    try {
      const user = await getSessionUser(client);
      if (!user) return;

      const history = await fetchStoryHistory(client, user.id);
      let latest = await fetchLatestStoryTurn(client, user.id);
      latest = await ensureReadyOpeningRow(latest);

      if (latest && !latest.selected_choice_id) {
        currentTurnRow = latest;
        renderStoryRow(latest);
      }

      if (gameState.worldState?.pendingStoryKey) {
        await recoverPendingStageTurn(user, history);
        return;
      }

      if (gameState.worldState?.step === 1 || gameState.worldState?.step === 5) {
        if (latest) {
          currentTurnRow = latest;
          renderStoryRow(latest, true);
        } else {
          renderInteractionChoices([]);
        }
        renderQuestList();
        return;
      }

      if (latest && !latest.selected_choice_id) {
        return;
      }

      const step = gameState.worldState?.step ?? 0;
      const stageTurns = gameState.worldState?.stageTurns ?? 0;

      if (step === 0 && stageTurns === 0) {
        if (gameState.selectedSubject === BUILD_WEEK_MATH) {
          await beginStageTurn(
            user,
            "math-intro-1",
            { ...gameState.worldState, step: 0, stageTurns: 0 }
          );
        } else {
          await createInitialGreetingTurn(user);
        }
        return;
      }

      // Build Week stages never auto-generate over an answered turn. Recovery is
      // driven by pendingStoryKey; otherwise keep the last narrative visible.
      if (latest && step >= 0 && step <= 5) {
        currentTurnRow = latest;
        renderStoryRow(latest);
        return;
      }

      await startNewTurn();
    } catch (err) {
      console.warn("Story hydrate failed:", err);
      if (defaultTurn) renderStoryTurn(defaultTurn);
    } finally {
      loading = false;
    }
  }

  function handleChoiceClick(choiceId) {
    if (!currentTurnRow || loading) return;

    const choices = normalizeChoices(currentTurnRow.choices, subjectSlugs());
    const choice = choices.find((c) => c.id === choiceId);
    if (!choice) return;

    return persistAndAdvance(choice);
  }

  async function enterSubjectPath(subject) {
    if (loading || gameState.worldState?.pendingStoryKey) return false;

    const matchingChoice = normalizeChoices(
      currentTurnRow?.choices,
      subjectSlugs()
    ).find(
      (choice) =>
        choice.action === "select_subject" &&
        choice.value === subject
    );
    if (matchingChoice) {
      await persistAndAdvance(matchingChoice);
      return true;
    }

    loading = true;
    try {
      const user = await getSessionUser(client);
      if (!user) return false;
      const step = gameState.worldState?.step ?? 0;
      const stageTurns = gameState.worldState?.stageTurns ?? 0;

      if (step === 0 && stageTurns === 0 && subject === BUILD_WEEK_MATH) {
        await beginStageTurn(
          user,
          "math-intro-1",
          { ...gameState.worldState, step: 0, stageTurns: 0 },
          null,
          () => setSubject(BUILD_WEEK_MATH, false)
        );
        return true;
      }

      if (step === 4 && stageTurns === 1 && subject === BUILD_WEEK_READING) {
        await pauseForQuestCards(user, null, BUILD_WEEK_READING, 5);
        return true;
      }

      await setSubject(subject, false);
      return true;
    } finally {
      loading = false;
    }
  }

  function skipToSubjects() {
    if (loading || gameState.worldState?.pendingStoryKey) {
      showToast("Finish this story moment first.");
      return;
    }
    openSubjectPicker();
  }

  function renderCurrentTurn() {
    if (currentTurnRow) {
      const cardsVisible =
        gameState.worldState?.step === 1 || gameState.worldState?.step === 5;
      renderStoryRow(currentTurnRow, cardsVisible);
      return;
    }
    if (defaultTurn) renderStoryTurn(defaultTurn);
  }

  return {
    bootstrap,
    handleChoiceClick,
    enterSubjectPath,
    acknowledgeCompletion,
    skipToSubjects,
    renderCurrentTurn,
    get currentTurnRow() {
      return currentTurnRow;
    }
  };
}
