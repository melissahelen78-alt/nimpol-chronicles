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

const ACTION_ALIASES = {
  continue: "continue_story",
  select_subject: "open_quest_subject",
  open_quests: "open_quest_subject",
  inspect: "inspect_world_element",
  explore: "inspect_world_element",
  investigate: "inspect_world_element",
  examine: "inspect_world_element",
  ask: "ask_companion",
  talk: "ask_companion"
};

export const QUEST_DRAWER_ACTIONS = new Set(["open_quest_subject"]);

function normalizeActionToken(action) {
  return String(action ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

export function normalizeStoryAction(action) {
  const raw = normalizeActionToken(action);
  if (!raw) return "continue_story";
  if (ACTION_ALIASES[raw]) return ACTION_ALIASES[raw];
  if (STORY_ACTIONS.has(raw)) return raw;
  return "continue_story";
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
