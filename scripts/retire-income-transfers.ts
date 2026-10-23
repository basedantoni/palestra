/**
 * Retire the Income and Transfers categories for every user (KOI-341):
 * categories describe spend only. Idempotent; see `retireIncomeAndTransfers`.
 *
 * Run: pnpm db:retire-income-transfers
 * Prod: scripts/with-prod-db.sh pnpm db:retire-income-transfers
 */
import { db } from "@life-tracker/db";

import { retireIncomeAndTransfers } from "../packages/api/src/lib/retire-income-transfers-db";

retireIncomeAndTransfers(db)
  .then((done) => {
    console.log(`Retired: ${done.rules} rules now set a flow, ${done.transactions} rows lost a category, ${done.categories} categories deleted`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
