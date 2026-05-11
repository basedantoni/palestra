import { refreshAllValidWhoopTokens } from "@src/api/lib/whoop-client";
import { env } from "@src/env/server";
import { Hono } from "hono";

export const internalApp = new Hono();

internalApp.post("/whoop/refresh-tokens", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!env.INTERNAL_API_SECRET || secret !== env.INTERNAL_API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await refreshAllValidWhoopTokens();
  console.log(`[internal] Whoop token refresh: ${result.refreshed} refreshed, ${result.failed} failed`);
  return c.json({ ok: true, ...result });
});
