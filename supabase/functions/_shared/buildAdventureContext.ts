import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ADVENTURE_CONTEXT_FALLBACK } from "./adventureContextFallback.ts";

const SCHEMA_VERSION = 1;
const CANONICAL_VERSION = 1;
const RUNTIME_VERSION = 1;
const STORY_HISTORY_LIMIT = 6;
const INVENTORY_LIMIT = 50;

type JsonObject = Record<string, unknown>;

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type WorldRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  metadata: unknown;
};

type ResolvedWorld = {
  slug: string;
  name: string;
  description: string | null;
  metadata: JsonObject;
};

type CharacterDefinitionRow = {
  slug: string;
  name: string;
  description: string | null;
  metadata: JsonObject;
};

type LocationDefinitionRow = {
  slug: string;
  name: string;
  description: string | null;
  metadata: JsonObject;
};

type QuestProgressRow = {
  world_state: unknown;
  selected_subject: string | null;
  highlighted_quest_id: string | null;
  wheel_spins: number;
  last_wheel_result: unknown;
  last_reset_date: string | null;
};

type ProgressionSnapshot = JsonObject;

type ActivityRewardRow = {
  xp_amount: number;
  quest_templates: {
    slug: string;
    is_active: boolean;
  };
  attribute_definitions: {
    slug: string;
  };
};

type ActiveQuestRow = {
  active_quest_id: string;
  template_slug: string;
  subject: string;
  title: string;
  status: string;
  reward_xp: number;
  location_slug: string | null;
  timer_started_at: string | null;
  timer_ready_at: string | null;
  claimed_at: string | null;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
      ...new Set(
        value.filter((item): item is string => typeof item === "string")
      )
    ]
    : [];
}

function requiredRow<T>(
  label: string,
  result: QueryResult<T>
): T {
  if (result.error) {
    throw new Error(`${label} query failed: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${label} is missing`);
  }
  return result.data;
}

function requiredRows<T>(
  label: string,
  result: QueryResult<T[]>
): T[] {
  if (result.error) {
    throw new Error(`${label} query failed: ${result.error.message}`);
  }
  if (!result.data?.length) {
    throw new Error(`${label} is empty`);
  }
  return result.data;
}

function optionalRows<T>(
  label: string,
  result: QueryResult<T[]>
): T[] {
  if (result.error) {
    throw new Error(`${label} query failed: ${result.error.message}`);
  }
  return result.data ?? [];
}

function requiredRpc<T>(
  label: string,
  result: QueryResult<T>
): T {
  if (result.error) {
    throw new Error(`${label} RPC failed: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${label} RPC returned no data`);
  }
  return result.data;
}

function parseWorldRow(data: unknown): WorldRow {
  const row = asObject(data);
  const id = asString(row.id);
  const slug = asString(row.slug);
  const name = asString(row.name);

  if (!id || !slug || !name) {
    throw new Error("Dragon Realm row is malformed");
  }

  return {
    id,
    slug,
    name,
    description: asNullableString(row.description),
    metadata: row.metadata
  };
}

function toResolvedWorld(row: WorldRow): ResolvedWorld {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    metadata: asObject(row.metadata)
  };
}

function parseCharacterDefinitionRow(data: unknown): CharacterDefinitionRow {
  const row = asObject(data);
  const slug = asString(row.slug);
  const name = asString(row.name);

  if (!slug || !name) {
    throw new Error("Character definition row is malformed");
  }

  return {
    slug,
    name,
    description: asNullableString(row.description),
    metadata: asObject(row.metadata)
  };
}

function parseLocationDefinitionRow(data: unknown): LocationDefinitionRow {
  const row = asObject(data);
  const slug = asString(row.slug);
  const name = asString(row.name);

  if (!slug || !name) {
    throw new Error("Location definition row is malformed");
  }

  return {
    slug,
    name,
    description: asNullableString(row.description),
    metadata: asObject(row.metadata)
  };
}

function parseQuestProgressRow(data: unknown): QuestProgressRow {
  const row = asObject(data);
  return {
    world_state: row.world_state,
    selected_subject: asNullableString(row.selected_subject),
    highlighted_quest_id: asNullableString(row.highlighted_quest_id),
    wheel_spins: asNumber(row.wheel_spins),
    last_wheel_result: row.last_wheel_result ?? null,
    last_reset_date: asNullableString(row.last_reset_date)
  };
}

function parseProgressionSnapshot(data: unknown): ProgressionSnapshot {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Progression snapshot RPC returned malformed data");
  }
  return data as ProgressionSnapshot;
}

function parseActivityRewardRow(data: unknown): ActivityRewardRow | null {
  const row = asObject(data);
  const template = asObject(row.quest_templates);
  const attribute = asObject(row.attribute_definitions);
  const templateSlug = asString(template.slug);
  const attributeSlug = asString(attribute.slug);

  if (!templateSlug || !attributeSlug) {
    return null;
  }

  return {
    xp_amount: asNumber(row.xp_amount),
    quest_templates: {
      slug: templateSlug,
      is_active: Boolean(template.is_active)
    },
    attribute_definitions: {
      slug: attributeSlug
    }
  };
}

function normalizeActivityRewards(rows: unknown[]): ActivityRewardRow[] {
  return rows
    .map(parseActivityRewardRow)
    .filter((row): row is ActivityRewardRow => row != null);
}

function parseActiveQuestRow(data: unknown): ActiveQuestRow | null {
  const row = asObject(data);
  const template = asObject(row.quest_templates);
  const activeQuestId = asString(row.id);
  const templateSlug = asString(template.slug);
  const subject = asString(template.subject);
  const title = asString(template.title);
  const status = asString(row.status);

  if (!activeQuestId || !templateSlug || !subject || !title || !status) {
    return null;
  }

  return {
    active_quest_id: activeQuestId,
    template_slug: templateSlug,
    subject,
    title,
    status,
    reward_xp: asNumber(template.reward_xp),
    location_slug: asNullableString(template.location_slug),
    timer_started_at: asNullableString(row.timer_started_at),
    timer_ready_at: asNullableString(row.timer_ready_at),
    claimed_at: asNullableString(row.claimed_at)
  };
}

function normalizeActiveQuests(rows: unknown[]): ActiveQuestRow[] {
  return rows
    .map(parseActiveQuestRow)
    .filter((row): row is ActiveQuestRow => row != null);
}

function buildRewardsByTemplate(
  rewards: ActivityRewardRow[]
): Record<string, Array<{ attribute_slug: string; xp_amount: number }>> {
  const rewardsByTemplate: Record<
    string,
    Array<{ attribute_slug: string; xp_amount: number }>
  > = {};

  for (const row of rewards) {
    const templateSlug = row.quest_templates.slug;
    const attributeSlug = row.attribute_definitions.slug;
    if (!rewardsByTemplate[templateSlug]) {
      rewardsByTemplate[templateSlug] = [];
    }
    rewardsByTemplate[templateSlug].push({
      attribute_slug: attributeSlug,
      xp_amount: row.xp_amount
    });
  }

  return rewardsByTemplate;
}

function normalizeWorldState(value: unknown) {
  const state = asObject(value);
  return {
    step: asNumber(state.step),
    stage_turns: asNumber(state.stage_turns ?? state.stageTurns),
    pending_story_key: asNullableString(
      state.pending_story_key ?? state.pendingStoryKey
    ),
    unlocked_locations: asStringArray(
      state.unlocked_locations ?? state.unlockedLocations
    ),
    unlocked_subjects: asStringArray(
      state.unlocked_subjects ?? state.unlockedSubjects
    ),
    completed_quest_ids: asStringArray(
      state.completed_quest_ids ?? state.completedQuestIds
    ),
    knowledge_library_eligible: Boolean(
      state.knowledge_library_eligible ?? state.knowledgeLibraryEligible
    )
  };
}

export function whitelistRuntimeFields(sourceValue: unknown) {
  const source = asObject(sourceValue);
  const quests = asObject(source.quests);
  const lastChoice = asObject(source.lastChoice);
  const recentCompletion = asObject(source.recentCompletion);
  const activity = asObject(source.activity);

  const storyHistory = Array.isArray(source.storyHistory)
    ? source.storyHistory.slice(-STORY_HISTORY_LIMIT).map((item) => {
      const row = asObject(item);
      return {
        turn_index: asNumber(row.turn_index ?? row.turnIndex),
        story_text: asString(row.story_text ?? row.storyText),
        selected_choice_id: asNullableString(
          row.selected_choice_id ?? row.selectedChoiceId
        ),
        selected_choice_label: asNullableString(
          row.selected_choice_label ?? row.selectedChoiceLabel
        )
      };
    })
    : [];

  const inventory = Array.isArray(source.inventory)
    ? source.inventory.slice(0, INVENTORY_LIMIT).map((item) => {
      const row = asObject(item);
      return {
        slug: asNullableString(row.slug),
        name: asString(row.name),
        rarity: asString(row.rarity, "common"),
        quantity: Math.max(1, asNumber(row.quantity, 1))
      };
    })
    : [];

  return {
    lastChoice: Object.keys(lastChoice).length
      ? {
        id: asString(lastChoice.id),
        label: asString(lastChoice.label),
        action: asString(lastChoice.action, "continue"),
        value: asNullableString(lastChoice.value)
      }
      : null,
    storyHistory,
    recentCompletion: Object.keys(recentCompletion).length
      ? {
        questId: asString(recentCompletion.questId),
        questTitle: asString(recentCompletion.questTitle),
        subject: asString(recentCompletion.subject)
      }
      : null,
    inventory,
    activity: {
      last_discovery_title: asNullableString(
        activity.last_discovery_title ?? activity.lastDiscoveryTitle
      ),
      hours_since_discovery_view: activity.hours_since_discovery_view != null ||
          activity.hoursSinceDiscoveryView != null
        ? asNumber(
          activity.hours_since_discovery_view ?? activity.hoursSinceDiscoveryView
        )
        : null,
      last_transmission_title: asNullableString(
        activity.last_transmission_title ?? activity.lastTransmissionTitle
      ),
      hours_since_transmission_watch:
        activity.hours_since_transmission_watch != null ||
          activity.hoursSinceTransmissionWatch != null
          ? asNumber(
            activity.hours_since_transmission_watch ??
              activity.hoursSinceTransmissionWatch
          )
          : null
    },
    session: {
      selected_subject: asNullableString(
        quests.selected_subject ?? quests.selectedSubject
      ),
      highlighted_quest_id: asNullableString(
        quests.highlighted_quest_id ?? quests.highlightedQuestId
      ),
      wheel_spins: asNumber(quests.wheel_spins ?? quests.wheelSpins),
      last_wheel_result:
        quests.last_wheel_result ?? quests.lastWheelResult ?? null,
      claimed_today: asStringArray(quests.claimed_today ?? quests.claimedToday)
    }
  };
}

function questDateUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveWorldCanon(
  client: SupabaseClient,
  worldResult: QueryResult<unknown>
): Promise<{
  world: ResolvedWorld;
  characters: CharacterDefinitionRow[];
  locations: LocationDefinitionRow[];
}> {
  if (worldResult.error) {
    throw new Error(`Dragon Realm query failed: ${worldResult.error.message}`);
  }

  if (worldResult.data) {
    const worldRow = parseWorldRow(worldResult.data);
    const [charactersResult, locationsResult] = await Promise.all([
      client
        .from("character_definitions")
        .select("slug, name, description, metadata")
        .eq("world_id", worldRow.id),
      client
        .from("location_definitions")
        .select("slug, name, description, metadata")
        .eq("world_id", worldRow.id)
    ]);

    const characters = requiredRows("Character definitions", charactersResult)
      .map(parseCharacterDefinitionRow);
    const locations = optionalRows("Location definitions", locationsResult)
      .map(parseLocationDefinitionRow);

    if (!characters.some((character) => character.slug === "nutty")) {
      throw new Error("Character definitions are missing Nutty");
    }

    return {
      world: toResolvedWorld(worldRow),
      characters,
      locations
    };
  }

  if (Deno.env.get("ADVENTURE_CONTEXT_ALLOW_FALLBACK") === "true") {
    return {
      world: {
        slug: ADVENTURE_CONTEXT_FALLBACK.world.slug,
        name: ADVENTURE_CONTEXT_FALLBACK.world.name,
        description: ADVENTURE_CONTEXT_FALLBACK.world.description,
        metadata: asObject(ADVENTURE_CONTEXT_FALLBACK.world.metadata)
      },
      characters: ADVENTURE_CONTEXT_FALLBACK.characters.map((character) => ({
        slug: character.slug,
        name: character.name,
        description: character.description,
        metadata: asObject(character.metadata)
      })),
      locations: ADVENTURE_CONTEXT_FALLBACK.locations.map((location) => ({
        slug: location.slug,
        name: location.name,
        description: location.description,
        metadata: asObject(location.metadata)
      }))
    };
  }

  throw new Error("Dragon Realm is missing");
}

export async function buildAdventureContext(
  client: SupabaseClient,
  userId: string,
  runtimeSource: unknown
) {
  const questDate = questDateUtc();

  const [
    profileResult,
    progressionResult,
    questProgressResult,
    worldResult,
    templatesResult,
    rewardsResult,
    attributeDefinitionsResult,
    activeQuestsResult
  ] = await Promise.all([
    client
      .from("profiles")
      .select("id, player_name")
      .eq("id", userId)
      .maybeSingle(),
    client.rpc("get_player_progression_snapshot"),
    client
      .from("quest_progress")
      .select(
        "world_state, selected_subject, highlighted_quest_id, " +
          "wheel_spins, last_wheel_result, last_reset_date"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("worlds")
      .select("id, slug, name, description, metadata")
      .or("slug.eq.dragon-realm,name.eq.Dragon Realm")
      .limit(1)
      .maybeSingle(),
    client
      .from("quest_templates")
      .select(
        "id, slug, subject, subject_label, subject_icon, " +
          "subject_sort_order, tool_name, title, description, icon, " +
          "reward_xp, portal_url, verification_type, delay_minutes, " +
          "sort_order, is_active, created_at, metadata, story_context, " +
          "location_slug, story_weight, prerequisite_tags"
      )
      .eq("is_active", true)
      .order("sort_order")
      .order("slug"),
    client
      .from("activity_attribute_rewards")
      .select(
        "xp_amount, quest_templates!inner(slug, is_active), " +
          "attribute_definitions!inner(slug)"
      )
      .eq("quest_templates.is_active", true),
    client
      .from("attribute_definitions")
      .select("slug, label, sort_order, is_mana")
      .order("sort_order")
      .order("slug"),
    client
      .from("active_quests")
      .select(
        "id, status, timer_started_at, timer_ready_at, claimed_at, " +
          "quest_templates!inner(slug, subject, title, reward_xp, location_slug)"
      )
      .eq("user_id", userId)
      .eq("quest_date", questDate)
      .order("created_at")
  ]);

  const profile = requiredRow("Profile", profileResult);
  const progression = parseProgressionSnapshot(
    requiredRpc("Progression snapshot", progressionResult)
  );
  const questProgress = parseQuestProgressRow(
    requiredRow("Quest progress", questProgressResult)
  );
  const templates = requiredRows("Quest catalog", templatesResult);
  const rewards = normalizeActivityRewards(
    optionalRows("Activity attribute rewards", rewardsResult)
  );
  const attributeDefinitions = requiredRows(
    "Attribute definitions",
    attributeDefinitionsResult
  );
  const activeQuests = normalizeActiveQuests(
    optionalRows("Active quests", activeQuestsResult)
  );
  const { world, characters, locations } = await resolveWorldCanon(
    client,
    worldResult
  );
  const rewardsByTemplate = buildRewardsByTemplate(rewards);

  const progressionWithoutEligibility = { ...progression };
  delete progressionWithoutEligibility.knowledge_library_eligible;

  return {
    schemaVersion: SCHEMA_VERSION,
    canonicalVersion: CANONICAL_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    canonical: {
      definitions: {
        world,
        characters,
        locations,
        questTemplates: templates,
        activityAttributeRewards: rewardsByTemplate,
        attributeDefinitions
      },
      player: {
        profile_id: asString(profile.id),
        name: asString(profile.player_name, "Nimpol")
      },
      progression: progressionWithoutEligibility,
      worldState: normalizeWorldState(questProgress.world_state),
      questSession: {
        selected_subject: questProgress.selected_subject,
        highlighted_quest_id: questProgress.highlighted_quest_id,
        wheel_spins: questProgress.wheel_spins,
        last_wheel_result: questProgress.last_wheel_result
      },
      today: {
        quest_date: questDate,
        activeQuests
      }
    },
    runtime: whitelistRuntimeFields(runtimeSource)
  };
}
