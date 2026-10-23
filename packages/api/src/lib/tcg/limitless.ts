/**
 * Artist backfill from Limitless One Piece card pages (KOI-306, ADR 0006).
 * Bandai doesn't credit illustrators; Limitless does, one print per page,
 * under its own numbering: prints are paired with Artworks by art (KOI-356).
 *
 * ponytail: regex over Limitless's server-rendered markup (no HTML parser
 * installed). Selectors are pinned by the saved fixtures; if Limitless changes
 * its templates the fixture tests won't notice, but the backfill will report
 * pages without a variant.
 */

/** What one Limitless card page says about the print it shows. */
export interface LimitlessVariant {
  /**
   * Limitless's variant ID, from the card image's filename (`OP05-069_p1`), or null when the page
   * shows no card. Limitless numbers prints its own way, shared by both languages and matching
   * neither Bandai list after a reprint (KOI-356): it is not an Artwork's variant ID.
   */
  limitlessId: string | null;
  /** The card image, to pair this print with an Artwork by art distance. */
  imageUrl: string | null;
  /** Credited illustrator, or null when the page credits nobody. Never guessed. */
  artist: string | null;
  /** Limitless's print label for this variant ("aa", "manga", "wanted"…), null when blank. */
  label: string | null;
  /** The card's other prints (`?v=1` → 1), to fetch from the base page's path. */
  versions: number[];
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
  // a stable mapping (OP01-120's v=4 is `_p4`, not `_r1`). Some Japanese promo pages leave the
  // language out of the filename (`P-111_p1_.webp`) and of their links (`/cards//P-111?v=1`, a 500),
  // so only `?v=N` is taken from a link.
  const image = /<img class="card[\s"][^>]*\bsrc="([^"]*\/([^/"]+?)_(?:EN|JP)?\.\w+)"/.exec(html);
  const artist = /<div class="[^"]*\bcard-text-artist\b[^"]*">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/.exec(html);
  const table = /<table class="card-prints-versions">([\s\S]*?)<\/table>/.exec(html)?.[1] ?? "";
  const current = /<tr\s+class="current"\s*>[\s\S]*?<span class="prints-table-card-number">([\s\S]*?)<\/span>/.exec(table);
  return {
    limitlessId: image?.[2] ?? null,
    imageUrl: image?.[1] ?? null,
    artist: artist ? text(artist[1]!) : null,
    label: current ? text(current[1]!) : null,
    versions: [...table.matchAll(/href="\/cards\/[^"]*\?v=(\d+)"/g)].map((m) => Number(m[1])),
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
 * An Artwork takes its credit from every Limitless print with the same art
 * (`sameArt`), never from a matching ID: Limitless's numbering drifts from
 * Bandai's after a reprint (KOI-356). Same art is the same illustrator, so a
 * reprint sharing a scan is credited too. A print that credits nobody is no
 * evidence against the others. When credits disagree the Artwork is flagged and
 * keeps its existing artist. Artworks no print matches are left out (unchanged).
 * Re-running with the same pages gives the same updates.
 */
export function reconcileArtists(
  artworks: Array<{ variantId: string; artist: string | null }>,
  pages: { ja: LimitlessVariant[]; en: LimitlessVariant[] },
  sameArt: (variantId: string, limitlessId: string) => boolean,
): ArtistUpdate[] {
  // English first, so its spelling of an agreed credit wins.
  const prints = [...pages.en, ...pages.ja];
  return artworks.flatMap(({ variantId, artist }): ArtistUpdate[] => {
    const matches = prints.filter((p) => p.limitlessId && sameArt(variantId, p.limitlessId));
    if (!matches.length) return [];
    const manga = matches.some((p) => p.label === "manga");
    const credits = matches.flatMap((p) => p.artist ?? []);
    if (credits.some((c) => !sameArtist(c, credits[0]!))) {
      return [{ variantId, artist, artistConflict: true, manga }];
    }
    return [{ variantId, artist: credits[0] ?? null, artistConflict: false, manga }];
  });
}
