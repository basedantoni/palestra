import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { snapshotAllPlaidBalances } from "@life-tracker/api/lib/plaid-balance-snapshot";
import { refreshAllValidWhoopTokens } from "@life-tracker/api/lib/whoop-client";
import { env } from "@life-tracker/env/server";
import { Hono } from "hono";

export const internalApp = new Hono();

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

// Every internal route is cron-triggered and guarded by X-Internal-Secret.
internalApp.use("*", async (c, next) => {
  const secret = c.req.header("X-Internal-Secret");
  if (
    !env.INTERNAL_API_SECRET ||
    !secret ||
    !timingSafeEqual(secret, env.INTERNAL_API_SECRET)
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

internalApp.post("/whoop/refresh-tokens", async (c) => {
  const result = await refreshAllValidWhoopTokens();
  console.log(
    `[internal] Whoop token refresh: ${result.refreshed} refreshed, ${result.failed} failed`,
  );
  return c.json({ ok: true, ...result });
});

internalApp.post("/plaid/snapshot-balances", async (c) => {
  const result = await snapshotAllPlaidBalances();
  console.log(
    `[internal] Plaid balance snapshot: ${result.snapshotted} snapshotted, ${result.failed} failed`,
  );
  // A day not captured is lost for good (ADR 0003): if every item failed, fail
  // the request so the cron run goes red instead of silently passing.
  const ok = result.failed === 0 || result.snapshotted > 0;
  return c.json({ ok, ...result }, ok ? 200 : 500);
});
