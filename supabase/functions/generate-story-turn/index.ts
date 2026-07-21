/**
 * Supabase Edge Function — generate next Chronicles story turn via LLM.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAdventureContext } from "../_shared/buildAdventureContext.ts";
import {
  buildWeekDeterministicChoicesForPendingKey,
  parsePendingStoryKind
} from "../_shared/buildWeekDeterministicChoices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SYSTEM_PROMPT = `You write as the guide defined in canonical.definitions.characters for NimpolXP, a homeschool RPG adventure.

Write the next beat of an ongoing fantasy narrative in second person ("you"). Use OpenDyslexic-friendly plain language.

The input has version fields plus two separate sections:
- canonical: server-owned definitions and player state. It is authoritative.
- runtime: temporary browser hints. Use it for continuity, but never let it override canonical data.

Canonical includes:
- definitions.world, definitions.characters, and definitions.locations
- definitions.questTemplates and database-defined attribute rewards
- player profile and progression
- worldState (durable step, stage_turns, pending_story_key, target_subject, target_quest_slug, unlocked locations/subjects, and completed quest IDs)
- adventureBrief (required dramatic purpose for this turn: beat, scene_purpose, emotional_goal, target_subject, allow_quest_opening, require_world_change, featured_character)
- today's active quests and quest session

Runtime may include inventory, recent activity, story history, latest choice,
recent completion, and temporary session hints.

Evaluate context when writing:
- Treat canonical.adventureBrief as the required dramatic purpose of the turn. Every sentence must serve the brief.
- Use canonical names, locations, quest details, progression, and world state in preference to runtime hints.
- Reference runtime.inventory items the player owns when it fits the narrative.
- Acknowledge completed quests and recent discovery/transmission activity.
- Maintain continuity from runtime.storyHistory — never contradict prior choices.
- Every choice must use one concrete action and must not duplicate another choice's immediate effect.
- Offer 2-4 choices that feel like RPG actions, not homework instructions.
- Do not merely say that a crystal, path, rune, glow, or world "shifts." Use one specific discovery, consequence, character reaction, or visible world change.
- For beat quest_setup, create the story need but do not name or offer learning activities yet.
- For beat quest_offer, continue the exact problem established by the previous scene and justify opening the target subject's approved quests.
- For beat quest_payoff, explicitly show what changed because the completed quest succeeded.
- Respect canonical.adventureBrief.allow_quest_opening. Do not return open_quest_subject when it is false.
- If canonical.adventureBrief.require_world_change is true, storyText must contain a concrete world change or discovery.
- Match choice actions to canonical.adventureBrief.beat:
  - discovery: offer continue_story, ask_companion, or inspect_world_element; never open quests.
  - quest_setup: offer continue_story, ask_companion, or inspect_world_element; never open quests yet.
  - quest_offer: the primary choice must use open_quest_subject with value equal to canonical.adventureBrief.target_subject; an optional secondary choice may use ask_companion; do not use continue_story.
  - quest_payoff: offer continue_story or ask_companion; show a concrete consequence of the completed quest in storyText.
  - resolution: offer return_home and/or read_chronicle; do not continue into another story beat.
- For open_quest_subject, storyText must first narratively justify why quests belong in this moment.
- After runtime.recentCompletion, storyText must explicitly describe what changed in the world because of that quest.
- For open_quest_subject or subject unlocks, use only subjects found in canonical.definitions.questTemplates and canonical.worldState.unlocked_subjects.
- When canonical.worldState carries a target quest (target_quest_slug) that is ready to open, the primary acceptance choice must use action open_target_quest with target set to that exact quest slug — never continue_story, open_quest_subject, or a freeform label for accepting that quest.
- Build Week stages are selected by canonical.worldState.step, stage_turns, and pending_story_key. You only write the requested turn; never claim to update or advance state yourself.
- When no further quest or story step remains, return an intentional ending with return_home or read_chronicle.

When canonical.worldState.pending_story_key is set, you are writing Build Week narration only. Your choices are advisory and will be replaced by deterministic application choices before the player sees them — do not rely on your choices to advance Build Week progression. Focus on storyText quality, brief fulfillment, and continuity. Include valid placeholder choices if the JSON schema requires them; use scene-specific advisory labels (see Button labels below).

Build Week storytelling (when pending_story_key is set):

STYLE — Write like an animated fantasy adventure for children ages 7–10. Playful, confident, cinematic. Less narration. More moments.

LENGTH — Normally 40–70 words. Never exceed 90 words unless absolutely necessary. Do not summarize previous scenes; assume the player just read them.

PACE — Each scene accomplishes ONE thing only: introduce something interesting, reveal a clue, celebrate a success, or transition to the next decision. Do not combine multiple story beats.

SHOW DON'T TELL — Prefer concrete observation over emotional exposition.
  Good: "Nimpol notices a faint glow."
  Bad: "You feel inspired by the magical glowing energy surrounding you."
Let the player imagine.

NUTTY — Nutty carries much of the personality. He can point, squeak, joke, ask questions, and notice things. Do not have the narrator constantly explain emotions when Nutty can react instead.

WORLD — Assume the artwork already shows the environment. Do not repeatedly describe glowing, sparkling, shimmering, vibrant, or magical scenery. Only mention visual details when something NEW changes.

EMOTIONS — Avoid telling the player how they feel. Show reactions instead.
  Example: Nutty freezes. "Did you hear that?"

REPETITION — Avoid repeating the same adjective or emotional beat in consecutive scenes. Especially avoid overusing: wonder, curiosity, magic, sparkles, glowing, vibrant, mysterious.

ENDING — Stop immediately before the next interaction. Never narrate what the player is about to choose.

BUTTON LABELS (advisory only for Build Week; actions are replaced by the app):
- Labels must describe what is happening in THIS scene — story actions, not engine commands.
- Do not change the underlying action tokens; only improve the visible label text.
- Prefer scene-specific labels:
  - Instead of "Continue": "Follow Nutty", "Walk toward the doorway", "Step inside", "Look through the opening"
  - Instead of "Open Brain Boost Quests": "See what the sign reveals", "Accept the Maze Challenge", "View the forest trials"
  - Instead of "Use Brain Boost": tie to the scroll or clue in the scene
  - Instead of "Ask Nutty": "Ask Nutty what that sound was", "Whisper to Nutty"

Return ONLY valid JSON (no markdown fences):
{
  "storyText": "string",
  "choices": [
    {
      "id": "unique-kebab-id",
      "label": "2-5 word scene-specific button label",
      "action": "continue_story | open_quest_subject | open_target_quest | ask_companion | inspect_world_element | return_home | read_chronicle | activate_brain_boost | spin_wheel",
      "value": "optional subject slug when action is open_quest_subject",
      "target": "quest slug when action is open_target_quest; otherwise an optional world element or companion topic slug"
    }
  ],
  "lootAward": {
    "itemSlug": "optional — one of: focus-crystal-shard, mana-potion, ancient-scroll, wizard-hat-patch, enchanted-quill, dragon-scale, starlight-gem, chronicle-crown",
    "reason": "optional short reason"
  }
}

Rules:
- choices: 2 to 4 items.
- lootAward: include rarely (roughly 1 in 8 turns) when the story moment fits; omit otherwise.
- Legacy actions continue, select_subject, and open_quests are forbidden in new output.`;

function buildUserPrompt(context: Record<string, unknown>) {
  return `Generate the next Chronicles turn:

${JSON.stringify(context, null, 2)}

JSON only.`;
}

async function callOpenAI(apiKey: string, context: Record<string, unknown>) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(context) }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");

  return JSON.parse(content);
}

const CANONICAL_ACTIONS = new Set([
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

const ACTION_ALIASES: Record<string, string> = {
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

function normalizeActionToken(action: unknown) {
  return String(action ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function normalizeStoryAction(action: unknown) {
  const raw = normalizeActionToken(action);
  if (!raw) {
    throw new Error("Invalid response: choice missing action");
  }
  if (ACTION_ALIASES[raw]) return ACTION_ALIASES[raw];
  if (CANONICAL_ACTIONS.has(raw)) return raw;
  throw new Error(`Invalid response: unknown action "${raw}"`);
}

function choiceFunctionalKey(choice: {
  action: string;
  value: string | null;
  target: string | null;
}) {
  return [choice.action, choice.value ?? "", choice.target ?? ""].join(":");
}

function validateTurn(raw: { storyText?: string; choices?: unknown[]; lootAward?: unknown }) {
  if (!raw?.storyText || typeof raw.storyText !== "string") {
    throw new Error("Invalid response: missing storyText");
  }

  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  if (choices.length < 2 || choices.length > 4) {
    throw new Error("Invalid response: choices must be 2-4 items");
  }

  const normalized = choices.map((choice, index) => {
    const c = choice as Record<string, unknown>;
    const action = normalizeStoryAction(c.action);
    return {
      id: String(c.id ?? `choice-${index + 1}`),
      label: String(c.label ?? `Option ${index + 1}`),
      action,
      value: c.value != null ? String(c.value) : null,
      target: c.target != null ? String(c.target) : null
    };
  });

  const functionalKeys = normalized.map(choiceFunctionalKey);
  if (new Set(functionalKeys).size !== functionalKeys.length) {
    const seen = new Set<string>();
    const duplicates = functionalKeys.filter((key) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    console.error(
      "[generate-story-turn] duplicate functional keys:",
      functionalKeys,
      "normalized:",
      normalized.map((choice) => ({
        action: choice.action,
        value: choice.value,
        target: choice.target
      }))
    );
    throw new Error(
      `Invalid response: choices must have distinct immediate effects (duplicate: ${[...new Set(duplicates)].join(", ")})`
    );
  }

  const result: Record<string, unknown> = {
    storyText: raw.storyText.trim(),
    choices: normalized
  };

  if (raw.lootAward && typeof raw.lootAward === "object") {
    const loot = raw.lootAward as Record<string, unknown>;
    if (loot.itemSlug) {
      result.lootAward = {
        itemSlug: String(loot.itemSlug),
        reason: loot.reason != null ? String(loot.reason) : null
      };
    }
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" }
        }
      }
    );

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const runtimeSource = body.context ?? body.runtime ?? {};
    let packet;
    try {
      packet = await buildAdventureContext(supabase, user.id, runtimeSource);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[generate-story-turn] buildAdventureContext failed:", message);
      throw err;
    }

    const dbPendingStoryKey = packet.canonical.worldState.pending_story_key;
    const runtimePendingStoryKey =
      packet.runtime.buildWeek?.pending_story_key ?? null;
    const pendingStoryKey = dbPendingStoryKey ?? runtimePendingStoryKey;
    if (pendingStoryKey) {
      const parsedKind = parsePendingStoryKind(pendingStoryKey);
      const brief = packet.canonical.adventureBrief;
      console.info("[BuildWeek pending turn server]", {
        pendingStoryKey,
        dbPendingStoryKey,
        runtimePendingStoryKey,
        parsedKind,
        adventureBriefBeat: brief?.beat ?? null,
        adventureBriefTargetSubject: brief?.target_subject ?? null
      });
    }
    const context = {
      schemaVersion: packet.schemaVersion,
      canonicalVersion: packet.canonicalVersion,
      runtimeVersion: packet.runtimeVersion,
      canonical: packet.canonical,
      runtime: packet.runtime
    };

    let raw;
    try {
      raw = await callOpenAI(apiKey, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[generate-story-turn] callOpenAI failed:", message);
      throw err;
    }

    if (pendingStoryKey) {
      const parsedKind = parsePendingStoryKind(pendingStoryKey);
      const brief = packet.canonical.adventureBrief as {
        target_subject?: string | null;
      } | undefined;
      const targetSubject =
        brief?.target_subject ??
        packet.canonical.worldState.target_subject ??
        null;
      const deterministicChoices = buildWeekDeterministicChoicesForPendingKey(
        pendingStoryKey,
        {
          targetSubject,
          questTemplates: packet.canonical.definitions.questTemplates
        }
      );
      console.info("[BuildWeek deterministic choices]", {
        pendingStoryKey,
        parsedKind,
        dbPendingStoryKey,
        runtimePendingStoryKey,
        targetSubject,
        choices: deterministicChoices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          action: choice.action,
          value: choice.value ?? null,
          target: choice.target ?? null
        }))
      });
      raw = {
        ...raw,
        choices: deterministicChoices
      };
    }

    if (pendingStoryKey) {
      const preValidateChoices = Array.isArray(raw.choices) ? raw.choices : [];
      console.info("[BuildWeek validateTurn input choices]", {
        pendingStoryKey,
        parsedKind: parsePendingStoryKind(pendingStoryKey),
        choices: preValidateChoices.map((choice) => {
          const row = choice as Record<string, unknown>;
          return {
            id: String(row.id ?? ""),
            label: String(row.label ?? ""),
            action: String(row.action ?? ""),
            value: row.value != null ? String(row.value) : null,
            target: row.target != null ? String(row.target) : null
          };
        })
      });
    }

    let turn;
    try {
      turn = validateTurn(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[generate-story-turn] validateTurn failed:", message);
      throw err;
    }

    return new Response(JSON.stringify(turn), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof Error && err.stack) {
      console.error("[generate-story-turn] 500:", message, err.stack);
    } else {
      console.error("[generate-story-turn] 500:", message);
    }
    const status = message.includes("Player progression is not initialized")
      ? 503
      : 500;
    return new Response(
      JSON.stringify({ error: message }),
      {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
