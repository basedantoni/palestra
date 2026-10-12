/**
 * Bandai serves card images with `Cross-Origin-Resource-Policy: same-site`, so
 * browsers block them on our pages. The server relays them instead (still
 * hotlinked per ADR 0006: fetched per request, never stored). This allowlist
 * keeps that relay from fetching anything but a Bandai card image.
 */
const HOSTS = new Set(["www.onepiece-cardgame.com", "en.onepiece-cardgame.com"]);
const PATH = /^\/images\/cardlist\/card\/[\w-]+\.png$/;

export function bandaiCardImageUrl(src: string): URL | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  const ok = url.protocol === "https:" && HOSTS.has(url.hostname) && !url.username && !url.port && PATH.test(url.pathname);
  return ok ? url : null;
}

/**
 * Fetch an allowlisted card image and relay it. Redirects are refused (they
 * could lead off the allowlist) and a slow upstream is cut off at `timeoutMs`.
 */
export async function relayCardImage(url: URL, timeoutMs = 10_000): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return new Response(timedOut ? "Image timed out" : "Image unavailable", { status: timedOut ? 504 : 502 });
  }
  if (!upstream.ok) return new Response("Image unavailable", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      // The URL carries Bandai's version (`?260828`), so a long private cache is safe.
      "Cache-Control": "private, max-age=604800",
    },
  });
}
