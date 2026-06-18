import { startOfISOWeek } from "date-fns";

// Stable per-ISO-week string key: the local Monday of `date`'s week as "yyyy-MM-dd".
// Use to dedup workout dates that fall in the same week before recalculating volume.
// Routes through toLocalDateKey (local getters, no toISOString round-trip), so it
// never lands on the wrong week in timezones behind UTC.
export function isoWeekKey(date: Date): string {
  return toLocalDateKey(startOfISOWeek(date));
}

// Converts a DB-returned UTC timestamp to a local calendar date at noon.
// Uses UTC getters so "2025-01-05T00:00:00Z" maps to Jan 5 regardless of timezone.
// NOT for locally-constructed Date objects — use localDateToNoon for those.
export function toLocalNoon(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
}

// For locally-constructed Date objects (form dates, new Date()).
// Uses local getters — correct when the date was created in local time, not from a UTC DB timestamp.
export function localDateToNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
}

export function toDateString(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalDateKey(date: Date): string {
  return toDateString(date);
}
