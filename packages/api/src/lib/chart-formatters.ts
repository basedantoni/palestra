// "2025-01-15" or similar date string → "Jan 15" (safe for DST: forces noon)
export function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "2025-W03" → "W3", "2025-03" → "Mar", anything else → passthrough
export function formatPeriodLabel(period: string): string {
  if (period.includes("-W")) {
    const week = period.split("-W")[1];
    return `W${Number(week)}`;
  }
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-US", {
    month: "short",
  });
}

// ISO week-start date string → "Jan 15"
export function formatWeekLabel(weekStart: string): string {
  return formatDateLabel(weekStart);
}

// seconds/unit → "M:SS" (used by Whoop pace charts)
export function formatPaceFromSecPerUnit(secPerUnit: number): string {
  const minutes = Math.floor(secPerUnit / 60);
  const seconds = Math.round(secPerUnit % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// min/unit → "M:SS" (used by running pace trend chart)
export function formatPaceFromMinPerUnit(minPerUnit: number): string {
  const mins = Math.floor(minPerUnit);
  const secs = Math.round((minPerUnit - mins) * 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// seconds → "1h 30m" or "45m" (chart tooltip display)
export function formatChartDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
