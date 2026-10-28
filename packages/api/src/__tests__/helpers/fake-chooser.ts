import type { ArtworkChoice, ArtworkChooser, ChoiceCandidate, ChoiceProduct } from "../../lib/market/typesafe-tier";

/**
 * A TypeSafe chooser answering from a script keyed by product name, noting each question it was
 * asked. A product with no scripted answer gets "none"; a scripted Error is thrown.
 */
export function fakeChooser(script: Record<string, ArtworkChoice | Error> = {}) {
  const asked: Array<{ product: ChoiceProduct; candidates: ChoiceCandidate[] }> = [];
  const chooser: ArtworkChooser = async (product, candidates) => {
    asked.push({ product, candidates });
    const answer = script[product.name] ?? { choice: "none", confidence: 1 };
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { chooser, asked };
}
