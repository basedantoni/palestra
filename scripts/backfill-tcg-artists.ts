/**
 * Backfill each Artwork's artist from Limitless One Piece card pages, Japanese
 * and English (KOI-306, ADR 0006). One request per second; re-runnable: every
 * run recomputes the same artist and conflict flag from the pages. Run the
 * catalog import first.
 *
 * Run: pnpm db:backfill:tcg-artists [--set OP-05]
 * Without --set it walks the whole catalog (~10k pages, a few hours).
 */
import { parseArgs } from "node:util";

import { applyArtistUpdates, artworksByCard } from "../packages/api/src/lib/tcg/catalog-db";
import { type LimitlessVariant, parseLimitlessCardPage, reconcileArtists } from "../packages/api/src/lib/tcg/limitless";

const BASE = "https://onepiece.limitlesstcg.com";
const DELAY_MS = 1000;

let last = 0;
/** GET a Limitless page at most once per DELAY_MS; null on 404. */
async function getPage(path: string): Promise<string | null> {
  await new Promise((r) => setTimeout(r, Math.max(0, last + DELAY_MS - Date.now())));
  last = Date.now();
  const res = await fetch(BASE + path, { headers: { "User-Agent": "palestra-tcg-artist-backfill (personal use)" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
  return res.text();
}

/** Every variant Limitless lists for a card in one language: the base page plus each print it links. */
async function variantsOf(basePath: string): Promise<LimitlessVariant[]> {
  const html = await getPage(basePath);
  if (!html) return [];
  const base = parseLimitlessCardPage(html);
  const pages = [base];
  for (const path of base.versions) {
    const page = await getPage(path);
    if (page) pages.push(parseLimitlessCardPage(page));
  }
  return pages;
}

async function main() {
  const { values } = parseArgs({ options: { set: { type: "string" } } });
  const cards = await artworksByCard(values.set);
  console.log(`${cards.size} cards${values.set ? ` in ${values.set}` : ""}`);

  let done = 0;
  let failed = 0;
  for (const [cardNumber, artworks] of cards) {
    try {
      // A card only fails as a whole, so one missing language never clears a flag or an artist.
      const en = await variantsOf(`/cards/${cardNumber}`);
      const ja = await variantsOf(`/cards/jp/${cardNumber}`);
      const updates = reconcileArtists(artworks, { ja, en });
      await applyArtistUpdates(updates);
      const flagged = updates.filter((u) => u.artistConflict).map((u) => u.variantId);
      console.log(
        `${cardNumber}: ${updates.length}/${artworks.length} artworks` + (flagged.length ? `, conflict: ${flagged.join(", ")}` : ""),
      );
    } catch (e) {
      failed++;
      console.error(`${cardNumber}: skipped (${e instanceof Error ? e.message : e})`);
    }
    done++;
  }
  console.log(`Done: ${done - failed} cards backfilled, ${failed} skipped`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
