/**
 * punk-records catalog → Card, Artwork and Printing rows (ADR 0006).
 *
 * Pure: the import script fetches the Japanese and English catalogs, pairs the
 * English records (`pairing.ts`) and upserts what this returns. An Artwork is a
 * Japanese variant ID (e.g. `OP05-069_p1`), or `EN-<list ID>` for an English-only
 * print; each language it is printed in is a Printing, under that language's list ID.
 */

/** The fields we read from a punk-records card record (`<lang>/data/<pack>.json`). */
export type PunkRecord = {
  id: string;
  pack_id: string;
  name: string;
  rarity: string;
  img_full_url: string;
};

/** English `packs.json`: pack id → title parts. (The Japanese `packs.json` is empty.) */
export type PunkPacks = Record<string, { title_parts: { label?: string | null; title: string } }>;

export type Language = "ja" | "en";
export type VariantKind = "base" | "parallel" | "manga" | "reprint";

export type CardRow = { number: string; nameEn: string | null; nameJa: string | null };
export type ArtworkRow = { variantId: string; cardNumber: string; variantKind: VariantKind; rarity: string };
export type PrintingRow = {
  variantId: string;
  listId: string;
  language: Language;
  packId: string;
  setName: string;
  imageUrl: string;
};

export function transformCatalog(input: {
  ja: PunkRecord[];
  en: PunkRecord[];
  packs: PunkPacks;
  /** EN list ID → paired JA variant ID; null or missing = English-only. */
  pairs: Map<string, string | null>;
}) {
  const cards = new Map<string, CardRow>();
  const artworks = new Map<string, ArtworkRow>();
  const printings = new Map<string, PrintingRow>();

  for (const language of ["ja", "en"] as const) {
    const records = input[language];
    const basePack = new Map(records.filter((r) => !r.id.includes("_")).map((r) => [r.id, r.pack_id]));
    for (const r of records) {
      const cardNumber = r.id.split("_")[0]!;
      const card = cards.get(cardNumber) ?? { number: cardNumber, nameEn: null, nameJa: null };
      const name = r.name.replaceAll("&amp;", "&"); // the only entity punk-records leaves in names
      if (language === "ja") card.nameJa ??= name;
      else card.nameEn ??= name;
      cards.set(cardNumber, card);
      // Japanese comes first, so a paired English record finds its Artwork already made.
      const variantId = language === "ja" ? r.id : (input.pairs.get(r.id) ?? `EN-${r.id}`);
      if (!artworks.has(variantId)) {
        artworks.set(variantId, {
          variantId,
          cardNumber,
          variantKind: variantKind(r, basePack.get(cardNumber)),
          rarity: r.rarity,
        });
      }
      // A variant listed in two packs (e.g. a promo also in a product) is one Printing: first pack wins.
      const key = `${r.id}|${language}`;
      if (!printings.has(key)) {
        printings.set(key, {
          variantId,
          listId: r.id,
          language,
          packId: r.pack_id,
          setName: setName(input.packs, r.pack_id),
          imageUrl: r.img_full_url,
        });
      }
    }
  }

  return { cards: [...cards.values()], artworks: [...artworks.values()], printings: [...printings.values()] };
}

/**
 * Set code (`OP-05`), or the title for products without one ("Promotion card").
 * Japanese pack ids are `550xxx` and English `569xxx` with the same suffix, so
 * Japanese packs borrow the English names.
 * ponytail: suffix mapping holds for every current pack; Japanese-only packs fall back to their id.
 */
function setName(packs: PunkPacks, packId: string): string {
  const pack = packs[packId] ?? packs[`569${packId.slice(3)}`];
  return pack ? (pack.title_parts.label ?? pack.title_parts.title) : packId;
}

/**
 * Kind from the ID suffix: none = base, `_rN` = reprint, `_pN` = parallel.
 * punk-records has no manga label, so a manga is inferred: the secret rare's
 * `_p2`, printed in the same pack as its base card (OP01 Shanks, OP05 Luffy,
 * OP13's three brothers…; OP13's `_p3`/`_p4` are red and wanted-poster arts).
 * ponytail: heuristic, checked by eye. It misses manga-style alt arts on
 * other rarities (Limitless labels OP05-069_p2, an SR, "manga"); the artist
 * backfill (KOI-306) promotes those from Limitless's label, and the upsert
 * keeps a manga kind once set.
 */
function variantKind(r: PunkRecord, basePackId: string | undefined): VariantKind {
  const suffix = /_([pr])(\d+)$/.exec(r.id);
  if (!suffix) return "base";
  if (suffix[1] === "r") return "reprint";
  const isManga = r.rarity === "SecretRare" && suffix[2] === "2" && r.pack_id === basePackId;
  return isManga ? "manga" : "parallel";
}
