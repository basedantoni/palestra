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
