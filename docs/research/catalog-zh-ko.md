# Simplified Chinese and Korean One Piece catalogs: sources and variant IDs

Research for KOI-323 (map KOI-320, Market Watch). Checked 2026-10-16 against Bandai's regional card-list sites, the punk-records repository and its scraper (vegapull), and Limitless One Piece. Terms follow `packages/api/GLOSSARY.md` (Artwork = one illustration keyed by Bandai's variant ID; Printing = an Artwork in one language).

## Answer

- **Neither the Simplified Chinese nor the Korean list uses Bandai's variant IDs as Japanese and English do.** Simplified Chinese gives every Printing the bare card number (`OP05-119`) with no variant suffix. Korean uses `_P1`, `_P2`, … but numbers them in Korean release order, so the same suffix names a different Artwork than in Japanese or English.
- **punk-records covers neither language.** It does carry Traditional Chinese. That edition is a separate Bandai edition that uses Japanese variant IDs exactly.
- **Each language needs its own importer against the official site**, plus a mapping step from each regional row to a Japanese variant ID (set, base number, rarity, art type, order). Neither site credits artists, and Limitless has only English and Japanese pages, so artist credits must come through that mapping.

## Editions Bandai sells

Bandai's global page links one card-list site per region ([onepiece-cardgame.com/global](https://www.onepiece-cardgame.com/global/)):

| Edition | Official site | Operator | Set codes | Latest set (2026-10-16) |
|---|---|---|---|---|
| Japanese | www.onepiece-cardgame.com | Bandai | OP-xx | OP-17 |
| English | en.onepiece-cardgame.com | Bandai | OP-xx | OP-17 |
| Traditional Chinese (TW/HK/Asia) | asia-tc.onepiece-cardgame.com | Bandai Asia | OP-xx | OP-17 |
| Simplified Chinese (mainland) | www.onepiece-cardgame.cn | Windo Entertainment (data and images on `windoent.com`), ICP 16038212-6 | OPC-xx (OP-17 is listed as `【OP-17】`) | OP-17 |
| Korean | onepiece-cardgame.kr | Bandai Korea (footer links `BANDAIKOREATOY`) | OPK-xx, STK-xx, EBK-xx | OPK-14 |

- **There are two Chinese editions.** The old `asia-hk` and `asia-tw` hosts both now 302-redirect to `asia-tc` (`curl -I https://asia-tw.onepiece-cardgame.com/cardlist/`), so Traditional Chinese has a single card list.
- **Simplified Chinese releases with Japanese.** Its pack list ([`cardofferingtype/cachelist`](https://webadmin.windoent.com/front/op-public/cardType/cardofferingtype/cachelist)) shows OPC-14 created 2025-11-28, against a Japanese OP-14 release of 2025-11-22 ([JA OP-14 page](https://www.onepiece-cardgame.com/products/boosters/op14.php)). It already lists 169 OP-17 rows. It also has its own premium boosters, PRBC-01 and PRBC-02, and EBC-01 to EBC-04.
- **Korean runs about nine months behind Japanese.** OPK-14 (창해의 칠걸, the Korean OP-14) released 2026-08-21 ([products.do](https://www.onepiece-cardgame.kr/products.do)), while Japanese OP-14 released 2025-11-22. Korea has no PRB set: its card-list dropdown has OPK-01 to OPK-14, EBK-01 to EBK-04, STK-01 to STK-29 and promos ([cardlist.do](https://www.onepiece-cardgame.kr/cardlist.do)).

## Candidate sources

### punk-records (`buhbbl/punk-records`)

- **Languages:** english, english-asia, japanese, chinese-hongkong, chinese-taiwan, thai and french. No Simplified Chinese and no Korean ([README](https://github.com/buhbbl/punk-records/blob/main/README.md); `build_punk_records.py` loops over exactly those seven).
- **Licence:** AGPL-3.0 for the pipeline. The card data is marked © Oda/Shueisha/Toei/Bandai Namco. The repository is current: last pushed 2026-10-16, and `chinese-taiwan` already has pack `554117` (OP-17).
- **How it is built:** the data comes from [vegapull](https://github.com/Coko7/vegapull), which scrapes Bandai's card-list pages. vegapull has a `chinese-simplified` language code (`src/cli.rs`) but no `config/zh_cn.toml`, and its only Chinese hosts are `asia-hk` and `asia-tw` (`config/zh_hk.toml`, `config/zh_tw.toml`). It has no Korean support. The mainland site is a JavaScript single-page app on a different backend, so vegapull's HTML scraper could not read it anyway.
- **Traditional Chinese is available for free.** `chinese-taiwan/` has the same record shape we already import (`img_full_url`, `pack_id`, variant `id`).

### Simplified Chinese: onepiece-cardgame.cn (Windo backend)

- **Access path:** the page is a JavaScript single-page app (`/static/js/app.*.js`). It calls an unauthenticated JSON API at `https://webadmin.windoent.com/front/op-public`:
  - `cardList/cardlist/weblist?limit=&page=` returns `{id, cardNumber, cardOfferType, cardImg}`. `limit=5000` returned all 4,957 rows in one response.
  - `cardList/cardlist/webInfo/{id}` returns the full record: `cardName`, `cardType`, `cardRarity`, `cardColor`, `cardPower`, `cardTextDesc`, `cardCartograph` (art type, such as 漫画 for manga), `recordCardsAgain` (the reprint flag) and `subscript`.
  - `cardType/cardofferingtype/cachelist` returns the sets.
- **Terms:** no API documentation or published terms were found. The endpoint is documented nowhere, and I found it by reading the site's own JavaScript. Under KOI-320's standing rule ("never private endpoints found via REA"), using it in production needs an explicit decision. The alternative is rendering the page in a browser, which reads the same data.
- **IDs:** 4,539 of the 4,957 rows have no suffix. The other 418 use `_NN` (e.g. `P-084_01`, `EB04-007_02`), which is not Bandai's `_pN`. Only 3,310 card numbers are distinct, so several Artworks share one `cardNumber` and can be told apart only by the backend `id`.
- **Images:** hosted on `source.windoent.com` with `Access-Control-Allow-Origin: *`, so they can be shown on our pages without the relay. Filenames are a timestamp plus an ad hoc suffix (`OP05-119P.png`, `OP05-119SP.png`, `OP05-119_05.png`), not a variant ID.
- **Artist credits:** none. The detail record has no illustrator field.

### Korean: onepiece-cardgame.kr

- **Access path:** a server-rendered HTML card list. `GET /cardlist.do?page=N&size=20&series=all&freewords=` returns 20 cards per page across 160 pages (about 3,200 Printings). Each card is a `<button class="item">` with `cardNumber`, `cardName`, `cardGet` (set), `rarity`, `cardType`, `cardColor`, `power`, `cardText`, `blockNumber`, `animationType` (art type) and an image.
- **Terms:** `robots.txt` contains only Cloudflare's content-signal preamble, with no `Disallow` rules and no signals set. The page sets `<meta name="robots" content="index,nofollow">`. The footer links no terms of use. This is the same kind of public HTML card list that punk-records already scrapes for Japanese and English.
- **IDs:** a variant ID shape with an upper-case suffix (`OP14-001_P1`), but numbered in Korean release order (see below). The set code on the card (`OPK-14`) differs from the number prefix (`OP14-`).
- **Images:** `/fileDownload?downname=<timestamp_hash>`, served as `Content-Disposition: attachment` with no CORS or CORP headers. Image names are not keyed by variant ID.
- **Artist credits:** none. The `illustrations` filter is the art type (오리지널 = original, and so on), not the illustrator.

### Traditional Chinese: asia-tc.onepiece-cardgame.com (not in scope, noted)

- Same markup and IDs as the Japanese site. Images are at `/images/cardlist/card/<variantId>.png`.
- Images are served with `Cross-Origin-Resource-Policy: same-site`, so they would go through the existing `/api/tcg/image` relay.
- Already mirrored in punk-records.

## Do variant IDs line up? (concrete check: OP05-119)

The table lists each Printing's ID and set, taken from each official card list's search for `OP05-119`.

| Artwork (by set) | Japanese | English | Traditional Chinese | Korean | Simplified Chinese |
|---|---|---|---|---|---|
| OP-05 base | `OP05-119` | `OP05-119` | `OP05-119` | `OP05-119` | `OP05-119` (id 2598) |
| OP-05 parallel | `_p1` | `_p1` | `_p1` | `_P1` | `OP05-119` (id 2599, img `…P.png`) |
| OP-05 SP/manga | `_p2` | `_p2` | `_p2` | `_P2` | `OP05-119` (id 2600, img `…SP.png`) |
| PRB-01 | `_p3`, `_r1`, `_r2` | `_p4`, `_r1`, `_r2` | `_p3`, `_r1`, `_r2` | not released | `OP05-119` ×3 (PRBC-01, ids 3605–3607) |
| OP-09 | `_p5` | `_p6` | `_p5` | `_P4` | `OP05-119` (OPC-09, id 4049) |
| OP-11 | `_p6`, `_p7` | `_p7`, `_p8` | `_p6`, `_p7` | `_P5`, `_P6` | `OP05-119` ×2 (OPC-11, ids 4642–4643) |
| English 2nd Anniversary Set | `_p8` | absent | `_p8` | absent | — |
| Promotion Pack 2025 Vol.1 | absent | absent | absent | `_P3` | — |
| Limited-product reprint | — | — | — | — | `OP05-119` (限定商品收录卡牌, id 5492) |

Sources: [JA](https://www.onepiece-cardgame.com/cardlist/?freewords=OP05-119), [EN](https://en.onepiece-cardgame.com/cardlist/?freewords=OP05-119), [TC](https://asia-tc.onepiece-cardgame.com/cardlist/?freewords=OP05-119), [KR](https://www.onepiece-cardgame.kr/cardlist.do?freewords=OP05-119&series=all), [SC weblist](https://webadmin.windoent.com/front/op-public/cardList/cardlist/weblist?limit=5000&page=1) and [SC detail 3605](https://webadmin.windoent.com/front/op-public/cardList/cardlist/webInfo/3605). punk-records' `english` and `chinese-hongkong` indexes match the EN and TC columns.

**Findings:**

- **The English/Japanese mismatch is broader than PRB-01.** Every English suffix after PRB-01 is shifted by one: the OP-09 print is `_p6` in English and `_p5` in Japanese, and the OP-11 prints are `_p7`/`_p8` against `_p6`/`_p7`. English skips `_p3`, whose Japanese use is the PRB-01 print. The ADR amendment records only the PRB-01 case.
- **Traditional Chinese = Japanese**, ID for ID.
- **Korean diverges from all of them.** `_P3` is a Korea-only promo, and `_P4` is the OP-09 print, which Japanese numbers `_p5`. `OP05-069_P3` (Promotion Pack 2025 Vol.1) has no Japanese counterpart. Korean has no `_r` reprint IDs.
- **Simplified Chinese has no variant ID.** Its identity is the Windo row `id`, which is stable but local to Windo.

## Images, artists, Limitless

- **Images:** both sites expose a card image per Printing. Simplified Chinese images are CORS-open on `source.windoent.com`. Korean images are a download endpoint on the site's own domain. Neither is keyed by variant ID.
- **Artists:** neither official list credits illustrators. The Japanese and English lists do not either (ADR 0006).
- **Limitless:** card pages exist only under `/cards/jp/…` and `/cards/en/…`. `/cards/zh/`, `/cards/cn/`, `/cards/tw/`, `/cards/ko/` and `/cards/kr/` return HTTP 500. The print list on `/cards/jp/OP05-119` names only "Japanese", "English" and "English Version 2nd Anniversary Set". So Simplified Chinese and Korean Printings can be credited only by mapping them to a Japanese Artwork whose artist Limitless gives.

## Implications for Market Watch

- **Model:** a Printing in Simplified Chinese or Korean cannot be keyed by its own regional ID and joined to an Artwork by string equality. Keep the regional identifier (Windo `id`; Korean `cardNumber`) on the Printing and resolve it to an Artwork through a mapping keyed on (base card number, Japanese-equivalent set, rarity, art type, order within set).
- **The mapping needs a review queue.** Korea-only promos (Korean `_P3`) and China-only products (PRBC, 限定商品收录卡牌) may have no Japanese Artwork with the same art, and the mapping has to say so rather than guess.
- **Re-check English/Japanese merging.** The existing import already merges English and Japanese by variant ID. The `_p5`/`_p6` shift above means more English and Japanese Printings sit on the wrong Artwork than ADR 0006's amendment states. That deserves its own ticket.
- **Open question for the map:** whether the Windo JSON endpoint counts as a ToS-permitted path under KOI-320's standing rule, or whether the Simplified Chinese catalog must come from rendering the site.
