/**
 * Small saved samples of real punk-records data (KOI-305): OP05-119's base,
 * parallel, manga and reprint in both languages, plus a Japanese-only and an
 * English-only parallel, OP08-119 (an `&amp;` name), OP07-091_p1 (listed
 * in two English packs), and OP13-118_p3 (a secret-rare non-manga parallel).
 */
import { readFileSync } from "node:fs";

import type { PunkPacks, PunkRecord } from "../catalog-transform";

const load = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));

export const ja: PunkRecord[] = load("./punk-records-ja.json");
export const en: PunkRecord[] = load("./punk-records-en.json");
export const packs: PunkPacks = load("./punk-records-en-packs.json");
