/**
 * Pair each English print with its Japanese Artwork (KOI-332; ADR 0006, "English
 * pairs to Japanese by pack and image"). Bandai's English suffixes drift from the
 * Japanese ones after reprints, so an English list ID says nothing about which
 * Japanese variant it is. Per card, in order:
 *
 * 1. overrides (`pairing-overrides.ts`);
 * 2. a pack both languages list exactly one variant of the card in, except
 *    promos (`x901`) and Other Product (`x801`);
 * 3. the pairing stored by the last import, while its Japanese variant is free;
 * 4. art distance within a shared pack, list order breaking identical-art ties;
 * 5. art distance across packs, up to the gray zone;
 * 6. anything left is English-only.
 *
 * Pure: the caller fetches images. Run it once with no distances to learn
 * `needsImages`, then again with distances over those.
 */
import { GRAY_ART, SAME_ART, TWIN } from "./art-distance";
import type { PunkRecord } from "./catalog-transform";

/** A record in its language's list order. */
type ListRecord = Pick<PunkRecord, "id" | "pack_id">;

/** EN list ID → JA variant ID, or `"english-only"`. */
export type PairingOverrides = Record<string, string>;

export type PairingTier = "override" | "pack" | "stored" | "artInPack" | "artAcrossPacks";

export type PairingReport = {
  tiers: Record<PairingTier, number>;
  /** Paired by art at SAME_ART or above: likely a stamp or lettering difference. Review by eye. */
  grayZone: Array<{ en: string; ja: string; distance: number }>;
  /** Several English prints share one Japanese print's identical scan; list order picked the winner. */
  twinContests: Array<{ ja: string; winner: string; losers: string[] }>;
  /** Left unpaired, contest losers aside. */
  englishOnly: string[];
};

/** Promotion card and Other Product Card packs: a 1:1 group there can still be different art. */
const PROMO_PACKS = new Set(["801", "901"]);

/** Japanese pack `550105` is English `569105`: compare by suffix. */
const packOf = (r: ListRecord) => r.pack_id.slice(3);

/** Records per card number in list order; a record listed in two packs keeps its first. */
function byCard(records: ListRecord[]): Map<string, ListRecord[]> {
  const seen = new Set<string>();
  const cards = new Map<string, ListRecord[]>();
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const card = r.id.split("_")[0]!;
    cards.set(card, [...(cards.get(card) ?? []), r]);
  }
  return cards;
}

export function pairEnglish(input: {
  ja: ListRecord[];
  en: ListRecord[];
  overrides: PairingOverrides;
  /** The last import's pairings (null = English-only) and Japanese variants. Omit to re-pair everything. */
  stored?: { pairs: Map<string, string | null>; ja: Set<string> };
  /** Art distance; undefined while the images are not fetched. */
  distance: (enListId: string, jaVariantId: string) => number | undefined;
}): { pairs: Map<string, string | null>; report: PairingReport; needsImages: { en: string[]; ja: string[] } } {
  const jaCards = byCard(input.ja);
  const overridden = Object.entries(input.overrides).filter(([, ja]) => ja !== "english-only");
  for (const [en, ja] of overridden) {
    if (!jaCards.get(en.split("_")[0]!)?.some((r) => r.id === ja)) {
      throw new Error(`Pairing override ${en} → ${ja}: the card has no such Japanese variant`);
    }
  }
  const targets = overridden.map(([, ja]) => ja);
  const twice = targets.find((ja, i) => targets.indexOf(ja) !== i);
  if (twice) throw new Error(`Pairing overrides pair ${twice} twice`);

  const pairs = new Map<string, string | null>();
  const report: PairingReport = {
    tiers: { override: 0, pack: 0, stored: 0, artInPack: 0, artAcrossPacks: 0 },
    grayZone: [],
    twinContests: [],
    englishOnly: [],
  };
  const needs = { en: [] as string[], ja: [] as string[] };

  for (const [card, enRecords] of byCard(input.en)) {
    const jaRecords = jaCards.get(card) ?? [];
    const freeEn = new Set(enRecords.map((r) => r.id));
    const freeJa = new Set(jaRecords.map((r) => r.id));
    const pair = (en: string, ja: string | null, tier: PairingTier) => {
      pairs.set(en, ja);
      freeEn.delete(en);
      if (ja) freeJa.delete(ja);
      report.tiers[tier]++;
    };

    for (const r of enRecords) {
      const o = input.overrides[r.id];
      if (o) pair(r.id, o === "english-only" ? null : o, "override");
    }

    const jaGroups = Map.groupBy(
      jaRecords.filter((r) => freeJa.has(r.id)),
      packOf,
    );
    for (const [pack, group] of Map.groupBy(
      enRecords.filter((r) => freeEn.has(r.id)),
      packOf,
    )) {
      const jaGroup = jaGroups.get(pack);
      if (!PROMO_PACKS.has(pack) && group.length === 1 && jaGroup?.length === 1) pair(group[0]!.id, jaGroup[0]!.id, "pack");
    }

    if (input.stored) {
      const { stored } = input;
      // Deleting from a Set while iterating it is safe: the loop moves on.
      for (const en of freeEn) {
        const ja = stored.pairs.get(en);
        if (ja && freeJa.has(ja)) pair(en, ja, "stored");
      }
      // An English-only print stays so until a new Japanese variant could be its partner.
      if ([...freeJa].every((ja) => stored.ja.has(ja))) {
        for (const en of freeEn) if (stored.pairs.get(en) === null) pair(en, null, "stored");
      }
    }

    if (freeEn.size && freeJa.size) {
      needs.en.push(...freeEn);
      needs.ja.push(...freeJa);
    }

    const candidates = enRecords
      .filter((e) => freeEn.has(e.id))
      .flatMap((e) =>
        jaRecords
          .filter((j) => freeJa.has(j.id))
          .flatMap((j) => {
            const d = input.distance(e.id, j.id);
            return d === undefined ? [] : [{ en: e.id, ja: j.id, d, samePack: packOf(e) === packOf(j) }];
          }),
      );
    // Identical scans tie at 0. Candidates are built in list order, so the stable sort
    // pairs the k-th English twin with the k-th free Japanese one.
    const nearest = (c: (typeof candidates)[number]) => (c.d < TWIN ? 0 : c.d);
    const greedy = (cs: typeof candidates, tier: PairingTier) => {
      for (const c of cs) {
        if (!freeEn.has(c.en) || !freeJa.has(c.ja)) continue;
        pair(c.en, c.ja, tier);
        if (c.d >= SAME_ART) report.grayZone.push({ en: c.en, ja: c.ja, distance: c.d });
      }
    };
    greedy(
      candidates.filter((c) => c.samePack && c.d < SAME_ART).toSorted((a, b) => nearest(a) - nearest(b)),
      "artInPack",
    );
    greedy(
      candidates.filter((c) => c.d < GRAY_ART).toSorted((a, b) => nearest(a) - nearest(b)),
      "artAcrossPacks",
    );

    const winnerOf = new Map([...pairs].filter(([en]) => en.split("_")[0] === card).map(([en, ja]) => [ja, en]));
    for (const en of freeEn) {
      pairs.set(en, null);
      const twin = candidates.find((c) => c.en === en && c.d < TWIN && winnerOf.has(c.ja));
      if (!twin) {
        report.englishOnly.push(en);
        continue;
      }
      const contest = report.twinContests.find((t) => t.ja === twin.ja);
      if (contest) contest.losers.push(en);
      else report.twinContests.push({ ja: twin.ja, winner: winnerOf.get(twin.ja)!, losers: [en] });
    }
  }

  return { pairs, report, needsImages: needs };
}
