/** Time as the throttle sees it: injected so a test can assert the spacing without waiting. */
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
};

/**
 * A GET that sends each host at most one request per `delayMs`: for the scripts that crawl Bandai
 * and Limitless, and the CardTrader capture's ToS bound (ADR 0007).
 */
export function throttledFetch(
  delayMs: number,
  userAgent: string,
  { fetch = globalThis.fetch, clock = systemClock }: { fetch?: typeof globalThis.fetch; clock?: Clock } = {},
): (url: string, headers?: Record<string, string>) => Promise<Response> {
  const next = new Map<string, number>();
  return async (url, headers) => {
    const host = new URL(url).host;
    const at = Math.max(clock.now(), next.get(host) ?? 0);
    next.set(host, at + delayMs);
    await clock.sleep(at - clock.now());
    return fetch(url, { headers: { "User-Agent": userAgent, ...headers } });
  };
}
