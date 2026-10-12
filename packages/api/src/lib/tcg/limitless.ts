/**
 * Artist backfill from Limitless One Piece card pages (KOI-306, ADR 0006).
 * Bandai doesn't credit illustrators; Limitless does, one variant per page.
 *
 * ponytail: regex over Limitless's server-rendered markup (no HTML parser
 * installed). Selectors are pinned by the saved fixtures; if Limitless changes
 * its templates the fixture tests won't notice, but the backfill will report
 * pages without a variant.
 */

/** What one Limitless card page says about the Artwork it shows. */
export interface LimitlessVariant {
  /** Bandai variant ID from the card image's filename (`OP05-069_p1`), or null when the page shows no card. */
  variantId: string | null;
  /** Credited illustrator, or null when the page credits nobody. Never guessed. */
  artist: string | null;
  /** Limitless's print label for this variant ("aa", "manga", "wanted"…), null when blank. */
  label: string | null;
  /** Links to the card's other prints (`/cards/OP05-069?v=1`), to fetch from the base page. */
  versions: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] !== "#"
        ? (ENTITIES[e.toLowerCase()] ?? m)
        : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))),
    )
    .replace(/\s+/g, " ")
    .trim() || null;

export function parseLimitlessCardPage(html: string): LimitlessVariant {
  // The card image is named after the variant (`.../OP05/OP05-069_p1_EN.webp`); `?v=N` is not
  // a stable mapping (OP01-120's v=4 is `_p4`, not `_r1`).
  const image = /<img class="card[\s"][^>]*\bsrc="[^"]*\/([^/"]+?)_(?:EN|JP)\.\w+"/.exec(html);
  const artist = /<div class="[^"]*\bcard-text-artist\b[^"]*">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/.exec(html);
  const table = /<table class="card-prints-versions">([\s\S]*?)<\/table>/.exec(html)?.[1] ?? "";
  const current = /<tr\s+class="current"\s*>[\s\S]*?<span class="prints-table-card-number">([\s\S]*?)<\/span>/.exec(table);
  return {
    variantId: image?.[1] ?? null,
    artist: artist ? text(artist[1]!) : null,
    label: current ? text(current[1]!) : null,
    versions: [...table.matchAll(/href="(\/cards\/[^"]*\?v=\d+)"/g)].map((m) => m[1]!),
  };
}

/** What the backfill writes to one Artwork. */
export interface ArtistUpdate {
  variantId: string;
  artist: string | null;
  artistConflict: boolean;
  /** Limitless labels the variant "manga" in either language. */
  manga: boolean;
}

const sameArtist = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "accent" }) === 0;

/**
 * Artist per Artwork from the Japanese and English Limitless pages of one Card.
 * A language that credits nobody is no evidence against the other. When both
 * credit different artists the Artwork is flagged and keeps its existing artist.
 * Artworks neither language lists are left out (unchanged). Re-running with the
 * same pages gives the same updates.
 */
export function reconcileArtists(
  artworks: Array<{ variantId: string; artist: string | null }>,
  pages: { ja: LimitlessVariant[]; en: LimitlessVariant[] },
): ArtistUpdate[] {
  const byId = (list: LimitlessVariant[]) => new Map(list.map((v) => [v.variantId, v]));
  const ja = byId(pages.ja);
  const en = byId(pages.en);
  return artworks.flatMap(({ variantId, artist }): ArtistUpdate[] => {
    const j = ja.get(variantId);
    const e = en.get(variantId);
    if (!j && !e) return [];
    const manga = j?.label === "manga" || e?.label === "manga";
    if (j?.artist && e?.artist && !sameArtist(j.artist, e.artist)) {
      return [{ variantId, artist, artistConflict: true, manga }];
    }
    return [{ variantId, artist: e?.artist ?? j?.artist ?? null, artistConflict: false, manga }];
  });
}
