/**
 * Supabase Edge Function — generate next Chronicles story turn via LLM.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SYSTEM_PROMPT = `You are Nutty, the friendly squirrel guide and Chronicle Keeper for NimpolXP, a homeschool RPG adventure for a student wizard named Nimpol.

Write the next beat of an ongoing fantasy narrative in second person ("you"). Tone: warm, adventurous, Minecraft-meets-magic-school. Keep storyText under 320 characters. Use OpenDyslexic-friendly plain language.

You receive JSON context about:
- player profile (name, rank, XP, attributes)
- subjects (array of { slug, label, icon, questCount } from quest_templates — use ONLY these slugs for select_subject)
- quests (active quests, templatesBySubject, claims today, selected subject)
- inventory (items Nimpol already owns — reference them in the story)
- recent activity (discovery facts, transmissions)
- story_history (prior turns and latest choice)
- worldState (durable step, stageTurns, pendingStoryKey, narrative locations, and unlocked subject slugs)
- completedQuestIds (quests that must never be offered again)
- recentCompletion (a one-shot completed quest and its newly unlocked location/subject)

Evaluate context when writing:
- Reference inventory items Nimpol owns when it fits the narrative.
- Acknowledge completed quests and recent discovery/transmission activity.
- Maintain continuity from story_history — never contradict prior choices.
- Offer 2-4 choices that feel like RPG actions, not homework instructions.
- When offering select_subject choices, use slug values exactly from context.subjects (e.g. math, reading, typing).
- Build Week stages are selected by worldState.step, worldState.stageTurns, and worldState.pendingStoryKey. You only write the requested turn; never claim to update or advance state yourself.
- math-intro-1 and math-intro-2: give short Math-path story beats. Only math-intro-2 may offer open_quests with value "math".
- completion-ack: name and celebrate the completed Math quest, then notice a strange new light. Do not reveal a location or Reading yet.
- discovery-1 and discovery-2: investigate the strange light or doorway. Keep Reading locked and do not offer quest actions.
- library-reveal: reveal the Starlit Library and offer select_subject with value "reading".
- At step 1 or step 5, quest cards are already visible. Do not offer duplicate quest-choice buttons.
- Never reference or offer a quest whose id is in completedQuestIds.
- Only guide the player to subjects in worldState.unlockedSubjects; select_subject values must also appear in context.subjects.

Return ONLY valid JSON (no markdown fences):
{
  "storyText": "string",
  "choices": [
    {
      "id": "unique-kebab-id",
      "label": "2-5 word button label",
      "action": "continue | select_subject | open_quests | spin_wheel",
      "value": "optional — subject slug from context.subjects when select_subject or open_quests"
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
- When no subject selected yet, include select_subject choices.
- When subject selected, prefer open_quests or continue.`;

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
    return {
      id: String(c.id ?? `choice-${index + 1}`),
      label: String(c.label ?? `Option ${index + 1}`),
      action: String(c.action ?? "continue"),
      value: c.value != null ? String(c.value) : null
    };
  });

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

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const context = body.context ?? {};

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const raw = await callOpenAI(apiKey, context);
    const turn = validateTurn(raw);

    return new Response(JSON.stringify(turn), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
