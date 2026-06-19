import { subYears } from "date-fns";
import { z } from "zod";

import { toDateString } from "./date-utils";

export const analyticsDateBoundsShape = {
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
};

export type AnalyticsDateBoundsInput = {
  startDate?: Date;
  endDate?: Date;
  from?: string;
  to?: string;
};

export const whoopRangeBoundsShape = {
  from: z.string().optional(),
  to: z.string().optional(),
};

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

function toSqlDateString(value?: Date | string): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (value instanceof Date) {
    return toDateString(value);
  }

  const match = ISO_DATE_PREFIX.exec(value);
  return match?.[1];
}

function parseSqlDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function resolveAnalyticsDateBounds(
  input?: AnalyticsDateBoundsInput,
): { from?: string; to?: string; startDate?: Date; endDate?: Date } {
  return {
    from: toSqlDateString(input?.from),
    to: toSqlDateString(input?.to),
    startDate: input?.from ? undefined : input?.startDate,
    endDate: input?.to ? undefined : input?.endDate,
  };
}

export function resolveClampedWorkoutFrequencyBounds(
  input?: AnalyticsDateBoundsInput,
  now = new Date(),
): { from: string; to: string } {
  const base = resolveAnalyticsDateBounds(input);
  const fallbackTo = toDateString(now);
  const to = base.to ?? fallbackTo;
  const toDate = parseSqlDateString(to);

  const unclampedFrom =
    base.from ?? toDateString(subYears(toDate, 1));
  const minimumFrom = toDateString(subYears(toDate, 1));
  const from =
    parseSqlDateString(unclampedFrom) < parseSqlDateString(minimumFrom)
      ? minimumFrom
      : unclampedFrom;

  return { from, to };
}
