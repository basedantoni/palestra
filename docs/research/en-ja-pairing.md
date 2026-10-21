# Pairing an English variant ID with its Japanese Artwork (KOI-354)

Researched 2026-10-21 against punk-records `a936558` (2026-10-16) and Bandai's public card images.

## Question

The catalog import (`packages/api/src/lib/tcg/catalog-transform.ts`) treats one variant ID as one Artwork in both languages: it keys English and Japanese records by their own `id`. Bandai's two card lists number parallels independently, so after reprints the suffixes drift (OP05-119's PRB-01 print is JA `_p3` and EN `_p4`). What signal reliably pairs an English variant with the Japanese variant that has the same art? And how do we tell a genuine region-exclusive print from a shifted one?

## Short answer

Use **pack + image**, applied in layers:

1. **Pack groups.** Group each card's variants by pack in each language. Japanese pack `550SSS` pairs with English pack `569SSS`. Where the shared pack holds exactly one variant per language and is not a promo or Other Product pack, pair the two. No image is needed. On the sample this tier was 262/262 correct.
2. **Image inside the pack.** Where a shared pack holds several variants of the card, or the pack is Promotion card (`x901`) or Other Product Card (`x801`), pair by art distance between Bandai's card images. Use list order only to break ties between variants with identical art. Order alone is not enough: Bandai's two lists sometimes order parallels differently inside a pack.
3. **Image across packs.** Pair the leftovers by art distance whatever their pack. This catches EB-04, which English sells inside OP14-EB04 and OP15-EB04 and Japanese as its own EB-04, and promos that one language files under "Other Product" and the other under "Promotion card".
4. **Manual list.** These go to a short hand-curated override list:
   - variants whose nearest counterpart is in the gray zone of the art distance;
   - several identical-image promos competing for one counterpart.
5. **Everything else is a region-exclusive.** An unpaired variant with no counterpart image within the gray zone is a real English-only or Japanese-only print.

Results on the 136 shift-suspect cards: 606 of 608 English variants agree with the reference. 14 of the 136 cards still need a manual decision. The current rule (same ID) gets 362 of 608. On 60 random control cards both rules are near-perfect: 149/149 for the recommended rule, 145/149 for same ID.

The suspect set also undercounts the damage. 73 more cards have identical EN and JA ID sets but swapped suffixes (OP01-016's `_p1`/`_p2`, OP09-014). Across the catalog, the pack rule alone maps at least **338** English variants to a *different* Japanese ID than the current import does.

## Sources

| Source | URL | Used for |
|---|---|---|
| punk-records (static mirror of Bandai's card lists, the import's own input) | https://github.com/buhbbl/punk-records (`english/data/*.json`, `japanese/data/*.json`, `english/packs.json`) | Variant IDs, `pack_id`, list order (`_idx` = position in the pack file), rarity, image URL |
| Bandai English card images | `https://en.onepiece-cardgame.com/images/cardlist/card/<id>.png` | Art comparison (2,235 images fetched, ≤2 req/s, nothing stored in the repo) |
| Bandai Japanese card images | `https://www.onepiece-cardgame.com/images/cardlist/card/<id>.png` | Same |
| TCGCSV (TCGplayer mirror), category 68 | https://tcgcsv.com/tcgplayer/68/groups, `.../68/23496/products` (PRB-01) | Candidate (c) |
| CardTrader API v2 | `https://api.cardtrader.com/api/v2/expansions`, `/blueprints/export?expansion_id=` for PRB-01 (3847), OP-09 (3848), OP-11 (4138), OP-01 (3332) | Candidate (c), 5 calls at ≤1 req/s with the existing token |
| Limitless One Piece | https://onepiece.limitlesstcg.com/cards/OP05-119 and `/cards/jp/OP05-119`, `?v=0..7` | Candidate (d) |
| ADR 0006 | `packages/api/docs/adr/0006-tcg-data-sources.md` | Constraints: one variant ID is assumed to be one Artwork; Bandai images are never copied |

The suspect set was rebuilt from punk-records rather than prod. It gives the same counts as the prod query: 2,785 cards in both languages, 291 EN-only and 435 JA-only variant IDs, and 136 cards with both EN-only and JA-only IDs.

## Method

- **Rules under test**, per card:
  - **id-equal**: the current import.
  - **(a) pack-order**: pair the k-th variant of the card in EN pack `569SSS` with the k-th in JA pack `550SSS`, in Bandai's list order. Abstain when the two counts differ.
  - **pack+orphan**: (a), plus the card's single leftover set-pack group in each language, paired by order when the counts match.
  - **(b) image-only**: greedy 1:1 matching on art distance, with no pack information.
  - **layered**: (a), then image for the variants (a) abstains on.
  - **pack+image**: the recommended rule above.
- **Art distance.**
  - Take the illustration band of the card: rows 6–40% of the height, inset 4% each side. That stays above the "SAMPLE" watermark, which is solid in English and outlined in Japanese, and above the name and effect text.
  - Grayscale it at 64×64, split it into 16 blocks and z-normalise each block.
  - Distance = 1 − median of the per-block Pearson r.
  - The median shrugs off what differs locally: translated sound-effect lettering inside the art (ST01-014 "Guard Point"), event stamps, and the darker scans of English SP cards. A first version used a single 32×32 correlation over rows 6–48%. It let the watermark through and pushed true pairs (OP01-025) to 0.27.
  - Thresholds: same art below **0.20**, gray zone 0.20–0.60, different art above that. True pairs land at 0.00–0.15 (most below 0.03). Different illustrations land at 0.6–1.3.
- **Treatment distance.** A masked 16×24 colour thumbnail of the whole card, with the watermark band and text box blanked. It reflects frame, border and foil treatment. It is used only to corroborate the tie-breaks between identical-art twins.
- **Reference ("truth").**
  - Built by greedy 1:1 assignment on art distance + 0.05 when the packs differ + treatment distance, accepting art below 0.20.
  - When another variant in the same pack has identical art, the image cannot choose between them. Those pairs are scored "consistent, unverifiable".
  - The reference is image-based, so pack+image scores well partly by construction. The independent checks are:
    - 38 card images (19 EN–JA pairs) reviewed by eye: the OP05-119 and EB01-006 examples, every gray-zone pair below, and the order-swap cases (OP09-014, ST01-012);
    - the treatment distance agreeing with list order on 164 of 174 swappable twin decisions (9 ties, 1 marginal disagreement: OP03-110 PRB-02).
- **Samples.** Images were fetched for every variant in both languages of:
  - the 136 suspect cards;
  - the 73 "shifted non-suspect" cards (same ID sets, but the pack rule permutes them);
  - 60 random control cards with at least 2 variants (seed 354), to measure false positives;
  - 27 pack-misaligned cards: 15 EB-04, 10 from Japanese pack 550701, and the lone SPs.

Scratch scripts and images lived under `/tmp/koi354` and are not committed.

## Results

A row counts as correct when it pairs the variant with the reference partner, or leaves it unpaired where the reference does. Correct counts include "consistent, unverifiable" twin pairs.

- *Abstain*: the rule declined to decide.
- *Gray*: the rule paired two variants whose art distance is 0.20–0.60. On review these are the same illustration with a stamp or lettering difference.

| Rule | Suspect (136 cards, 608 EN variants) | Shifted non-suspect (73 / 310) | Control, false positives (60 / 149) | Pack-misaligned (27 / 38) |
|---|---|---|---|---|
| id-equal (current) | 362 (59.5%); 228 wrong, 18 gray | 157 (50.6%); 148 wrong, 5 gray | 145 (97.3%); 1 wrong, 3 gray | 37 (97.4%); 1 wrong |
| (a) pack-order | 555 (91.3%); 37 abstain, 12 wrong, 4 gray | 215 (69.4%); 82 abstain, 13 wrong | 146 (98.0%); 0 wrong, 3 gray | 19 (50%); 19 wrong (EB-04) |
| (a) + orphan groups | 554; 37 abstain, 13 wrong, 4 gray | 218; 82 abstain, 10 wrong | 146; 3 gray | 38 (100%) |
| (b) image-only | 478 (78.6%); 130 wrong | 267 (86.1%); 43 wrong | 136 (91.3%); 13 wrong | 38 (100%) |
| layered: (a), then image where (a) abstains | 591 (97.2%); 13 wrong, 4 gray | 299 (96.5%); 11 wrong | 146; 3 gray | 38 (100%) |
| **pack+image (recommended)** | **606 (99.7%)**; 2 twin contests | **292 (94.2%)**; 18 twin contests | **149 (100%)** | **38 (100%)** |

What the errors are:

- **id-equal** is wrong wherever a reprint product pushed the suffixes along, including on IDs that exist in both languages (see OP01-006 below).
- **Pack-order** fails in three ways:
  - Bandai's lists sometimes order a pack's parallels differently. In OP09-014 in PRB-02, English lists the full-art base art (`_p1`) before the new art (`_p2`); Japanese lists the new art (`_p2`) before the full-art (`_p3`). ST01-012's two OP-05 SPs and OP07-040 in PRB-02 do the same.
  - Promo packs whose single variants are different art (ST02-008: EN `_p1` vs JA `_p2`, distance 0.76).
  - EB-04, which sits in different packs per language.
- **Image-only** fails only on identical-art reprints in different packs: base in OP-01 vs `_r1` in PRB-01, which are the same scan. Pack information fixes all of them.
- **pack+image**'s remaining "wrongs" are all twin contests. English lists 2–6 promos with the *identical* image and Japanese has fewer: OP07-047 EN `_p2`/`_p3`/`_p4` vs JA `_p2`, P-078 EN base and `_p1`–`_p5`, OP07-109 EN `_p3`/`_p4`. Bandai shows the same scan for prints that differ only in a real-world stamp or distribution, so no data signal can choose. These belong on the manual list, not the error column.

### Outcome of the recommended rule per variant (EN | JA)

| Bucket | Suspect EN | Suspect JA | Shifted EN | Shifted JA | Control EN | Control JA | Misaligned EN | Misaligned JA |
|---|---|---|---|---|---|---|---|---|
| Paired, unique art | 398 | 398 | 173 | 173 | 131 | 131 | 34 | 34 |
| Paired, twin resolved by list order | 181 | 181 | 77 | 77 | 14 | 14 | 0 | 0 |
| Region-exclusive, different art | 17 | 25 | 25 | 24 | 1 | 11 | 4 | 2 |
| Region-exclusive print of shared art (pack the other language lacks for this card) | 0 | 17 | 1 | 11 | 0 | 2 | 0 | 8 |
| **Manual**: twin contest | 6 | 4 | 28 | 8 | 0 | 0 | 0 | 0 |
| **Manual**: gray zone | 6 | 4 | 6 | 2 | 3 | 4 | 0 | 0 |

Cards with any manual variant: **14 / 136** suspect, **20 / 73** shifted non-suspect, **2 / 60** control, **0 / 27** pack-misaligned.

Of the 110 variants (67 cards) that come anywhere near the gray zone or a twin contest, 73 sit in Promotion card or Other Product Card packs. That is where the manual list will concentrate.

### Candidate (c): marketplaces

- **TCGCSV / TCGplayer can't pair.**
  - It carries English only. Its 87 One Piece groups include no Japanese set, which matches ADR 0006.
  - `extendedData.Number` has no suffix (`OP01-006`). The print is only in the product name: "Otama (Alternate Art)", "(Full Art)", "(Jolly Roger Foil)", "(Reprint)".
  - At most it could label English variants, and only via the same pack-and-image matching.
  - Its PRB-01 product count for OP01-006 (4) matches Bandai's EN PRB-01 group.
- **CardTrader can't pair either.**
  - A blueprint is one print, with language as an editable property (`onepiece_language`: en, jp, …). So in principle a blueprint is a cross-language pairing.
  - But blueprints carry CardTrader's own letter suffixes (`OP05-119a`, `OP05-119m`, `OP01-006f`, `OP01-006j`), not Bandai IDs.
  - Its granularity doesn't match Bandai's. Per-card blueprint counts equal both Bandai counts for:
    - only 56 of 111 cards in PRB-01 (reprints are filed elsewhere or missing);
    - 118 of 129 in OP-09;
    - 125 of 128 in OP-11;
    - 121 of 121 in OP-01.
  - Mapping blueprints to Bandai IDs needs pack plus image again, so it adds no signal and a third numbering to reconcile.
  - The token came from the shell environment (`CT_TOKEN`), as in the KOI-349 probe scripts.

### Candidate (d): Limitless and Bandai metadata

- **Limitless can't settle it.** Its EN page (`/cards/OP05-119`) and JP page (`/cards/jp/OP05-119`) list the same eight prints, in the same order, under one shared numbering. Limitless's numbering is its own and matches *neither* of Bandai's for shifted cards:
  - Limitless `OP05-119_p3` ("Emperors in the New World, wanted") is Bandai JA `_p5` and EN `_p6`.
  - Limitless `_p4` ("One Piece Card The Best") is Bandai JA `_p3` and EN `_p4`.
  - This was checked by eye against the Limitless and Bandai images.

  So a Limitless row is a cross-language pairing, but only by print name and set. Turning it into Bandai IDs is the same pack-and-image problem.
- **Side finding: the artist backfill likely mis-keys shifted cards.** The backfill (`scripts/backfill-tcg-artists.ts`, `parseLimitlessCardPage`) takes the variant ID from the Limitless image filename and treats it as Bandai's. For OP05-119 it would write the artist of Limitless `_p3` (OP-09 wanted) onto Bandai `OP05-119_p3` (the PRB-01 art). Worth a follow-up ticket.
- **Bandai metadata gives pack only.** Bandai's lists give, per card, the product it was released in, which is what punk-records exposes as `pack_id`. Neither list links to the other language. Bandai's card-list pages were not fetched directly: punk-records mirrors them, and its `pack_id` and order were enough.
- **Bandai suffixes have gaps.** The English list for OP05-119 has no `_p3` or `_p5`. A suffix is a per-language counter, not a cross-language key.

## Worked examples

**OP05-119 (Luffy).** Pack groups line up one-to-one (1:1 or 2:2), so even pack-order gets this card right:

| EN | Pack | → JA | Art distance |
|---|---|---|---|
| base, `_p1`, `_p2` | OP-05 | base, `_p1`, `_p2` | ≤0.004 |
| `_p4` | PRB-01 | `_p3` | 0.000 |
| `_r1`, `_r2` | PRB-01 | `_r1`, `_r2` | 0.001 |
| `_p6` (wanted poster) | OP-09 | `_p5` | 0.007 |
| `_p7`, `_p8` | OP-11 | `_p6`, `_p7` | 0.054, 0.090 |
| — | — | JA `_p8` (Other Product Card) | nearest EN 0.979 → **Japanese-only** |

The current import merges EN `_p6` with JA `_p6`, which is the OP-09 wanted poster with an OP-11 art, and so on down the list.

**OP01-006 (Otama).** Even the IDs that "exist in both languages" are different art:

| EN | Pack | → JA | Pack | Art distance | Current import pairs EN with |
|---|---|---|---|---|---|
| base | OP-01 | base | OP-01 | 0.001 | base ✓ |
| `_p1` | Other Product | `_p4` | Other Product | 0.025 | JA `_p1` ✗ (a PRB-01 print) |
| `_p3` | PRB-01 | `_p1` | PRB-01 | 0.002 | JA `_p3` ✗ |
| `_p4` | PRB-01 | `_p2` | PRB-01 | 0.002 | JA `_p4` ✗ |
| `_p5` | PRB-01 | `_p3` | PRB-01 | 0.003 | nothing (EN-only) ✗ |
| `_r1` | PRB-01 | `_r1` | PRB-01 | 0.001 | `_r1` ✓ |

Every variant has a counterpart, so the card has no region-exclusive at all. The JA-only `_p2` and EN-only `_p5` are one Artwork.

**EB01-015.**

- EN `_p3` (ST-24) is JA `_r1` (ST-24): English calls the starter-deck reprint a parallel.
- In PRB-02, EN `_p5` and `_r1` are JA `_p2` and `_r2`.
- EN `_p1` and JA `_p1` (promo) pair at 0.011.
- EN `_p2` and `_p4` (promo) are different art from every Japanese print (≥0.80): **English-only**.

**EB01-006.**

- EN `_p3` (promo) is the illustration of JA `_p1` (EB-01) with a purple frame (0.078). But JA `_p1` is already EN `_p1` in the same pack (0.003), so EN `_p3` is an English-only treatment of a shared illustration.
- JA `_p4` and `_p5` (promos, white and red frames, one new art) have no English counterpart: **Japanese-only**.

**Gray zone, by eye.**

These are the same illustration with a stamp, lettering or scan difference:

- OP05-074_p3 SP (0.27, darker English scan);
- OP03-089_p1 (0.36, English Regionals stamp across the art);
- OP06-110 EN `_p1` / JA `_p3` (0.39, Regionals stamp);
- EB01-038 (0.44–0.50, a text-heavy event whose art is the Japanese/English lettering itself).

Whether a stamped Regionals promo and an unstamped Japanese promo are "one Artwork" is a product decision, not a data one. The rule sends them to the manual list.

## Telling region-exclusives from shifted prints

A variant is **shifted** when it has a same-art counterpart (distance below 0.20) in the other language under another suffix. A variant is **region-exclusive** when no counterpart is within the gray zone (0.60) after pairing. Two kinds show up:

- **Different art.** Most are English promos (EB01-015 `_p2`/`_p4`), Japanese promos (EB01-006 `_p4`/`_p5`) and Japanese Other Product prints (OP05-119 `_p8`).
- **Same art in a product the other language doesn't have.**
  - Japanese pack 550701 reprints the ST-01 to ST-05 starters as `_r1`.
  - Japanese EB-04 `_p` prints.

  They share an illustration with an already-paired variant but are their own variant and their own Printing. The rule keeps them unpaired because their counterpart is taken by the same-pack print.

Neither ID shape nor pack membership alone separates the two kinds. A one-sided pack group is as often EB-04 or promo filing as a true exclusive (pack-order got 19 of 38 pack-misaligned variants wrong). The image is the deciding signal.

## Recommended rule and its ceiling

1. **Tier 1, no images.** Pair 1:1 pack groups in every pack except Other Product Card (`x801`) and Promotion card (`x901`). Catalog-wide that is 2,367 groups. Sample accuracy: 262/262, including 2 gray pairs confirmed by eye. In promo packs, 1:1 groups were 69 of 72 same art: 2 were gray (stamps) and 1 was different art (ST02-008).
2. **Tier 2, image.** Covers every other group: several variants in a pack, uneven counts, a pack only one language has, or promo and Other Product packs. That is 1,144 of 2,785 cards, about 6,300 images, roughly an hour once at 2 req/s, then only each new set's cards.
   - Match same-pack first; break identical-art ties by list order, which the treatment distance corroborates in 164 of 174 cases.
   - Then match across packs.
   - To stay within ADR 0006 ("card images stay on Bandai's servers and are never copied"), compute the signature from a transient fetch and keep only the decided pairing, or at most the 16-block signature. Never keep the image.
3. **Tier 3, manual overrides.** A small checked-in list of `EN id → JA id | none`. It covers gray-zone pairs (stamped promos, text-as-art events) and twin contests (several identical-image promos on one side). Sample size: 14 of 136 suspect cards, 20 of 73 shifted non-suspect cards and 2 of 60 control cards. Mostly Promotion card and Other Product packs. A full run of tier 2 will produce the exact list.
4. **Unpaired after all tiers.** The variant is a region-exclusive Printing with its own Artwork.

**Ceiling.**

- Twin contests cannot be resolved from any data source examined. Bandai uses the same scan for prints that differ only by stamp or distribution, and no marketplace carries Bandai IDs.
- Pairs among same-pack identical-art twins (PRB reprints, "Jolly Roger Foil" vs reprint) rest on list order. The treatment distance only corroborates them, and its margin is small.
- The art distance can't see a stamp outside the illustration band or a foil-only difference. Those print the same in both languages, so they don't affect pairing.

## What was not done

- Bandai's own card-list HTML pages were not fetched; their pack metadata was taken from punk-records.
- CardTrader was probed only for PRB-01, OP-09, OP-11 and OP-01.
- Prod was not queried. punk-records reproduced its counts exactly.
- The image tier was run on 296 of 2,785 cards, not the whole catalog, so the catalog-wide manual-list size is an estimate.
