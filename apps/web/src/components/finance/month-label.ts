import { format } from "date-fns";

/** Format a "yyyy-MM" month key with a date-fns pattern, e.g. "MMM" → "Jun". */
export function monthLabel(monthKey: string, pattern: string): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  return format(new Date(y, m - 1, 1), pattern);
}
