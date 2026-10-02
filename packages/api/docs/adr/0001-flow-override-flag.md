# Flow overrides are a flag that sync respects

Users can correct a transaction's flow (e.g. a Venmo inflow Plaid called a transfer is really income). We store the corrected value in `transaction.flow` itself and set a `flowOverridden` flag that makes the Plaid sync upsert leave `flow` untouched. We chose this over a separate nullable `userFlow` column because every reader of flow (budget spend, summary, charts) would then need `coalesce(userFlow, flow)`, and one forgotten coalesce is a silent wrong total. "Reset to automatic" stays possible by re-running classification on the always-preserved `plaidCategoryPrimary`.

## Consequences

- Overrides are only allowed on posted transactions: when a pending transaction posts, Plaid issues a new id and the override would be lost.
- Overriding one leg of a transfer pair breaks the pair (clears `transferPairId` on both legs); the other leg stays an unpaired transfer.
