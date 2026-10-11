import { fileURLToPath } from "node:url";

/** Absolute path of the drizzle migrations folder, for tooling that applies them (e.g. the PGlite test harness). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
