/** TCG labels and limits shared by the API and the web app. */

export const TCG_LANGUAGE_NAME = { ja: "Japanese", en: "English" } as const;

/** Best first: a Want's "at least LP" accepts NM and LP. Matches the `tcg_condition` enum order. */
export const TCG_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

/** Most Artworks `tcg.artworks` returns in one request. */
export const TCG_ARTWORKS_MAX_LIMIT = 5000;
