import type { ObjectStore } from "../../lib/market/object-store";

/** In-memory stand-in for the Tigris bucket (KOI-364). `objects` is the bucket, by key. */
export function memoryStore(): ObjectStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
  };
}
