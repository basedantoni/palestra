import { eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { userPreferences } from "@life-tracker/db/schema/index";

/** Matches the `user_preferences.timezone` column default. */
export const DEFAULT_TIMEZONE = "America/Chicago";

/** The user's IANA timezone from preferences, or the default if unset. */
export async function getUserTimezone(userId: string): Promise<string> {
  const [prefs] = await db
    .select({ timezone: userPreferences.timezone })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return prefs?.timezone ?? DEFAULT_TIMEZONE;
}
