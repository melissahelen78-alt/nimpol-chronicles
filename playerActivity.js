/**
 * Log discovery / transmission activity for AI story context.
 */

export async function upsertPlayerActivity(client, userId, patch) {
  const { data, error } = await client
    .from("player_activity")
    .upsert(
      {
        user_id: userId,
        ...patch,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function logDiscoveryViewed(client, fact, session = null) {
  if (!session) {
    const {
      data: { session: currentSession }
    } = await client.auth.getSession();
    session = currentSession;
  }
  if (!session?.user || !fact) return null;

  try {
    return await upsertPlayerActivity(client, session.user.id, {
      last_discovery_viewed_at: new Date().toISOString(),
      last_discovery_fact_id: fact.id ?? null,
      last_discovery_fact_title: fact.title ?? null
    });
  } catch (err) {
    console.warn("Failed to log discovery view:", err);
    return null;
  }
}

export async function logTransmissionWatched(client, transmission, session = null) {
  if (!session) {
    const {
      data: { session: currentSession }
    } = await client.auth.getSession();
    session = currentSession;
  }
  if (!session?.user || !transmission) return null;

  try {
    return await upsertPlayerActivity(client, session.user.id, {
      last_transmission_watched_at: new Date().toISOString(),
      last_transmission_id: transmission.id ?? null,
      last_transmission_title: transmission.title ?? null
    });
  } catch (err) {
    console.warn("Failed to log transmission watch:", err);
    return null;
  }
}
