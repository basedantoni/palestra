/**
 * In-flight processor registry.
 *
 * A Set of all currently-running processor promises. Used to:
 * - Track active work during graceful shutdown (await all before exit)
 * - Report in-flight count for observability
 *
 * No dependencies — imported by both whoop-webhook.ts and whoop-webhook-drain.ts.
 */

const inFlight = new Set<Promise<void>>();

export function trackInFlight(promise: Promise<void>): void {
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise));
}

export function getInFlightCount(): number {
  return inFlight.size;
}

export function getInFlightPromises(): Promise<void>[] {
  return Array.from(inFlight);
}
