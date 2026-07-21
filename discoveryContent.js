/**
 * Discovery hub content from Supabase reference tables.
 */

import { logDiscoveryViewed, logTransmissionWatched } from "./playerActivity.js";

const ATTRIBUTE_TYPES = [
  "Mana",
  "Intellect",
  "Lore",
  "Perception",
  "Charisma",
  "Stamina"
];

export function formatDiscoveryFact(fact) {
  if (!fact) return "";

  const prefix = fact.title ? `${fact.title}: ` : "Today's Insight: ";
  return `${prefix}${fact.content_text}`;
}

/**
 * Fetch one random row via the get_random_discovery_fact RPC.
 */
export async function fetchRandomDiscoveryFact(client, attributeType = null) {
  const { data, error } = await client.rpc("get_random_discovery_fact", {
    p_attribute_type: attributeType
  });

  if (error) throw error;
  return data ?? null;
}

/**
 * Random discovery fact without RPC (works before RPC is deployed).
 */
export async function fetchRandomDiscoveryFactDirect(client, attributeType = null) {
  let query = client.from("discovery_facts").select("id, title, content_text, attribute_type");

  if (attributeType) {
    query = query.eq("attribute_type", attributeType);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return null;

  return data[Math.floor(Math.random() * data.length)];
}

/**
 * Random approved_transmissions row (optionally filtered by category).
 */
export async function fetchRandomApprovedTransmission(client, category = null) {
  let query = client
    .from("approved_transmissions")
    .select("id, title, video_url, category");

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return null;

  return data[Math.floor(Math.random() * data.length)];
}

export function applyDiscoveryFactToUI(fact) {
  const el = document.getElementById("inlineKnowledgeText");
  if (!el || !fact) return;

  el.textContent = formatDiscoveryFact(fact);
  if (fact.attribute_type) {
    el.dataset.attributeType = fact.attribute_type;
  }
}

export function applyApprovedTransmissionToUI(transmission) {
  const btn = document.getElementById("watchTransmissionBtn");
  if (!btn) return;

  if (!transmission?.video_url) {
    delete btn.dataset.videoUrl;
    delete btn.dataset.transmissionTitle;
    delete btn.dataset.transmissionCategory;
    btn.setAttribute("aria-label", "Explore this wonder");
    return;
  }

  btn.dataset.videoUrl = transmission.video_url;

  if (transmission.id) {
    btn.dataset.transmissionId = transmission.id;
  }

  if (transmission.title) {
    btn.dataset.transmissionTitle = transmission.title;
    btn.setAttribute("aria-label", `Explore this wonder: ${transmission.title}`);
  }

  if (transmission.category) {
    btn.dataset.transmissionCategory = transmission.category;
  }
}

/**
 * Load a random discovery fact into the Scroll of Knowledge.
 */
export async function hydrateScrollOfKnowledge(client, { fallbackText, attributeType = null } = {}, session = null) {
  try {
    let fact = await fetchRandomDiscoveryFact(client, attributeType);

    if (!fact) {
      fact = await fetchRandomDiscoveryFactDirect(client, attributeType);
    }

    if (fact) {
      applyDiscoveryFactToUI(fact);
      await logDiscoveryViewed(client, fact, session);
      return fact;
    }
  } catch (err) {
    console.warn("Scroll of Knowledge fetch failed:", err);
  }

  if (fallbackText) {
    const el = document.getElementById("inlineKnowledgeText");
    if (el) el.textContent = fallbackText;
  }

  return null;
}

/**
 * Load a random approved transmission and wire the Watch Transmission button.
 */
export async function hydrateApprovedTransmission(client, { fallbackVideoUrl = null, category = null } = {}) {
  try {
    const transmission = await fetchRandomApprovedTransmission(client, category);

    if (transmission) {
      applyApprovedTransmissionToUI(transmission);
      return transmission;
    }
  } catch (err) {
    console.warn("Approved transmission fetch failed:", err);
  }

  if (fallbackVideoUrl) {
    const transmission = {
      title: "Default transmission",
      video_url: fallbackVideoUrl,
      category: null
    };
    applyApprovedTransmissionToUI(transmission);
    return transmission;
  }

  return null;
}

export async function recordTransmissionWatch(client, session = null) {
  const btn = document.getElementById("watchTransmissionBtn");
  if (!btn?.dataset.videoUrl) return null;

  return logTransmissionWatched(client, {
    id: btn.dataset.transmissionId || null,
    title: btn.dataset.transmissionTitle || null
  }, session);
}

/**
 * Hydrate Scroll of Knowledge + Watch Transmission on page load.
 */
export async function hydrateDiscoveryContent(
  client,
  { fallbackText, fallbackVideoUrl = null, attributeType = null, category = null } = {},
  session = null
) {
  const [fact, transmission] = await Promise.all([
    hydrateScrollOfKnowledge(client, { fallbackText, attributeType }, session),
    hydrateApprovedTransmission(client, { fallbackVideoUrl, category })
  ]);

  return { fact, transmission };
}

export { ATTRIBUTE_TYPES };
