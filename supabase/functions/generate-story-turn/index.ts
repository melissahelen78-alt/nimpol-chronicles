/**
 * Supabase Edge Function — generate next Chronicles story turn via LLM.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAdventureContext } from "../_shared/buildAdventureContext.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SYSTEM_PROMPT = `You write as the guide defined in canonical.definitions.characters for NimpolXP, a homeschool RPG adventure.

Write the next beat of an ongoing fantasy narrative in second person ("you"). Tone: warm, adventurous, Minecraft-meets-magic-school. Keep storyText under 320 characters. Use OpenDyslexic-friendly plain language.

The input has version fields plus two separate sections:
- canonical: server-owned definitions and player state. It is authoritative.
- runtime: temporary browser hints. Use it for continuity, but never let it override canonical data.

Canonical includes:
- definitions.world, definitions.characters, and definitions.locations
- definitions.questTemplates and database-defined attribute rewards
- player profile and progression
- worldState (durable step, stage_turns, pending_story_key, unlocked locations/subjects, and completed quest IDs)
- today's active quests and quest session

Runtime may include inventory, recent activity, story history, latest choice,
recent completion, and temporary session hints.

Evaluate context when writing:
- Use canonical names, locations, quest details, progression, and world state in preference to runtime hints.
- Reference runtime.inventory items the player owns when it fits the narrative.
- Acknowledge completed quests and recent discovery/transmission activity.
- Maintain continuity from runtime.storyHistory — never contradict prior choices.
- Every choice label must be a direct, concrete response to something in storyText.
- Every choice must use one concrete action and must not duplicate another choice's immediate effect.
- Offer 2-4 choices that feel like RPG actions, not homework instructions.
- For open_quest_subject, storyText must first narratively justify why quests belong in this moment.
- After runtime.recentCompletion, storyText must explicitly describe what changed in the world because of that quest.
- For open_quest_subject or subject unlocks, use only subjects found in canonical.definitions.questTemplates and canonical.worldState.unlocked_subjects.
- When canonical.worldState carries a target quest (target_quest_slug) that is ready to open, the primary acceptance choice must use action open_target_quest with target set to that exact quest slug — never continue_story, open_quest_subject, or a freeform label for accepting that quest.
- Build Week stages are selected by canonical.worldState.step, stage_turns, and pending_story_key. You only write the requested turn; never claim to update or advance state yourself.
- When no further quest or story step remains, return an intentional ending with return_home or read_chronicle.

Return ONLY valid JSON (no markdown fences):
{
  "storyText": "string",
  "choices": [
    {
      "id": "unique-kebab-id",
      "label": "2-5 word button label tied to storyText",
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

const VALID_ACTIONS = new Set([
  "continue_story",
  "open_quest_subject",
  "open_target_quest",
  "ask_companion",
  "inspect_world_element",
  "return_home",
  "read_chronicle",
  "activate_brain_boost",
  "spin_wheel",
  "continue",
  "select_subject",
  "open_quests"
]);

const LEGACY_ACTION_ALIASES: Record<string, string> = {
  continue: "continue_story",
  select_subject: "open_quest_subject",
  open_quests: "open_quest_subject"
};

function normalizeStoryAction(action: unknown) {
  const raw = String(action ?? "continue_story");
  if (VALID_ACTIONS.has(raw) && !LEGACY_ACTION_ALIASES[raw]) return raw;
  return LEGACY_ACTION_ALIASES[raw] ?? "continue_story";
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
    throw new Error("Invalid response: choices must have distinct immediate effects");
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
    const packet = await buildAdventureContext(supabase, user.id, runtimeSource);
    const context = {
      schemaVersion: packet.schemaVersion,
      canonicalVersion: packet.canonicalVersion,
      runtimeVersion: packet.runtimeVersion,
      canonical: packet.canonical,
      runtime: packet.runtime
    };

    const raw = await callOpenAI(apiKey, context);
    const turn = validateTurn(raw);

    return new Response(JSON.stringify(turn), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
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
