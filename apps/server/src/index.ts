import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@src/api/context";
import { appRouter } from "@src/api/routers/index";
import { auth } from "@src/auth";
import { env } from "@src/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("fly-client-ip")
    ?? headers.get("cf-connecting-ip")
    ?? headers.get("x-real-ip")
    ?? "unknown"
  );
}

function cleanupExpired(now: number) {
  for (const [key, value] of rateLimitState.entries()) {
    if (value.resetAt <= now) {
      rateLimitState.delete(key);
    }
  }
}

const app = new Hono();

app.use(logger());
app.use("/*", async (c, next) => {
  const now = Date.now();
  if (rateLimitState.size > 10_000) {
    cleanupExpired(now);
  }

  const ip = getClientIp(c.req.raw.headers);
  const key = `${ip}:${c.req.method}`;
  const current = rateLimitState.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitState.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
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
});

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

serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: Number(process.env.PORT) || 3000,
  },
  (info) => {
    console.log(`Server is running on http://${info.address}:${info.port}`);
  },
);
