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
Spend with no category assigned. Shown as its own bucket, never dropped. It is never a category itself, so no category may be named "Uncategorized".

**Refund**:
An expense-flow transaction that returns money; it reduces spend in the month it posts and is not matched back to the original purchase.

**Transfer**:
Money moving between the user's own accounts. Neither income nor spend.
_Avoid_: Payment (for credit card payoffs)

**Transfer Pair**:
The two legs of one transfer, one outflow and one equal inflow on different accounts.

**Excluded**:
A transaction removed from all totals while kept in the ledger: one the user excluded by hand, or one in an Excluded Category.
_Avoid_: Hidden, ignored

**Net**:
Income minus spend for a period.
_Avoid_: Savings, profit, cash flow

**Savings Rate**:
Net as a fraction of income for a period; undefined when income is zero.

**Month**:
A calendar month of the bank's posting date. All finance figures bucket by this.

### Finance — categorization

**Category**:
What a piece of spend was for, named by the user. Only expense-flow transactions carry one; income and transfers never do. A category is either top-level or a Subcategory.
_Avoid_: Type (flow covers how money moves)

**Parent Category**:
A top-level category with Subcategories under it. Its spend is its own transactions plus all its Subcategories'.
_Avoid_: Group

**Subcategory**:
A category filed under one Parent Category, such as Golf under Entertainment. A Subcategory can't have Subcategories of its own.
_Avoid_: Child category, tag

**Excluded Category**:
A category whose transactions are all Excluded, such as reimbursable or business spend. Excluding a Parent Category excludes its Subcategories too.

**Bank Category**:
The bank's own classification of a transaction, kept as received.
_Avoid_: Plaid category

**Rule**:
A user-defined instruction that sets a category, a flow, or both on every transaction whose bank description matches its Pattern. It matches exactly (the whole description) or by containing the Pattern, both ignoring case and accents. An exact match beats any containing match; among containing matches, the longest Pattern wins. A rule that makes a transaction income or transfer sets no category. Saving a rule applies it to future transactions, and to existing ones unless the user chooses future only.
_Avoid_: Category rule, filter, auto-category, mapping

**Pattern**:
The text a Rule compares against a transaction's bank description.
_Avoid_: Keyword, query, match string

**Manual Category**:
A category the user chose by hand for one transaction, including choosing Uncategorized. No Rule or Default Category replaces it until the user resets the transaction to automatic, except that applying a matching Rule fills one left Uncategorized. Every Split's category is a Manual Category.
_Avoid_: Override (unqualified), custom category

**Default Category**:
The category the user has mapped a transaction's Bank Category to, applied when it first arrives. A matching Rule takes precedence over it. When the Bank Category is mapped to no category, there is no Default Category and the transaction is Uncategorized.
_Avoid_: Plaid category, auto category

**Split**:
One piece of a transaction, with its own amount and category, sharing the original's date, account and flow. The Splits of a transaction sum to it exactly and replace it in every total. Only posted expense transactions outside a Transfer Pair can be split.
_Avoid_: Child transaction, line item

**Unreviewed**:
A posted transaction the user hasn't confirmed yet. Every newly arrived posted transaction starts unreviewed, however it was categorized; marking it reviewed or editing it by hand clears that.
_Avoid_: New, unread, pending (pending is the bank's state)

### Finance — budgets

**Budget**:
A spending limit on one category for one Month, measured against that category's Budgeted Spend. A Parent Category's budget covers its Subcategories' spend too, and may contain their own budgets.

**Total Budget**:
The sum of a Month's budgets, counting a Subcategory's budget only when its Parent Category has none.

**Pace**:
A straight path from zero on a Month's first day to its Total Budget on its last; Budgeted Spend so far is over or under pace.
_Avoid_: Perfect path, target line

### Finance — position

**Balance Snapshot**:
An account's balance as recorded on a given day. History exists only from when the account was linked.

**Net Worth**:
Total balance of asset accounts (depository, investment) minus total owed on liability accounts (credit, loan), across linked accounts only (via Plaid or SnapTrade).
_Avoid_: Total balance, wealth

### TCG — cards

The One Piece Card Game collection, Japanese and English mixed. Collected for artwork, not play or investment.

**Card**:
A game card identified by its card number (e.g. `OP05-069`) and character. Several Artworks can share one card number.
_Avoid_: Using "card" for a physical card or a specific artwork

**Artwork**:
One illustration of a Card, identified by Bandai's variant ID (e.g. `OP05-069_p1`: base, parallel, manga, reprint) and credited to an artist when known. The same Artwork is released in each language.
_Avoid_: Variant (as a noun), art, illustration

**Printing**:
An Artwork released in one language (Japanese or English), with its set. What a seller sells and what a Copy is of.
_Avoid_: Version, edition

**Copy**:
One physical card the user holds, of a known Printing and condition. May exist without a Want (cards already owned, gifts, pack pulls).
_Avoid_: Card, item, owned card

**Art Rating**:
The user's 0–5 judgement of an Artwork, shared by all its Printings. The only preference score the app keeps; buying rules stay the user's judgement.
_Avoid_: Score, preference score

**Theme**:
A user-defined tag grouping Artworks across characters, such as D Clan. What a theme covers is decided when tagging, not by the app.
_Avoid_: Category (finance owns that word), collection

**Section**:
A run of Artworks that browse lists together, keyed by the browse sort. By card number, the Card's card-number prefix (`OP05` for `OP05-119_p3`): a reprint stays in its Card's Section whichever set its Printings came out in. By Art Rating, the rating (★5 … ★0, then Unrated).
_Avoid_: Set (a Printing's set is a different thing), group, page

**Binder**:
The collection laid out like a physical binder: the Artworks the user owns a Copy of, in card-number order, nine pockets to a sheet, one sheet at a time.
_Avoid_: Album, collection view, page (say sheet)

### TCG — buying

**Want**:
The user's intent to acquire one Copy of an Artwork in an accepted language (Japanese, English, or either), bounded by a maximum delivered price and a minimum acceptable condition. It is open, ordered, fulfilled (a Copy arrived), or dropped.
_Avoid_: Wishlist item, target

**Offer**:
A seller's price for a specific Printing, as seen by the user on a given date, recorded against a Want. Its delivered price, in USD, includes item, shipping, and tax as one amount. Offers go stale; the date seen is part of the fact.
_Avoid_: Listing, quote, price

**Condition**:
A Copy's physical state on one ordered scale: NM, LP, MP, HP, DMG. Japanese shop grades are converted to it when entered. Graded slabs are out of scope.
_Avoid_: Grade, quality

**Card Fund**:
Money available for TCG purchases: the Cards category's monthly budgets summed since a start month, minus that category's Budgeted Spend over the same months. Unspent budget carries forward, unlike finance budgets; a month with no Cards budget adds nothing.
_Avoid_: Chase fund, TCG budget, balance
