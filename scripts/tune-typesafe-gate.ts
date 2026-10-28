/**
 * Tune the matcher's TypeSafe gate (KOI-371) on the hand-checked sample: ask the live chooser
 * once per case and print each answer, then the lowest gate at which no accepted answer in the
 * sample is wrong, its recall, and the tokens and cost spent.
 *
 * Run: pnpm market:tune-gate   (needs TYPESAFE_API_KEY in apps/server/.env; ~30 requests)
 *
 * How the gate is set: an accepted wrong match puts the wrong Artwork's price on a card, and a
 * rejected right one only leaves a product on the unmatched list, so the gate sits 0.15 above the
 * most confident wrong answer in the sample (no wrong acceptance, with room for a sample this
 * small), rounded up to the next 0.05 and never below 0.5. Put it in TYPESAFE_GATE (lib/market/typesafe-tier.ts). Re-tune when TYPESAFE_MODEL,
 * the question or the sample changes; grow the sample from the unmatched list as real cases come.
 */
import "dotenv/config";

import sample from "../packages/api/src/lib/market/fixtures/typesafe-sample.json" with { type: "json" };
import {
  type ChoiceCandidate,
  type ChoiceProduct,
  NONE,
  baseNumber,
  typesafeChooser,
} from "../packages/api/src/lib/market/typesafe-tier";
import { catalog } from "../packages/api/src/lib/tcg/fixtures";

const PRICE_PER_TOKEN = 0.042 / 1_000_000; // Jev, input tokens only (docs.typesafe.ai/models)

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");

/** The candidates the tier would query: every Artwork of the card with a Printing in the language. */
function candidatesFor(product: ChoiceProduct): ChoiceCandidate[] {
  const language = product.marketplace === "tcgplayer" ? "en" : "ja";
  return catalog.artworks
    .filter((a) => a.cardNumber === baseNumber(product.number))
    .map((a) => ({
      variantId: a.variantId,
      variantKind: a.variantKind,
      sets: catalog.printings.filter((p) => p.variantId === a.variantId && p.language === language).map((p) => p.setName).toSorted(),
      rarity: a.rarity,
      artist: null,
    }))
    .filter((c) => c.sets.length > 0)
    .toSorted((a, b) => a.variantId.localeCompare(b.variantId));
}

let inputTokens = 0;
const countingFetch: typeof fetch = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.clone().json().catch(() => null);
  inputTokens += body?.usage?.input_tokens ?? 0;
  return res;
};
const chooser = typesafeChooser(apiKey, countingFetch);

const results = [];
for (const { product, expected, note } of sample.cases as Array<{ product: ChoiceProduct; expected: string | null; note: string }>) {
  const candidates = candidatesFor(product);
  if (expected && !candidates.some((c) => c.variantId === expected)) {
    throw new Error(`${product.name} (${product.set}): ${expected} is not a candidate`);
  }
  const { choice, confidence } = await chooser(product, candidates);
  results.push({ product: `${product.marketplace} ${product.name} [${product.set}]`, expected: expected ?? NONE, choice, confidence, note });
}
console.table(results.map((r) => ({ ...r, ok: r.choice === r.expected ? "yes" : "NO" })));

// The gate sits a margin above every wrong answer's confidence, rounded up to the next 0.05, at least 0.5.
const MARGIN = 0.15;
const worstWrong = Math.max(0, ...results.filter((r) => r.choice !== NONE && r.choice !== r.expected).map((r) => r.confidence));
const gate = Math.max(0.5, Math.ceil((worstWrong + MARGIN) * 20 - 1e-9) / 20);
const accepted = results.filter((r) => r.choice !== NONE && r.confidence >= gate);
const positives = results.filter((r) => r.expected !== NONE).length;

console.log(`gate ${gate}: ${accepted.length} accepted, all right; recall ${accepted.length}/${positives}`);
console.log(`${inputTokens} input tokens, ${Math.round(inputTokens / results.length)} a product, $${(inputTokens * PRICE_PER_TOKEN).toFixed(6)}`);
