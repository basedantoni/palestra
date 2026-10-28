/** TCG labels and limits shared by the API and the web app. */

export const TCG_LANGUAGE_NAME = { ja: "Japanese", en: "English", zh: "Simplified Chinese", ko: "Korean" } as const;

/** Best first: a Want's "at least LP" accepts NM and LP. Matches the `tcg_condition` enum order. */
export const TCG_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

/**
 * Most Artworks `tcg.artworks` returns in one request: browse's "Show all" for a Section, and sorted by
 * Art Rating the Unrated Section holds nearly the whole catalog (5,278 Artworks in 2026).
 */
// ponytail: 10k Artworks per request; page "Show all" if the catalog nears it.
export const TCG_ARTWORKS_MAX_LIMIT = 10_000;

/** The Section of Artworks the user hasn't given an Art Rating, when browse is sorted by rating. */
export const TCG_UNRATED_SECTION = "unrated";
