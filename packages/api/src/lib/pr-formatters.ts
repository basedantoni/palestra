import { formatDistance } from "./workout-utils";

export const RECORD_TYPE_LABELS: Record<string, string> = {
  max_weight: "Max Weight",
  max_reps: "Max Reps",
  max_volume: "Max Volume",
  best_pace: "Best Pace",
  longest_distance: "Longest Distance",
};

export function formatPrValue(
  recordType: string,
  value: number,
  distanceUnit: "mi" | "km",
): string {
  if (recordType === "max_weight") return `${value} lbs`;
  if (recordType === "max_reps") return `${value} reps`;
  if (recordType === "max_volume") return `${value.toLocaleString()} lbs`;
  if (recordType === "best_pace") return `${value.toFixed(2)} min/${distanceUnit}`;
  if (recordType === "longest_distance") return formatDistance(value, distanceUnit);
  return String(value);
}

export function formatPrDelta(
  recordType: string,
  delta: number,
  distanceUnit: "mi" | "km",
): string {
  const unit =
    recordType === "max_weight" || recordType === "max_volume"
      ? " lbs"
      : recordType === "max_reps"
        ? " reps"
        : recordType === "best_pace"
          ? ` min/${distanceUnit}`
          : recordType === "longest_distance"
            ? ` ${distanceUnit}`
            : "";
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta}${unit}`;
}

export function isPrImprovement(recordType: string, delta: number): boolean {
  if (recordType === "best_pace") return delta <= 0;
  return delta >= 0;
}
