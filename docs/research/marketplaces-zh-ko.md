# Marketplaces for Simplified Chinese and Korean Market Prices

Research for [KOI-322](https://linear.app/koi-consultancy/issue/KOI-322) (map [KOI-320](https://linear.app/koi-consultancy/issue/KOI-320), Market Watch). Checked 2026-10-16.

Terms follow `packages/api/GLOSSARY.md` on `wayfinder/market-watch`. A **Marketplace** is a site where many sellers list Printings *and which reports its own prices*. A single shop is not one. A **Market Price** is that Marketplace's own aggregate price for one Printing in one Condition on one day.

## Answer

**CardTrader is the only Marketplace with a permitted, documented path for Simplified Chinese and Korean One Piece prices, and it has no history.** Its catalog accepts `zh-CN` and `kr` as One Piece listing languages, and its REST API returns live listings with Condition, language and price. The API has no price-history endpoint, so history builds forward from the day capture starts. There is no backfill.

Two caveats limit this:

1. **Permission is narrow.** CardTrader's terms consent to the self-serve API token for "handling your inventory". For market data, they say "We can provide market APIs upon request … You need to write to us." Using the self-serve token for daily price capture is not clearly covered. The fully permitted path is to email CardTrader and ask.
2. **Liquidity is unmeasured.** The catalog supports these languages, but how many Chinese and Korean listings exist was not measured: listings load through the API (a token is needed) or a CSRF-protected page endpoint. Expect thin, EU-centred supply (prices in EUR). Many Printings will have no listing on a given day.

**Every Chinese and Korean domestic Marketplace is ruled out.** 集换社 (Jihuanshe), 闲鱼 (Xianyu), 번개장터 (Bunjang), KREAM and SNKRDUNK all lack a public API, and their terms forbid scraping or bulk collection (Xianyu's clause is narrower; see its row). The two peer-to-peer apps (Xianyu, Bunjang) also fail the Marketplace definition, because they publish no aggregate price. **Cardmarket**'s public price-guide file has no language split, so it cannot give a Chinese or Korean price. **eBay**'s Browse API is permitted but shows only live listings with no eBay-reported price, and its sold-history API is a restricted Limited Release.

Short version: through a permitted path, Chinese and Korean prices come from **CardTrader only, from capture day forward**, preferably after CardTrader grants market-API access. If CardTrader declines, **no permitted source exists** for ZH/KO Market Prices.

## Per-Marketplace table

| Marketplace | Access path | ToS stance (personal use) | ZH / KO coverage | The number | Per Condition? | Currency | History depth | Product id → Bandai variant ID | Rate / volume limits |
|---|---|---|---|---|---|---|---|---|---|
| **CardTrader** | REST API v2, bearer token from profile settings [1]. `GET /marketplace/products?expansion_id=…&language=…` [1] | Self-serve API consented "as long as your purpose is handling your inventory". Market data is "upon request … write to us" [2]. Scraping forbidden without permission [2] | Yes: One Piece `onepiece_language` values `en, jp, zh-CN, kr, fr` [3]. Separate "Chinese Exclusives" expansion, 88 singles [4]. Listing depth unmeasured | Live asks: up to the 25 cheapest listings per blueprint [1]. Market Price = lowest ask per Condition (derived). The site also shows "CT Min Price / CT Market Price" and a roughly 6-week chart, with no documented API [5] | Yes: `condition` on each listing (Mint, Near Mint, Slightly Played, Moderately Played, Played, Poor) [3] | EUR (price `cents` + `currency`) [1] | **None from API**: no history or price-guide endpoint [1]. Capture-forward only | Blueprint = one Artwork across languages; language is a listing property [1][3]. Blueprints carry collector number and Cardmarket/TCGplayer ids, not Bandai's variant ID [1]. Map by collector number + version label | 200 req / 10 s overall; marketplace products 10 req/s (the doc also says 1 call/s) [1]. About 100 One Piece expansions [3] → about 200 calls/day for zh-CN + kr |
| **Cardmarket** | Public daily price-guide JSON per game (One Piece = game 18) [6]. API closed to new applications (ADR 0006) | Out of scope here; see KOI-321 | Catalog not split by language; only 2 of 12,613 One Piece singles mention Chinese (DON!! anniversary cards) [6] | `avg, low, trend, avg1/7/30` per product [6] | No | EUR | Today's file only | `idProduct` per Artwork, **no language**. **Cannot yield a ZH/KO price** | n/a |
| **eBay** | Browse API: search and retrieve items [7] | Buy APIs are "intended for certain approved eBay partners" [7] | Chinese and Korean singles listed by sellers (search results) | Live asks only. eBay reports no aggregate price, so it **fails the Marketplace definition** | Seller free text | Varies | Sold history needs Marketplace Insights, a "Limited Release" [7] | Free-text titles; no catalog id | Per eBay app limits |
| **集换社 Jihuanshe** (CN app / mini-program) | App only; no public API found | User agreement (effective 2026-08-27) forbids unauthorised "数据抓取" and using software for "批量信息的抓取、下载" [8] | Supports 海贼王 (One Piece) cards [9] | "集换价", generated from "海量真实订单" (real orders) [9] | Has a Condition definition (《品相定义》) [8]; whether the price is per Condition is unknown | CNY | Shows trends in-app; depth unknown | Unknown | n/a: **forbidden** |
| **闲鱼 Xianyu / Goofish** | Open platform is for merchants and service providers, not listing search (forum report; no official doc found) | Agreement (effective 2025-11-22) bars "爬虫等恶意软件" that obtain data without authorisation [10] | Many ZH listings (peer-to-peer) | Individual asks only. No aggregate price, so it **fails the Marketplace definition** | Seller free text | CNY | None | None | n/a |
| **번개장터 Bunjang** (KR) | No public API | Terms (effective 2026-08-05) forbid automated tools ("로봇, 스파이더, 스크립트, 스크래퍼, 크롤러") to collect, store or analyse data [11]. robots.txt blocks ClaudeBot/GPTBot [12] | Many KR listings (peer-to-peer) | Individual asks only. No aggregate price, so it **fails the Marketplace definition** | Seller free text | KRW | None | None | n/a: **forbidden** |
| **KREAM** (KR) | No public API | Bars commercial reuse of service information "without prior consent" and restricts "자동화된 수단" misuse [13]. No explicit personal-scraping clause | KR singles listed for Pokémon. One Piece singles observed only in Japanese (일어판) [14] | Last trade (체결) + bids/asks | Graded/raw split | KRW | In-app trade history | KREAM product id | n/a |
| **SNKRDUNK** (JP, some KR/CN promos) | No public API | Forbids "クローリング、スクレイピング" [15] | Japanese-first; some Chinese promo sets referenced by price sites | Last sold / asks | n/a | JPY | n/a | n/a | n/a: **forbidden** |

**Aggregators are not Marketplaces.** Card Pone (optcgkorea.com), Arvo TCG, TCG Hub and collectory.cc show Korean or Chinese prices. They repackage other sites' prices: Card Pone says "공개 시장 데이터", and TCG Hub says its data is SNKRDUNK-based [16]. None documents an API or a licence to reuse the data. tcgfast.com sells a One Piece price API, but documents only Japanese and English printings [17].

## Notes for the spec

- **Identity.** CardTrader's blueprint is per Artwork with language as a listing attribute, so a Chinese or Korean Printing is captured as *(blueprint, language = zh-CN/kr, Condition)*. That fits "one Market Price per Printing per Condition per Marketplace per day" if Printing ↔ (blueprint, language). Language-exclusive cards (Chinese anniversary sets) are their own blueprints under "Chinese Exclusives".
- **Numbering risk.** ADR 0006 already found that Bandai's JA and EN lists number some reprints differently (`_p3` vs `_p4`). The Chinese and Korean lists (onepiece-cardgame.cn, onepiece-cardgame.kr, both live) may have the same problem. Collector number + version label is a heuristic match, not an id join.
- **Unverified API detail.** The docs describe `language` as "a 2 letter country locale name like: en, it or fr" [1], but One Piece uses `zh-CN` and `kr`. If the filter rejects `zh-CN`, unfiltered calls return only the 25 cheapest listings across all languages, and EN/JP listings could crowd out Chinese ones. Check this with a token before building.
- **Validation step before committing to CardTrader (≈30 min):** get a token and pull `marketplace/products` with `language=kr` and `language=zh-CN` for 3–4 recent expansions. Count blueprints with ≥1 listing to measure real coverage. In parallel, email CardTrader for market-API permission.
- **Rollout order fits.** The map's EN → JA → ZH → KO order leaves time for the permission request, and capture-forward is accepted.

## Sources

1. CardTrader Full API reference (auth, rate limits, `/marketplace/products`, Blueprint fields): https://www.cardtrader.com/docs/api/full/reference
2. CardTrader Terms of Service, "Web Services, Applications & APIs" and the crawling clause: https://static.cardtrader.com/en/pages/terms-of-service
3. CardTrader One Piece singles page, embedded `productSearchFilters` (`onepiece_language` pools `["en","jp","zh-CN","kr","fr"]`, conditions) and expansion list: https://www.cardtrader.com/en/games/one-piece/categories/one-piece-single-card/blueprints
4. CardTrader "Chinese Exclusives" expansion (Singles: 88 items): https://www.cardtrader.com/en/games/one-piece/expansions/chinese-exclusives/blueprints_search
5. CardTrader card page, rendered (REA browser capture, learning only): "CT Min Price €0.11 · CT Market Price €0.11 · US Market Price —" with a chart from 7 Sept to 12 Oct: https://www.cardtrader.com/en/cards/283750-i-want-to-live-eb-01-memorial-collection
6. Cardmarket public downloads: price guide https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json and catalog https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json (fetched 2026-10-16; fields `idProduct, avg, low, trend, avg1, avg7, avg30`; no language field)
7. eBay, Get Started on a Buying Application (Browse API; Marketplace Insights "Limited Release"; Buy APIs for "approved eBay partners"): https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application
8. 集换社 用户服务协议 (版本生效日期 2026-08-27), linked from api.jihuanshe.com: https://mp.weixin.qq.com/s/QUnfBQazw_DzH9XUDsI7lA
9. 集换社 App Store listing (supports "海贼王卡牌"; 集换价 "基于海量真实订单生成"): https://apps.apple.com/cn/app/id1560760961
10. 闲鱼社区用户服务协议 (最新生效日期 2025-11-22), copy at: https://www.elawcn.com/agreement/2026/0402/1784.html
11. 번개장터 서비스 이용약관 (시행 2026-08-05): https://terms.bunjang.co.kr/terms/service.html
12. 번개장터 robots.txt: https://m.bunjang.co.kr/robots.txt
13. KREAM 이용약관 (시행일자 2026-10-16), arts. 12–13: https://kream.co.kr/agreement
14. KREAM product pages: https://kream.co.kr/products/873336 (One Piece OP-01 pack, 일어판) and https://kream.co.kr/products/907010 (Pokémon, 한글판)
15. SNKRDUNK 利用規約 (prohibited acts): https://snkrdunk.com/terms
16. Card Pone https://www.optcgkorea.com/ and its terms https://www.optcgkorea.com/terms; Arvo TCG https://www.arvotcg.com/; TCG Hub https://tcghub.kr/
17. tcgfast One Piece API page: https://tcgfast.com/ko/games/one-piece/
