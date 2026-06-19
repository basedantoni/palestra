import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
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

internalApp.post("/whoop/refresh-tokens", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (
    !env.INTERNAL_API_SECRET ||
    !secret ||
    !timingSafeEqual(secret, env.INTERNAL_API_SECRET)
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await refreshAllValidWhoopTokens();
  console.log(
    `[internal] Whoop token refresh: ${result.refreshed} refreshed, ${result.failed} failed`,
  );
  return c.json({ ok: true, ...result });
});
