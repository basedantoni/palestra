# Whoop Webhook Integration — Implementation Plan

## Overview

Move the Whoop integration from pull-based (manual import page) to push-based (Whoop notifies us when activities complete). Workouts, sleep sessions, and recovery scores auto-import within minutes of completion. Users can toggle auto-import, see last-synced status, and re-register the webhook if it expires — all without re-doing the OAuth flow.

The plan is structured as vertical tracer-bullet slices: each phase cuts through schema, server, API, and UI end-to-end and is independently demoable.

---

## Architectural Decisions (locked in)

These decisions are settled and apply across all phases. Do not relitigate them.

### Transport & verification
- **Webhook endpoint:** `POST /api/whoop/webhook` on the Hono server, mounted alongside the existing `/api/whoop/*` OAuth routes.
- **Signature verification:** HMAC-SHA256 using a per-user secret stored encrypted at rest. Reject (401) on signature mismatch before any DB work. Raw request body bytes must be used for HMAC (not re-serialized JSON) — buffer raw body before parsing.
- **Response strategy:** Verify signature → record event row → return 200 immediately → process async (`setImmediate`, fire-and-forget). The handler must not block on activity fetches or DB writes beyond the initial event-row insert.
- **Dedup:** by Whoop event ID (primary key on `whoop_webhook_event`). Re-deliveries are idempotent no-ops at the verification layer.
- **Failure recovery:** No retry queue. Accept loss on server restart — Whoop's own retry mechanism covers transient failures. Failed events are recorded with `errorMessage` for manual inspection.

### User identification at the webhook endpoint
- Whoop includes a user identifier in every webhook payload. Map it to an app user via `whoopUserId` stored on `whoop_connection`.
- **`whoopUserId` must be fetched during OAuth:** after token exchange, call Whoop's `/v2/user/profile/basic` endpoint (synchronously, before the redirect) to retrieve and store the Whoop user ID. This is the only synchronous addition to the OAuth callback.

### Schema additions to `whoop_connection`
- `whoopUserId` (text, not null, unique, indexed) — Whoop's user identifier; used to route incoming webhooks to the correct app user.
- `webhookSubscriptionId` (text, nullable) — Whoop-issued subscription identifier returned at registration.
- `webhookSecret` (text, nullable, encrypted) — per-user shared secret used for HMAC verification.
- `webhookLastReceivedAt` (timestamp, nullable) — updated on every verified delivery, regardless of processing outcome.
- `autoImportEnabled` (boolean, default true) — global gate for all event types (workouts, sleep, recovery).
- `notifyOnAutoImport` (boolean, default true) — independent of auto-import; controls whether successful imports emit a user-facing notification.

### Webhook subscription lifecycle
- **One subscription per user, covering all event types** (`workout.updated`, `workout.deleted`, `sleep.created`, `sleep.updated`, `sleep.deleted`, `recovery.created`, `recovery.updated`, `recovery.deleted`). Single `webhookSubscriptionId` and `webhookSecret` per connection row.
- **Registration:** async (fire-and-forget after OAuth redirect). Brief window where `webhookStatus.isValid` is false; resolves automatically.
- **`reregisterWebhook` order:** delete existing subscription first, then register new one. Brief gap acceptable — Whoop retries cover it.
- **Disconnect:** delete subscription at Whoop before removing local row. Best-effort — proceed with local deletion even if Whoop call fails.

### Event types and processing rules
- **`workout.updated` only** — skip `workout.created` entirely. Whoop sends `workout.updated` after scoring completes; this is when real data is available.
- **`score_state` handling:** import if `SCORED` or `INCOMPLETE` (null score fields for incomplete). Skip event and mark `skipped` if `PENDING_SCORE`.
- **`workout.deleted` / `sleep.deleted` / `recovery.deleted`:** auto-delete the corresponding row from our DB regardless of `source`. For workout deletes: if the workout was manually created and only linked to Whoop, delete the whole workout anyway.
- **Manual-link overwrite:** when a webhook updates metrics on a manually-linked workout's exercise log, overwrite unconditionally (same behavior as `linkToWorkout` with `force: true`).

### Workout dedup logic (three paths)
When a `workout.updated` event arrives for `whoopActivityId = X` belonging to user `U`:
1. **Manual link path:** workout row exists for `(U, X)` and `source != "whoop"` → update linked exercise log metrics unconditionally. Do NOT create a new workout.
2. **Auto-imported update path:** workout row exists for `(U, X)` and `source = "whoop"` → update existing workout + exercise log with refreshed data.
3. **New import path:** no row for `(U, X)` → create new workout + exercise log using existing `whoopActivityToExerciseLog` DTO and `whoopSportToWorkoutType` mapping.

The unique index `workout_userId_whoopActivityId_unique_idx` enforces uniqueness at the DB layer.

### New table `whoop_webhook_event`
- `id` (text, PK) — Whoop's event ID; used for dedup.
- `userId` (FK to user, cascade).
- `eventType` (text) — e.g. `workout.updated`, `sleep.created`, `recovery.updated`, `workout.deleted`.
- `whoopResourceId` (text, nullable) — the activity / sleep / recovery ID referenced by the event.
- `receivedAt` (timestamp, default now).
- `processedAt` (timestamp, nullable).
- `status` (text) — `pending` | `processed` | `skipped` | `failed`.
- `errorMessage` (text, nullable).
- Index on `(userId, receivedAt)`.

### New tRPC procedures (under existing `whoopRouter`)
- `webhookStatus` (query) — returns `{ subscribed, isValid, lastReceivedAt, autoImportEnabled, notifyOnAutoImport, backfill: { running, importedCount, totalCount } | null }`.
- `setAutoImport` (mutation) — `{ enabled: boolean }` → updates `autoImportEnabled`. One toggle controls all event types.
- `setNotifyOnAutoImport` (mutation) — `{ enabled: boolean }` → updates `notifyOnAutoImport`.
- `reregisterWebhook` (mutation) — delete-first, then register fresh subscription, rotate secret, persist new IDs.
- `triggerBackfill` (mutation) — kicks off the 30-day backfill (used on first connect and as a manual retry).

### Sleep & recovery storage
- **`whoop_sleep`** table — one row per Whoop sleep session, keyed by `(userId, whoopSleepId)` with a partial unique index. Stores: start, end, nap (boolean), score state, sleep performance %, sleep consistency %, sleep efficiency %, respiratory rate, total in-bed time (ms), total awake time (ms), light/SWS/REM/no-data durations (ms), sleep needed (baseline + strain + debt + recent nap), disturbance count.
- **`whoop_recovery`** table — one row per Whoop recovery, keyed by `(userId, whoopCycleId)` with a partial unique index. Stores: created/updated timestamps, whoopSleepId (nullable text, not a FK — avoids race condition when sleep row doesn't exist yet), score state, recovery score (0–100), resting heart rate, HRV (RMSSD), SpO2 %, skin temp Celsius, user calibrating flag.
- Both tables FK to `user` with cascade delete; both indexed on `(userId, createdAt)` for chronological listing.

### UI placement
- **Sleep:** analytics page, new "Sleep" tab. Trend chart (sleep performance % over last 30 days) + chronological list (date, total duration, performance %, efficiency %). Standalone — no join to workouts.
- **Recovery:** analytics page, new "Recovery" tab alongside Sleep. Trend chart (recovery score % over time) + chronological list (date, score, RHR, HRV).

### Existing users on feature ship
- No migration script. Existing connected users see `webhookStatus.isValid = false` banner in Settings → click "Reregister webhook" → subscription created. Natural discovery.

### Async processing model
- Webhook handler inserts `whoop_webhook_event` row with `status = pending`, returns 200, then invokes processor via `setImmediate`.
- Processor fetches resource from Whoop, applies dedup/import logic, flips row to `processed` or `failed`.
- `autoImportEnabled = false` → mark `skipped`, no Whoop API fetch.

### Notification type
- Extend `notification_type` enum with `whoop_workout_imported`. No notification for sleep/recovery imports in this plan.

---

## What We're NOT Doing
- Running a separate background worker / queue. Async processing stays inline (`setImmediate`) — no retry mechanism beyond Whoop's own delivery retries.
- Backfilling sleep/recovery on first connect (workouts only — sleep/recovery flow in via webhooks going forward).
- Push notifications to OS — only in-app notifications via the existing `notification` table.
- Separate auto-import toggles per event type — one global `autoImportEnabled` covers all.
- Scheduled webhook signing key rotation — only on manual `reregisterWebhook`.
- Recovery score on the dashboard — analytics page only.

---

## Phase 1 — End-to-end webhook tracer

### User stories covered
- Story 13: HMAC-SHA256 signature verification on every webhook
- Story 14: Dedup by Whoop event ID
- Story 15: Return 200 immediately, process async

### What to build
The thinnest possible vertical slice proving the entire webhook pipe works. No subscription lifecycle, no UI, no business logic — just receive a signed payload, verify it, record it, return 200, and log a stub async step.

- Add `whoop_webhook_event` table and `whoopUserId` / `webhookSubscriptionId` / `webhookSecret` / `webhookLastReceivedAt` columns to `whoop_connection`. All new columns nullable/defaulted — backwards compatible migration.
- Add `POST /api/whoop/webhook` on the Hono server. Buffer raw body before parsing.
- Look up `whoop_connection` by `whoopUserId` from payload to retrieve `webhookSecret`. Verify HMAC-SHA256 against `X-Whoop-Signature` header using raw body bytes. Return 401 on mismatch without writing anything.
- On success: insert `whoop_webhook_event` (event ID as PK — re-deliveries collide and become no-ops), update `webhookLastReceivedAt`, return 200.
- `setImmediate` processor stub: flip event status to `processed` and log. No Whoop API fetch yet.
- For local testing: use ngrok or similar to expose the endpoint; manually populate `whoopUserId` and `webhookSecret` for a test user.

### Acceptance criteria
- [ ] Migration adds new columns without breaking existing reads/writes.
- [ ] Correctly-signed synthetic payload via curl returns 200 within < 100ms.
- [ ] Incorrectly-signed payload returns 401 and writes nothing.
- [ ] Same event ID sent twice results in exactly one `whoop_webhook_event` row.
- [ ] `webhookLastReceivedAt` advances on every verified delivery.
- [ ] Async processor runs after 200 is returned (verifiable via timing logs).
- [ ] Unit tests: valid signature, invalid signature, missing secret, duplicate event ID.

---

## Phase 2 — Subscription lifecycle on connect + disconnect

### User stories covered
- Story 16: Self-heal if subscription expires
- Story 22: Disconnect deletes Whoop subscription
- Story 8 (partial): Warning if webhook subscription invalid
- Story 9 (partial): Re-register webhook from Settings

### What to build
Wire subscription lifecycle into OAuth so connecting Whoop automatically registers a subscription (async) and disconnecting cleans it up. Fetch `whoopUserId` synchronously during OAuth callback.

- **OAuth callback changes:**
  1. (Sync) Fetch `/v2/user/profile/basic` after token exchange → store `whoopUserId` on connection row.
  2. (Async, `setImmediate`) Call Whoop's webhook registration API → generate and encrypt fresh secret → persist `webhookSubscriptionId` and `webhookSecret`.
- Extend `disconnect` mutation: call Whoop's subscription delete API before removing local row. Best-effort — proceed with local deletion on failure.
- Add `webhookStatus` tRPC query. `isValid = false` when `webhookSubscriptionId` is null or `webhookLastReceivedAt` is older than 7 days.
- Add `reregisterWebhook` mutation: delete existing Whoop subscription first, register new one, rotate secret atomically.

### Acceptance criteria
- [x] Connecting populates `whoopUserId`, `webhookSubscriptionId`, and `webhookSecret`.
- [x] Disconnecting removes the Whoop subscription and local row (proceeds even if Whoop call fails).
- [x] `webhookStatus` returns accurate `subscribed`, `isValid`, `lastReceivedAt`.
- [x] `reregisterWebhook` rotates subscription and secret; old-secret events rejected after rotation.
- [x] Connection row exists but `webhookSubscriptionId` null → `isValid: false`.
- [ ] End-to-end manual test: connect → subscription visible at Whoop; disconnect → subscription removed.

---

## Phase 3 — Auto-import workout events

### User stories covered
- Stories 1–5: Auto-import with full metrics, correct type, Whoop badge, score updates
- Stories 10–12: Dedup, update-in-place, manual-link update

### What to build
Replace the Phase 1 stub processor with the real workout-import handler. Core user value: workouts appear without manual action.

- Handle `workout.updated` events only (skip `workout.created`).
- Processor flow:
  1. Skip if `autoImportEnabled = false` → mark `skipped`.
  2. Fetch full activity from Whoop via `getValidWhoopAccessToken`.
  3. If `score_state = "PENDING_SCORE"` → mark `skipped`. If `SCORED` or `INCOMPLETE` → proceed.
  4. Apply three-path dedup. Manual-link path overwrites all Whoop fields unconditionally.
  5. Wrap writes in transaction; update `lastImportedAt`.
  6. Fire-and-forget recalculations (progressive overload, muscle group volume).
  7. Mark `processed` or `failed` with `errorMessage`.
- Handle `workout.deleted` events: look up workout by `(userId, whoopActivityId)` and delete it regardless of `source`. Fire recalculations after delete.

### Acceptance criteria
- [x] `workout.updated` for unseen activity creates workout + exercise log with `source = "whoop"`, correct type/HR/strain/zones/distance/duration.
- [x] `workout.updated` for already-imported activity updates in place (no duplicate).
- [x] `workout.updated` for manually-linked activity updates exercise log without creating new workout.
- [x] `INCOMPLETE` activity imports with null score fields, no error.
- [x] `PENDING_SCORE` event marked `skipped`, no workout created.
- [x] `workout.deleted` removes workout row; recalculations fire.
- [ ] `lastImportedAt` advances on successful import; does not advance on failure.
- [ ] Integration test: signed payload → workout row → `workouts.list` returns it.

---

## Phase 4 — Settings UI: auto-import toggle, last-synced, reregister

### User stories covered
- Stories 6–9: Toggle, last-synced timestamp, invalid warning, reregister

### What to build
Whoop section in Settings (web + native) surfacing webhook health and auto-import control.

- Add `setAutoImport` tRPC mutation.
- Web Settings: auto-import toggle (optimistic update), "Last synced" relative timestamp, validity banner with "Reregister webhook" action when `isValid: false`.
- Native Settings: mirror web — same three controls using existing native patterns.
- Both clients invalidate `webhookStatus` after `setAutoImport` and `reregisterWebhook`.

### Acceptance criteria
- [x] `setAutoImport` mutation updates `autoImportEnabled` in DB (309 API tests pass)
- [x] `pnpm -F @src/api test` — 309 tests pass
- [x] TypeScript: no errors on web (`pnpm -F web check-types`)
- [ ] Toggling off → next Whoop workout event marked `skipped`, no import.
- [ ] Toggling on → imports resume for new events.
- [ ] Last-synced shows human-readable relative time; updates on new deliveries.
- [ ] Invalid banner visible on both platforms when `isValid: false`.
- [ ] Reregister clears banner on success.
- [ ] Toggle persists across reloads; optimistic update reconciles cleanly.
- [ ] Web and native show identical state for same user.

---

## Phase 5 — In-app notifications for auto-imported workouts

### User stories covered
- Stories 17–19: Notification on import, workout type + duration, independent toggle

### What to build
Emit a notification after every successful workout auto-import. Independent toggle from auto-import.

- Extend `notification_type` enum with `whoop_workout_imported`.
- Emit notification row (when `notifyOnAutoImport = true`) at the end of new-import and update paths. Payload includes `{ workoutId }` for deep-link. Skip emission on manual-link path and delete path.
- Add `setNotifyOnAutoImport` mutation.
- Add notification toggle to Settings Whoop section (web + native), independent of auto-import toggle.
- Verify existing notifications UI surfaces new type without modification.

### Acceptance criteria
- [x] Successful new-import or score-update emits exactly one `whoop_workout_imported` notification.
- [x] Manual-link update and workout delete do NOT emit notifications.
- [x] Tapping notification routes to workout detail on web and native.
- [x] Notification title/message includes workout type and duration.
- [x] `notifyOnAutoImport = false` suppresses notifications; auto-import continues.
- [x] Notification appears in bell/badge UI and counts toward unread.

---

## Phase 6 — 30-day backfill on first connect

### User stories covered
- Stories 20–21: Backfill last 30 days, skippable

### What to build
First-time connect triggers a background backfill of the last 30 days. Manual re-trigger available in Settings. Partial failures accepted — re-run is idempotent.

- `triggerBackfill` mutation accepts `{ days?: number }` defaulting to 30. Paginate Whoop's activity list API, reusing the import path from Phase 3 for each activity.
- After OAuth callback, if `lastImportedAt` is null (first-ever connect), fire `triggerBackfill` via `setImmediate`. No await.
- On partial failure (Whoop API error mid-pagination), stop and mark remaining as unimported. User re-triggers from Settings — already-imported activities dedup cleanly.
- Track progress in-memory, exposed via `webhookStatus` extension: `{ backfill: { running, importedCount, totalCount } | null }`.
- Settings UI: progress indicator + "Skip" button while running. "Skip" halts processor at next iteration.
- Backfill emits one summary notification at completion when `notifyOnAutoImport = true` ("Imported N workouts from the last 30 days"). No notification on skip.

### Acceptance criteria
- [x] First-time connect triggers backfill; subsequent reconnects do not.
- [x] Backfill imports unimported activities from last 30 days, skipping duplicates.
- [x] Progress visible in Settings while running.
- [x] "Skip" halts at next iteration, clears progress UI.
- [x] Single summary notification on completion (suppressed if `notifyOnAutoImport = false` or if skipped).
- [x] OAuth callback returns immediately without waiting for backfill.
- [x] Re-running imports zero workouts when no new data.

---

## Phase 7 — Sleep events

### User stories covered
- Story 23: Auto-import sleep sessions from Whoop (`sleep.created`, `sleep.updated`, `sleep.deleted`)

### What to build
Add sleep table, extend processor with sleep handler, surface data in analytics.

- Add `whoop_sleep` table per Architectural Decisions.
- Processor handles `sleep.created` and `sleep.updated`:
  1. Skip if `autoImportEnabled = false`.
  2. Fetch sleep record from Whoop's sleep endpoint.
  3. Upsert by `(userId, whoopSleepId)`.
  4. Mark `processed` / `failed`.
- Processor handles `sleep.deleted`: delete `whoop_sleep` row for `(userId, whoopSleepId)`.
- Add `whoopSleep.list` tRPC query: paginated, ordered by start desc, optional date-range filter.
- Web analytics: new "Sleep" tab. Trend chart (sleep performance % over last 30 days) + list (date, total duration, performance %, efficiency %).
- Native analytics: mirror.

### Acceptance criteria
- [x] Migration adds `whoop_sleep` with documented columns and unique index.
- [x] `sleep.created` imports new row.
- [x] `sleep.updated` updates row in place.
- [x] `sleep.deleted` removes row.
- [x] Re-delivery of same event ID is no-op.
- [x] `whoopSleep.list` returns sessions with correct pagination.
- [x] Web and native render trend chart + list for a connected user.
- [x] `autoImportEnabled = false` → sleep events marked `skipped`.
- [ ] Integration test: signed sleep payload → row exists → list returns it.

---

## Phase 8 — Recovery events

### User stories covered
- Story 24: Auto-import recovery score data from Whoop (`recovery.created`, `recovery.updated`, `recovery.deleted`)

### What to build
Add recovery table, extend processor, surface score in analytics.

- Add `whoop_recovery` table per Architectural Decisions. `whoopSleepId` stored as plain text (not FK) to avoid race condition when sleep row hasn't arrived yet.
- Processor handles `recovery.created` and `recovery.updated`:
  1. Skip if `autoImportEnabled = false`.
  2. Fetch recovery record from Whoop.
  3. Upsert by `(userId, whoopCycleId)`.
  4. Mark `processed` / `failed`.
- Processor handles `recovery.deleted`: delete `whoop_recovery` row.
- Add `whoopRecovery.list` tRPC query: paginated, ordered by createdAt desc.
- Add `whoopRecovery.latest` tRPC query: most-recent score for authenticated user.
- Web analytics: new "Recovery" tab alongside Sleep. Trend chart (recovery score % over time) + list (date, score, RHR, HRV). Score color-coded green/yellow/red.
- Native analytics: mirror.

### Acceptance criteria
- [x] Migration adds `whoop_recovery` with documented columns and unique index.
- [x] `recovery.created` imports new row.
- [x] `recovery.updated` updates in place (calibrating flag, finalized score).
- [x] `recovery.deleted` removes row.
- [x] `whoopRecovery.latest` returns most-recent score.
- [x] Web and native render trend chart + list with color-coded scores.
- [x] `autoImportEnabled = false` → recovery events marked `skipped`.
- [x] Integration test: signed recovery payload → row exists → latest returns it.
- [x] Regression: workout (Phase 3) and sleep (Phase 7) auto-import unchanged.

---

## References
- Existing OAuth + connection flow: Hono server `whoop-oauth` module.
- Existing Whoop tRPC router — reuse `whoopActivityToExerciseLog`, `whoopSportToWorkoutType`, `getValidWhoopAccessToken`.
- Existing notifications router and `notification` table — Phase 5 extends rather than replaces.
- Workout uniqueness constraint: `workout_userId_whoopActivityId_unique_idx` (partial unique on `(userId, whoopActivityId)`).
- Existing `commit` mutation — backfill reuses same import path, not the mutation directly (server-side only).
