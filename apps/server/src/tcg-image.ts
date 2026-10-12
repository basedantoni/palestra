import { bandaiCardImageUrl } from "@life-tracker/api/lib/tcg/card-image";
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
  if (!(await auth.api.getSession({ headers: c.req.raw.headers }))) return c.text("Unauthorized", 401);

  const upstream = await fetch(url);
  if (!upstream.ok) return c.text("Image unavailable", 502);
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      // The URL carries Bandai's version (`?260828`), so a long private cache is safe.
      "Cache-Control": "private, max-age=604800",
    },
  });
});
