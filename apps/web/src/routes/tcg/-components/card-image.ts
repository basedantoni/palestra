import { env } from "@life-tracker/env/web";

/** Bandai blocks cross-site image loads, so card images go through the server's relay. */
export const cardImage = (src: string) => `${env.VITE_SERVER_URL}/api/tcg/image?src=${encodeURIComponent(src)}`;

/** The image an Artwork shows as: its Japanese Printing's, else its first Printing's. */
export const artworkImage = (printings: ReadonlyArray<{ language: string; imageUrl: string }>) => {
  const printing = printings.find((p) => p.language === "ja") ?? printings[0];
  return printing && cardImage(printing.imageUrl);
};
