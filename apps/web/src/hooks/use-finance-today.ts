import { useQuery } from "@tanstack/react-query";

import { todayInTimeZone } from "@life-tracker/shared";
import { trpc } from "@/utils/trpc";

/** Matches the server's fallback when the user has no timezone preference. */
const DEFAULT_TIMEZONE = "America/Chicago";

/** Today (YYYY-MM-DD) in the user's preferred timezone — the same "today" the server uses for finance periods. */
export function useFinanceToday(): string {
  const { data: prefs } = useQuery(trpc.preferences.get.queryOptions());
  return todayInTimeZone(new Date(), prefs?.timezone ?? DEFAULT_TIMEZONE);
}
