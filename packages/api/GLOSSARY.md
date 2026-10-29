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
A category the user chose by hand for one transaction, including choosing Uncategorized. No Rule or Default Category replaces it until the user resets the transaction to automatic, except that applying a matching Rule fills one left Uncategorized. A flow change off expense clears it, since only expense carries a Category; the flag stays. Every Split's category is a Manual Category.
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
One illustration of a Card, identified by Bandai's Japanese variant ID (e.g. `OP05-069_p1`: base, parallel, manga, reprint) and credited to an artist when known. The same Artwork is released in each language. An English-only print is an Artwork too, identified by its English ID marked as English. A Korea-only promo or China-only card is not an Artwork here.
_Avoid_: Variant (as a noun), art, illustration

**Printing**:
An Artwork released in one language (English, Japanese, Simplified Chinese, or Korean), with its set. What a seller sells and what a Copy is of. Its language's card list may number it differently from its Artwork's variant ID: Bandai's English IDs drift from the Japanese ones after reprints.
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
The Copies the user holds laid out like a physical binder: one Copy per Pocket, in card-number order, nine Pockets to a sheet, one sheet at a time.
_Avoid_: Album, collection view, page (say sheet)

**Pocket**:
One slot on a Binder sheet, holding one Copy.
_Avoid_: Slot, cell

### TCG — buying

**Want**:
The user's intent to acquire one Copy of an Artwork in one or more accepted languages, bounded by a maximum delivered price and a minimum acceptable condition. It is open, ordered, fulfilled (a Copy arrived), or dropped.
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

### TCG — market

**Marketplace**:
A site where many sellers list Printings and which reports its own prices for them, such as TCGplayer or CardTrader. A single shop or seller is not a Marketplace.
_Avoid_: Source, feed, shop, store

**Market Price**:
One Marketplace's price for one Printing in one Condition on one day, in the currency the Marketplace reports: its own aggregate where it publishes one, otherwise its lowest Listing that day. Not a seller's price: an Offer can sit well above or below it.
_Avoid_: Price, market value, quote

**Current Market Price**:
The latest Market Price for a Printing in a Condition on a Marketplace on or before a given day, up to 30 days old. It shows its date once it is more than 7 days old. With none that recent, there is no Current Market Price, and none is carried forward or estimated.
_Avoid_: Latest price, today's price, last price

**Marketplace Product**:
A Marketplace's own identity for something it sells, such as a TCGplayer product or a CardTrader blueprint. It is of at most one Artwork; one Artwork can have several (a reprint, an errata or a promo stamp of the same art). One with no Artwork gets no Market Price.
_Avoid_: Blueprint, SKU, product

**Listing**:
One seller's ask for a Marketplace Product in one language and Condition. Graded, signed and altered Listings never count.
_Avoid_: Offer, ask, sale

**Price History**:
The daily Market Prices of one Printing from one Marketplace over time. Never blended across Marketplaces.
_Avoid_: Price chart, price trend, history

**Price Move**:
The change in one Printing's Market Price on one Marketplace over a window, as a percentage in the Marketplace's own currency, so exchange-rate swings never count as a move. A Printing with no Market Price near either end of the window has no Price Move.
_Avoid_: Mover, swing, trend

**Watched Artwork**:
An Artwork the user has an open Want for, holds a Copy of, has rated ★4 or ★5, or has tagged with a Theme. Derived from those facts, never hand-picked.
_Avoid_: Watchlist, favourite

**Copy Value**:
What one Copy is worth in USD on a day: the lowest Current Market Price for its Printing at its Condition or better (what replacing it would cost), converted at that day's exchange rate. A Copy with no such price is unpriced, never estimated from another language or from what was paid.
_Avoid_: Market value, worth

**Collection Value**:
The sum of Copy Values of the Copies the user holds today, over priced Copies only. Its history revalues today's Copies at each past day's prices, so buying a card is never counted as a change.
_Avoid_: Portfolio value, net worth, total

**Gain**:
A Copy Value minus the price paid for that Copy, and summed over Copies that have both. Unrealized: nothing was sold.
_Avoid_: Return, profit, P&L
