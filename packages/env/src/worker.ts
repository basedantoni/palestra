import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The Market Watch worker's env (KOI-364, ADR 0008): `palestra-worker` and the local market CLI
 * load this module, never ./server, and the web server never loads this one, so neither requires
 * the other's secrets.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    // The web server's admins, who get the worker's failed-capture and database-size notifications
    // (KOI-365). Set it on palestra-worker too. Omit = nobody is notified.
    ADMIN_EMAILS: z.string().min(1).optional(),
    // Tigris (S3) bucket for raw snapshots, private. `fly storage create -a palestra-worker` sets
    // all five as secrets on the app.
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_ENDPOINT_URL_S3: z.url(),
    AWS_REGION: z.string().min(1).default("auto"),
    BUCKET_NAME: z.string().min(1),
    // CardTrader's self-serve API token (profile settings → API). Optional so a missing token fails
    // only market.cardtrader, never the worker's boot or the other sources.
    CARDTRADER_TOKEN: z.string().min(1).optional(),
    // TypeSafe API key (console.typesafe.ai) for the matcher's TypeSafe tier (KOI-371). Optional:
    // without it the tier is skipped and ambiguous products stay on the unmatched list.
    TYPESAFE_API_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
