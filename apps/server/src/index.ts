import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@life-tracker/api/context";
import { appRouter } from "@life-tracker/api/routers/index";
import { auth } from "@life-tracker/auth";
import { env } from "@life-tracker/env/server";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { whoopOAuthApp } from "./whoop-oauth";
import { plaidWebhookApp } from "@life-tracker/api/lib/plaid-webhook";
import { internalApp } from "./internal";
import { tcgImageApp } from "./tcg-image";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
// One browse page loads up to 200 card images at once (browser-cached for a week afterwards).
const IMAGE_RATE_LIMIT_MAX_REQUESTS = 1_000;

function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("fly-client-ip") ??
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

function cleanupExpired(state: Map<string, { count: number; resetAt: number }>, now: number) {
  for (const [key, value] of state.entries()) {
    if (value.resetAt <= now) {
      state.delete(key);
    }
  }
}

/** Fixed-window limit of `maxRequests` per client IP and method per minute; each limiter counts separately. */
function rateLimit(maxRequests: number): MiddlewareHandler {
  const state = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const now = Date.now();
    if (state.size > 10_000) {
      cleanupExpired(state, now);
    }

    const ip = getClientIp(c.req.raw.headers);
    const key = `${ip}:${c.req.method}`;
    const current = state.get(key);

    if (!current || current.resetAt <= now) {
      state.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000),
      );
      c.header("Retry-After", String(retryAfterSeconds));
      return c.json(
        {
          error: "Too many requests",
        },
        429,
      );
    }

    current.count += 1;
    return next();
  };
}

const app = new Hono();

app.use(logger());
// Card images get their own, larger budget so a browse page doesn't exhaust the API limit.
app.use("/api/tcg/*", rateLimit(IMAGE_RATE_LIMIT_MAX_REQUESTS));
app.route("/api/tcg", tcgImageApp);
app.use("/*", rateLimit(RATE_LIMIT_MAX_REQUESTS));

app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/whoop", whoopOAuthApp);
app.route("/api/internal", internalApp);
app.route("/api/plaid", plaidWebhookApp);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

import { serve } from "@hono/node-server";
import { drainPendingWhoopEvents } from "@life-tracker/api/lib/whoop-webhook-drain";
import { drainPendingRecalcJobs } from "@life-tracker/api/lib/recalc-queue";
import { drainPendingPlaidEvents } from "@life-tracker/api/lib/plaid-webhook";
import {
  getInFlightCount,
  getInFlightPromises,
} from "@life-tracker/api/lib/whoop-inflight";

const SHUTDOWN_TIMEOUT_MS = 38_000; // fly.toml kill_timeout = 45s → 7s safety margin

const server = serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: Number(process.env.PORT) || 3000,
  },
  (info) => {
    console.log(`Server is running on http://${info.address}:${info.port}`);
    drainPendingWhoopEvents().catch((err) =>
      console.error("[whoop-drain] Startup drain failed:", err),
    );
    drainPendingRecalcJobs().catch((err) =>
      console.error("[recalc-drain] Startup drain failed:", err),
    );
    drainPendingPlaidEvents().catch((err) =>
      console.error("[plaid-drain] Startup drain failed:", err),
    );
  },
);

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(
    `[shutdown] Received ${signal}, draining ${getInFlightCount()} in-flight processors`,
  );

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  }).catch((err) => console.error("[shutdown] server.close error:", err));

  const inFlight = getInFlightPromises();
  if (inFlight.length > 0) {
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), SHUTDOWN_TIMEOUT_MS),
    );
    const result = await Promise.race([
      Promise.allSettled(inFlight).then(() => "drained" as const),
      timeout,
    ]);
    if (result === "timeout") {
      console.warn(
        `[shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms with ${getInFlightCount()} processors still running`,
      );
    } else {
      console.log("[shutdown] All in-flight processors drained");
    }
  }

  console.log("[shutdown] Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
