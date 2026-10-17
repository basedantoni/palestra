# Splits are transaction rows; totals skip their parent

A split transaction keeps its own row and amount, and each Split is a new `transaction` row linked to that parent, with no Plaid id. Every total skips a transaction that has Splits and counts the Splits instead. We chose this over a separate split-lines table because every finance aggregation (spend, budgets, cash flow, category charts) already sums `transaction` rows: child rows cost each of them one extra filter, while a lines table would make each one union or join a second source, and one forgotten join is a silent wrong total (the same reasoning as ADR 0001). This follows Copilot Money, which models splits the same way.

## Consequences

- `plaidTransactionId` becomes nullable, so a transaction without one is a Split, not a sync bug.
- The parent keeps its Bank Category but carries no category. Rules and Default Category resolution skip parents and Splits.
- When Plaid removes a parent, its Splits are deleted. When Plaid changes the parent's amount, the split is undone and the transaction goes back to Unreviewed, because Splits that no longer sum to the parent can't be trusted.
