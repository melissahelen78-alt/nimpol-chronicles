/**
 * Hydrates identity from profiles and authoritative progression from RPCs.
 */

export const ATTRIBUTE_KEYS = [
  { id: "mana", label: "Mana", diamond: "mana", barClass: "bar-mana" },
  { id: "knowledge", label: "Knowledge", diamond: "intellect", barClass: "bar-intellect" },
  { id: "perception", label: "Perception", diamond: "perception", barClass: "bar-perception" },
  { id: "creativity", label: "Creativity", diamond: "lore", barClass: "bar-lore" },
  { id: "stamina", label: "Stamina", diamond: "stamina", barClass: "bar-stamina" },
  { id: "resolve", label: "Resolve", diamond: "charisma", barClass: "bar-charisma" }
];

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function barPercent(current, max) {
  const safeMax = Math.max(1, Number(max) || 1);
  return Math.max(0, Math.min(100, Math.round((Number(current) / safeMax) * 100)));
}

function attributeMeta(slug) {
  return ATTRIBUTE_KEYS.find((item) => item.id === slug) ?? {
    id: slug,
    label: slug,
    diamond: slug,
    barClass: `bar-${slug}`
  };
}

/**
 * Fetch the signed-in user's profile row.
 * Falls back to null when there is no session or no row yet.
 */
export async function fetchPlayerProfile(client, session = null) {
  if (!session) {
    const {
      data: { session: currentSession },
      error: sessionError
    } = await client.auth.getSession();

    if (sessionError) throw sessionError;
    session = currentSession;
  }

  if (!session?.user) return null;

  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Ensure a profiles row exists for the signed-in user (e.g. dashboard-created test users).
 */
export async function ensurePlayerProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .insert({ id: userId })
    .select("*")
    .maybeSingle();

  if (error && error.code !== "23505") throw error;

  if (data) return data;

  const { data: existing, error: readError } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (readError) throw readError;
  return existing;
}

export function syncConfigFromProgression(profile, snapshot, config, gameState) {
  if (!snapshot?.rank || !Array.isArray(snapshot.attributes)) {
    throw new Error("Progression RPC returned an invalid snapshot.");
  }

  if (profile?.player_name) config.player.name = profile.player_name;
  config.player.rank = snapshot.rank.name;
  config.player.xp = snapshot.total_xp;
  config.player.rankProgress = snapshot.rank.progress_xp;
  config.player.rankSpan = snapshot.rank.rank_span_xp;
  config.player.xpToNextRank = snapshot.rank.xp_to_next_rank;
  config.player.nextRank = snapshot.rank.next_rank_name;

  config.attributes = snapshot.attributes.map((attribute) => {
    const meta = attributeMeta(attribute.slug);
    const atFinalLevel = attribute.next_level == null;
    return {
      ...meta,
      label: attribute.label ?? meta.label,
      level: attribute.level,
      nextLevel: attribute.next_level,
      attributeXp: attribute.attribute_xp,
      current: atFinalLevel ? 1 : attribute.progress_xp,
      max: atFinalLevel ? 1 : attribute.level_span_xp,
      progressText: atFinalLevel
        ? `${formatNumber(attribute.attribute_xp)} XP`
        : `${formatNumber(attribute.progress_xp)} / ${formatNumber(attribute.level_span_xp)} to Lv. ${attribute.next_level}`
    };
  });

  if (gameState) {
    gameState.xp = snapshot.total_xp;
    gameState.progression = snapshot;
    gameState.worldState = {
      ...gameState.worldState,
      knowledgeLibraryEligible: Boolean(snapshot.knowledge_library_eligible)
    };
  }
}

export function applyProgressionToUI(profile, snapshot, config) {
  if (!snapshot) return;

  const playerName = document.getElementById("playerName");
  const playerRank = document.getElementById("playerRank");
  const xpFill = document.getElementById("xpFill");
  const xpText = document.getElementById("xpText");
  const xpTrack = document.getElementById("xpTrack");
  const attrList = document.getElementById("attrList");

  if (!playerName || !playerRank || !xpFill || !xpText || !xpTrack || !attrList) {
    return;
  }

  const rankProgress = snapshot.rank.rank_span_xp == null
    ? 1
    : snapshot.rank.progress_xp;
  const rankSpan = snapshot.rank.rank_span_xp ?? 1;
  const xpPct = barPercent(rankProgress, rankSpan);

  playerName.textContent = profile?.player_name ?? config.player.name;
  playerRank.textContent = snapshot.rank.name;

  const bannerTitle = document.getElementById("bannerTitle");
  if (bannerTitle) {
    bannerTitle.textContent = `The Chronicles of ${profile?.player_name ?? config.player.name}`;
  }

  const avatarImg = document.querySelector(".avatar-frame img");
  if (avatarImg) avatarImg.alt = profile?.player_name ?? config.player.name;

  xpFill.style.width = `${xpPct}%`;
  xpText.textContent = snapshot.rank.next_rank_name
    ? `${formatNumber(snapshot.total_xp)} XP · ${formatNumber(snapshot.rank.xp_to_next_rank)} to ${snapshot.rank.next_rank_name}`
    : `${formatNumber(snapshot.total_xp)} XP · Max Rank`;
  xpTrack.setAttribute("aria-valuemin", "0");
  xpTrack.setAttribute("aria-valuemax", String(rankSpan));
  xpTrack.setAttribute("aria-valuenow", String(rankProgress));

  attrList.innerHTML = config.attributes
    .map((attr) => {
      const pct = barPercent(attr.current, attr.max);
      return `
        <div class="attr-row" data-attr="${attr.id}">
          <div class="diamond diamond--${attr.diamond}" aria-hidden="true"></div>
          <span class="attr-label">${attr.label} — Lv. ${attr.level} ${attr.progressText}</span>
          <div class="attr-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="${attr.max}" aria-valuenow="${attr.current}" aria-label="${attr.label}">
            <div class="attr-bar-fill ${attr.barClass}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

export function applyProgressionSnapshot(snapshot, config, gameState, profile = null) {
  syncConfigFromProgression(profile, snapshot, config, gameState);
  applyProgressionToUI(profile, snapshot, config);
}

export async function hydratePlayerProfile(client, config, gameState, session = null) {
  if (!session) {
    const {
      data: { session: currentSession },
      error: sessionError
    } = await client.auth.getSession();

    if (sessionError) throw sessionError;
    session = currentSession;
  }

  if (!session?.user) return null;

  let row = await fetchPlayerProfile(client, session);

  if (!row) {
    try {
      row = await ensurePlayerProfile(client, session.user.id);
    } catch (err) {
      console.warn("Could not create profile row:", err);
      return null;
    }
  }

  if (!row) return null;

  const { data: progression, error: progressionError } = await client.rpc(
    "initialize_player_progression"
  );

  if (progressionError) throw progressionError;
  if (!progression) throw new Error("Progression initialization returned no state.");

  applyProgressionSnapshot(progression, config, gameState, row);
  return { profile: row, progression };
}
