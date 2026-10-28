# Market Prices from TCGCSV and CardTrader, exchange rates from the ECB, captured forward

Market Watch records a daily Market Price for every One Piece Printing. English comes from **TCGplayer via TCGCSV**, TCGCSV's free daily mirror of TCGplayer's API. Its single `marketPrice` per product is stored as the **NM** Market Price in USD; TCGplayer gives no price for other Conditions. The assumption that this price mostly reflects NM sales is unverified. Japanese (`jp`), Simplified Chinese (`zh-CN`) and Korean (`kr`) come from **CardTrader**, which publishes listings, not an aggregate. Its Market Price is therefore the **lowest ask** per Printing per Condition that day, in EUR, stored with the number of listings it was drawn from, because most Chinese prices rest on a single listing. Korean is captured from day one even though almost nothing is listed yet: history exists only from the day capture starts. Exchange rates are the **ECB euro reference rates**, fetched directly (`eurofxref-daily.xml` each day, plus a one-time `eurofxref-hist.zip`), with the ECB cited as the source. USD values are crossed through EUR. Weekends and TARGET holidays have no rate, so a price converts at the latest rate on or before its date. Prices are stored in native currency and converted on read.

ADR 0006 turned TCGCSV down because it gives a market average rather than a seller's delivered price. That holds for Offers, which are still entered by hand. It does not hold for a Market Price, which is a market reference by definition.

**There is no backfill.** No permitted path holds more than a year of daily history. TCGCSV's archive of English prices from 2024-02-08 has returned 403 since about September 2026. CardTrader's 5–6-week site chart sits behind a private endpoint, which we do not use. If TCGCSV re-shares its archive, importing it is a bonus, not a dependency.

## The CardTrader capture is a known ToS exception

CardTrader's terms permit the self-serve API token for "handling your inventory". Market data is available "upon request", and pricing is their copyrighted content. A whole-catalog daily price capture with the self-serve token is **not ToS-compliant at any volume**. We do it anyway, as a user-accepted exception, without waiting for a reply to the market-API request emailed on 2026-10-17. The capture is bounded:

- one pass a day, at most 1 request per second;
- language-filtered calls for `jp`, `zh-CN` and `kr` only, about 300 a day (English never comes from CardTrader);
- read-only, personal use, no redistribution.

**Amended with KOI-369: which calls are language-filtered.** The language filter applies to the price calls, `marketplace/products?expansion_id=…&language=…`, one per One Piece expansion per language. The catalog calls carry no prices and have no language filter: `expansions` is called once a day, and `blueprints/export` once per expansion. They are made because only blueprints carry the collector number, rarity and `tcg_player_id` that matching needs. That comes to about 2 calls per expansion a day for `jp`, plus one more per expansion for each of `zh-CN` and `kr`. The user accepted this.

If CardTrader grants market-API access, the grant replaces the exception. If CardTrader declines or objects, the capture stops. Japanese then falls back to **PriceCharting Legendary**, which is $49/mo, priced from ungraded sold listings with no Condition split, licensed for internal use and purged if the subscription lapses. Chinese and Korean then have no prices, since no other permitted source exists. PriceCharting is not built until that happens. The accepted risk: CardTrader may revoke the token or act on the account.

Rejected: Cardmarket (API closed, and its public price guide blends languages and Conditions), SNKRDUNK, 集换社, Xianyu, Bunjang and KREAM (scraping forbidden or no aggregate price), eBay (sold history is a restricted Limited Release), Korean price aggregators (they repackage other sites with no licence), and Frankfurter (a third-party relay of the same ECB numbers).
