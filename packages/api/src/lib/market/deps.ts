import { createDb } from "@life-tracker/db/client";
import { env } from "@life-tracker/env/worker";

import { parseAdminEmails } from "../admins";
import { databaseSize } from "./alerts";
import { s3Store } from "./object-store";
import { typesafeChooser } from "./typesafe-tier";
import type { WorkerDeps } from "./worker";

/** The real collaborators, from the worker env: Postgres, the Tigris bucket, the network, the admins. */
export function marketDeps(): WorkerDeps {
  const db = createDb(env.DATABASE_URL);
  return {
    db,
    store: s3Store({
      endpoint: env.AWS_ENDPOINT_URL_S3,
      bucket: env.BUCKET_NAME,
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    }),
    fetch: globalThis.fetch,
    cardtraderToken: env.CARDTRADER_TOKEN,
    chooser: env.TYPESAFE_API_KEY ? typesafeChooser(env.TYPESAFE_API_KEY, globalThis.fetch) : undefined,
    adminEmails: parseAdminEmails(env.ADMIN_EMAILS),
    databaseSize: () => databaseSize(db),
  };
}
