import dotenv from "dotenv";
import path from "path";

// Try to load local .env for development (no-op in CI where the file doesn't exist)
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../../../apps/server/.env"),
});

// Fallback env vars for CI — only applied when not already set by .env above
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/testdb";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters-long!!";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
// Required by adminProcedure — must include the test admin email used in tests
process.env.ADMIN_EMAILS ??= "admin@test.internal";
