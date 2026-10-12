/**
 * Import the One Piece TCG catalog (Japanese + English) from punk-records
 * (KOI-305, ADR 0006). Re-run after each set release: upserts are idempotent
 * and never touch artists or per-user data.
 *
 * Run: pnpm db:import:tcg
 */
import { upsertCatalog } from "../packages/api/src/lib/tcg/catalog-db";
import { type PunkPacks, type PunkRecord, transformCatalog } from "../packages/api/src/lib/tcg/catalog-transform";

const REPO = "buhbbl/punk-records";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "palestra-tcg-import" } });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Every pack file under `<lang>/data/`. The Japanese `packs.json` is empty, so list the folder. */
async function fetchLanguage(folder: "japanese" | "english"): Promise<PunkRecord[]> {
  const files = await getJson<Array<{ name: string }>>(`https://api.github.com/repos/${REPO}/contents/${folder}/data`);
  const records: PunkRecord[] = [];
  for (const { name } of files.filter((f) => f.name.endsWith(".json")).toSorted((a, b) => a.name.localeCompare(b.name))) {
    records.push(...(await getJson<PunkRecord[]>(`${RAW}/${folder}/data/${name}`)));
  }
  console.log(`${folder}: ${files.length} packs, ${records.length} records`);
  return records;
}

async function main() {
  const [ja, en, packs] = await Promise.all([
    fetchLanguage("japanese"),
    fetchLanguage("english"),
    getJson<PunkPacks>(`${RAW}/english/packs.json`),
  ]);
  const catalog = transformCatalog({ ja, en, packs });
  await upsertCatalog(catalog);
  console.log(
    `Upserted ${catalog.cards.length} cards, ${catalog.artworks.length} artworks, ${catalog.printings.length} printings`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
