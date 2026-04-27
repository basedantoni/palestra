# Plan: Whoop Integration

> Source PRD: PRD - Whoop Integration (00 Projects/Fitness App)

## Architectural Decisions

- **OAuth routes**: Custom Hono HTTP routes at `/api/whoop/connect`, `/api/whoop/callback`, `/api/whoop/disconnect` — not a Better Auth provider; success and failure both redirect back to Settings
- **Token storage**: New `whoopConnection` table — `userId` (unique FK), `accessToken` (encrypted), `refreshToken` (encrypted), `tokenExpiresAt`, `connectedAt`, `lastImportedAt`, `isValid`
- **Token encryption**: Node.js built-in `crypto` module with AES-GCM, app-level `TOKEN_ENCRYPTION_KEY` env var; encrypt before insert, decrypt before use
- **tRPC router**: New `whoop` protected router in `packages/api` — `connectionStatus`, `listActivities`, `commit`, `disconnect`
- **Sport type mapping**: Static Whoop `sport_id` → app `workoutType` map in `packages/shared`; unmapped IDs default to `mixed`; specific IDs determined during implementation from Whoop API docs
- **Workout source tracking**: `source` column (`text`, nullable) added to `workout` table — values: `'whoop'`, `'import'`, null (manual)
- **Whoop activity ID tracking**: `whoopActivityId` column (`text`, nullable, indexed) added to `workout` table — used for exact duplicate detection
- **Import flow route**: `/import/whoop` — 3-step flow: Select → Review → Complete
- **Pagination**: Whoop API uses token-based cursor (`next_token`); UI paginated with load-more; React Query caches loaded pages so failed page fetches don't lose already-loaded results
- **Commit payload**: `whoop.commit` accepts either explicit activity IDs or `{ selectAll: true, from?, to? }`; server handles fetching and deduplication for the `selectAll` case
- **Review step state**: Type overrides per activity are ephemeral React state — not persisted between sessions
- **Settings Integrations section**: Generic card-based design to support future integrations; Whoop is the first card
- **New env vars**: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`

---

## Phase 1: Whoop OAuth Connection

**User stories**: 1, 2, 3, 4, 5, 25, 26, 27

### What to build

A user can navigate to a generic "Integrations" section on the Settings page, which renders integration cards. The Whoop card shows disconnected state with a Connect button. Clicking Connect initiates the Whoop OAuth 2.0 PKCE flow, redirecting to Whoop's authorization page. After approval, the server callback exchanges the code for tokens, encrypts them with AES-GCM, and stores them in `whoopConnection`. The user is redirected back to Settings where the card now shows connected state with the connected-since date. On failure or cancellation, the user also lands back on Settings with a clear error message surfaced via query param.

Clicking Disconnect deletes the `whoopConnection` row; the card returns to disconnected state.

Token refresh is handled transparently: before any Whoop API call, the server checks token expiry and refreshes if needed. If refresh fails, `isValid` is set to false and the UI prompts the user to re-connect. The `whoop.connectionStatus` tRPC query surfaces `{ connected, isValid, lastImportedAt }`.

### Acceptance criteria

- [x] Settings page has a generic Integrations section rendering a Whoop card
- [x] Whoop card shows connected status, connected-since date, and Disconnect button when connected
- [x] Whoop card shows Connect button when disconnected or `isValid = false`
- [x] Clicking Connect redirects to Whoop OAuth and returns to Settings on success
- [x] Cancelled or failed OAuth redirects back to Settings with a visible error message
- [x] `whoopConnection` row is created with AES-GCM encrypted tokens after successful OAuth
- [x] Clicking Disconnect deletes the connection row; card returns to disconnected state
- [x] An expired access token is refreshed automatically before being used
- [x] A failed refresh sets `isValid = false`; card prompts re-connect instead of silently failing
- [x] New env vars (`WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`) are validated at startup

---

## Phase 2: Browse Whoop Activities

**User stories**: 6, 7, 8, 9, 10, 11

### What to build

A new `/import/whoop` route shows a paginated load-more list of the user's Whoop workout activities fetched from the Whoop API. Each row displays date, sport name, duration, and strain score. Already-imported activities (matched by `whoopActivityId` against existing workout rows) are visually distinguished. The user can filter by date range and select/deselect individual activities or all loaded activities at once.

A secondary "Select all activities in date range" button (no count shown — Whoop API doesn't return totals) marks all activities in the current filter as selected regardless of how many pages have been loaded; this sets a `selectAll` flag used at commit time. React Query caches each loaded page so a failed subsequent page fetch doesn't lose already-loaded results. No workouts are created yet — this phase ends at the selection step.

### Acceptance criteria

- [x] `/import/whoop` is accessible from the existing `/import` page
- [x] If the Whoop connection is missing or `isValid = false`, the page shows a prompt to connect instead of the list
- [x] Activity list loads the first page on mount and shows a load-more control for subsequent pages
- [x] Each row shows: date, Whoop sport name, duration (minutes), strain score
- [x] Already-imported activities are visually distinguished (matched by `whoopActivityId`)
- [x] Date range filter (from / to) narrows the list; changing the filter resets to page 1
- [x] "Select All" / "Deselect All" applies to currently loaded activities only
- [x] "Select all activities in date range" button sets the `selectAll` flag; selection UI reflects this state
- [x] Previously loaded pages remain visible if a subsequent page fetch fails

---

## Phase 3: Import Flow (Web)

**User stories**: 12, 13, 14, 15, 16, 17, 18, 19, 20

### What to build

Continuing from Phase 2's selection step, the user advances to a Review step showing each selected activity (or a summary for the `selectAll` case) mapped to a proposed app workout type derived from the sport_id mapping. The user can override the workout type per activity via a dropdown; overrides are ephemeral React state.

Clicking Commit calls `whoop.commit` with either explicit activity IDs + overrides or `{ selectAll: true, from, to }` + overrides. The server fetches any unloaded activities for the `selectAll` case, filters out already-imported IDs (by `whoopActivityId`), creates all new workouts in a single transaction with `source = 'whoop'` and `whoopActivityId` set, updates `lastImportedAt` after inserts succeed, and fires progressive overload and muscle group volume recalculation (fire-and-forget). The Complete step shows created vs. skipped counts. Imported workouts display a Whoop source badge on the workout list and detail views.

### Acceptance criteria

- [x] Review step shows proposed workout type for each selected activity, derived from sport_id map
- [x] User can override workout type per activity before committing
- [x] Preview shows all fields that will be written: date, type, duration, heart rate, intensity (from strain), notes
- [x] `whoop.commit` accepts both explicit ID list and `{ selectAll, from, to }` payload
- [x] Server deduplicates by `whoopActivityId` before inserting — already-imported activities are silently skipped
- [x] Workouts are created transactionally; partial failures do not create partial data
- [x] Committed workouts have `source = 'whoop'` and `whoopActivityId` set
- [x] `durationMinutes`, `exerciseLog.heartRate`, and `exerciseLog.intensity` are populated from Whoop data
- [x] Notes field contains auto-generated Whoop import summary (strain score, etc.)
- [x] `lastImportedAt` is updated inside the transaction after inserts succeed, even if some activities were skipped
- [x] Progressive overload and muscle group volume recalculation fires after commit
- [x] Complete step shows created count and skipped count
- [x] Workout list and detail views display a Whoop source badge for imported workouts

---

## Phase 4: Incremental Sync Memory

**User stories**: 21, 22

### What to build

`lastImportedAt` is already written in Phase 3. This phase surfaces it in two places: the Whoop card on Settings shows the last import date, and the `/import/whoop` activity list defaults its `from` filter to `lastImportedAt` (inclusive) when a prior import exists. The user can clear or override the filter to see older activities. A user who has never imported sees the full unfiltered list.

### Acceptance criteria

- [ ] Settings Whoop card shows `lastImportedAt` formatted as a readable date when set
- [ ] `/import/whoop` activity list defaults `from` to `lastImportedAt` (inclusive) when set
- [ ] Defaulted filter is clearly indicated in the UI so the user knows it's pre-filtered
- [ ] User can clear or override the default date filter to see all historical activities
- [ ] A user who has never imported sees the full unfiltered activity list by default
