export interface HrZoneDurations {
  zone_zero_milli?: number;
  zone_one_milli?: number;
  zone_two_milli?: number;
  zone_three_milli?: number;
  zone_four_milli?: number;
  zone_five_milli?: number;
}

export const HR_ZONE_COLORS = [
  "#9ca3af", // Zone 0 — gray
  "#3b82f6", // Zone 1 — blue
  "#22c55e", // Zone 2 — green
  "#eab308", // Zone 3 — yellow
  "#f97316", // Zone 4 — orange
  "#ef4444", // Zone 5 — red/max
] as const;

export const HR_ZONE_LABELS_SHORT = [
  "Zone 0",
  "Zone 1",
  "Zone 2",
  "Zone 3",
  "Zone 4",
  "Zone 5",
] as const;

export const HR_ZONE_LABELS_FULL = [
  "Zone 0 · Rest",
  "Zone 1 · Light",
  "Zone 2 · Moderate",
  "Zone 3 · Hard",
  "Zone 4 · Very Hard",
  "Zone 5 · Max",
] as const;
