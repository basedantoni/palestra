import { expo } from "@better-auth/expo";
import { db } from "@src/db";
import * as schema from "@src/db/schema/auth";
import { env } from "@src/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const isHttpsAuthUrl = env.BETTER_AUTH_URL.startsWith("https://");
const secureCookies = env.NODE_ENV === "production" || isHttpsAuthUrl;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",

    schema: schema,
  }),
  trustedOrigins: [
    env.CORS_ORIGIN,
    "src://",
    ...(env.NODE_ENV === "development" ? ["exp://"] : []),
  ],
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: secureCookies ? "none" : "lax",
      secure: secureCookies,
      httpOnly: true,
    },
  },
  crossSubDomainCookies: {
    enabled: true,
    domain: "palestra.dev",
  },
  plugins: [expo()],
});
