import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const serverSchema = {
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  CORS_ORIGIN: z.url(),
  ADMIN_EMAILS: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
};

export const env = createEnv<undefined, typeof serverSchema>({
  server: serverSchema,
  runtimeEnvStrict: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
});
