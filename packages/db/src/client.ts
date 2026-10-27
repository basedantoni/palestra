import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

/** A database client for `url`, without loading the web server's env (the worker has its own). */
export const createDb = (url: string) => drizzle(url, { schema });
