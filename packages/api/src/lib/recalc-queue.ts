/**
 * Durable recalc queue.
 *
 * Replaces fire-and-forget `recalculate*().catch(console.error)` calls with
 * persisted jobs in the `recalc_job` table. A failed recalc stays visible
 * (status='failed' + errorMessage) and is retried by the startup drain.
 *
 * Mirrors the whoop_webhook_event pattern:
 * - hot path inserts pending rows then dispatches each immediately
 * - `dispatchRecalcJob` atomically claims a single row (pending → processing)
 *   so the hot path and the startup drain don't both run a freshly-enqueued job
 * - `drainPendingRecalcJobs` claims a batch via a `FOR UPDATE SKIP LOCKED` CTE
 *
 * Delivery is at-least-once, not exactly-once: the drain's orphan-recovery
 * clause re-runs `processing` rows older than 5 min, so a job that legitimately
 * outlives that window (or a crashed worker's job) can run twice. Both recalc
 * functions recompute from data (delete+reinsert / upsert) and are idempotent,
 * so a re-run converges to the same state — this is the safety guarantee the
 * queue relies on.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { recalcJob } from "@life-tracker/db/schema/index";

import { isoWeekKey } from "./date-utils";
import { trackInFlight } from "./whoop-inflight";
import { recalculateMuscleGroupVolumeForWeek } from "./muscle-group-volume-db";
import { recalculateProgressiveOverload } from "./progressive-overload-db";

const DRAIN_BATCH_LIMIT = 200;
const PENDING_GRACE_MS = 5_000; // grace window before drain claims a pending row
const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000; // orphaned from a crashed machine

type RecalcJobKind = "progressive_overload" | "muscle_group_volume";

interface ProgressiveOverloadPayload {
  exerciseIds: string[];
}

interface MuscleGroupVolumePayload {
  weekOf: string; // ISO timestamp of any date in the target ISO week
}

export interface RecalcJob {
  id: string;
  userId: string;
  kind: RecalcJobKind;
  payload: Record<string, unknown>;
}

export interface EnqueueRecalcsOpts {
  /** Exercise IDs whose progressive-overload state needs recomputing. */
  exerciseIds?: string[];
  /** Workout dates whose ISO-week muscle-group volume needs recomputing. */
  weekDates?: Date[];
}

// ─────────────────────────────────────────────────────────────────────────────
// enqueueRecalcs — hot path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts the applicable recalc jobs for a workout write, then dispatches each
 * immediately (tracked in-flight for graceful shutdown). Returns once the rows
 * are persisted and dispatch is kicked off — it does not await the recalcs.
 */
export async function enqueueRecalcs(
  userId: string,
  opts: EnqueueRecalcsOpts,
): Promise<void> {
  const jobs: { kind: RecalcJobKind; payload: Record<string, unknown> }[] = [];

  const exerciseIds = Array.from(new Set(opts.exerciseIds ?? []));
  if (exerciseIds.length > 0) {
    jobs.push({ kind: "progressive_overload", payload: { exerciseIds } });
  }

  // One muscle-group-volume job per distinct ISO week; the recalc normalizes
  // the stored date to the week start itself.
  const weekRepresentatives = new Map<string, Date>();
  for (const date of opts.weekDates ?? []) {
    weekRepresentatives.set(isoWeekKey(date), date);
  }
  for (const date of weekRepresentatives.values()) {
    jobs.push({
      kind: "muscle_group_volume",
      payload: { weekOf: date.toISOString() },
    });
  }

  if (jobs.length === 0) return;

  const inserted = await db
    .insert(recalcJob)
    .values(jobs.map((job) => ({ userId, kind: job.kind, payload: job.payload })))
    .returning({
      id: recalcJob.id,
      userId: recalcJob.userId,
      kind: recalcJob.kind,
      payload: recalcJob.payload,
    });

  for (const job of inserted) {
    trackInFlight(dispatchRecalcJob(job));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchRecalcJob — atomic single-row claim + run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically claims a pending job (pending → processing); if the claim is lost
 * (already claimed by the drain or another dispatch) this is a no-op. On a
 * winning claim, runs the recalc and marks the row done/failed. Never rejects.
 */
export async function dispatchRecalcJob(job: RecalcJob): Promise<void> {
  let claimed = false;
  try {
    // The claim itself can reject (pool timeout, connection drop) — swallow it
    // so the contract holds: this is dispatched un-awaited via trackInFlight,
    // which only registers .finally(), so a rejection here would go unhandled.
    const claim = await db
      .update(recalcJob)
      .set({ status: "processing" })
      .where(and(eq(recalcJob.id, job.id), eq(recalcJob.status, "pending")));
    claimed = claim.rowCount !== 0;
  } catch (err) {
    console.error(`[recalc-queue] failed to claim job ${job.id}:`, err);
    return; // row stays pending → the startup drain retries it
  }

  if (!claimed) return; // lost the claim — someone else owns it

  await runClaimedJob(job);
}

// ─────────────────────────────────────────────────────────────────────────────
// drainPendingRecalcJobs — startup batch claim
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Claims a batch of stuck jobs in one atomic round trip and runs them:
 * - `pending` older than the 5s grace window (hot path never picked it up)
 * - `processing` older than 5 min (orphaned from a crashed machine)
 *
 * The CTE flips the rows to `processing` as it claims them, so each row is run
 * directly (no second claim) and tracked in-flight.
 */
export async function drainPendingRecalcJobs(): Promise<{
  scanned: number;
  dispatched: number;
}> {
  const pendingCutoff = new Date(Date.now() - PENDING_GRACE_MS);
  const orphanCutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);

  const claimed = await db.execute<{
    id: string;
    user_id: string;
    kind: RecalcJobKind;
    payload: Record<string, unknown>;
  }>(sql`
    WITH claimed AS (
      SELECT id, user_id, kind, payload
      FROM recalc_job
      WHERE (status = 'pending'    AND received_at < ${pendingCutoff})
         OR (status = 'processing' AND received_at < ${orphanCutoff})
      LIMIT ${DRAIN_BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE recalc_job
    SET status = 'processing'
    FROM claimed
    WHERE recalc_job.id = claimed.id
    RETURNING
      recalc_job.id,
      recalc_job.user_id,
      recalc_job.kind,
      recalc_job.payload
  `);

  const rows = claimed.rows;
  let dispatched = 0;

  for (const row of rows) {
    const job: RecalcJob = {
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      payload: row.payload,
    };
    trackInFlight(runClaimedJob(job));
    dispatched += 1;
  }

  console.log(`[recalc-drain] scanned=${rows.length} dispatched=${dispatched}`);
  return { scanned: rows.length, dispatched };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the recalc for an already-claimed (status='processing') job and marks
 * it done, or failed with the error message. Never rejects.
 */
async function runClaimedJob(job: RecalcJob): Promise<void> {
  try {
    await runRecalc(job);
    await db
      .update(recalcJob)
      .set({ status: "done", processedAt: new Date() })
      .where(eq(recalcJob.id, job.id));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[recalc-queue] job ${job.id} (${job.kind}) failed:`, err);
    await db
      .update(recalcJob)
      .set({ status: "failed", processedAt: new Date(), errorMessage })
      .where(eq(recalcJob.id, job.id))
      .catch((markErr) =>
        console.error(
          `[recalc-queue] failed to mark job ${job.id} failed:`,
          markErr,
        ),
      );
  }
}

function runRecalc(job: RecalcJob): Promise<void> {
  switch (job.kind) {
    case "progressive_overload": {
      const { exerciseIds } = job.payload as unknown as ProgressiveOverloadPayload;
      return recalculateProgressiveOverload(job.userId, exerciseIds ?? []);
    }
    case "muscle_group_volume": {
      const { weekOf } = job.payload as unknown as MuscleGroupVolumePayload;
      return recalculateMuscleGroupVolumeForWeek(job.userId, new Date(weekOf));
    }
  }
}
