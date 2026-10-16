# Which Marketplaces can feed English and Japanese Market Prices, and how far back?

Research for Market Watch (Linear: "Which Marketplaces can feed English and Japanese Market Prices, and how far back?", child of "Market Watch: long-history One Piece price tracking"). Checked 2026-10-16. Terms follow `packages/api/GLOSSARY.md` (TCG — market): **Marketplace**, **Market Price**, **Price History**, **Printing**, **Condition**.

## Answer in brief

- **English:** TCGplayer is the only deep English source, and the only ToS-clean way in today is the **TCGCSV** daily mirror of TCGplayer's API. It gives one condition-agnostic Market Price per product and sub-type (Normal/Foil) in USD. **History:** none can be downloaded today. TCGCSV's daily archive (back to **2024-02-08**) has returned 403 since about September 2026. The maintainer says archiving continues behind the scenes and he hopes to re-share it once TCGplayer clarifies. So we capture forward, and a backfill of about 2.7 years may appear later.
- **Japanese:** no free source is both ToS-clean and per-Condition. There are two credible paths:
  1. **PriceCharting** (Legendary, $49/mo). Covers English and Japanese One Piece. Its "ungraded" value is built from sales. USD. Price data is licensed for internal use. The API and CSV give **current values only**, so we capture forward.
  2. **CardTrader** (free API token). Per-listing Condition and language, EUR. The ToS consents to the API for inventory handling only. "Market APIs" come "upon request", so we must **write to CardTrader** before ingesting prices. There is no history endpoint, so we capture forward.
- **Cardmarket** publishes a public daily price guide file for One Piece. It blends all languages and Conditions, which makes it useless as a Japanese Market Price, and its terms for reuse are unverified. The API is closed to new applicants.
- **SNKRDUNK** (its terms forbid scraping), **Mercari** (no API, no aggregate price) and **Yuyu-tei / Card Rush** (single shops, so not Marketplaces) are out.
- **No permitted path gives more than a year of daily history today.** The only route to deeper history is the paused TCGCSV archive, which is English only and not per-Condition.

## Per-Marketplace table

| Marketplace | Access path (today) | ToS stance, personal use | EN / JA One Piece | What the number is | Per Condition? | Currency | History obtainable via permitted path | Product id → Bandai variant ID | Rate / volume |
|---|---|---|---|---|---|---|---|---|---|
| **TCGplayer** (official API) | REST API; **no new keys** [T1] | API use under API ToS; site scraping forbidden [T2] | EN whole catalog (87 groups) [T4]; **no JA** (no Japanese One Piece category; only "Pokemon Japan") [T4] | `marketPrice` (based on recent sales), `lowPrice`, `midPrice`, `directLowPrice` [C2] | Yes, per SKU (product × condition × language × printing) [T3] | USD | None: "TCGplayer does not offer historical price information" [C3] | `productId`; name carries tags such as `(Alternate Art)` and `(Manga)`; `extendedData.Number` = `OP05-069`; no `_pN` [T4] | No request cap per key [T1] |
| **TCGCSV** (mirror of TCGplayer API) | Public JSON/CSV, rebuilt daily ~20:00 UTC [C1] | Site invites scraping within its guidelines [C2][C3]; data is TCGplayer's, which TCGplayer's ToS calls its property [T2] | Same as TCGplayer: EN only (category 68) | Same price object as above; **no SKUs** [C1] | **No**: one price per product + `subTypeName` (Normal/Foil) [C2] | USD | Daily archive from **2024-02-08** advertised [C3] but **403 since ~Sept 2026** ("temporarily removed… Prices are still being archived behind-the-scenes") [C4][C5] | Same as TCGplayer | ≤10k req/day, ~100 ms between requests, custom User-Agent, poll once per 24 h [C2]. One Piece daily ≈ 87 groups × 2 files ≈ 175 req |
| **CardTrader** | REST API v2 with a profile token [K1] | API consented "as long as your purpose is handling your inventory"; **"market APIs upon request… write to us"**; no crawling/scraping without permission [K2] | EN + JA (language is a listing filter on the same blueprint) [K3]; game id 15 [K3] | Listings: "the cheapest 25 Products" per blueprint, each with price, condition and language [K1]. UI also shows "CT Market Price" = "balanced average of the first 15 listings" and "CT Min Price" [K3][K4] | Derivable: each listing has a condition (Near Mint … Poor) and language [K1] | EUR (`price.currency`) | **None** via API [K1]. UI chart covers about 5–6 weeks, rendered server-side (observed) [K3] | Blueprint has `tcg_player_id`, `card_market_ids`, `expansion_id`; collector number is a product property; `version` "almost always null" [K1] | 200 req / 10 s global; marketplace products 1 req/s [K1]. One request per expansion × language a day (a few hundred) |
| **Cardmarket** | API: "Currently, we are not accepting applications" [M1]. Public daily files: `downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json` + `productList/products_singles_18.json` (18 = One Piece) [M2] | API credentials can't be shared [M1]; reuse terms for the files **not verified** (cardmarket.com blocks automated clients with Cloudflare) | EN + JA traded, but the price guide **does not split by language** [M2][M3] | `avg`, `low`, `trend`, `avg1/7/30` (+ foil variants) [M2] | **No** (and no language) [M3] | EUR | Rolling `avg30` only; no archive | `idProduct`; name `Trafalgar Law (OP05-069)`; several products per number with **no variant field** (only product id order and `idExpansion`) [M2] | 2 files/day (~2.8 MB + catalog) |
| **PriceCharting** | Paid API + CSV, **Legendary only** ($49/mo) [P1][P2] | "Internal Business Purposes" with a Legendary sub; no use in third-party-accessible software; purge data when the sub ends [P1][P3] | EN + JA (~74 Japanese One Piece set pages of 140) [P4] | Sold-listing value from "eBay and our Marketplace" via a proprietary algorithm [P5]; ungraded, plus graded grades | **No** NM/LP/MP; ungraded vs graded (Grade 7…PSA 10) [P4] | USD | API/CSV: "Historic prices and historic sales are not supported" [P1]. UI chart has **monthly** points (example: Feb 2025 → Oct 2026) [P4] | Slug per variant, e.g. `trafalgar-law-alternate-art-op05-069`, `…-alternate-art-manga-op05-069`; no `_pN` [P4] | API 1 call/s; CSV regenerated every 24 h, at most one download per 10 min [P1] |
| **SNKRDUNK** | None (no API) | **Forbidden**: Art. 7(1)(13) bans crawling and scraping [S1] | JA (asking and sold prices) | — | — | JPY | — | — | — |
| **Mercari JP** | None (no API) [R1] | No express permission; users may use information obtained "only within the scope of using the Service" [R1] | JA | No aggregate price published (individual listings only), so it is not a Market Price source | — | JPY | — | — | — |
| **Yuyu-tei, Card Rush** | None | Yuyu-tei terms forbid reproduction (ADR 0006) | JA | Shop price | — | JPY | — | — | — |

Yuyu-tei and Card Rush are single shops. Under the glossary ("A single shop or seller is not a Marketplace") they are not Marketplaces, so they are listed only to close them out.

## Findings by question

### Access path and ToS

- **TCGplayer API**: "We are no longer granting new API access at this time." Existing users must follow the API terms. "There is no limit to the number of requests that can be made with a single key." [T1] The site ToS says: "You agree not to crawl, scrape or spider any of our websites without express permission from us". Pricing information and card databases are "the property of TCGplayer, Inc." [T2] This confirms what ADR 0006 found.
- **TCGCSV** caches TCGplayer API responses and re-serves them, about 24 h old. It asks clients to check `last-updated.txt`, pull once per 24 h, stay under 10k requests a day and send a custom User-Agent [C2]. Its FAQ answers "Can I scrape this website?" with "go ahead!" [C3]. The data itself still belongs to TCGplayer [T2], and TCGCSV publishes no licence. The maintainer paused the archive while he seeks "further clarification from TCGplayer" [C4]. Treat TCGCSV as tolerated rather than licensed: it is the best permitted EN path, but it carries platform risk.
- **CardTrader ToS**, section "Web Services, Applications & APIs": "As long as your purpose is handling your inventory on our personal site or other sale channels … we will consent to the usage of the API. … We can provide market APIs upon request, with site data, availability and pricing. You need to write to us, our staff will evaluate each case". Also: "You agree not to crawl, scrape or spider any of our websites without express permission from us." [K2] **Polling marketplace prices for tracking is not inventory handling, so permission must be requested first.**
- **Cardmarket**: "Currently, we are not accepting applications for access to the Cardmarket API." [M1] The daily price-guide and product-list JSON files sit on a public S3 bucket [M2]. TCGCSV's FAQ says "Cardmarket does offer Product and Price data exports on their website" [C3]. I could not read Cardmarket's own download page or ToS because Cloudflare blocks automated clients, so reuse terms are **unverified**.
- **PriceCharting**: "You must have a paid subscription to access the API" and "CSV download feature is only available to Legendary subscribers." [P1] Its ToS adds: "Price Data can be used for your Internal Business Purposes if you maintain a valid and current Legendary subscription" and "Price Data cannot be used in any software, application, or system that is accessible to third parties" [P3]. A single-user Palestra fits "internal". Data "must be purged after your subscription has ended" [P1].
- **SNKRDUNK** ToS Art. 7(1)(13) forbids "クローリング、スクレイピング又はこれらと類似する手段により本サービスにアクセスし、又は本サービスに関する情報を取得する行為" (accessing the service, or obtaining information about it, by crawling, scraping or similar means). It offers no API [S1].
- **Mercari JP** ToS has no API and no scraping clause in the text. Art. 7(3) limits information obtained through the service to use "within the scope of using the Service" [R1]. Its prohibited-acts guide does not mention scraping [R2]. Without express permission, and with no aggregate price to read, it is excluded.

### Coverage

- TCGplayer and TCGCSV: category 68 "One Piece Card Game", 87 groups from OP01/ST-01 through OP18 (pre-release, promo and release-event groups included). There are **no Japanese groups**. The only Japanese category on TCGplayer is 85 "Pokemon Japan" [T4].
- CardTrader: the One Piece page says "Yes, the marketplace supports various languages, and you can use filters to distinguish between different regional printings" [K3]. `GET /marketplace/products` takes `language` as a 2-letter code [K1].
- Cardmarket: 12,613 One Piece singles in the product list and 13,412 price-guide rows (file of 2026-10-16) [M2]. Languages are traded as article attributes, but the guide has one row per product [M2][M3].
- PriceCharting: 140 One Piece set pages, 74 of them "one-piece-japanese-…" [P4].

### What the number is

- **TCGplayer `marketPrice`**: "TCGplayer Market Price uses the value at which a card has recently been selling as a key data point" (quoted in [C2]). The per-SKU API gives it per Condition [T3]. TCGCSV gives one product-level price, which "will roughly center around Near Mint (NM) or Lightly Played (LP) listings, but not always" [C2].
- **CardTrader**: the API returns raw listings, so a Market Price must be **derived** (for example, the lowest NM listing per language). The UI's "CT Market Price" is "The balanced average of the first 15 listings on the marketplace" [K4]. It is not in the documented API.
- **Cardmarket**: `trend`, `avg`, `low`, `avg1`, `avg7`, `avg30`. No official definition was readable. Secondary sources say AVG values "don't take into account attributes like language and condition" [M3].
- **PriceCharting**: values come from sold listings combined by "a proprietary algorithm" into one value per item and condition [P5]. For cards, "condition" means ungraded or a grade.

### History depth

| Source | Via permitted path | Notes |
|---|---|---|
| TCGplayer API | 0 (current only) | "TCGplayer does not offer archived prices" [C3] |
| TCGCSV | 0 today; **2024-02-08 →** if the archive returns | `prices-YYYY-MM-DD.ppmd.7z` returns 403 for every date tried (2024-02-07/08, 2025-06-01, 2026-10-15). GitHub issue "Archived prices are now returning 403" was opened 2026-09-16 [C4][C5] |
| CardTrader | 0 | No history endpoint [K1]. UI chart is about 5–6 weeks (observed: 7 Sept–12 Oct) [K3] |
| Cardmarket | 0 (rolling `avg30`) | Each file is a snapshot (`createdAt`) [M2] |
| PriceCharting | 0 via API/CSV [P1] | UI "historic prices" are free [P2] but monthly and in the UI only, which is not a permitted ingestion path [P4] |

**Is TCGplayer's ~1-year free UI cap client-side only?** Not established. The product page loads `infinite-api.tcgplayer.com/price/history/{productId}/detailed?range=quarter` (observed in a REA capture of product 527662). I did not test other `range` values against that private endpoint, and the point is moot because the ToS forbids scraping it [T2]. It is noted for learning only.

### Product identity → Bandai variant ID

No Marketplace uses Bandai's `_pN` / `_rN` suffixes, so each needs a mapping table built by heuristic and reviewed by hand:

- **TCGplayer/TCGCSV**: `extendedData.Number` (`OP05-069`) plus name tags. For OP05-069 there are three products: `Trafalgar Law (069)`, `Trafalgar Law (Alternate Art) (069)` and `Trafalgar Law (069) (Alternate Art) (Manga)`. Reprints live in their reprint set's group (for example PRB-01) [T4].
- **CardTrader**: blueprint `tcg_player_id` and `card_market_ids` [K1] mean a TCGplayer mapping can be reused. Japanese uses the same blueprint with a language filter.
- **Cardmarket**: `Trafalgar Law (OP05-069)` appears three times in expansion 5481 and three times in 5426 with **no variant label** [M2]. Mapping would need the expansion list and image comparison. This is the weakest identity of all the sources.
- **PriceCharting**: one slug per variant per language set (`one-piece-japanese-awakening-of-the-new-era/trafalgar-law-alternate-art-manga-op05-069`) [P4].

### Rate and volume for ~10–20k Printings a day

All of the viable sources can serve the whole catalog daily within their limits: TCGCSV with about 175 requests, CardTrader with one request per expansion and language at 1/s (a few hundred), PriceCharting with one CSV, and Cardmarket with two files. None has to run on the Fly app VM.

## Recommendation

1. **EN v1: TCGCSV daily capture.** Store `marketPrice` (plus `lowPrice`) per `productId`×`subTypeName` in USD. Model Condition as unknown or "market" (TCGCSV is not per-Condition) rather than inventing NM. Watch TCGCSV issue #7. If the archive returns, it is a ~2.7-year backfill (2024-02-08 →).
2. **JA v1: pick one, as a cost-versus-permission decision:**
   - **PriceCharting Legendary** ($49/mo): cleanest ToS for personal internal use and covers EN and JA. Ungraded only, not per NM/LP, USD, capture forward. Data must be purged if the subscription lapses.
   - **CardTrader**: free and per-Condition and per-language, but first **email CardTrader for market-API consent** [K2]. Then derive a daily Market Price per Printing × Condition × language from `marketplace/products` (EUR), capturing forward.
3. **Don't** use Cardmarket's guide as a JA Market Price, because it blends languages. **Don't** scrape SNKRDUNK, Mercari, Yuyu-tei, Card Rush or TCGplayer's `infinite-api` history endpoint.
4. Supersede ADR 0006's price paragraph once a choice is made. Its claim "TCGplayer… carries no Japanese One Piece" still holds.

## Sources

- [T1] TCGplayer API, Getting Started: https://docs.tcgplayer.com/docs/getting-started ("We are no longer granting new API access at this time"; "There is no limit to the number of requests…")
- [T2] TCGplayer Terms of Service (Zendesk article 205004918, read via https://help.tcgplayer.com/api/v2/help_center/en-us/articles/205004918.json): "You agree not to crawl, scrape or spider any of our websites without express permission from us"; pricing information and card databases are TCGplayer property.
- [T3] TCGplayer API reference: SKU market prices (https://docs.tcgplayer.com/reference/pricing_getmarketpricebyproductconditionid-1) and SKUs by product (https://docs.tcgplayer.com/reference/catalog_getskusbyproductid): a SKU ("productConditionId") is product + language + printing + condition.
- [T4] TCGplayer catalog via TCGCSV: https://tcgcsv.com/tcgplayer/categories (68 "One Piece Card Game", 85 "Pokemon Japan"), https://tcgcsv.com/tcgplayer/68/groups (87 groups), https://tcgcsv.com/tcgplayer/68/23213/products and `/prices` (OP05). Fetched 2026-10-16.
- [C1] TCGCSV home: https://tcgcsv.com/ ("updates everyday around 20:00:00 UTC"; "does not share information about SKUs").
- [C2] TCGCSV docs: https://tcgcsv.com/docs (usage guidelines, price field definitions, USD).
- [C3] TCGCSV FAQ: https://tcgcsv.com/faq (archive "from February 8, 2024 and onwards"; "TCGplayer does not offer historcal price information"; Cardmarket exports; "Can I scrape this website?… go ahead!").
- [C4] TCGCSV archive 403 body and GitHub issue #7: https://github.com/CptSpaceToaster/tcgcsv/issues/7 ("The price archive has been temporarily removed due to rising server costs… Prices are still being archived behind-the-scenes. My goal is to share the price archive once I can get further clarification from TCGplayer").
- [C5] Direct probe 2026-10-16: `https://tcgcsv.com/archive/tcgplayer/prices-{2024-02-07,2024-02-08,2025-06-01,2026-10-15}.ppmd.7z` all returned HTTP 403.
- [K1] CardTrader API reference: https://www.cardtrader.com/docs/api/full/reference (token from profile settings; 200 req/10 s; marketplace products "the cheapest 25 Products"; `language` 2-letter code; Blueprint fields incl. `tcg_player_id`, `card_market_ids`; no history endpoint).
- [K2] CardTrader Terms of Service: https://static.cardtrader.com/en/pages/terms-of-service (API for inventory handling; "market APIs upon request… write to us"; no crawling/scraping without permission).
- [K3] CardTrader One Piece pages, REA browser capture 2026-10-16: https://www.cardtrader.com/en-EU/one-piece (language FAQ; `manasearch/15/…` = game 15) and https://www.cardtrader.com/en-EU/cards/406520-… ("CT Min Price", "CT Market Price", "US Market Price"; Highcharts axis 7 Sept–12 Oct; no separate history XHR). Learning only.
- [K4] CardTrader Autopricer: https://static.cardtrader.com/en/pages/autopricer ("CT Market Price: The balanced average of the first 15 listings on the marketplace"; "CT Lowest Price: The lowest price currently available").
- [M1] Cardmarket API help: https://help.cardmarket.com/en/cardmarket-api ("Currently, we are not accepting applications for access to the Cardmarket API").
- [M2] Cardmarket public files, fetched 2026-10-16: https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json (`createdAt` 2026-10-16, 13,412 rows; fields `avg, low, trend, avg1, avg7, avg30` and `-foil`) and https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json (12,613 products, `categoryName` "One Piece Single").
- [M3] Secondary: MTG PowerTools, https://mtg-powertools.outseta.com/support/kb/articles/j9b8Mwmn/how-to-price-your-cards-based-on-trend-average-price-price-guide (AVG values "don't take into account attributes like language and condition"). Not a primary source.
- [P1] PriceCharting API docs: https://www.pricecharting.com/api-documentation ("You must have a paid subscription"; "Historic prices and historic sales are not supported"; 1 call/s; CSV every 24 h; "licensed for internal use only"; purge after subscription ends).
- [P2] PriceCharting subscriptions: https://www.pricecharting.com/pricecharting-pro (Collector $6/mo; Legendary $49/mo with API and price CSV).
- [P3] PriceCharting ToS: https://www.pricecharting.com/page/terms-of-service ("Price Data Acceptable Use").
- [P4] PriceCharting pages fetched 2026-10-16: https://www.pricecharting.com/category/one-piece-cards (140 One Piece sets, 74 Japanese) and https://www.pricecharting.com/game/one-piece-japanese-awakening-of-the-new-era/trafalgar-law-alternate-art-op05-069 (`VGPC.chart_data`: 21 monthly points, 2025-02-01 → 2026-10-01).
- [P5] PriceCharting FAQ: https://www.pricecharting.com/faq ("We track … sold on eBay and our Marketplace"; proprietary algorithm).
- [S1] SNKRDUNK 利用規約: https://snkrdunk.com/terms (Art. 7(1)(13), no API).
- [R1] Mercari 利用規約: https://static.jp.mercari.com/tos (Art. 7(3), Art. 8 → guide; no API).
- [R2] Mercari prohibited acts guide: https://help.jp.mercari.com/guide/articles/258 (no clause on automated access).
- ADR 0006: `packages/api/docs/adr/0006-tcg-data-sources.md` (Oct 2026 findings, re-checked above).
