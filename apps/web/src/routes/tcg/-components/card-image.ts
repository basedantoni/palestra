import { env } from "@life-tracker/env/web";

/** Bandai blocks cross-site image loads, so card images go through the server's relay. */
export const cardImage = (src: string) => `${env.VITE_SERVER_URL}/api/tcg/image?src=${encodeURIComponent(src)}`;
