import { env } from "@src/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const db = drizzle(env.DATABASE_URL);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./migrations" });
console.log("Migrations complete.");
process.exit(0);
