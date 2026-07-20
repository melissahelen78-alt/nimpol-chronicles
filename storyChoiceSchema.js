/**
 * Story choice action vocabulary shared by client and Edge Function validation.
 */

export const STORY_ACTIONS = new Set([
  "continue_story",
  "open_quest_subject",
  "open_target_quest",
  "ask_companion",
  "inspect_world_element",
  "return_home",
  "read_chronicle",
  "activate_brain_boost",
  "spin_wheel"
]);

const LEGACY_ACTION_ALIASES = {
  continue: "continue_story",
  select_subject: "open_quest_subject",
  open_quests: "open_quest_subject"
};

export const QUEST_DRAWER_ACTIONS = new Set(["open_quest_subject"]);

export function normalizeStoryAction(action) {
  const raw = String(action ?? "continue_story");
  if (STORY_ACTIONS.has(raw)) return raw;
  return LEGACY_ACTION_ALIASES[raw] ?? "continue_story";
}

export function normalizeStoryChoice(choice, index = 0) {
  const action = normalizeStoryAction(choice?.action);
  return {
    id: String(choice?.id ?? `choice-${index + 1}`),
    label: String(choice?.label ?? `Option ${index + 1}`),
    action,
    value: choice?.value != null ? String(choice.value) : null,
    target: choice?.target != null ? String(choice.target) : null
  };
}

export function choiceFunctionalKey(choice) {
  return [
    choice.action,
    choice.value ?? "",
    choice.target ?? ""
  ].join(":");
}

export function dedupeFunctionalChoices(choices) {
  const seen = new Set();
  return choices.filter((choice) => {
    const key = choiceFunctionalKey(choice);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function assertDistinctFunctionalChoices(choices) {
  const keys = choices.map(choiceFunctionalKey);
  return new Set(keys).size === keys.length;
}

export function isQuestDrawerAction(action) {
  return QUEST_DRAWER_ACTIONS.has(normalizeStoryAction(action));
}
