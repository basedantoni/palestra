import { bandaiCardImageUrl, relayCardImage } from "@life-tracker/api/lib/tcg/card-image";
import { auth } from "@life-tracker/auth";
import { Hono } from "hono";

/**
 * GET /api/tcg/image?src=<Bandai card image URL>: relays a Bandai card image,
 * which browsers refuse to load cross-site (see `card-image.ts`). Signed-in
 * users only; nothing is stored server-side, the browser caches it.
 */
export const tcgImageApp = new Hono();

tcgImageApp.get("/image", async (c) => {
  const url = bandaiCardImageUrl(c.req.query("src") ?? "");
  if (!url) return c.text("Bad image URL", 400);
  // ponytail: one session lookup per image (no cookie cache); fine at browse scale, enable Better-Auth cookieCache if it shows up.
  if (!(await auth.api.getSession({ headers: c.req.raw.headers }))) return c.text("Unauthorized", 401);
  return relayCardImage(url);
});
