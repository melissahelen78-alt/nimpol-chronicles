/**
 * Minimal Build Week canon for local development before World Domain
 * migrations are available. Production context assembly fails loudly instead
 * of silently replacing missing database canon with these values.
 */
export const ADVENTURE_CONTEXT_FALLBACK_WORLD_ID =
  "00000000-0000-4000-8000-adventure000001";

export const ADVENTURE_CONTEXT_FALLBACK = {
  world: {
    id: ADVENTURE_CONTEXT_FALLBACK_WORLD_ID,
    slug: "dragon-realm",
    name: "Dragon Realm",
    description: null,
    metadata: {}
  },
  characters: [
    {
      slug: "nutty",
      name: "Nutty",
      description: "A friendly squirrel guide and Chronicle Keeper.",
      metadata: { role: "companion", is_guide: true }
    }
  ],
  locations: [
    {
      slug: "hidden_treehouse",
      name: "Hidden Treehouse",
      description: null,
      metadata: {}
    },
    {
      slug: "tree-of-life-and-death",
      name: "Tree of Life and Death",
      description: null,
      metadata: {}
    },
    {
      slug: "starlit-library",
      name: "Starlit Library",
      description: "A library of living books and starlit knowledge.",
      metadata: {}
    },
    {
      slug: "whispering-forest",
      name: "Whispering Forest",
      description: null,
      metadata: {}
    }
  ]
} as const;
