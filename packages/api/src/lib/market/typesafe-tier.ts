/**
 * The matcher's TypeSafe tier (KOI-371): a Marketplace Product the rule and `tcgplayer_id` tiers
 * leave ambiguous goes to one TypeSafe Choice among its card's Artworks, plus "none". Text only,
 * no images. Pure apart from `typesafeChooser`, the HTTP adapter.
 */
import { z } from "zod";

import type { VariantKind } from "../tcg/catalog-transform";

/** The Choice's no-match option. */
export const NONE = "none";

/**
 * A choice is accepted at or above this confidence. Tuned with `pnpm market:tune-gate`
 * (scripts/tune-typesafe-gate.ts) on the 30 hand-checked cases in fixtures/typesafe-sample.json,
 * jev-1.14.0, 2026-10-28: the most confident wrong answer was 0.46, so the gate is 0.46 + a 0.15
 * margin, rounded up to 0.65. At it, 18 of the 21 matchable cases are accepted and none is wrong.
 */
export const TYPESAFE_GATE = 0.65;

/** Pinned: the gate was tuned on this model, so a new model is re-tuned before it is used. */
export const TYPESAFE_MODEL = "jev-1.14.0";

export type ChoiceProduct = {
  marketplace: "tcgplayer" | "cardtrader";
  name: string;
  /** As the Marketplace prints it, suffix included (`OP05-119a`). */
  number: string;
  set: string;
  rarity: string | null;
  /** TCGplayer: the name's parentheticals. CardTrader: the blueprint's `version`. */
  tags: string[];
};

export type ChoiceCandidate = {
  variantId: string;
  variantKind: VariantKind;
  /** The sets of its Printings in the Marketplace's language. */
  sets: string[];
  rarity: string | null;
  artist: string | null;
};

/** TypeSafe's answer: a candidate's variant ID or `NONE`, and its confidence (0–1). */
export type ArtworkChoice = { choice: string; confidence: number };

/** Asks TypeSafe which candidate Artwork a product is. Injected, so tests script the answers. */
export type ArtworkChooser = (product: ChoiceProduct, candidates: ChoiceCandidate[]) => Promise<ArtworkChoice>;

/** The card number without CardTrader's variant suffix: `OP05-119a` is `OP05-119`. */
export const baseNumber = (number: string) => number.replace(/(?<=\d)[a-z]+$/, "");

/**
 * The gate: a candidate chosen at or above `gate` is a match with its confidence; "none", a
 * choice below the gate, or an answer that is no candidate leaves the product unmatched.
 */
export function judgeChoice(
  { choice, confidence }: ArtworkChoice,
  candidates: ChoiceCandidate[],
  gate = TYPESAFE_GATE,
): { variantId: string; confidence: number } | { reason: string } {
  if (choice === NONE) return { reason: `TypeSafe tier: none of the ${candidates.length} candidate Artworks fits` };
  if (!candidates.some((c) => c.variantId === choice)) return { reason: `TypeSafe tier: answered ${choice}, not a candidate` };
  if (confidence < gate) {
    return { reason: `TypeSafe tier: ${choice} at confidence ${confidence.toFixed(2)}, below the ${gate} gate` };
  }
  return { variantId: choice, confidence };
}

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

const INSTRUCTIONS = {
  question:
    "Which One Piece Card Game Artwork is `product`, the listing of one card on a marketplace? Each option is one Artwork of the card it names.",
  evidence:
    "Compare the product's set, rarity, tags or version (Parallel, Alternate Art, Manga, SP, Reprint) and any letter after its collector number with each Artwork's kind, sets and rarity.",
  kinds: {
    base: "the card's original art, as first released",
    parallel: "an alternate art (parallel, SP, promo or other non-base art)",
    manga: "the manga-panel alternate art",
    reprint: "a later reprint of an existing art, in another set",
  },
  none: "Answer none when the product's details do not single out one Artwork, or fit none of them.",
};

/** The request body: the product as state, one Choice among the candidates and "none". */
function choiceRequest(product: ChoiceProduct, candidates: ChoiceCandidate[]) {
  const { tags, ...rest } = product;
  const state = {
    product: { ...rest, ...(product.marketplace === "cardtrader" ? { version: tags[0] ?? null } : { tags }) },
  };
  const criteria: Record<string, unknown> = {};
  for (const { variantId, variantKind, sets, rarity, artist } of candidates) {
    // Unknown rarity or artist is left out, not sent as null: every token is paid for.
    criteria[variantId] = { kind: variantKind, sets, ...(rarity && { rarity }), ...(artist && { artist }) };
  }
  criteria[NONE] = "No single Artwork above is clearly this product";
  return { model: TYPESAFE_MODEL, state, questions: { artwork: { type: "choice", instructions: INSTRUCTIONS, criteria } } };
}

const choiceResponse = z.object({ answers: z.object({ artwork: z.object({ choice: z.string(), confidence: z.number() }) }) });

/** The live chooser: one TypeSafe System One request per product. */
export function typesafeChooser(apiKey: string, fetch: typeof globalThis.fetch): ArtworkChooser {
  return async (product, candidates) => {
    const res = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(choiceRequest(product, candidates)),
    });
    if (!res.ok) throw new Error(`TypeSafe answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { choice, confidence } = choiceResponse.parse(await res.json()).answers.artwork;
    return { choice, confidence };
  };
}
