import { env } from "@life-tracker/env/server";

import { createDb } from "./client";

export const db = createDb(env.DATABASE_URL);
