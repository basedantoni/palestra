import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// src/utils/trpc.ts reads the server URL at load; nothing is ever sent there. Mocked, not stubbed:
// the env module reads `(import.meta as any).env`, which Vitest does not populate.
vi.mock("@life-tracker/env/web", () => ({ env: { VITE_SERVER_URL: "http://localhost:3000" } }));

// No network: a component that asks for data it was not given fails loudly instead of fetching.
vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
  Promise.reject(new Error(`Network is off in component tests: ${String(input)}`)),
);

// jsdom has no layout. recharts' ResponsiveContainer sizes itself from a ResizeObserver, so report
// a fixed box: charts render real SVG (geometry is never asserted) instead of throwing or staying empty.
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const contentRect = { width: 800, height: 400, top: 0, left: 0, bottom: 400, right: 800, x: 0, y: 0 };
      this.callback([{ target, contentRect } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  },
);
