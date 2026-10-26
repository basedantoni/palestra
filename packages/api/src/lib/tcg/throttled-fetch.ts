/** A GET that sends each host at most one request per `delayMs`, for scripts that crawl Bandai and Limitless. */
export function throttledFetch(delayMs: number, userAgent: string): (url: string) => Promise<Response> {
  const next = new Map<string, number>();
  return async (url) => {
    const host = new URL(url).host;
    const at = Math.max(Date.now(), next.get(host) ?? 0);
    next.set(host, at + delayMs);
    await new Promise((r) => setTimeout(r, Math.max(0, at - Date.now())));
    return fetch(url, { headers: { "User-Agent": userAgent } });
  };
}
