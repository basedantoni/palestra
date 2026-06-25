import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    ADMIN_EMAILS: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    WHOOP_CLIENT_ID: z.string().min(1).optional(),
    WHOOP_CLIENT_SECRET: z.string().min(1).optional(),
    WHOOP_REDIRECT_URI: z.string().url().optional(),
    TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(),
    INTERNAL_API_SECRET: z.string().min(32).optional(),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    PLAID_CLIENT_ID: z.string().min(1).optional(),
    PLAID_SECRET: z.string().min(1).optional(),
    PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    PLAID_WEBHOOK_URL: z.string().url().optional(),
    PLAID_PRODUCTS: z.string().min(1).default("transactions"),
    PLAID_COUNTRY_CODES: z.string().min(1).default("US"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
