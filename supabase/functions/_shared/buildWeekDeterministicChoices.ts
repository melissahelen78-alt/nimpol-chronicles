/**
 * Deterministic Build Week choice buttons — mirrors buildWeekTurn() in storyEngine.js.
 * Narration may be AI-generated; these choices drive progression.
 */

export type BuildWeekChoice = {
  id: string;
  label: string;
  action: string;
  value?: string | null;
  target?: string | null;
};

export type BuildWeekPendingKind =
  | "brain-boost-intro"
  | "brain-boost-effect"
  | "quest-intro-1"
  | "quest-intro-2"
  | "completion-ack"
  | "demo-ending";

const PENDING_STORY_KIND_PREFIXES: BuildWeekPendingKind[] = [
  "brain-boost-intro",
  "brain-boost-effect",
  "quest-intro-1",
  "quest-intro-2",
  "completion-ack",
  "demo-ending"
];

type QuestTemplateRow = {
  subject?: string;
  subject_label?: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Ordered prefix match — do not split on ":" (keys may embed extra segments). */
export function parsePendingStoryKind(
  key: string | null
): BuildWeekPendingKind | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;

  for (const prefix of PENDING_STORY_KIND_PREFIXES) {
    if (raw === prefix || raw.startsWith(`${prefix}:`)) {
      return prefix;
    }
  }

  return null;
}

/** @deprecated Prefer parsePendingStoryKind for Build Week keys. */
export function pendingStoryKind(key: string | null): string {
  return parsePendingStoryKind(key) ?? String(key ?? "").split(":")[0];
}

export function choiceFunctionalKey(choice: BuildWeekChoice): string {
  return [choice.action, choice.value ?? "", choice.target ?? ""].join(":");
}

export function assertDistinctFunctionalChoices(choices: BuildWeekChoice[]): void {
  const keys = choices.map(choiceFunctionalKey);
  if (new Set(keys).size !== keys.length) {
    const seen = new Set<string>();
    const duplicates = keys.filter((key) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    throw new Error(
      `Build Week choices must have distinct functional effects (duplicate: ${[...new Set(duplicates)].join(", ")})`
    );
  }
}

function subjectLabelFromTemplates(
  subject: string,
  questTemplates: unknown[]
): string {
  for (const row of questTemplates) {
    const template = asObject(row) as QuestTemplateRow;
    if (template.subject === subject) {
      const label = asString(template.subject_label);
      if (label) return label;
    }
  }
  return subject;
}

export function buildWeekDeterministicChoices(
  kind: BuildWeekPendingKind,
  options: {
    targetSubject: string | null;
    questTemplates?: unknown[];
  }
): BuildWeekChoice[] {
  const templates = options.questTemplates ?? [];
  const targetSubject = options.targetSubject;

  switch (kind) {
    case "brain-boost-intro":
      return [
        {
          id: "im-ready",
          label: "I'm Ready!",
          action: "activate_brain_boost"
        },
        {
          id: "look-at-scroll",
          label: "Look at the scroll",
          action: "inspect_world_element",
          target: "scroll-of-knowledge"
        }
      ];
    case "brain-boost-effect":
      return [
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
      ];
    case "quest-intro-1":
      return [
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
      ];
    case "quest-intro-2": {
      if (!targetSubject) {
        throw new Error("Build Week quest offer is missing target subject");
      }
      return [
        {
          id: "ask-about-subject-quests",
          label: "Ask Nutty",
          action: "ask_companion",
          target: "subject-quests"
        },
        {
          id: "look-at-quest-board",
          label: "Look at the quest board",
          action: "inspect_world_element",
          target: "quest-board"
        }
      ];
    }
    case "completion-ack":
      return [
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
      ];
    case "demo-ending":
      return [
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
      ];
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown Build Week pending story kind: ${_exhaustive}`);
    }
  }
}

export function buildWeekDeterministicChoicesForPendingKey(
  pendingStoryKey: string,
  options: {
    targetSubject: string | null;
    questTemplates?: unknown[];
  }
): BuildWeekChoice[] {
  const kind = parsePendingStoryKind(pendingStoryKey);
  if (!kind) {
    throw new Error(`Unknown Build Week pending story kind: ${pendingStoryKey}`);
  }

  const choices = buildWeekDeterministicChoices(kind, options);
  assertDistinctFunctionalChoices(choices);
  return choices;
}

export function allBuildWeekDeterministicChoiceSets(options: {
  targetSubject: string;
  questTemplates?: unknown[];
}): Record<BuildWeekPendingKind, BuildWeekChoice[]> {
  const sets = {} as Record<BuildWeekPendingKind, BuildWeekChoice[]>;
  for (const kind of PENDING_STORY_KIND_PREFIXES) {
    sets[kind] = buildWeekDeterministicChoices(kind, options);
    assertDistinctFunctionalChoices(sets[kind]);
  }
  return sets;
}
