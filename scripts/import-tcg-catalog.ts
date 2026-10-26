/**
 * Import the One Piece TCG catalog (Japanese + English) from punk-records
 * (KOI-305, ADR 0006). Re-run after each set release: upserts are idempotent
 * and never touch artists or per-user data.
 *
 * English prints are paired with their Japanese Artwork by pack, then by art
 * distance on Bandai's images (KOI-332). Images are fetched transiently, at most
 * two requests a second per host, and only for prints neither the pack, an
 * override nor the last import's pairing settles. The report lists what to
 * review: gray-zone pairs and twin contests go into `pairing-overrides.ts`.
 *
 * Run: pnpm db:import:tcg [--repair]
 * --repair ignores the stored pairings and re-pairs every English print (about
 * 6,300 images, an hour). A catalog imported before KOI-332, with no English
 * print paired yet, is re-paired that way on its own.
 */
import { parseArgs } from "node:util";

import { type ArtSignature, artDistance, artSignature } from "../packages/api/src/lib/tcg/art-distance";
import { storedPairings, upsertCatalog } from "../packages/api/src/lib/tcg/catalog-db";
import { type PunkPacks, type PunkRecord, transformCatalog } from "../packages/api/src/lib/tcg/catalog-transform";
import { pairEnglish, type PairingReport } from "../packages/api/src/lib/tcg/pairing";
import { pairingOverrides } from "../packages/api/src/lib/tcg/pairing-overrides";
import { throttledFetch } from "../packages/api/src/lib/tcg/throttled-fetch";

const REPO = "buhbbl/punk-records";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

const getImage = throttledFetch(500, "palestra-tcg-import (personal use)");

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "palestra-tcg-import" } });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * Every pack file under `<lang>/data/`, in list order: files by name, records in
 * file order. The Japanese `packs.json` is empty, so list the folder.
 */
async function fetchLanguage(folder: "japanese" | "english"): Promise<PunkRecord[]> {
  const files = await getJson<Array<{ name: string }>>(`https://api.github.com/repos/${REPO}/contents/${folder}/data`);
  const records: PunkRecord[] = [];
  for (const { name } of files.filter((f) => f.name.endsWith(".json")).toSorted((a, b) => a.name.localeCompare(b.name))) {
    records.push(...(await getJson<PunkRecord[]>(`${RAW}/${folder}/data/${name}`)));
  }
  console.log(`${folder}: ${files.length} packs, ${records.length} records`);
  return records;
}

/**
 * Art signature per list ID, from each record's Bandai image. An image Bandai no
 * longer has (404) is skipped and listed: its print can't pair by art, so an
 * override settles it. Any other failure throws, before anything is written.
 */
async function signatures(ids: string[], records: PunkRecord[]): Promise<Map<string, ArtSignature>> {
  // Reversed so a record listed in two packs keeps its first listing's image, as its Printing does.
  const urls = new Map(records.toReversed().map((r) => [r.id, r.img_full_url]));
  const out = new Map<string, ArtSignature>();
  const failed: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const url = urls.get(id)!;
    // Bandai's CDN sends the odd 502: retry before one image costs a whole run.
    let res: Response | Error = new Error("not fetched");
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await getImage(url).catch((e: unknown) => e as Error);
      if (res instanceof Response && (res.ok || res.status === 404)) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
    if (res instanceof Response && res.ok) out.set(id, await artSignature(new Uint8Array(await res.arrayBuffer())));
    else if (res instanceof Response && res.status === 404) missing.push(id);
    else failed.push(`${url}: ${res instanceof Response ? res.status : res.message}`);
    if (out.size % 250 === 0 && out.size) console.log(`  ${out.size}/${ids.length} images`);
  }
  if (failed.length) throw new Error(`${failed.length} images failed, nothing imported:\n${failed.join("\n")}`);
  if (missing.length) console.log(`  No Bandai image (404), can't pair by art: ${missing.join(", ")}`);
  return out;
}

function printReport(report: PairingReport) {
  const t = report.tiers;
  console.log(
    `Paired: ${t.override} by override, ${t.pack} by pack, ${t.stored} as stored, ` +
      `${t.artInPack} by art in their pack, ${t.artAcrossPacks} by art across packs`,
  );
  if (report.grayZone.length) {
    console.log(`\nGray zone (${report.grayZone.length}), taken as best guesses. Check by eye, then add to pairing-overrides.ts:`);
    for (const g of report.grayZone) console.log(`  "${g.en}": "${g.ja}", // gray zone ${g.distance.toFixed(2)}`);
  }
  if (report.twinContests.length) {
    console.log(`\nTwin contests (${report.twinContests.length}), list order picked the winner. Review, then add to pairing-overrides.ts:`);
    for (const c of report.twinContests) {
      console.log(`  "${c.winner}": "${c.ja}", // twin contest: list order's pick`);
      for (const l of c.losers) console.log(`  "${l}": "english-only", // twin contest: identical scan to ${c.ja}, taken by ${c.winner}`);
    }
  }
  if (report.englishOnly.length) console.log(`\nEnglish-only (${report.englishOnly.length}): ${report.englishOnly.join(", ")}`);
}

async function main() {
  const { values } = parseArgs({ options: { repair: { type: "boolean", default: false } } });
  const [ja, en, packs] = await Promise.all([
    fetchLanguage("japanese"),
    fetchLanguage("english"),
    getJson<PunkPacks>(`${RAW}/english/packs.json`),
  ]);

  let stored = values.repair ? undefined : await storedPairings();
  // A catalog imported before KOI-332 stores each English print on its own ID: those pairings are the bug.
  if (stored && [...stored.pairs].every(([listId, variantId]) => variantId === listId)) {
    if (stored.pairs.size) console.log("No English print has been paired yet: re-pairing all, as --repair does");
    stored = undefined;
  }
  const input = { ja, en, overrides: pairingOverrides, stored };
  const { needsImages } = pairEnglish({ ...input, distance: () => undefined });
  console.log(`Fetching ${needsImages.en.length} English and ${needsImages.ja.length} Japanese images`);
  // The two languages' images come from different hosts, so they download side by side.
  const [enArt, jaArt] = await Promise.all([signatures(needsImages.en, en), signatures(needsImages.ja, ja)]);
  const { pairs, report } = pairEnglish({
    ...input,
    distance: (e, j) => {
      const a = enArt.get(e);
      const b = jaArt.get(j);
      return a && b ? artDistance(a, b) : undefined;
    },
  });
  printReport(report);

  const catalog = transformCatalog({ ja, en, packs, pairs });
  const { deleted, offerMismatches } = await upsertCatalog(catalog);
  console.log(
    `\nUpserted ${catalog.cards.length} cards, ${catalog.artworks.length} artworks, ${catalog.printings.length} printings`,
  );
  if (deleted.length) console.log(`Deleted ${deleted.length} Artworks left without Printings: ${deleted.join(", ")}`);
  if (offerMismatches.length) {
    console.log(`\nOffers whose Printing moved off their Want's Artwork (${offerMismatches.length}), fix by hand:`);
    for (const m of offerMismatches) {
      console.log(`  offer ${m.offerId}: Want ${m.wantVariantId}, English ${m.listId} now on ${m.printingVariantId}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
