# Nike TCX Import

- [x] Phase 1: Add XML parser dependency and dry-run parser script
  - [x] Add `fast-xml-parser` to `@src/db`
  - [x] Add `fast-xml-parser` at the repo root for top-level script resolution
  - [x] Add root `import:nike-tcx` script and root `tsx` devDependency
  - [x] Create `scripts/import-nike-tcx.ts`
  - [x] Run `pnpm install`
  - [x] Run TypeScript checks
  - [x] Run dry-run parser against Nike TCX directory
- [ ] Phase 2: DB writes, dedup, and import
  - [x] Load seeded Short Run and Long Run exercise rows
  - [x] Build Nike Run Club dedup index from existing workouts
  - [x] Insert workout and exercise log rows transactionally
  - [x] Keep dry-run read-only while exercising DB lookup and dedup
  - [x] Resolve TCX duplicate-count mismatch before real import
  - [x] Run real import for `anthony <ant@gmail.com>`
  - [x] Verify immediate rerun is a no-op
  - [x] Verify imported row counts and HR coverage
  - [ ] Manually verify imported runs in the web app
- [x] Fix `/workouts` calendar month navigation freeze
  - [x] Identify maximum-update-depth loop in selected date synchronization
  - [x] Guard fallback date updates by local date key
  - [x] Run type checks and web build

## Review

- Phase 1 automated verification passed.
- `pnpm install --no-frozen-lockfile` completed and updated dependencies.
- TypeScript passed with `pnpm check-types`.
- Dry run parsed `126/126` TCX files with `errors: 0`.
- Sample rows showed dates from 2022 and 2025, distances from 3.24km to 6.00km, durations from 21.2min to 41.2min, and HR where available.
- Bare `tsx` is not on PATH in this shell, so verification uses `pnpm exec tsx`.
- Top-level scripts do not resolve `packages/db` devDependencies under pnpm isolation, so the XML parser is also declared at the repo root.
- User verification from `scripts/` showed `pnpm exec tsx` was unavailable because root did not declare `tsx`; root now owns the runner via `pnpm import:nike-tcx`.
- Phase 2 type checks pass.
- DB-backed dry-run for a throwaway user parsed all 126 files but reports `imported=125 skipped_duplicate=1 skipped_error=0`.
- Duplicate pair: `0bed5eea-8609-42c7-bad5-d79b7a251e3f.tcx` and `dc541d18-f9cd-4ce7-94fb-9752d700ab41.tcx` share `2022-10-29T19:05:05.526Z`, `14920.372m`, `6000.572s`, avg HR `147`, max HR `165`; the first has calories `1146`, the second has calories `0`.
- Real import for `YcKMG9bVumEcHuNwMizZ1VourXa0kiBB` inserted `125` unique Nike runs and skipped the duplicate file.
- Immediate rerun returned `imported=0 skipped_duplicate=126 skipped_error=0`.
- DB verification: `125` Nike workouts, `34` rows with heart rate, `104` Short Run rows, `21` Long Run rows, distance range `54.77m` to `42313.22m`.
- Fixed `/workouts` calendar freeze by preventing the selected-date effect from setting a new `Date` object when the selected local-day key is already the intended fallback.
- Verification passed: `pnpm check-types`, `pnpm -F web build`.
