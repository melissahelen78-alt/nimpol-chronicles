/**
 * Inventory fetch, display helpers, and loot awards.
 */

export async function fetchUserInventory(client, userId) {
  const { data, error } = await client
    .from("user_inventory")
    .select("id, quantity, acquired_at, source, items(id, slug, name, description, icon, rarity)")
    .eq("user_id", userId)
    .order("acquired_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchAllItems(client) {
  const { data, error } = await client.from("items").select("*").order("rarity");
  if (error) throw error;
  return data ?? [];
}

export async function awardItem(client, userId, itemId, source = "quest") {
  const { data: existing, error: readError } = await client
    .from("user_inventory")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("item_id", itemId)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    const { data, error } = await client
      .from("user_inventory")
      .update({ quantity: existing.quantity + 1, source })
      .eq("id", existing.id)
      .select("*, items(*)")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await client
    .from("user_inventory")
    .insert({ user_id: userId, item_id: itemId, quantity: 1, source })
    .select("*, items(*)")
    .single();

  if (error) throw error;
  return data;
}

export function pickWeightedItem(items) {
  if (!items?.length) return null;
  const total = items.reduce((sum, item) => sum + (item.drop_weight ?? 1), 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.drop_weight ?? 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * ~35% chance to drop a random item (quest claim / wheel).
 */
export async function maybeAwardRandomLoot(client, userId, source, dropChance = 0.35) {
  if (Math.random() > dropChance) return null;

  const items = await fetchAllItems(client);
  const picked = pickWeightedItem(items);
  if (!picked) return null;

  const row = await awardItem(client, userId, picked.id, source);
  return row?.items ?? picked;
}

export function renderInventoryGrid(rows) {
  const grid = document.getElementById("inventoryGrid");
  const empty = document.getElementById("inventoryEmpty");
  if (!grid) return;

  if (!rows?.length) {
    grid.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  grid.innerHTML = rows
    .map((row) => {
      const item = row.items ?? row;
      const qty = row.quantity ?? 1;
      return `
        <div class="inventory-card inventory-card--${item.rarity ?? "common"}" title="${item.description ?? ""}">
          <div class="inventory-card-icon">${item.icon ?? "🎁"}</div>
          <div class="inventory-card-name">${item.name}</div>
          <div class="inventory-card-rarity">${item.rarity ?? "common"}</div>
          ${qty > 1 ? `<div class="inventory-card-qty">×${qty}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

export async function awardItemBySlug(client, userId, slug, source = "story") {
  const { data: item, error: itemError } = await client
    .from("items")
    .select("id, name, icon, rarity")
    .eq("slug", slug)
    .maybeSingle();

  if (itemError) throw itemError;
  if (!item) return null;

  await awardItem(client, userId, item.id, source);
  return item;
}

export async function hydrateInventory(client, session = null) {
  if (!session) {
    const {
      data: { session: currentSession }
    } = await client.auth.getSession();
    session = currentSession;
  }
  if (!session?.user) return [];

  const rows = await fetchUserInventory(client, session.user.id);
  renderInventoryGrid(rows);
  return rows;
}

