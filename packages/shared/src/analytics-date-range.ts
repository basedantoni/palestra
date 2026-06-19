export const ANALYTICS_RANGE_PRESETS = [
  "30d",
  "3m",
  "6m",
  "1y",
  "all",
  "custom",
] as const;

export type AnalyticsRangePreset = (typeof ANALYTICS_RANGE_PRESETS)[number];

export type AnalyticsRangeSearch = {
  range?: AnalyticsRangePreset;
  from?: string;
  to?: string;
};

export type NormalizedAnalyticsRangeSearch = {
  range: AnalyticsRangePreset;
  from?: string;
  to?: string;
};

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRangePreset, string> = {
  "30d": "30D",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
  all: "All",
  custom: "Custom",
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDateString(value: string | undefined): value is string {
  return value !== undefined && ISO_DATE_PATTERN.test(value);
}

function toLocalNoon(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
    0,
  );
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function shiftDays(date: Date, delta: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + delta,
    12,
    0,
    0,
    0,
  );
}

function shiftMonths(date: Date, delta: number): Date {
  const anchor = new Date(date.getFullYear(), date.getMonth() + delta, 1, 12);
  const day = Math.min(
    date.getDate(),
    daysInMonth(anchor.getFullYear(), anchor.getMonth()),
  );

  return new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    day,
    12,
    0,
    0,
    0,
  );
}

export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function normalizeAnalyticsRangeSearch(
  search: AnalyticsRangeSearch,
): NormalizedAnalyticsRangeSearch {
  const hasExplicitRange =
    isIsoDateString(search.from) &&
    isIsoDateString(search.to) &&
    search.from <= search.to;

  if (search.range === "custom" || (!search.range && (search.from || search.to))) {
    if (hasExplicitRange) {
      return {
        range: "custom",
        from: search.from,
        to: search.to,
      };
    }

    return { range: "3m" };
  }

  if (
    search.range === "30d" ||
    search.range === "3m" ||
    search.range === "6m" ||
    search.range === "1y" ||
    search.range === "all"
  ) {
    return { range: search.range };
  }

  return { range: "3m" };
}

export function resolveAnalyticsRangeBounds(
  search: AnalyticsRangeSearch,
  referenceDate = new Date(),
): NormalizedAnalyticsRangeSearch {
  const normalized = normalizeAnalyticsRangeSearch(search);
  const today = toLocalNoon(referenceDate);

  if (normalized.range === "custom") {
    return normalized;
  }

  if (normalized.range === "all") {
    return normalized;
  }

  const to = formatLocalDate(today);

  if (normalized.range === "30d") {
    return {
      range: normalized.range,
      from: formatLocalDate(shiftDays(today, -29)),
      to,
    };
  }

  if (normalized.range === "3m") {
    return {
      range: normalized.range,
      from: formatLocalDate(shiftMonths(today, -3)),
      to,
    };
  }

  if (normalized.range === "6m") {
    return {
      range: normalized.range,
      from: formatLocalDate(shiftMonths(today, -6)),
      to,
    };
  }

  return {
    range: normalized.range,
    from: formatLocalDate(shiftMonths(today, -12)),
    to,
  };
}
