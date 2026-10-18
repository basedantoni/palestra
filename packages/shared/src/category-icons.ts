/**
 * Category icons (KOI-336): the lucide icons a category can wear, by lucide's
 * kebab-case name. 42 of them, in the 7 × 6 order the picker lays them out:
 * one row each for food and shopping, getting around, home, health and care,
 * fun, and money. The web app maps each name to its component
 * (`category-icon.tsx`), so only these are bundled.
 */
export const CATEGORY_ICONS = [
  "utensils",
  "coffee",
  "pizza",
  "apple",
  "wine",
  "shopping-cart",
  "shopping-bag",

  "car",
  "fuel",
  "bus",
  "train-front",
  "plane",
  "bike",
  "map-pin",

  "house",
  "hammer",
  "zap",
  "droplet",
  "wifi",
  "smartphone",
  "sofa",

  "heart-pulse",
  "pill",
  "stethoscope",
  "dumbbell",
  "scissors",
  "shirt",
  "baby",

  "film",
  "music",
  "gamepad-2",
  "ticket",
  "book-open",
  "gift",
  "paw-print",

  "banknote",
  "arrow-left-right",
  "credit-card",
  "receipt",
  "hand-coins",
  "landmark",
  "wrench",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];
