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
A category the user chose by hand for one transaction, including choosing Uncategorized. No category rule or default category replaces it until the user resets the transaction to automatic — except that applying a matching category rule fills one left Uncategorized.
_Avoid_: Override (unqualified), custom category

**Default Category**:
The category derived from the bank's own classification when a transaction first arrives. A matching category rule takes precedence over it. When the bank's classification maps to no category, there is no Default Category and the transaction is Uncategorized.
_Avoid_: Plaid category, auto category

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
