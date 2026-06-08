/**
 * Whoop Backfill — Phase 6
 *
 * In-memory state tracking for the 30-day backfill process, plus the
 * runBackfill async function that paginates Whoop's activity list and
 * imports each workout using the same three-path dedup logic as
 * workoutProcessor in whoop-webhook.ts.
 */

import { eq } from "drizzle-orm";

import { db } from "@src/db";
import { notification, whoopConnection } from "@src/db/schema/index";

import type { WhoopActivityDetail } from "./whoop-activity-dto";
import { upsertWhoopWorkout } from "./whoop-upsert";
import { getValidWhoopAccessToken, WHOOP_API_BASE } from "./whoop-client";

// ─────────────────────────────────────────────────────────────────────────────
// State map — persists for the lifetime of the Node process
// ─────────────────────────────────────────────────────────────────────────────

export interface BackfillState {
  running: boolean;
  importedCount: number;
  totalCount: number;
  shouldStop: boolean;
}

/** Module-level map: userId → BackfillState */
const backfillStateMap = new Map<string, BackfillState>();

export function getBackfillState(userId: string): BackfillState | null {
  return backfillStateMap.get(userId) ?? null;
}

export function setBackfillState(userId: string, state: BackfillState): void {
  backfillStateMap.set(userId, state);
}

export function clearBackfillState(userId: string): void {
  backfillStateMap.delete(userId);
}

/** Sets shouldStop = true on the existing state. No-op if no state. */
export function stopBackfill(userId: string): void {
  const state = backfillStateMap.get(userId);
  if (state) {
    backfillStateMap.set(userId, { ...state, shouldStop: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whoop API types
// ─────────────────────────────────────────────────────────────────────────────

interface WhoopWorkoutListResponse {
  records: WhoopActivityDetail[];
  next_token: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// runBackfill — the main async backfill function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginates Whoop's activity list for the past `days` days and imports each
 * workout using the same three-path dedup logic as workoutProcessor.
 *
 * - Skips PENDING_SCORE activities.
 * - Deduplicates via onConflictDoNothing at the DB layer.
 * - Checks shouldStop before each activity; halts cleanly if set.
 * - Emits a summary notification on completion when notifyOnAutoImport = true.
 * - Always clears state in a finally block; never throws.
 */
export async function triggerBackfill(
  userId: string,
  days = 30,
): Promise<void> {
  // Initialize state
  setBackfillState(userId, {
    running: true,
    importedCount: 0,
    totalCount: 0,
    shouldStop: false,
  });

  try {
    // Fetch connection settings (autoImportEnabled, notifyOnAutoImport)
    const [connection] = await db
      .select({
        autoImportEnabled: whoopConnection.autoImportEnabled,
        notifyOnAutoImport: whoopConnection.notifyOnAutoImport,
      })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    const notifyOnCompletion = connection?.notifyOnAutoImport ?? false;

    // Build date range
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const accessToken = await getValidWhoopAccessToken(userId);

    let importedCount = 0;
    let cursor: string | null = null;
    let isFirstPage = true;

    // Paginate
    do {
      // Check stop flag before each page
      const currentState = getBackfillState(userId);
      if (currentState?.shouldStop) {
        clearBackfillState(userId);
        return;
      }

      const params = new URLSearchParams();
      params.set("start", fromIso);
      params.set("end", toIso);
      params.set("limit", "25");
      if (cursor) params.set("nextToken", cursor);

      const response = await fetch(
        `${WHOOP_API_BASE}/activity/workout?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Whoop API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as WhoopWorkoutListResponse;
      const records = data.records ?? [];

      // Update totalCount on first page (we don't have a total from Whoop API,
      // so we accumulate as we go — we'll update it each page)
      if (isFirstPage) {
        isFirstPage = false;
        // Set a rough total so the UI shows something; we'll increment as we go
        setBackfillState(userId, {
          ...(getBackfillState(userId) ?? { running: true, importedCount: 0, totalCount: 0, shouldStop: false }),
          totalCount: records.length,
        });
      }

      for (const activity of records) {
        // Check stop flag before each activity
        const stateCheck = getBackfillState(userId);
        if (stateCheck?.shouldStop) {
          clearBackfillState(userId);
          return;
        }

        // Skip PENDING_SCORE
        if (activity.score_state === "PENDING_SCORE") {
          continue;
        }

        // Three-path dedup + import (shared with the webhook) — see whoop-upsert.ts.
        // Count auto-update & new-import toward importedCount; manual-link does not.
        const result = await upsertWhoopWorkout(userId, activity);
        if (result.path !== "manual-link") {
          importedCount++;
        }

        // Update running count in state
        const latest = getBackfillState(userId);
        if (latest) {
          setBackfillState(userId, {
            ...latest,
            importedCount,
          });
        }

        // Check stop flag after each activity (allows stop signal set during transaction)
        const postActivityState = getBackfillState(userId);
        if (postActivityState?.shouldStop) {
          clearBackfillState(userId);
          return;
        }
      }

      cursor = data.next_token ?? null;

      // Update totalCount to running total as pages complete
      const latestState = getBackfillState(userId);
      if (latestState) {
        setBackfillState(userId, {
          ...latestState,
          totalCount: latestState.totalCount + (cursor ? records.length : 0),
        });
      }
    } while (cursor !== null);

    // Emit summary notification on completion
    if (notifyOnCompletion && importedCount > 0) {
      await db.insert(notification).values({
        id: crypto.randomUUID(),
        userId,
        type: "whoop_workout_imported",
        title: "Whoop backfill complete",
        message: `Imported ${importedCount} workout${importedCount === 1 ? "" : "s"} from the last ${days} days`,
      });
    }
  } catch (err) {
    console.error("[whoop-backfill] Error during backfill:", err);
  } finally {
    clearBackfillState(userId);
  }
}
