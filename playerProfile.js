/**
 * Maps a Supabase profiles row → dashboard CONFIG + DOM updates.
 *
 * HTML targets (index.html):
 *   #playerName      — .name-plate
 *   #playerRank      — .rank-ribbon
 *   #xpFill          — .xp-fill width %
 *   #xpText          — overlay label inside .xp-track
 *   #xpTrack         — role="progressbar" aria values
 *   #attrList        — .attr-row blocks with .attr-bar-fill width %
 */

export const ATTRIBUTE_KEYS = [
  { id: "mana", label: "Mana", diamond: "mana", barClass: "bar-mana" },
  { id: "intellect", label: "Intellect", diamond: "intellect", barClass: "bar-intellect" },
  { id: "lore", label: "Lore", diamond: "lore", barClass: "bar-lore" },
  { id: "perception", label: "Perception", diamond: "perception", barClass: "bar-perception" },
  { id: "charisma", label: "Charisma", diamond: "charisma", barClass: "bar-charisma" },
  { id: "stamina", label: "Stamina", diamond: "stamina", barClass: "bar-stamina" }
];

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function barPercent(current, max) {
  const safeMax = Math.max(1, Number(max) || 1);
  return Math.max(0, Math.min(100, Math.round((Number(current) / safeMax) * 100)));
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

/**
 * Push Supabase row values into in-memory CONFIG/state used by the game loop.
 */
export function syncConfigFromProfile(row, config, gameState) {
  if (!row) return;

  config.player.name = row.player_name ?? config.player.name;
  config.player.rank = row.rank_ribbon ?? config.player.rank;
  config.player.xp = row.xp_current ?? config.player.xp;
  config.player.xpToNextRank = row.xp_max ?? config.player.xpToNextRank;

  if (gameState) {
    gameState.xp = row.xp_current ?? gameState.xp;
  }

  config.attributes = ATTRIBUTE_KEYS.map((meta) => ({
    ...meta,
    current: row[`${meta.id}_current`] ?? 0,
    max: row[`${meta.id}_max`] ?? 100
  }));
}

/**
 * Update the profile panel DOM from a profiles row (or synced CONFIG).
 */
export function applyProfileToUI(row, config) {
  if (!row) return;

  const playerName = document.getElementById("playerName");
  const playerRank = document.getElementById("playerRank");
  const xpFill = document.getElementById("xpFill");
  const xpText = document.getElementById("xpText");
  const xpTrack = document.getElementById("xpTrack");
  const attrList = document.getElementById("attrList");

  if (!playerName || !playerRank || !xpFill || !xpText || !xpTrack || !attrList) {
    return;
  }

  const xpCurrent = row.xp_current ?? config.player.xp;
  const xpMax = row.xp_max ?? config.player.xpToNextRank;
  const xpPct = barPercent(xpCurrent, xpMax);

  playerName.textContent = row.player_name ?? config.player.name;
  playerRank.textContent = row.rank_ribbon ?? config.player.rank;

  const bannerTitle = document.getElementById("bannerTitle");
  if (bannerTitle) {
    bannerTitle.textContent = `The Chronicles of ${row.player_name ?? config.player.name}`;
  }

  const avatarImg = document.querySelector(".avatar-frame img");
  if (avatarImg) avatarImg.alt = row.player_name ?? config.player.name;

  xpFill.style.width = `${xpPct}%`;
  xpText.textContent = `${formatNumber(xpCurrent)} / ${formatNumber(xpMax)} XP`;
  xpTrack.setAttribute("aria-valuemin", "0");
  xpTrack.setAttribute("aria-valuemax", String(xpMax));
  xpTrack.setAttribute("aria-valuenow", String(xpCurrent));

  const attributes = config.attributes?.length
    ? config.attributes
    : ATTRIBUTE_KEYS.map((meta) => ({
        ...meta,
        current: row[`${meta.id}_current`] ?? 0,
        max: row[`${meta.id}_max`] ?? 100
      }));

  attrList.innerHTML = attributes
    .map((attr) => {
      const pct = barPercent(attr.current, attr.max);
      return `
        <div class="attr-row" data-attr="${attr.id}">
          <div class="diamond diamond--${attr.diamond}" aria-hidden="true"></div>
          <span class="attr-label">${attr.label} ${attr.current}/${attr.max}</span>
          <div class="attr-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="${attr.max}" aria-valuenow="${attr.current}" aria-label="${attr.label}">
            <div class="attr-bar-fill ${attr.barClass}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

/**
 * Convenience: fetch + sync CONFIG/state + paint UI in one call.
 */
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

  syncConfigFromProfile(row, config, gameState);
  applyProfileToUI(row, config);
  return row;
}
