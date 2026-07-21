/**
 * AI-driven Chronicles interaction loop.
 */

import {
  buildFallbackStoryContext as buildStoryContext,
  extractRuntimeContext,
  assertRuntimeOnlyPayload
} from "./adventureContext.js";
import {
  getSessionUser,
  persistWorldState,
  getNextIncompleteSubject,
  getTargetSubject,
  getSubjectLabel
} from "./questSync.js";
import {
  STORY_ACTIONS,
  normalizeStoryAction,
  normalizeStoryChoice,
  dedupeFunctionalChoices,
  isQuestDrawerAction,
  assertDistinctFunctionalChoices
} from "./storyChoiceSchema.js";

const BUILD_WEEK_LOCATION = "starlit-library";

const BUILD_WEEK_FINAL_TURNS = {
  "brain-boost-intro": 1,
  "brain-boost-effect": 0,
  "quest-intro-1": 1,
  "quest-intro-2": 2,
  "completion-ack": 1,
  "demo-ending": 0
};

function unlockWorldForSubject(worldState, subject) {
  if (!subject) return worldState;
  const unlockedLocations = uniqueValues([...(worldState.unlockedLocations ?? [])]);
  const unlockedSubjects = uniqueValues([
    ...(worldState.unlockedSubjects ?? []),
    subject
  ]);
  if (subject === "reading" && !unlockedLocations.includes(BUILD_WEEK_LOCATION)) {
    unlockedLocations.push(BUILD_WEEK_LOCATION);
  }
  return {
    ...worldState,
    unlockedLocations,
    unlockedSubjects,
    targetSubject: subject,
    // Story progression is subject-scoped; a specific quest slug is only set
    // after the player picks a card in the drawer.
    targetQuestSlug: null
  };
}

function enrichBuildWeekContext(context, gameState) {
  const subject = getTargetSubject(gameState);
  if (!subject) return context;
  const label = getSubjectLabel(gameState, subject);
  context.buildWeek = {
    ...context.buildWeek,
    targetSubject: subject,
    targetSubjectLabel: label,
    targetQuestSlug: null,
    targetQuestTitle: null,
    targetQuestSubjectSlug: subject
  };
  return context;
}

const BUILD_WEEK_SUBJECT_CHOICE_LABELS = {
  brain: {
    continue_story: "Trace the Glowing Pattern",
    inspect_world_element: "Search the Stone's Edge",
    ask_companion: "Ask Nutty What He Sees"
  },
  math: {
    continue_story: "Decode the First Rune",
    inspect_world_element: "Test the Number Sequence",
    ask_companion: "Let Nutty Inspect the Symbols"
  },
  reading: {
    continue_story: "Read the Hidden Message",
    inspect_world_element: "Follow the Word Trail",
    ask_companion: "Ask Nutty for a Clue"
  }
};

function buildWeekLabelSubject(context, kind) {
  if (kind === "completion-ack") {
    return (
      context.recentCompletion?.subject ??
      buildWeekTargetSubject(context) ??
      "brain"
    );
  }
  return (
    buildWeekTargetSubject(context) ??
    context.recentCompletion?.subject ??
    "brain"
  );
}

function subjectCompletionCelebration(subject) {
  if (subject === "math") {
    return `The runes flash gold and settle into perfect order. Nutty spins in a circle. "The code is cracked! Those numbers never stood a chance."`;
  }
  if (subject === "reading") {
    return `The hidden words rise from the page like fireflies. Nutty grins. "You found the meaning beneath the mystery. The Chronicle remembers!"`;
  }
  return `The ancient stone glows brighter as the final pattern clicks into place. Nutty throws both paws into the air. "You did it, Nimpol! The path is opening!"`;
}

function applyBuildWeekSubjectChoiceLabels(choices, subject) {
  const labels =
    BUILD_WEEK_SUBJECT_CHOICE_LABELS[subject] ??
    BUILD_WEEK_SUBJECT_CHOICE_LABELS.brain;
  return (choices ?? []).map((choice) => {
    if (choice.id === "continue-after-completion") return choice;
    const nextLabel = labels[choice.action];
    return nextLabel ? { ...choice, label: nextLabel } : choice;
  });
}

function subjectIntroCopy(subject, label) {
  const subjectLabel = label || "next";
  if (!subject) {
    return {
      lead: "Nutty scans the chronicle for your next subject path.",
      ready: "Your next subject quests are ready below."
    };
  }
  if (subject === "brain") {
    return {
      lead: `Nutty opens today's ${subjectLabel} trials. "Pick any one Brain quest to continue."`,
      ready: `${subjectLabel} quests are ready in the drawer below — choose one.`
    };
  }
  if (subject === "math") {
    return {
      lead: `Stone runes wake for ${subjectLabel}. Nutty says choose any one Math trial next.`,
      ready: `${subjectLabel} quests wait in the drawer — claim any one to continue.`
    };
  }
  if (subject === "reading") {
    return {
      lead: `A quiet glow opens the ${subjectLabel} path. Nutty whispers: choose any one Reading trial.`,
      ready: `${subjectLabel} quests are ready below — pick one to finish today's chronicle.`
    };
  }
  return {
    lead: `Nutty points toward the ${subjectLabel} path.`,
    ready: `${subjectLabel} quests are ready below.`
  };
}

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

  const normalized = rawChoices
    .slice(0, 4)
    .map((choice, index) => {
      const base = normalizeStoryChoice(choice, index);
      const action = normalizeStoryAction(base.action);
      const value =
        isQuestDrawerAction(action) && validSubjectSlugs.has(base.value)
          ? base.value
          : isQuestDrawerAction(action)
            ? null
            : base.value;

      return {
        ...base,
        action: STORY_ACTIONS.has(action) ? action : "continue_story",
        value,
        target: base.target ?? null
      };
    })
    .filter((choice) => choice.label.trim().length > 0);

  return dedupeFunctionalChoices(normalized);
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

function buildSubjectChoices(subjects, max = 4) {
  return (subjects ?? []).slice(0, max).map((s) => ({
    id: `subject-${s.slug}`,
    label: s.label ? `${s.label} Path` : `${s.slug} Path`,
    action: "open_quest_subject",
    value: s.slug
  }));
}

const OPENING_CHOICES = [
  {
    id: "im-ready",
    label: "I'm Ready!",
    action: "activate_brain_boost"
  }
];

function buildWeekTurn(context, validSubjectSlugs = new Set()) {
  const key = context.buildWeek?.pendingStoryKey ?? context.worldState?.pendingStoryKey;
  const kind = pendingStoryKind(key);
  const name = context.player?.name ?? "Nimpol";
  const questTitle = context.recentCompletion?.questTitle ?? "your Math quest";
  const discoveryTitle = context.activity?.lastDiscoveryTitle ?? "today's insight";
  let raw = null;

  if (kind === "brain-boost-intro") {
    raw = {
      storyText: `Nutty taps the Scroll of Knowledge beside you. "That is your Brain Boost, ${name}. Read it and your focus crystal learns from the insight."`,
      choices: [
        {
          id: "im-ready",
          label: "I'm Ready!",
          action: "activate_brain_boost"
        }
      ]
    };
  } else if (kind === "brain-boost-effect") {
    raw = {
      storyText: `The Brain Boost sinks in. Your focus crystal brightens from soft blue to sharp gold, humming with fresh knowledge from "${discoveryTitle}."`,
      choices: [
        {
          id: "follow-crystal-glow",
          label: "Follow the Glow",
          action: "continue_story"
        },
        {
          id: "ask-nutty-about-glow",
          label: "Ask Nutty",
          action: "ask_companion",
          target: "crystal-glow"
        }
      ]
    };
  } else if (kind === "quest-intro-1") {
    const subject = context.buildWeek?.targetSubject ?? context.buildWeek?.targetQuestSubjectSlug ?? "brain";
    const label = context.buildWeek?.targetSubjectLabel ?? subject;
    const copy = subjectIntroCopy(subject, label);
    raw = {
      storyText: copy.lead,
      choices: [
        {
          id: "continue-quest-intro",
          label: "Press Closer",
          action: "continue_story"
        },
        {
          id: "ask-about-next-quest",
          label: "Ask Nutty",
          action: "ask_companion",
          target: "next-subject"
        }
      ]
    };
  } else if (kind === "quest-intro-2") {
    const subject = context.buildWeek?.targetSubject ?? context.buildWeek?.targetQuestSubjectSlug ?? null;
    const copy = subjectIntroCopy(subject, context.buildWeek?.targetSubjectLabel ?? subject ?? "Quests");
    raw = {
      storyText: copy.ready,
      choices: [
        {
          id: "ask-about-subject-quests",
          label: "Ask Nutty",
          action: "ask_companion",
          target: "subject-quests"
        }
      ]
    };
  } else if (kind === "completion-ack") {
    const subject =
      context.recentCompletion?.subject ?? buildWeekTargetSubject(context) ?? "brain";
    raw = {
      storyText: subjectCompletionCelebration(subject),
      choices: [
        {
          id: "continue-after-completion",
          label: "Continue the Adventure",
          action: "continue_story"
        },
        {
          id: "ask-nutty-after-completion",
          label: "Ask Nutty",
          action: "ask_companion",
          target: "quest-complete"
        }
      ]
    };
  } else if (kind === "demo-ending") {
    raw = {
      storyText: `Nutty settles on your shoulder. "Today's chronicle is complete, ${name}. Your focus crystal and today's victories will be here when you return."`,
      choices: [
        {
          id: "return-to-treehouse",
          label: "Return to the Treehouse",
          action: "return_home"
        },
        {
          id: "read-chronicle-again",
          label: "Read Today's Chronicle",
          action: "read_chronicle"
        }
      ]
    };
  }

  if (!raw) return null;

  const labelSubject = buildWeekLabelSubject(context, kind);
  raw.choices = applyBuildWeekSubjectChoiceLabels(raw.choices, labelSubject);
  return validateStoryTurn(raw, validSubjectSlugs);
}

function buildWeekTargetSubject(context) {
  return (
    context.buildWeek?.targetSubject ??
    context.buildWeek?.targetQuestSubjectSlug ??
    context.worldState?.targetSubject ??
    null
  );
}

function buildWeekChoiceActions(choices) {
  return (choices ?? []).map((choice) => choice.action);
}

function buildWeekHasAction(choices, actions) {
  const allowed = new Set(actions);
  return choices.some((choice) => allowed.has(choice.action));
}

function buildWeekHasForbiddenAction(choices, forbidden) {
  const blocked = new Set(forbidden);
  return choices.some((choice) => blocked.has(choice.action));
}

function validateBuildWeekTurnForKindDetail(turn, kind, context, validSubjectSlugs) {
  if (!turn?.storyText?.trim()) {
    return { ok: false, reason: "missing storyText", actions: [] };
  }

  const choices = normalizeChoices(turn.choices, validSubjectSlugs);
  if (choices.length < 1) {
    return { ok: false, reason: "no valid choices", actions: [] };
  }

  const actions = buildWeekChoiceActions(choices);
  if (!assertDistinctFunctionalChoices(choices)) {
    return {
      ok: false,
      reason: "choices must have distinct functional effects",
      actions
    };
  }

  if (buildWeekHasForbiddenAction(choices, ["open_target_quest"])) {
    return { ok: false, reason: "open_target_quest is not allowed", actions };
  }

  const targetSubject = buildWeekTargetSubject(context);
  for (const choice of choices) {
    if (choice.action === "open_quest_subject" && choice.value !== targetSubject) {
      return {
        ok: false,
        reason: "open_quest_subject must match the current subject focus",
        actions
      };
    }
  }

  switch (kind) {
    case "brain-boost-intro": {
      const allowed = ["activate_brain_boost", "continue_story", "ask_companion"];
      if (!buildWeekHasAction(choices, ["activate_brain_boost", "continue_story"])) {
        return {
          ok: false,
          reason: "must include activate_brain_boost or continue_story",
          actions
        };
      }
      if (choices.some((choice) => !allowed.includes(choice.action))) {
        return {
          ok: false,
          reason: "only activate_brain_boost, continue_story, and ask_companion are allowed",
          actions
        };
      }
      break;
    }
    case "brain-boost-effect": {
      const allowed = ["continue_story", "ask_companion", "inspect_world_element"];
      if (!buildWeekHasAction(choices, allowed)) {
        return {
          ok: false,
          reason: "must include continue_story, ask_companion, or inspect_world_element",
          actions
        };
      }
      if (buildWeekHasForbiddenAction(choices, [
        "open_quest_subject",
        "return_home",
        "read_chronicle",
        "spin_wheel",
        "activate_brain_boost",
        "open_target_quest"
      ])) {
        return {
          ok: false,
          reason: "forbidden action for brain-boost-effect",
          actions
        };
      }
      break;
    }
    case "quest-intro-1": {
      const allowed = ["continue_story", "ask_companion", "inspect_world_element"];
      if (!buildWeekHasAction(choices, allowed)) {
        return {
          ok: false,
          reason: "must include continue_story, ask_companion, or inspect_world_element",
          actions
        };
      }
      if (buildWeekHasForbiddenAction(choices, [
        "open_quest_subject",
        "return_home",
        "read_chronicle",
        "activate_brain_boost",
        "spin_wheel",
        "open_target_quest"
      ])) {
        return {
          ok: false,
          reason: "forbidden action for quest-intro-1",
          actions
        };
      }
      break;
    }
    case "quest-intro-2": {
      const allowed = ["ask_companion", "inspect_world_element", "open_quest_subject"];
      if (!buildWeekHasAction(choices, ["ask_companion", "inspect_world_element"])) {
        return {
          ok: false,
          reason: "must include ask_companion or inspect_world_element",
          actions
        };
      }
      if (choices.some((choice) => !allowed.includes(choice.action))) {
        return {
          ok: false,
          reason: "only ask_companion, inspect_world_element, and open_quest_subject are allowed",
          actions
        };
      }
      for (const choice of choices) {
        if (choice.action === "open_quest_subject" && choice.value !== targetSubject) {
          return {
            ok: false,
            reason: "open_quest_subject value must match the current subject focus",
            actions
          };
        }
      }
      break;
    }
    case "completion-ack": {
      const allowed = ["continue_story", "ask_companion"];
      if (!buildWeekHasAction(choices, allowed)) {
        return {
          ok: false,
          reason: "must include continue_story or ask_companion",
          actions
        };
      }
      if (buildWeekHasForbiddenAction(choices, [
        "open_quest_subject",
        "return_home",
        "read_chronicle",
        "activate_brain_boost",
        "spin_wheel",
        "open_target_quest",
        "inspect_world_element"
      ])) {
        return {
          ok: false,
          reason: "forbidden action for completion-ack",
          actions
        };
      }
      break;
    }
    case "demo-ending": {
      const allowed = ["return_home", "read_chronicle"];
      if (!buildWeekHasAction(choices, allowed)) {
        return {
          ok: false,
          reason: "must include return_home or read_chronicle",
          actions
        };
      }
      if (buildWeekHasForbiddenAction(choices, [
        "continue_story",
        "open_quest_subject",
        "open_target_quest",
        "activate_brain_boost",
        "spin_wheel",
        "ask_companion",
        "inspect_world_element"
      ])) {
        return {
          ok: false,
          reason: "forbidden action for demo-ending",
          actions
        };
      }
      break;
    }
    default:
      return { ok: false, reason: `unknown Build Week kind: ${kind}`, actions };
  }

  return { ok: true, reason: "", actions };
}

export function validateBuildWeekTurnForKind(turn, kind, context, validSubjectSlugs = new Set()) {
  return validateBuildWeekTurnForKindDetail(turn, kind, context, validSubjectSlugs).ok;
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

  // Build Week scripted turns are inserted through pendingStoryKey.
  if (recentCompletion && context.worldState?.pendingStoryKey) {
    return buildWeekTurn(context, validSubjectSlugs);
  }

  const atScrollOpening =
    (context.worldState?.step ?? 0) === 0 &&
    !context.worldState?.scrollComplete &&
    (context.worldState?.stageTurns ?? 0) === 0;

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
          {
            id: "open-quests",
            label: "View Quests",
            action: "open_quest_subject",
            value: subject
          },
          { id: "spin-wheel", label: "Spin Wheel", action: "spin_wheel" },
          {
            id: "continue-story",
            label: "Press Onward",
            action: "continue_story"
          }
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
  const choices = atScrollOpening
    ? [...OPENING_CHOICES.map((choice) => ({ ...choice }))]
    : subjectChoices.length >= 2
      ? [
          ...subjectChoices.slice(0, 3),
          {
            id: "continue-story",
            label: "Press Onward",
            action: "continue_story"
          }
        ]
      : [...OPENING_CHOICES.map((choice) => ({ ...choice }))];

  return validateStoryTurn({ storyText, choices }, validSubjectSlugs);
}

export async function requestStoryTurn(client, context, validSubjectSlugs = new Set()) {
  try {
    const runtimeContext = extractRuntimeContext(context);
    assertRuntimeOnlyPayload(runtimeContext);

    const { data, error } = await client.functions.invoke("generate-story-turn", {
      body: { context: runtimeContext }
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

function rectSnapshot(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: Math.round(r.top),
    left: Math.round(r.left),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
    width: Math.round(r.width),
    height: Math.round(r.height)
  };
}

function describeElementAtPoint(el) {
  if (!el) return null;
  return {
    tag: el.tagName,
    id: el.id || null,
    className: el.className || null
  };
}

export function logCompletionLayout() {
  const dialogue = document.getElementById("dialogueText");
  const interaction = document.getElementById("interaction-buttons");
  const continueBtn = document.querySelector(
    '#interaction-buttons button[data-story-choice="continue-after-completion"]'
  );
  const adventure = document.querySelector(".col-adventure");
  const adventureInner = document.querySelector(".adventure-inner");
  const continueButtonRect = rectSnapshot(continueBtn);
  const viewportHeight = window.innerHeight;

  let elementAtButtonCenter = null;
  if (continueBtn && continueButtonRect) {
    const centerX = continueButtonRect.left + continueButtonRect.width / 2;
    const centerY = continueButtonRect.top + continueButtonRect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    elementAtButtonCenter = hit
      ? {
          ...describeElementAtPoint(hit),
          isButton: hit === continueBtn
        }
      : null;
  }

  const continueInViewport = continueButtonRect
    ? continueButtonRect.top >= 0 &&
      continueButtonRect.left >= 0 &&
      continueButtonRect.bottom <= viewportHeight &&
      continueButtonRect.right <= window.innerWidth
    : false;

  const continueBtnStyle = continueBtn ? getComputedStyle(continueBtn) : null;

  const layout = {
    viewportHeight,
    scrollY: window.scrollY,
    dialogueRect: rectSnapshot(dialogue),
    interactionRect: rectSnapshot(interaction),
    continueButtonRect,
    elementAtButtonCenter,
    adventureOverflow: adventure ? getComputedStyle(adventure).overflow : null,
    adventureInnerOverflow: adventureInner ? getComputedStyle(adventureInner).overflow : null,
    interactionZIndex: interaction ? getComputedStyle(interaction).zIndex : null,
    buttonZIndex: continueBtnStyle?.zIndex ?? null,
    continueInViewport,
    buttonColor: continueBtnStyle?.color ?? null,
    buttonBackground: continueBtnStyle?.backgroundColor ?? null
  };

  console.info("[Completion layout]", layout);
  return layout;
}

function ensureCompletionButtonVisible() {
  let layout = logCompletionLayout();
  const continueBtn = document.querySelector(
    '#interaction-buttons button[data-story-choice="continue-after-completion"]'
  );
  if (!continueBtn) return layout;

  const obscured = layout.elementAtButtonCenter?.isButton !== true;
  if (!layout.continueInViewport || obscured) {
    continueBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
    layout = logCompletionLayout();
    console.info("[Completion layout] scrollIntoView applied", {
      continueInViewport: layout.continueInViewport,
      elementAtButtonCenter: layout.elementAtButtonCenter
    });
  }

  return layout;
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
  console.info("[Interaction choices render]", {
    source: "storyEngine.js",
    targetFound: Boolean(container),
    choiceCount: choices?.length ?? 0,
    labels: (choices ?? []).map((choice) => choice.label)
  });
  if (!container) return;

  container.innerHTML = "";
  choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-emerald";
    btn.textContent = choice.label;
    btn.dataset.storyChoice = choice.id;
    btn.dataset.storyAction = choice.action || "continue_story";
    if (choice.value) btn.dataset.storyValue = choice.value;
    if (choice.target) btn.dataset.storyTarget = choice.target;
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
    awardItemBySlug = async () => null,
    activateBrainBoost = async () => {}
  } = callbacks;

  const subjectSlugs = () => getValidSubjectSlugs(gameState);

  function presentationChoicesForRow(row) {
    const choices = normalizeChoices(row?.choices ?? [], subjectSlugs());
    const pendingKey =
      row?.ai_context?.buildWeek?.pendingStoryKey ??
      gameState.worldState?.pendingStoryKey ??
      null;
    if (!pendingKey) return choices;

    const kind = pendingStoryKind(pendingKey);
    const labelSubject = buildWeekLabelSubject(
      {
        recentCompletion:
          row?.ai_context?.recentCompletion ??
          gameState.recentCompletion ??
          buildRecentCompletion(),
        buildWeek: row?.ai_context?.buildWeek,
        worldState: row?.ai_context?.worldState ?? gameState.worldState
      },
      kind
    );
    return applyBuildWeekSubjectChoiceLabels(choices, labelSubject);
  }

  function completionAckChoiceContract() {
    return {
      id: "continue-after-completion",
      label: "Continue the Adventure",
      action: "continue_story"
    };
  }

  function isCompletionAckRow(row) {
    if (!row) return false;
    const pendingKey = row.ai_context?.buildWeek?.pendingStoryKey;
    if (pendingKey && pendingStoryKind(pendingKey) === "completion-ack") return true;
    const rawChoices = Array.isArray(row.choices) ? row.choices : [];
    return rawChoices.some((choice) => choice?.id === "continue-after-completion");
  }

  function isCompletionAckBeat() {
    const worldState = gameState.worldState ?? {};
    return (
      (worldState.step ?? 0) === 0 &&
      (worldState.stageTurns ?? 0) === 1 &&
      Boolean(gameState.recentCompletion)
    );
  }

  function traceCompletionFlow(label, extra = {}) {
    console.info(`[Completion trace] ${label}`, {
      step: gameState.worldState?.step ?? 0,
      stageTurns: gameState.worldState?.stageTurns ?? 0,
      pendingStoryKey: gameState.worldState?.pendingStoryKey ?? null,
      currentRowId: currentTurnRow?.id ?? null,
      rowChoices: currentTurnRow?.choices ?? null,
      selectedChoiceId: currentTurnRow?.selected_choice_id ?? null,
      recentCompletion: Boolean(gameState.recentCompletion),
      ...extra
    });
  }

  function completionChoicesForRow(row) {
    const normalized = normalizeChoices(row?.choices ?? [], subjectSlugs());
    const hasContinue = normalized.some(
      (choice) => choice.id === "continue-after-completion"
    );
    if (hasContinue) return normalized;
    return [
      normalizeStoryChoice(completionAckChoiceContract(), 0),
      ...normalized.filter((choice) => choice.id !== "continue-after-completion")
    ];
  }

  let completionDomObserver = null;

  function readElementVisibility(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      height: cs.height,
      overflow: cs.overflow
    };
  }

  function ensureCompletionDomObserver(container) {
    if (completionDomObserver || !container) return;
    const root = container.closest(".adventure-inner") ?? container.parentElement ?? container;
    completionDomObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target;
        const touchesInteraction =
          target.id === "interaction-buttons" ||
          target.querySelector?.("#interaction-buttons") ||
          [...mutation.removedNodes].some(
            (node) =>
              node.nodeType === 1 &&
              (node.id === "interaction-buttons" ||
                node.querySelector?.("#interaction-buttons"))
          );
        if (!touchesInteraction && mutation.type === "attributes") continue;

        console.info("[Completion DOM mutated]", {
          mutationType: mutation.type,
          removedNodes: [...mutation.removedNodes].map((node) =>
            node.nodeType === 1 ? node.outerHTML?.slice(0, 300) : String(node)
          ),
          addedNodes: [...mutation.addedNodes].map((node) =>
            node.nodeType === 1 ? node.outerHTML?.slice(0, 300) : String(node)
          ),
          currentOuterHTML:
            document.getElementById("interaction-buttons")?.outerHTML?.slice(0, 500) ?? null
        });
      }
    });
    completionDomObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"]
    });
  }

  function logCompletionDom(row, choices) {
    const container = document.getElementById("interaction-buttons");
    const buttons = container ? [...container.querySelectorAll("button")] : [];
    console.info("[Completion DOM]", {
      rowId: row?.id ?? null,
      choiceCount: choices.length,
      renderedButtonCount: buttons.length,
      buttonLabels: buttons.map((button) => button.textContent)
    });
  }

  function renderCompletionAck(row) {
    console.info("[Completion trace] renderCompletionAck:called", {
      rowId: row?.id ?? null
    });
    if (!row) {
      console.info("[Completion trace] renderCompletionAck:skipped", { reason: "no row" });
      return;
    }

    const choices = completionChoicesForRow(row);
    const pendingKey =
      row.ai_context?.buildWeek?.pendingStoryKey ??
      gameState.worldState?.pendingStoryKey ??
      null;
    const kind = pendingStoryKind(pendingKey);
    const labelSubject = buildWeekLabelSubject(
      {
        recentCompletion:
          row.ai_context?.recentCompletion ??
          gameState.recentCompletion ??
          buildRecentCompletion(),
        buildWeek: row.ai_context?.buildWeek,
        worldState: row.ai_context?.worldState ?? gameState.worldState
      },
      kind
    );
    const presentedChoices = applyBuildWeekSubjectChoiceLabels(choices, labelSubject);
    const target = document.querySelector("#interaction-buttons");
    const duplicateTargets = document.querySelectorAll("#interaction-buttons");
    const parent = target?.parentElement ?? null;
    const parentStyle = parent ? getComputedStyle(parent) : null;
    const targetStyle = target ? getComputedStyle(target) : null;

    console.info("[Completion target]", {
      targetFound: Boolean(target),
      duplicateTargetCount: duplicateTargets.length,
      targetOuterHTMLBefore: target?.outerHTML ?? null,
      parentDisplay: parentStyle?.display ?? null,
      parentVisibility: parentStyle?.visibility ?? null,
      targetDisplay: targetStyle?.display ?? null,
      targetVisibility: targetStyle?.visibility ?? null,
      targetOpacity: targetStyle?.opacity ?? null,
      targetHeight: targetStyle?.height ?? null,
      targetOverflow: targetStyle?.overflow ?? null
    });

    const textEl = document.getElementById("dialogueText");
    if (textEl) {
      textEl.textContent = subjectCompletionCelebration(labelSubject);
    }

    ensureCompletionDomObserver(target);
    renderInteractionChoices(presentedChoices);

    const container = document.getElementById("interaction-buttons");
    const buttons = container ? [...container.querySelectorAll("button")] : [];
    const firstButton = buttons[0] ?? null;

    console.info("[Completion inserted]", {
      targetOuterHTMLAfter: container?.outerHTML ?? null,
      buttonConnected: firstButton?.isConnected ?? false,
      renderedButtonCount: buttons.length,
      buttonLabels: buttons.map((button) => button.textContent),
      buttonCss: firstButton ? readElementVisibility(firstButton) : null,
      targetCss: readElementVisibility(container)
    });

    logCompletionDom(row, presentedChoices);
    console.info("[Completion ack rendered]", {
      pendingStoryKey:
        row.ai_context?.buildWeek?.pendingStoryKey ??
        gameState.worldState?.pendingStoryKey ??
        null,
      choiceCount: presentedChoices.length,
      choices: presentedChoices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        action: choice.action,
        value: choice.value ?? null,
        target: choice.target ?? null
      }))
    });

    ensureCompletionButtonVisible();
  }

  function renderStoryRow(row, hideChoices = false) {
    if (!row) return;
    if (isCompletionAckRow(row) || isCompletionAckBeat()) {
      console.info("[Completion trace] renderStoryRow:branch", { branch: "renderCompletionAck" });
      renderCompletionAck(row);
      return;
    }
    console.info("[Completion trace] renderStoryRow:branch", {
      branch: "renderStoryTurn",
      hideChoices
    });
    renderStoryTurn({
      storyText: row.story_text,
      choices: hideChoices ? [] : presentationChoicesForRow(row)
    });
  }

  async function createCompletionAckRow(user, pendingKey) {
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
      null,
      inventory
    );
    context.recentCompletion = buildRecentCompletion();
    enrichBuildWeekContext(context, gameState);
    context.buildWeek.pendingStoryKey = pendingKey;
    context.worldState.pendingStoryKey = pendingKey;

    const scripted = buildWeekTurn(context, subjectSlugs());
    if (!scripted) return null;
    const turn = validateStoryTurn(scripted, subjectSlugs());

    const turnIndex = await getNextTurnIndex(client, user.id);
    return insertStoryTurn(
      client,
      user.id,
      turnIndex,
      turn,
      context,
      "fallback"
    );
  }

  function looksLikeOpeningStory(text) {
    const value = String(text ?? "");
    return value.includes("Brain Boost") && value.includes("focus crystal");
  }

  function isOpeningTurnRow(row) {
    if (!row || row.selected_choice_id) return false;
    const choices = normalizeChoices(row.choices ?? [], subjectSlugs());
    const hasOpeningChoice = choices.some(
      (choice) => choice.action === "activate_brain_boost"
    );
    if (!hasOpeningChoice) return false;
    return row.turn_index === 0 || looksLikeOpeningStory(row.story_text);
  }

  function resolveOpeningTurn(latest, history) {
    const rows = [...(history ?? [])].sort((a, b) => a.turn_index - b.turn_index);
    const openingFromHistory = rows.find((row) => isOpeningTurnRow(row));
    if (openingFromHistory) return openingFromHistory;
    return isOpeningTurnRow(latest) ? latest : null;
  }

  async function ensureReadyOpeningRow(row) {
    const worldState = gameState.worldState ?? {};
    const atOpeningBeat =
      (worldState.step ?? 0) === 0 &&
      (worldState.stageTurns ?? 0) === 0 &&
      !worldState.scrollComplete &&
      !gameState.selectedSubject;

    if (!row || !atOpeningBeat || row.selected_choice_id || !isOpeningTurnRow(row)) {
      return row;
    }

    const normalized = normalizeChoices(row.choices ?? [], subjectSlugs());
    const desired = normalizeChoices(OPENING_CHOICES, subjectSlugs());
    const matchesOpening =
      normalized.length === desired.length &&
      normalized.every(
        (choice, index) =>
          choice.action === desired[index].action &&
          choice.label === desired[index].label
      );
    if (matchesOpening) return row;

    const choices = desired;
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

  async function showOpeningTurn(user, latest, history) {
    if (gameState.worldState?.pendingStoryKey) {
      await persistStoryWorld(user.id, {
        ...gameState.worldState,
        pendingStoryKey: null
      });
      saveState();
    }

    let opening = resolveOpeningTurn(latest, history);
    if (opening) {
      opening = await ensureReadyOpeningRow(opening);
      currentTurnRow = opening;
      renderStoryRow(opening);
      return true;
    }

    await createInitialGreetingTurn(user);
    return true;
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
    const next = {
      ...worldState,
      pendingStoryKey: null
    };

    if (kind === "brain-boost-effect") {
      next.scrollComplete = true;
      next.stageTurns = 0;
      const subject = getNextIncompleteSubject(gameState);
      return subject ? unlockWorldForSubject(next, subject) : next;
    }

    if (kind === "demo-ending") {
      next.step = 6;
      next.stageTurns = 0;
      return next;
    }

    next.stageTurns = BUILD_WEEK_FINAL_TURNS[kind] ?? worldState.stageTurns ?? 0;
    return next;
  }

  function buildRecentCompletion() {
    if (gameState.recentCompletion) return gameState.recentCompletion;
    const completedIds = gameState.worldState?.completedQuestIds ?? [];
    const questId = completedIds[completedIds.length - 1] ?? null;
    const template = (gameState.questTemplates ?? []).find((item) => item.slug === questId);
    const assigned = (gameState.activeQuests ?? []).find((item) => item.id === questId);
    return questId
      ? {
          questId,
          questTitle: assigned?.title ?? template?.title ?? "your quest",
          subject: assigned?.subject ?? template?.subject ?? "brain"
        }
      : null;
  }

  async function requestBuildWeekTurn(context, key) {
    const slugs = subjectSlugs();
    const kind = pendingStoryKind(key);
    const scriptedTurn = buildWeekTurn(context, slugs);
    if (!scriptedTurn) throw new Error(`Unknown Build Week story key: ${key}`);

    if (kind === "completion-ack") {
      return {
        turn: scriptedTurn,
        source: "fallback",
        lootAward: null,
        buildWeekLog: {
          pendingStoryKey: key,
          kind,
          adventureBriefBeat: null,
          adventureBriefTargetSubject: null,
          responseSource: "fallback",
          aiChoiceActions: [],
          validationResult: "skipped",
          rejectionReason: null,
          fallbackWhy: "completion-ack uses deterministic celebration copy"
        }
      };
    }

    const aiResult = await requestStoryTurn(client, context, slugs);
    const aiChoiceActions = buildWeekChoiceActions(
      normalizeChoices(aiResult.turn?.choices, slugs)
    );
    const validation = validateBuildWeekTurnForKindDetail(
      aiResult.turn,
      kind,
      context,
      slugs
    );

    let responseSource;
    let validationResult = validation.ok ? "accepted" : "rejected";
    let rejectionReason = validation.ok ? null : validation.reason;
    let fallbackWhy = null;
    let turn;

    if (aiResult.source === "ai" && validation.ok) {
      responseSource = "ai";
      turn = aiResult.turn;
    } else {
      responseSource = "fallback";
      if (aiResult.source === "ai") {
        fallbackWhy = `validation rejected: ${validation.reason}`;
      } else {
        fallbackWhy = "edge function unavailable or returned error";
      }
      turn = scriptedTurn;
    }

    const labelSubject = buildWeekLabelSubject(context, kind);
    turn = {
      ...turn,
      choices: applyBuildWeekSubjectChoiceLabels(
        normalizeChoices(turn.choices, slugs),
        labelSubject
      )
    };

    return {
      turn,
      source: responseSource,
      lootAward: responseSource === "ai" ? (aiResult.lootAward ?? null) : null,
      buildWeekLog: {
        pendingStoryKey: key,
        kind,
        adventureBriefBeat: null,
        adventureBriefTargetSubject: null,
        responseSource,
        aiChoiceActions,
        validationResult,
        rejectionReason,
        fallbackWhy: responseSource === "fallback" ? fallbackWhy : null
      }
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
    enrichBuildWeekContext(context, gameState);
    context.buildWeek.pendingStoryKey = key;
    context.worldState.pendingStoryKey = key;

    const { turn, source, buildWeekLog } = await requestBuildWeekTurn(context, key);
    const refreshedHistory = await fetchStoryHistory(client, user.id);
    const existingTurn = refreshedHistory.find(
      (row) => row.ai_context?.buildWeek?.pendingStoryKey === key
    );
    if (existingTurn) {
      currentTurnRow = existingTurn;
      renderStoryRow(existingTurn);
      await persistStoryWorld(user.id, finalWorldStateForPending(gameState.worldState));
      saveState();
      console.info("[BuildWeek pending turn]", {
        ...buildWeekLog,
        worldStateAfter: {
          pendingStoryKey: gameState.worldState?.pendingStoryKey ?? null,
          targetSubject: gameState.worldState?.targetSubject ?? null,
          step: gameState.worldState?.step ?? 0,
          stageTurns: gameState.worldState?.stageTurns ?? 0
        }
      });
      if (kind === "quest-intro-2") {
        await ensureQuestDrawerForBuildWeek(user);
      }
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
    renderStoryRow(currentTurnRow);

    const finalWorldState = finalWorldStateForPending(gameState.worldState);
    try {
      await persistStoryWorld(user.id, finalWorldState);
      saveState();
      console.info("[BuildWeek pending turn]", {
        ...buildWeekLog,
        worldStateAfter: {
          pendingStoryKey: gameState.worldState?.pendingStoryKey ?? null,
          targetSubject: gameState.worldState?.targetSubject ?? null,
          step: gameState.worldState?.step ?? 0,
          stageTurns: gameState.worldState?.stageTurns ?? 0
        }
      });
      if (kind === "quest-intro-2") {
        await ensureQuestDrawerForBuildWeek(user);
      }
      return true;
    } catch (err) {
      console.warn(`Build Week ${kind} turn saved; final stage sync is pending:`, err);
      gameState.worldState = finalWorldState;
      saveState();
      console.info("[BuildWeek pending turn]", {
        ...buildWeekLog,
        worldStateAfter: {
          pendingStoryKey: gameState.worldState?.pendingStoryKey ?? null,
          targetSubject: gameState.worldState?.targetSubject ?? null,
          step: gameState.worldState?.step ?? 0,
          stageTurns: gameState.worldState?.stageTurns ?? 0
        }
      });
      if (kind === "quest-intro-2") {
        await ensureQuestDrawerForBuildWeek(user);
      }
      showToast("Story saved. Finishing progress sync on refresh.");
      return true;
    }
  }

  async function beginStageTurn(user, kind, targetWorldState, choice = null, sideEffect = null) {
    if (kind === "quest-intro-1" && gameState.recentCompletion) {
      traceCompletionFlow("beginStageTurn:quest-intro-1", {
        choiceId: choice?.id ?? null,
        progressionInvoked: true
      });
    }
    const previousWorldState = { ...(gameState.worldState ?? {}) };
    const pending = pendingWorldState(kind, targetWorldState);
    try {
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

      const completed = await insertPendingStageTurn(user, pending.pendingStoryKey);
      return completed;
    } catch (err) {
      try {
        if (choice && currentTurnRow?.selected_choice_id === choice.id) {
          const { data, error: revertError } = await client
            .from("story_history")
            .update({ selected_choice_id: null, selected_choice_label: null })
            .eq("id", currentTurnRow.id)
            .select("*")
            .single();
          if (!revertError && data) currentTurnRow = data;
        }
        await persistStoryWorld(user.id, previousWorldState);
        gameState.worldState = previousWorldState;
        saveState();
      } catch (rollbackErr) {
        console.warn("Could not roll back pending story world state:", rollbackErr);
      }
      throw err;
    }
  }

  async function recoverPendingStageTurn(user, history) {
    const key = gameState.worldState?.pendingStoryKey;
    if (!key) return false;

    const findPendingTurn = (rows) =>
      (rows ?? []).find((row) => row.ai_context?.buildWeek?.pendingStoryKey === key);

    let existing = findPendingTurn(history);
    if (!existing) {
      const refreshedHistory = await fetchStoryHistory(client, user.id);
      existing = findPendingTurn(refreshedHistory);
    }

    if (!existing) {
      const latest = await fetchLatestStoryTurn(client, user.id);
      const kind = pendingStoryKind(key);
      if (kind !== "completion-ack" && !latest?.selected_choice_id) {
        return false;
      }
      try {
        const ok = await insertPendingStageTurn(user, key);
        return ok && Boolean(currentTurnRow);
      } catch (err) {
        console.warn("Build Week pending story recovery insert failed:", err);
        return false;
      }
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
    if (pendingStoryKind(key) === "quest-intro-2") {
      await ensureQuestDrawerForBuildWeek(user);
    }
    return true;
  }

  async function ensureCurrentTurnRow(user) {
    if (currentTurnRow) return currentTurnRow;

    const history = await fetchStoryHistory(client, user.id);
    let latest = await fetchLatestStoryTurn(client, user.id);
    const step = gameState.worldState?.step ?? 0;
    const stageTurns = gameState.worldState?.stageTurns ?? 0;

    if (step === 0 && stageTurns === 0 && !gameState.worldState?.scrollComplete) {
      let opening = resolveOpeningTurn(latest, history);
      if (opening) {
        opening = await ensureReadyOpeningRow(opening);
        currentTurnRow = opening;
        renderStoryRow(opening);
        return opening;
      }
      return null;
    }

    latest = await ensureReadyOpeningRow(latest);
    if (latest && !latest.selected_choice_id) {
      currentTurnRow = latest;
      renderStoryRow(latest);
      return latest;
    }

    return null;
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

  async function ensureQuestDrawerForBuildWeek(user) {
    const worldState = gameState.worldState ?? {};
    const step = worldState.step ?? 0;
    const stageTurns = worldState.stageTurns ?? 0;
    if (step !== 0 || !worldState.scrollComplete || stageTurns !== 2) return;

    const targetSubject = getTargetSubject(gameState, worldState.targetSubject);
    if (!targetSubject) return;

    await pauseForQuestCards(user, null, targetSubject);
  }

  async function pauseForQuestCards(user, choice, subject) {
    if (!subject) {
      showToast("Your assigned quests are still syncing.");
      return;
    }

    const assignedForSubject = (gameState.activeQuests ?? []).filter(
      (quest) =>
        quest.subject === subject &&
        quest.activeQuestId &&
        quest.status !== "claimed"
    );
    if (!assignedForSubject.length) {
      showToast("Your assigned quests are still syncing.");
      return;
    }

    const nextWorldState = unlockWorldForSubject(
      {
        ...gameState.worldState,
        step: 1,
        stageTurns: 0,
        pendingStoryKey: null
      },
      subject
    );
    await persistStoryWorld(user.id, nextWorldState);
    gameState.highlightedQuestId = null;

    if (choice && currentTurnRow) {
      currentTurnRow = await recordStoryChoice(
        client,
        currentTurnRow.id,
        choice.id,
        choice.label
      );
    }
    await setSubject(subject, true, null);
    renderInteractionChoices([]);
    renderQuestList();
    saveState();
  }

  async function applySideEffects(choice) {
    const action = normalizeStoryAction(choice.action);

    if (action === "open_quest_subject") {
      if (choice.value && gameState.worldState?.step === 1) {
        await setSubject(choice.value, true, null);
        renderQuestList();
        showToast("Your quests are ready below.");
      }
      return;
    }
    if (action === "open_target_quest") {
      // Legacy action: Build Week subject flow uses open_quest_subject.
      // Keep as a no-op so it can never fall through to AI narration.
      return;
    }
    if (action === "activate_brain_boost") {
      await activateBrainBoost();
      return;
    }
    if (action === "read_chronicle") {
      showToast("You open today's chronicle.");
      return;
    }
    if (action === "ask_companion") {
      showToast("Nutty answers in the story.");
      return;
    }
    if (action === "inspect_world_element") {
      showToast("You study it more closely.");
      return;
    }
    if (action === "return_home") {
      renderInteractionChoices([]);
      showToast("You return to the Hidden Treehouse.");
      return;
    }
    if (action === "spin_wheel") {
      openWheelModal();
    }
  }

  function restoreChoiceButtons() {
    if (!currentTurnRow) return;
    if (isCompletionAckRow(currentTurnRow) || isCompletionAckBeat()) {
      renderCompletionAck(currentTurnRow);
      return;
    }
    renderStoryTurn({
      storyText: currentTurnRow.story_text,
      choices: presentationChoicesForRow(currentTurnRow)
    });
  }

  async function handleBuildWeekChoice(user, choice) {
    traceCompletionFlow("handleBuildWeekChoice:start", {
      choiceId: choice?.id ?? null,
      choiceAction: choice?.action ?? null
    });
    let progressionInvoked = false;
    let worldState = gameState.worldState ?? {};
    let step = worldState.step ?? 0;
    let stageTurns = worldState.stageTurns ?? 0;
    let action = normalizeStoryAction(choice.action);


    if (worldState.pendingStoryKey) {
      const pendingKind = pendingStoryKind(worldState.pendingStoryKey);
      if (pendingKind === "completion-ack" && step === 0 && stageTurns === 0) {
        traceCompletionFlow("handleBuildWeekChoice:end", {
          blocked: true,
          progressionInvoked: false
        });
        return "blocked";
      }
      const history = await fetchStoryHistory(client, user.id, 20);
      const pendingTurn = history.find(
        (row) => row.ai_context?.buildWeek?.pendingStoryKey === worldState.pendingStoryKey
      );
      if (step === 0 && stageTurns === 0) {
        await persistStoryWorld(user.id, { ...worldState, pendingStoryKey: null });
        saveState();
        worldState = gameState.worldState ?? {};
        step = worldState.step ?? 0;
        stageTurns = worldState.stageTurns ?? 0;
      } else if (!pendingTurn) {
        await persistStoryWorld(user.id, { ...worldState, pendingStoryKey: null });
        saveState();
        worldState = gameState.worldState ?? {};
        step = worldState.step ?? 0;
        stageTurns = worldState.stageTurns ?? 0;
      } else {
        try {
          await persistStoryWorld(user.id, finalWorldStateForPending(worldState));
          saveState();
          worldState = gameState.worldState ?? {};
          step = worldState.step ?? 0;
          stageTurns = worldState.stageTurns ?? 0;
          if (pendingTurn.id !== currentTurnRow?.id) {
            currentTurnRow = pendingTurn;
            renderStoryRow(pendingTurn);
          }
        } catch (err) {
          showToast("Story progress is still syncing.");
          return "blocked";
        }
      }
    }

    const scrollComplete = Boolean(worldState.scrollComplete);
    const targetSubject = getTargetSubject(gameState, worldState.targetSubject);
    const subjectLabel = targetSubject
      ? getSubjectLabel(gameState, targetSubject)
      : null;

    // Safety guard: while a subject quest drawer is open, no story choice may
    // reach freeform AI narration. The quest drawer is the only valid action.
    if (step === 1) {
      if (action === "ask_companion") {
        showToast("Nutty answers in the story.");
        return true;
      }
      showToast("Claim one quest from this subject to continue.");
      return "blocked";
    }

    if (step === 0 && stageTurns === 0 && choice.id === "use-brain-boost" && action === "read_chronicle") {
      action = "activate_brain_boost";
    }

    if (step === 0 && !scrollComplete && stageTurns === 0) {
      if (action === "activate_brain_boost") {
        await beginStageTurn(
          user,
          "brain-boost-effect",
          { ...worldState, step: 0, stageTurns: 0 },
          choice,
          () => activateBrainBoost()
        );
        return true;
      }
      if (action === "ask_companion") {
        await beginStageTurn(
          user,
          "brain-boost-intro",
          { ...worldState, step: 0, stageTurns: 0 },
          choice
        );
        return true;
      }
    }

    if (step === 0 && !scrollComplete && stageTurns === 1) {
      if (action === "activate_brain_boost") {
        await beginStageTurn(
          user,
          "brain-boost-effect",
          { ...worldState, step: 0, stageTurns: 1 },
          choice,
          () => activateBrainBoost()
        );
        return true;
      }
      if (action === "continue_story" || action === "ask_companion") {
        await beginStageTurn(
          user,
          "brain-boost-effect",
          { ...worldState, step: 0, stageTurns: 1 },
          choice
        );
        return true;
      }
    }

    if (
      step === 0 &&
      scrollComplete &&
      stageTurns === 0 &&
      (action === "continue_story" || action === "ask_companion" || action === "inspect_world_element")
    ) {
      if (!targetSubject) {
        await beginStageTurn(user, "demo-ending", { ...worldState, step: 0, stageTurns: 0 }, choice);
        return true;
      }
      await beginStageTurn(
        user,
        "quest-intro-1",
        unlockWorldForSubject({ ...worldState, step: 0, stageTurns: 0 }, targetSubject),
        choice
      );
      return true;
    }

    if (
      step === 0 &&
      scrollComplete &&
      stageTurns === 1 &&
      gameState.recentCompletion &&
      (action === "continue_story" || action === "ask_companion")
    ) {
      gameState.recentCompletion = null;
      saveState();
      const nextSubject = getNextIncompleteSubject(gameState);
      progressionInvoked = true;
      if (!nextSubject) {
        await beginStageTurn(user, "demo-ending", { ...worldState, step: 0, stageTurns: 0 }, choice);
        traceCompletionFlow("handleBuildWeekChoice:end", { progressionInvoked: true });
        return true;
      }
      await beginStageTurn(
        user,
        "quest-intro-1",
        unlockWorldForSubject(
          { ...worldState, step: 0, stageTurns: 0, targetSubject: nextSubject },
          nextSubject
        ),
        choice
      );
      traceCompletionFlow("handleBuildWeekChoice:end", { progressionInvoked: true });
      return true;
    }

    if (
      step === 0 &&
      scrollComplete &&
      stageTurns === 1 &&
      !gameState.recentCompletion &&
      (action === "continue_story" || action === "ask_companion" || action === "inspect_world_element")
    ) {
      await beginStageTurn(
        user,
        "quest-intro-2",
        unlockWorldForSubject(
          { ...worldState, step: 0, targetSubject: targetSubject ?? worldState.targetSubject },
          targetSubject
        ),
        choice
      );
      return true;
    }

    if (step === 0 && scrollComplete && stageTurns === 2) {
      if (!targetSubject) {
        await beginStageTurn(user, "demo-ending", { ...worldState, step: 0, stageTurns: 0 }, choice);
        return true;
      }

      if (
        (action === "open_quest_subject" && choice.value === targetSubject) ||
        action === "open_target_quest"
      ) {
        await pauseForQuestCards(user, choice, targetSubject);
        return true;
      }

      // Safety guard: any other choice here (e.g. "Ask Nutty") gets one short
      // explanation and returns to this same open_quest_subject choice —
      // never freeform AI narration, never a new story beat.
      showToast(`${subjectLabel} quests are ready below — open them to choose one.`);
      return "blocked";
    }

    if (step === 6 && (action === "return_home" || action === "read_chronicle")) {
      if (action === "read_chronicle") {
        showToast("You reread today's chronicle.");
      } else {
        renderInteractionChoices([]);
      }
      return true;
    }

    traceCompletionFlow("handleBuildWeekChoice:end", { progressionInvoked });
    return false;
  }

  async function persistAndAdvance(choice) {
    traceCompletionFlow("persistAndAdvance:start", {
      choiceId: choice?.id ?? null,
      choiceAction: choice?.action ?? null
    });
    if (!currentTurnRow || loading) {
      traceCompletionFlow("persistAndAdvance:end", { skipped: true, progressionInvoked: false });
      return;
    }
    loading = true;
    let advanced = false;
    let progressionInvoked = false;

    renderInteractionChoices(normalizeChoices(currentTurnRow.choices, subjectSlugs()));
    document.querySelectorAll("#interaction-buttons button").forEach((btn) => {
      btn.disabled = true;
    });


    try {
      const user = await getSessionUser(client);
      if (!user) throw new Error("Not signed in");

      const buildWeekResult = await handleBuildWeekChoice(user, choice);
      if (buildWeekResult === "blocked") {
        traceCompletionFlow("persistAndAdvance:end", { blocked: true, progressionInvoked: false });
        return;
      }
      if (buildWeekResult === true) {
        advanced = true;
        progressionInvoked = true;
        traceCompletionFlow("persistAndAdvance:end", { progressionInvoked: true });
        return;
      }

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
      advanced = true;
    } catch (err) {
      console.warn("Story advance failed:", err);
      showToast("Story sync failed — try again.");
    } finally {
      loading = false;
      if (!advanced) restoreChoiceButtons();
      traceCompletionFlow("persistAndAdvance:end", { progressionInvoked });
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
    traceCompletionFlow("acknowledgeCompletion:start");
    const pendingKey = gameState.worldState?.pendingStoryKey;
    if (
      loading ||
      !pendingKey ||
      pendingStoryKind(pendingKey) !== "completion-ack"
    ) {
      traceCompletionFlow("acknowledgeCompletion:end", { skipped: true, progressionInvoked: false });
      return false;
    }

    loading = true;
    try {
      const user = await getSessionUser(client);
      if (!user) {
        traceCompletionFlow("acknowledgeCompletion:end", { progressionInvoked: false });
        return false;
      }

      const history = await fetchStoryHistory(client, user.id, 20);
      let row = history.find(
        (item) => item.ai_context?.buildWeek?.pendingStoryKey === pendingKey
      );

      if (!row) {
        row = await createCompletionAckRow(user, pendingKey);
      }

      if (!row) {
        traceCompletionFlow("acknowledgeCompletion:end", { progressionInvoked: false });
        return false;
      }

      currentTurnRow = row;
      renderCompletionAck(row);

      const nextWorld = finalWorldStateForPending({
        ...gameState.worldState,
        pendingStoryKey: pendingKey
      });
      await persistStoryWorld(user.id, nextWorld);
      saveState();

      traceCompletionFlow("acknowledgeCompletion:end", { progressionInvoked: false });
      return true;
    } catch (err) {
      console.warn("Completion acknowledgement failed:", err);
      showToast("Nutty's acknowledgement will retry on refresh.");
      traceCompletionFlow("acknowledgeCompletion:end", { error: true, progressionInvoked: false });
      return false;
    } finally {
      loading = false;
    }
  }

  async function bootstrap() {
    loading = true;

    try {
      const user = await getSessionUser(client);
      if (!user) {
        if (defaultTurn) renderStoryTurn(defaultTurn);
        return;
      }

      const history = await fetchStoryHistory(client, user.id);
      let latest = await fetchLatestStoryTurn(client, user.id);

      const step = gameState.worldState?.step ?? 0;
      const stageTurns = gameState.worldState?.stageTurns ?? 0;


      if (step === 0 && stageTurns === 0 && !gameState.worldState?.scrollComplete) {
        await showOpeningTurn(user, latest, history);
        return;
      }

      latest = await ensureReadyOpeningRow(latest);

      if (latest && !latest.selected_choice_id) {
        currentTurnRow = latest;
        if (isCompletionAckRow(latest) || isCompletionAckBeat()) {
          renderCompletionAck(latest);
        } else {
          renderStoryRow(latest);
        }
      }

      if (gameState.worldState?.pendingStoryKey) {
        const pendingKind = pendingStoryKind(gameState.worldState.pendingStoryKey);
        if (pendingKind === "completion-ack") {
          await acknowledgeCompletion();
          return;
        }
        const recovered = await recoverPendingStageTurn(user, history);
        if (currentTurnRow) return;

        await persistStoryWorld(user.id, {
          ...gameState.worldState,
          pendingStoryKey: null
        });
        saveState();
        latest = await fetchLatestStoryTurn(client, user.id);
        latest = await ensureReadyOpeningRow(latest);
        if (latest && !latest.selected_choice_id) {
          currentTurnRow = latest;
          renderStoryRow(latest);
          return;
        }
      }

      if (gameState.worldState?.step === 1) {
        if (latest) {
          currentTurnRow = latest;
          if (isCompletionAckRow(latest) || isCompletionAckBeat()) {
            renderCompletionAck(latest);
          } else {
            renderStoryRow(latest, true);
          }
        } else {
          renderInteractionChoices([]);
        }
        const subject = getTargetSubject(gameState, gameState.worldState?.targetSubject);
        if (subject) {
          await setSubject(subject, true, null);
        }
        renderQuestList();
        return;
      }

      if (gameState.worldState?.step === 6) {
        if (latest) {
          currentTurnRow = latest;
          renderStoryRow(latest);
        }
        return;
      }

      if (latest && !latest.selected_choice_id) {
        if (isCompletionAckRow(latest) || isCompletionAckBeat()) {
          currentTurnRow = latest;
          renderCompletionAck(latest);
        }
        return;
      }

      // Build Week stages never auto-generate over an answered turn. Recovery is
      // driven by pendingStoryKey; otherwise keep the last narrative visible.
      if (latest && step >= 0 && step <= 6) {
        currentTurnRow = latest;
        renderStoryRow(latest);
        if (step === 0 && stageTurns === 2 && gameState.worldState?.scrollComplete) {
          await ensureQuestDrawerForBuildWeek(user);
        }
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

  async function handleChoiceClick(choiceId) {
    if (loading) return;

    if (!currentTurnRow) {
      try {
        const user = await getSessionUser(client);
        if (!user) return;
        await ensureCurrentTurnRow(user);
      } catch (err) {
        return;
      }
    }

    if (!currentTurnRow) return;

    const choices = normalizeChoices(currentTurnRow.choices, subjectSlugs());
    let choice = choices.find((c) => c.id === choiceId);
    if (!choice && choiceId === "continue-after-completion") {
      choice = normalizeStoryChoice(completionAckChoiceContract(), 0);
    }
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
        choice.action === "open_quest_subject" &&
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

      const targetSubject = getTargetSubject(gameState, gameState.worldState?.targetSubject);
      if (step === 0 && stageTurns === 2 && targetSubject && subject === targetSubject) {
        await pauseForQuestCards(user, null, targetSubject);
        return true;
      }

      if (step === 1 && targetSubject && subject === targetSubject) {
        await setSubject(subject, true, null);
        renderQuestList();
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
    traceCompletionFlow("renderCurrentTurn:start");
    if (currentTurnRow) {
      const completion = isCompletionAckRow(currentTurnRow) || isCompletionAckBeat();
      console.info("[Completion trace] renderCurrentTurn:branch", {
        branch: completion ? "renderCompletionAck" : "renderStoryTurn",
        hideChoices: !completion && (gameState.worldState?.step ?? 0) === 1
      });
      if (completion) {
        renderCompletionAck(currentTurnRow);
      } else {
        const hideChoices = (gameState.worldState?.step ?? 0) === 1;
        renderStoryTurn({
          storyText: currentTurnRow.story_text,
          choices: hideChoices
            ? []
            : normalizeChoices(currentTurnRow.choices, subjectSlugs())
        });
      }
    } else if (defaultTurn) {
      renderStoryTurn(defaultTurn);
    }
    traceCompletionFlow("renderCurrentTurn:end", { progressionInvoked: false });
  }

  return {
    bootstrap,
    handleChoiceClick,
    enterSubjectPath,
    acknowledgeCompletion,
    skipToSubjects,
    renderCurrentTurn,
    logCompletionLayout,
    get currentTurnRow() {
      return currentTurnRow;
    }
  };
}
