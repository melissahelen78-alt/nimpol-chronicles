/**
 * AI-driven Chronicles interaction loop.
 */

import { getSessionUser } from "./questSync.js";

const VALID_ACTIONS = new Set(["continue", "select_subject", "open_quests", "spin_wheel"]);

export function getValidSubjectSlugs(gameState) {
  const fromSubjects = (gameState?.subjects ?? []).map((s) => s.slug);
  if (fromSubjects.length) return new Set(fromSubjects);
  const fromTemplates = (gameState?.questTemplates ?? [])
    .map((t) => t.subject)
    .filter(Boolean);
  return new Set(fromTemplates);
}

export function normalizeChoices(rawChoices, validSubjectSlugs = new Set()) {
  if (!Array.isArray(rawChoices)) return [];

  return rawChoices
    .slice(0, 4)
    .map((choice, index) => {
      const action = VALID_ACTIONS.has(choice?.action) ? choice.action : "continue";
      const value =
        action === "select_subject" && validSubjectSlugs.has(choice?.value)
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
  if (choices.length < 2) {
    throw new Error("Invalid story turn: need at least 2 choices");
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

function summarizeTemplatesBySubject(gameState) {
  const map = new Map();
  for (const t of gameState.questTemplates ?? []) {
    if (!t.subject) continue;
    if (!map.has(t.subject)) map.set(t.subject, []);
    map.get(t.subject).push({
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

  const subjects = (gameState.subjects ?? []).map((s) => ({
    slug: s.slug,
    label: s.label,
    icon: s.icon,
    questCount: s.questCount
  }));

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
      })),
      templatesBySubject: summarizeTemplatesBySubject(gameState),
      availableTools: [...new Set((gameState.questTemplates ?? []).map((t) => t.tool_name))]
    },
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

export function generateFallbackTurn(context, { skipped = false, validSubjectSlugs = new Set() } = {}) {
  const name = context.player?.name ?? "Nimpol";
  const discovery = context.activity?.lastDiscoveryTitle;
  const transmission = context.activity?.lastTransmissionTitle;
  const subject = context.quests?.selectedSubject;
  const lastLabel = context.lastChoice?.label;
  const subjects = context.subjects ?? [];

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

  let storyText = `Good morning, ${name}! Your focus crystal hums softly. How shall we begin today's chronicle?`;

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
          { id: "energetic", label: "Charge Ahead", action: "continue" },
          { id: "strategize", label: "Plan First", action: "continue" },
          { id: "scout", label: "Scout Ahead", action: "continue" }
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

  function applySideEffects(choice) {
    if (choice.action === "select_subject" && choice.value) {
      setSubject(choice.value, true);
      return;
    }
    if (choice.action === "open_quests") {
      renderQuestList();
      showToast("Your quests are ready below.");
      return;
    }
    if (choice.action === "spin_wheel") {
      openWheelModal();
    }
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

      applySideEffects(choice);

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

    const fallback = defaultTurn ?? generateFallbackTurn({ player: { name: config.player.name } });
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
    } catch (err) {
      console.warn("Story bootstrap failed:", err);
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

      const latest = await fetchLatestStoryTurn(client, user.id);

      if (latest && !latest.selected_choice_id) {
        currentTurnRow = latest;
        renderStoryTurn({
          storyText: latest.story_text,
          choices: normalizeChoices(latest.choices, subjectSlugs())
        });
        return;
      }

      if (latest?.selected_choice_id) {
        const nextTurn = await fetchStoryTurnByIndex(client, user.id, latest.turn_index + 1);
        if (nextTurn && !nextTurn.selected_choice_id) {
          currentTurnRow = nextTurn;
          renderStoryTurn({
            storyText: nextTurn.story_text,
            choices: normalizeChoices(nextTurn.choices, subjectSlugs())
          });
          return;
        }
        if (nextTurn?.selected_choice_id) {
          currentTurnRow = nextTurn;
          await startNewTurn({
            lastChoice: {
              id: nextTurn.selected_choice_id,
              label: nextTurn.selected_choice_label
            }
          });
          return;
        }

        await startNewTurn({
          lastChoice: {
            id: latest.selected_choice_id,
            label: latest.selected_choice_label
          }
        });
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

    persistAndAdvance(choice);
  }

  function skipToSubjects() {
    openSubjectPicker();
  }

  function renderCurrentTurn() {
    if (currentTurnRow) {
      renderStoryTurn({
        storyText: currentTurnRow.story_text,
        choices: normalizeChoices(currentTurnRow.choices, subjectSlugs())
      });
      return;
    }
    if (defaultTurn) renderStoryTurn(defaultTurn);
  }

  return {
    bootstrap,
    handleChoiceClick,
    skipToSubjects,
    renderCurrentTurn,
    get currentTurnRow() {
      return currentTurnRow;
    }
  };
}
