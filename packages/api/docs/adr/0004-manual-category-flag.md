# Manual categories are a flag; rule application is not tracked

Category rules must never overwrite a category the user picked by hand, so — following the flow-override pattern of ADR 0001 — a transaction carries a flag marking its category as manual, set by `setCategory` (including picking Uncategorized) and cleared only by "Reset to automatic". Rows that predate the flag are backfilled by inference: a row is manual when its `categoryId` differs from the default category recomputed from the always-preserved `plaidCategoryPrimary`. The only misclassification is a hand-pick that equals the default, which is harmless. We deliberately do not record which rule categorized a transaction: applying a rule is a one-shot write, so deleting or editing a rule never reverts past transactions. Deleting a rule means "stop doing this", not "undo history", and skipping provenance avoids a rule→transaction link that every rule edit would have to reconcile.

## Consequences

- To undo a rule's retroactive effect, the user recategorizes or resets the affected transactions; there is no bulk revert.
- A manual category on a pending transaction is lost when it posts (new Plaid id, ADR 0001), but a matching rule re-applies to the posted row.
- Retroactive apply (KOI-299) re-resolves only the rows the saved rule's Pattern matches — plus, on edit, the rows its previous Pattern matched — against the full rule set. It is not a sweep: rows a deleted rule once categorized keep that category until reset.
- Applying a rule fills a Manual Category left Uncategorized when the rule matches it, and clears its flag (KOI-300). Rows the backfill inferred as manual because they were blank were indistinguishable from a deliberate "Uncategorized", and blank rows are what users want rules to fill. A hand-picked real category is still never touched.
