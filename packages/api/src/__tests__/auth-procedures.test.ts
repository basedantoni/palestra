import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { adminProcedure, protectedProcedure, t } from "../index";

// Minimal local router that exercises the two auth gates directly — pure
// middleware, no DB, no HTTP. The procedures resolve to a sentinel string so a
// successful pass is observable.
const testRouter = t.router({
  protectedPing: protectedProcedure.query(() => "protected-ok"),
  adminPing: adminProcedure.query(() => "admin-ok"),
});

const createCaller = t.createCallerFactory(testRouter);

// setup.ts sets process.env.ADMIN_EMAILS before this module is imported, and
// index.ts reads it at module load. Read the same value here rather than
// hardcoding so the test tracks the configured admin list.
const ADMIN_EMAIL = process.env.ADMIN_EMAILS!.split(",")[0]!.trim();

type TestSession = {
  user: { id: string; email: string | undefined; name: string };
  session: { id: string; userId: string; expiresAt: Date };
} | null;

// Build a tRPC context with the given session. Cast through unknown because the
// real Context.session is better-auth's full session type; these tests only
// need the fields the auth middleware reads (session presence + user.email).
function caller(session: TestSession) {
  return createCaller({ session } as never);
}

function sessionWithEmail(email: string | undefined): TestSession {
  return {
    user: { id: "user-1", email, name: "Test User" },
    session: {
      id: "sess-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  };
}

describe("protectedProcedure", () => {
  it("throws UNAUTHORIZED when there is no session", async () => {
    await expect(caller(null).protectedPing()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("resolves for a valid session", async () => {
    await expect(
      caller(sessionWithEmail("user@test.internal")).protectedPing(),
    ).resolves.toBe("protected-ok");
  });
});

describe("adminProcedure", () => {
  it("throws FORBIDDEN for a valid session with a non-admin email", async () => {
    await expect(
      caller(sessionWithEmail("user@test.internal")).adminPing(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves for a valid session with an admin email", async () => {
    await expect(
      caller(sessionWithEmail(ADMIN_EMAIL)).adminPing(),
    ).resolves.toBe("admin-ok");
  });

  it("resolves when the admin email is uppercased (case-insensitive match)", async () => {
    await expect(
      caller(sessionWithEmail(ADMIN_EMAIL.toUpperCase())).adminPing(),
    ).resolves.toBe("admin-ok");
  });

  it("throws FORBIDDEN (not a crash) when user.email is undefined", async () => {
    const promise = caller(sessionWithEmail(undefined)).adminPing();
    await expect(promise).rejects.toBeInstanceOf(TRPCError);
    await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
