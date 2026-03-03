# Changelog

## [Unreleased]

### Added

- **`packages/shared`** — new shared package (`@src/shared`) containing the single source of truth for onboarding Zod schemas, option label constants, and the composed API preferences input schema.
  - `stepGoalsSchema`, `stepWorkoutsSchema`, `stepMetricsSchema`, `stepPreferencesSchema`
  - `onboardingSchema` (merged combined schema)
  - `preferencesInputSchema` (composed from step schemas + API-only fields; replaces the inline definition in the preferences router)
  - `STEP_FIELD_NAMES`, `TOTAL_STEPS`
  - `GOALS`, `EXPERIENCE_LEVELS`, `WORKOUT_TYPES`, `GENDERS`, `WEIGHT_UNITS`, `DISTANCE_UNITS`, `MUSCLE_GROUP_SYSTEMS`, `THEMES`
- **Onboarding schema tests** (`packages/shared/src/onboarding-schemas.test.ts`) — 26 Vitest tests covering all step schemas, the combined schema, the preferences input schema, and `STEP_FIELD_NAMES` groupings. Tests live once in the shared package instead of being duplicated per platform.

### Changed

- `apps/native` — all onboarding component and screen imports updated from `@/lib/onboarding-schemas` to `@src/shared`.
- `apps/web` — `onboarding-page.tsx` updated from `@/lib/onboarding-schemas` to `@src/shared`. Step components (`step-goals`, `step-workouts`, `step-preferences`, `step-metrics`) updated from inline local constant definitions to imported constants from `@src/shared`.
- `packages/api` — `preferences.ts` router now imports `preferencesInputSchema` from `@src/shared` instead of defining its own inline Zod schema.

### Removed

- `apps/native/lib/onboarding-schemas.ts` — replaced by `packages/shared`.
- `apps/native/lib/onboarding-schemas.test.ts` — consolidated into `packages/shared`.
- `apps/web/src/lib/onboarding-schemas.ts` — replaced by `packages/shared`.
- `apps/web/src/lib/onboarding-schemas.test.ts` — consolidated into `packages/shared`.
- Inline `GOALS`, `EXPERIENCE_LEVELS`, `WORKOUT_TYPES`, `GENDERS`, `WEIGHT_UNITS`, `DISTANCE_UNITS`, `MUSCLE_GROUP_SYSTEMS`, `THEMES` constant definitions from web step components.

### Architecture Notes

Prior to this change there were effectively **four** copies of the same validation rules:
1. `apps/native/lib/onboarding-schemas.ts`
2. `apps/web/src/lib/onboarding-schemas.ts`
3. Inline `preferencesInput` in `packages/api/src/routers/preferences.ts`
4. Inline constant arrays in each web step component

Additionally, the option label constants existed only in the native schema file, not the web one — an existing divergence. Moving everything to `packages/shared` closes all of these gaps and ensures that adding or changing a validation rule (e.g. a new fitness goal enum value) requires a change in exactly one place.

**Future work:** the raw enum string values are still also defined as Postgres `pgEnum` entries in `packages/db/src/schema/enums.ts`. Deriving those from shared string-array constants exported by `@src/shared` would close the final gap and make `packages/db` the only remaining source of truth for what values are valid at the database level.
