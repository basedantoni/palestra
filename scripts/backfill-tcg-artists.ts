/**
 * Backfill each Artwork's artist from Limitless One Piece card pages, Japanese
 * and English (KOI-306, ADR 0006). Limitless numbers prints its own way, so each
 * print is paired with the catalog's Artworks by art distance between its image
 * and Bandai's, not by ID (KOI-356). Images are fetched transiently, never kept.
 * One request per second per host; re-runnable: every run recomputes the same
 * artist and conflict flag from the pages. Run the catalog import first.
 *
 * Run: pnpm db:backfill:tcg-artists [--set OP-05]
 * Without --set it walks the whole catalog (~10k pages plus their images, a few hours).
 */
import { parseArgs } from "node:util";

import { type ArtSignature, artDistance, artSignature, SAME_ART } from "../packages/api/src/lib/tcg/art-distance";
import { applyArtistUpdates, artworksByCard } from "../packages/api/src/lib/tcg/catalog-db";
import { type LimitlessVariant, parseLimitlessCardPage, reconcileArtists } from "../packages/api/src/lib/tcg/limitless";

const BASE = "https://onepiece.limitlesstcg.com";
const DELAY_MS = 1000;

const next = new Map<string, number>();
/** GET a URL at most once per DELAY_MS per host. */
async function get(url: string): Promise<Response> {
  const host = new URL(url).host;
  const at = Math.max(Date.now(), next.get(host) ?? 0);
  next.set(host, at + DELAY_MS);
  await new Promise((r) => setTimeout(r, at - Date.now()));
  return fetch(url, { headers: { "User-Agent": "palestra-tcg-artist-backfill (personal use)" } });
}

/** GET a Limitless page; null on 404. */
async function getPage(path: string): Promise<string | null> {
  const res = await get(BASE + path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
  return res.text();
}

/** Signature of each key's first image that loads (Limitless links some JP images its CDN refuses). */
async function signatures(images: Map<string, string[]>): Promise<Map<string, ArtSignature>> {
  const out = new Map<string, ArtSignature>();
  for (const [key, urls] of images) {
    const errors: string[] = [];
    for (const url of urls) {
      const res = await get(url);
      if (res.ok) {
        out.set(key, await artSignature(new Uint8Array(await res.arrayBuffer())));
        break;
      }
      errors.push(`GET ${url}: ${res.status} ${res.statusText}`);
    }
    if (!out.has(key)) throw new Error(errors.join("; "));
  }
  return out;
}

/** Every variant Limitless lists for a card in one language: the base page plus each print it links. */
async function variantsOf(basePath: string): Promise<LimitlessVariant[]> {
  const html = await getPage(basePath);
  if (!html) return [];
  const base = parseLimitlessCardPage(html);
  const pages = [base];
  for (const v of base.versions) {
    const page = await getPage(`${basePath}?v=${v}`);
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
      // A card only fails as a whole, so one missing language or image never clears a flag or an artist.
      // Bandai's images come from other hosts, so they download while Limitless's pages do.
      const [pages, artworkArt] = await Promise.all([
        (async () => ({ en: await variantsOf(`/cards/${cardNumber}`), ja: await variantsOf(`/cards/jp/${cardNumber}`) }))(),
        signatures(new Map(artworks.flatMap((a) => (a.imageUrl ? [[a.variantId, [a.imageUrl]] as const] : [])))),
      ]);
      // Both languages share Limitless's numbering, so one image per print: the Japanese one,
      // which is Bandai's Japanese scan, else the English one.
      const printImages = new Map<string, string[]>();
      for (const p of [...pages.ja, ...pages.en]) {
        if (p.limitlessId && p.imageUrl) printImages.set(p.limitlessId, [...(printImages.get(p.limitlessId) ?? []), p.imageUrl]);
      }
      const printArt = await signatures(printImages);
      const sameArt = (variantId: string, limitlessId: string) => {
        const a = artworkArt.get(variantId);
        const b = printArt.get(limitlessId);
        return !!a && !!b && artDistance(a, b) < SAME_ART;
      };
      const updates = reconcileArtists(artworks, pages, sameArt);
      await applyArtistUpdates(updates);
      const flagged = updates.filter((u) => u.artistConflict).map((u) => u.variantId);
      // A print with no same-art Artwork: a stamped promo in the gray zone, or a print the catalog lacks.
      const unmatched = [...printArt.keys()].filter((id) => !artworks.some((a) => sameArt(a.variantId, id)));
      // A page whose card image the parser can't read credits nobody: Limitless changed a template.
      const unread = [...pages.en, ...pages.ja].filter((p) => !p.limitlessId).length;
      console.log(
        `${cardNumber}: ${updates.length}/${artworks.length} artworks` +
          (flagged.length ? `, conflict: ${flagged.join(", ")}` : "") +
          (unmatched.length ? `, unmatched Limitless: ${unmatched.join(", ")}` : "") +
          (unread ? `, ${unread} Limitless pages without a card image` : ""),
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
