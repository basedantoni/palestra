# API

Business rules behind the tracker: what the numbers mean, independent of how they are stored or drawn.

## Language

### Finance — money movement

**Flow**:
The role a transaction plays: income, expense, or transfer. Assigned from the bank's category; the user can correct it.
_Avoid_: Type, direction

**Income**:
The sum of non-excluded transactions whose flow is income, within a period.
_Avoid_: Earnings, inflow, deposits

**Spend**:
The sum of non-excluded transactions whose flow is expense within a period, including uncategorized ones. Refunds count as negative spend in the month they land.
_Avoid_: Expenses, outflow, spending

**Budgeted Spend**:
Spend restricted to categorized transactions; what a budget is measured against.
_Avoid_: Spend (when the uncategorized portion is excluded)

**Uncategorized**:
Spend with no category assigned. Shown as its own bucket, never dropped.

**Refund**:
An expense-flow transaction that returns money; it reduces spend in the month it posts and is not matched back to the original purchase.

**Transfer**:
Money moving between the user's own accounts. Neither income nor spend.
_Avoid_: Payment (for credit card payoffs)

**Transfer Pair**:
The two legs of one transfer, one outflow and one equal inflow on different accounts.

**Excluded**:
A transaction the user has removed from all totals while keeping it in the ledger.
_Avoid_: Hidden, ignored

**Net**:
Income minus spend for a period.
_Avoid_: Savings, profit, cash flow

**Savings Rate**:
Net as a fraction of income for a period; undefined when income is zero.

**Month**:
A calendar month of the bank's posting date. All finance figures bucket by this.

### Finance — categorization

**Category Rule**:
A user-defined instruction that assigns a category to every transaction whose bank description contains a given pattern, ignoring case. When several rules match, the one with the longest pattern wins. Applies whatever the transaction's flow.
_Avoid_: Filter, auto-category, mapping

**Pattern**:
The text a category rule looks for inside a transaction's bank description.
_Avoid_: Keyword, query, match string

**Manual Category**:
A category the user chose by hand for one transaction, including choosing Uncategorized. No category rule or default category replaces it until the user resets the transaction to automatic.
_Avoid_: Override (unqualified), custom category

**Default Category**:
The category derived from the bank's own classification when a transaction first arrives. A matching category rule takes precedence over it.
_Avoid_: Plaid category, auto category

### Finance — position

**Balance Snapshot**:
An account's balance as recorded on a given day. History exists only from when the account was linked.

**Net Worth**:
Total balance of asset accounts (depository, investment) minus total owed on liability accounts (credit, loan), across linked accounts only.
_Avoid_: Total balance, wealth
