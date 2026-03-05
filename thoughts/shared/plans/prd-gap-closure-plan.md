# Plan: PRD Gap Closure (MVP Must-Haves + Remaining Items)

> Source PRD: `/Users/anthony/dev/fitness-app/PRD.md` (Version 2.0, January 9, 2026) + approved remaining-gap list

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes (web)**: Keep TanStack file routes; add new feature routes under `/workouts/*`, `/templates/*`, `/settings`, and `/account/*`.
- **Routes (native)**: Keep Expo Router tabs + stack; add screens in the existing drawer/tabs stack for settings, template editing, and workout editing.
- **API boundary**: Continue using `packages/api` tRPC routers from web/native clients; no direct client-to-DB path.
- **Schema**: Preserve current core schema (`workout`, `exercise_log`, `exercise_set`, `workout_template`, `workout_template_exercise`, `user_preferences`, auth tables). Add new tables only where needed for export/offline metadata.
- **Key models**: Workout with nested logs/sets, workout template with ordered template exercises, user preferences, auth/session/account.
- **Auth/AuthZ**: Keep Better Auth sessions and protected procedures for user-scoped data access.
- **Third-party boundaries**: Better Auth for identity providers and password flows; local SQLite as native offline storage and sync queue.

---

## Phase 1: Edit Past Workouts on Web

**User stories**: FR-2.9

### What to build

Add an end-to-end web edit flow for previously logged workouts so users can open an existing workout, modify exercises/sets/notes/date/type, and persist updates through existing workout update APIs.

### Acceptance criteria

- [ ] User can start editing from workout detail/history and load existing workout data into an editable form.
- [ ] Save updates workout and nested logs/sets correctly and returns to updated workout detail.
- [ ] Validation and error states are surfaced (invalid data, failed save, missing workout).

---

## Phase 2: Edit Past Workouts on Native

**User stories**: FR-2.9

### What to build

Add the same end-to-end edit workflow in native so users can modify historical workouts from workout detail/history and save through existing workout update APIs.

### Acceptance criteria

- [ ] User can enter edit mode from workout detail/history and see prefilled workout data.
- [ ] Save persists updated workout, logs, and sets with success/failure feedback.
- [ ] Navigation and state handling avoid losing edits unintentionally.

---

## Phase 3: Template Editing UI on Web

**User stories**: FR-5.6

### What to build

Introduce a web template management/editing experience for user templates so users can modify template metadata and exercise ordering/list and persist changes via existing template APIs.

### Acceptance criteria

- [ ] User can open a template, edit name/type/notes, and modify exercise list/order.
- [ ] Save uses template update endpoint and reflects updated template in list/detail flows.
- [ ] System templates remain protected from unauthorized edits in user flows.

---

## Phase 4: Template Editing UI on Native

**User stories**: FR-5.6

### What to build

Add equivalent native template editing flows for user templates, including exercise list adjustments and metadata updates, backed by existing template APIs.

### Acceptance criteria

- [ ] User can access and edit personal templates on native.
- [ ] Template edits persist and are visible in template-backed workout creation flows.
- [ ] Error handling and permissions behavior match user ownership expectations.

---

## Phase 5: Settings Screen on Web (Preferences + Plateau Threshold)

**User stories**: FR-7

### What to build

Create a dedicated web settings page that allows post-onboarding updates to units, theme, muscle group system, and plateau threshold through preferences APIs.

### Acceptance criteria

- [ ] Settings route is reachable for authenticated/onboarded users.
- [ ] User can update units, theme, muscle group system, and plateau threshold.
- [ ] Changes persist to `user_preferences` and are reflected in relevant UI behavior.

---

## Phase 6: Settings Screen on Native (Preferences + Plateau Threshold)

**User stories**: FR-7

### What to build

Create a native settings screen mirroring web capability so users can update core preferences after onboarding.

### Acceptance criteria

- [ ] Settings screen is accessible from existing native navigation.
- [ ] User can update units, theme, muscle group system, and plateau threshold.
- [ ] Persisted values survive app restart and drive live UI behavior where applicable.

---

## Phase 7: Data Export v1 (JSON Export, User-Initiated)

**User stories**: FR-4.11, FR-6.6

### What to build

Deliver a first complete export path producing a user-owned JSON export of core account/workout/template/preferences data with authenticated request and retrieval UX.

### Acceptance criteria

- [ ] User can request JSON export from account/settings context.
- [ ] Export contains complete, user-scoped data across core models.
- [ ] Export operation is secure, auditable, and does not leak other users’ data.

---

## Phase 8: Data Export v2 (CSV Export + Download UX)

**User stories**: FR-4.11, FR-6.6

### What to build

Extend export support with CSV variants (or CSV bundle) and improve retrieval/download UX across web/native.

### Acceptance criteria

- [ ] User can select and receive CSV output for supported entities.
- [ ] CSV format is consistent, documented, and usable in spreadsheet tools.
- [ ] Download/retrieval flow is reliable for both web and native contexts.

---

## Phase 9: Password Reset End-to-End

**User stories**: FR-1.5

### What to build

Add complete password reset flow (request, tokenized reset, new password submission, post-reset sign-in behavior) integrated with current auth stack.

### Acceptance criteria

- [ ] User can request reset from auth UI and receive reset instructions.
- [ ] Reset token flow securely validates and updates password.
- [ ] UX includes success/error states and prevents invalid/expired token reuse.

---

## Phase 10: Account Deletion with Pre-Delete Export Flow

**User stories**: FR-1.6 (depends on FR-4.11/FR-6.6)

### What to build

Add account deletion flow that explicitly offers/exports data prior to destructive confirmation, then removes account and associated data under existing ownership constraints.

### Acceptance criteria

- [ ] User sees clear pre-delete warning and export option before final confirmation.
- [ ] Confirmed deletion removes user account/session and user-owned records.
- [ ] Flow is irreversible by design and communicates finality clearly.

---

## Phase 11: Social Login (Google + Apple) Across Web/Native

**User stories**: FR-1.2

### What to build

Integrate Google and Apple sign-in providers end-to-end in auth UI and backend provider configuration for both web and native.

### Acceptance criteria

- [ ] User can sign in/up with Google and Apple on supported platforms.
- [ ] Account linking/creation behavior avoids duplicate-account confusion.
- [ ] Existing email/password flows remain functional.

---

## Phase 12: Offline Foundation (SQLite + Sync Queue for Workout CRUD)

**User stories**: FR-6

### What to build

Establish offline-first foundation in native with local SQLite persistence and a sync queue for workout CRUD so logging/editing works without network and reconciles later.

### Acceptance criteria

- [ ] User can create/update/delete workouts while offline.
- [ ] Offline mutations enqueue and replay on reconnect with clear status visibility.
- [ ] Sync preserves data integrity and idempotency for repeated retries.

---

## Phase 13: Offline Expansion (Templates/Preferences Sync + Conflict Handling)

**User stories**: FR-6

### What to build

Extend offline capability beyond workouts to template and preference updates, including deterministic conflict resolution rules for cross-device/server drift.

### Acceptance criteria

- [ ] Templates and preferences can be edited offline and synced later.
- [ ] Conflict scenarios resolve predictably and are user-safe.
- [ ] Reconciliation behavior is tested for reconnect and stale-state edge cases.

---

## Phase 14: PR Celebration Animation

**User stories**: Section 3.2

### What to build

Add a lightweight celebration animation when a new personal record is achieved in workout logging/detail flows.

### Acceptance criteria

- [ ] PR detection triggers celebration exactly when new records are achieved.
- [ ] Animation is performant and non-disruptive on web/native.
- [ ] Users can continue normal logging flow without blocking interactions.
