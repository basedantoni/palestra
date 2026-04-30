# Lessons

- When adding a top-level one-off TypeScript script, declare its runtime tools in the root package and add a root `pnpm` script. Do not rely on binaries from another workspace package when the user-facing command is meant to run from the repo root or nearby folders.
