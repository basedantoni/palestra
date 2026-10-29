import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { TCG_ARTWORKS_MAX_LIMIT } from "@life-tracker/shared";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { BinderSheet } from "./binder-sheet";
import type { CopyRow } from "./copy-value";

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];
type Drawer = RouterOutputs["tcg"]["market"]["printing"];

const LUFFY_JA = "00000000-0000-4000-8000-0000000000a1";
const LUFFY_EN = "00000000-0000-4000-8000-0000000000a2";
const ZORO_EN = "00000000-0000-4000-8000-0000000000b2";

const artwork = (variantId: string, nameEn: string, printings: ArtworkRow["printings"]): ArtworkRow => ({
  variantId,
  cardNumber: variantId.slice(0, 8),
  nameEn,
  nameJa: null,
  variantKind: "parallel",
  artist: null,
  artistConflict: false,
  owned: true,
  wanted: false,
  rating: null,
  printings,
  themes: [],
});
const owned = [
  artwork("OP05-119_p1", "Monkey.D.Luffy", [
    { id: LUFFY_JA, language: "ja", setName: "OP-05", imageUrl: "https://img.test/luffy-ja.png" },
    { id: LUFFY_EN, language: "en", setName: "OP-05", imageUrl: "https://img.test/luffy-en.png" },
  ]),
  artwork("OP06-001", "Roronoa Zoro", [{ id: ZORO_EN, language: "en", setName: "OP-06", imageUrl: "https://img.test/zoro-en.png" }]),
];

const copy = (id: string, extra: Partial<CopyRow>): CopyRow => ({
  id,
  printingId: LUFFY_EN,
  variantId: "OP05-119_p1",
  language: "en",
  setName: "OP-05",
  imageUrl: "https://img.test/luffy-en.png",
  nameEn: "Monkey.D.Luffy",
  nameJa: null,
  condition: "NM",
  pricePaid: null,
  acquiredOn: "2026-10-01",
  createdAt: "2026-10-01T12:00:00.000Z",
  belowMinimum: false,
  value: null,
  gain: null,
  sparkline: [],
  ...extra,
});
const enLp = copy("00000000-0000-4000-8000-0000000000c1", {
  condition: "LP",
  pricePaid: 20,
  value: { usd: 28, pricedAt: "LP", day: "2026-10-27", asOf: false },
  gain: 8,
});
const jaNm = copy("00000000-0000-4000-8000-0000000000c2", {
  printingId: LUFFY_JA,
  language: "ja",
  imageUrl: "https://img.test/luffy-ja.png",
  acquiredOn: "2026-10-05",
  belowMinimum: true,
  value: { usd: 50, pricedAt: "NM", day: "2026-10-19", asOf: true },
  gain: null,
});
const zoro = copy("00000000-0000-4000-8000-0000000000c3", {
  printingId: ZORO_EN,
  variantId: "OP06-001",
  setName: "OP-06",
  imageUrl: "https://img.test/zoro-en.png",
  nameEn: "Roronoa Zoro",
  acquiredOn: "2026-10-09",
});

const history: Drawer = {
  today: "2026-10-27",
  series: [],
  ranges: Object.fromEntries(
    ["NM", "LP", "MP", "HP", "DMG"].map((c) => [c, { "1M": true, "3M": false, "1Y": false, All: false }]),
  ) as Drawer["ranges"],
  grid: [],
  offers: [],
  pricesPaid: [],
};

// The list comes newest first, as `tcg.copies.list` returns it.
const seed = (client: QueryClient) => {
  client.setQueryData(trpc.tcg.copies.list.queryKey(), [zoro, jaNm, enLp]);
  client.setQueryData(trpc.tcg.artworks.queryKey({ owned: true, limit: TCG_ARTWORKS_MAX_LIMIT }), owned);
  for (const printingId of [LUFFY_JA, LUFFY_EN, ZORO_EN]) {
    client.setQueryData(trpc.tcg.market.printing.queryKey({ printingId, range: "1M" }), history);
  }
};
const show = () => renderWithData(<BinderSheet page={1} onFlip={() => {}} onArtist={() => {}} />, seed);

const sheet = () => screen.getByRole("group", { name: "Sheet" });
const pockets = () => within(sheet()).getAllByRole("button", { name: /^OP0/ });
const aside = () => screen.getByRole("complementary");
const condition = () => within(within(aside()).getByRole("tablist", { name: "Condition" })).getByRole("tab", { selected: true });

describe("BinderSheet", () => {
  it("lays out one Pocket per Copy in Pocket order, each showing its own Printing's image", () => {
    show();

    expect(pockets().map((p) => p.getAttribute("aria-label"))).toEqual([
      "OP05-119_p1 Monkey.D.Luffy",
      "OP05-119_p1 Monkey.D.Luffy",
      "OP06-001 Roronoa Zoro",
    ]);
    expect(pockets().map((p) => decodeURIComponent(p.querySelector("img")!.src))).toEqual([
      expect.stringContaining("https://img.test/luffy-en.png"),
      expect.stringContaining("https://img.test/luffy-ja.png"),
      expect.stringContaining("https://img.test/zoro-en.png"),
    ]);
  });

  it("gives each Pocket its own Copy's price sticker, dated once stale, — when unpriced", () => {
    show();

    expect(within(sheet()).getByText("$28.00")).toBeInTheDocument();
    expect(within(sheet()).getByText("$50.00")).toBeInTheDocument();
    expect(within(sheet()).getByText("as of Oct 19")).toBeInTheDocument();
    expect(within(sheet()).getByText("—")).toBeInTheDocument();
  });

  it("selects the first Pocket, naming its Copy and marking it in the Artwork's tile", () => {
    show();

    expect(pockets()[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(aside()).getByText("EN LP · acquired Oct 1 · paid $20.00")).toBeInTheDocument();
    expect(aside().querySelector('[aria-current="true"]')).toHaveTextContent("EN LP");
  });

  it("selecting a Pocket selects its Copy: no price paid, Below Want minimum", () => {
    show();
    fireEvent.click(pockets()[1]!);

    expect(pockets()[1]).toHaveAttribute("aria-pressed", "true");
    expect(within(aside()).getByText("JA NM · acquired Oct 5 · no price paid")).toBeInTheDocument();
    expect(within(aside()).getByText("Below Want minimum")).toBeInTheDocument();
    expect(aside().querySelector('[aria-current="true"]')).toHaveTextContent("JA NM");
  });

  it("opens the aside's Price History on the Condition the Copy was priced at, NM when unpriced", () => {
    show();
    expect(condition()).toHaveTextContent("LP");

    fireEvent.click(pockets()[2]!);
    expect(condition()).toHaveTextContent("NM");
  });

  it("opens the drawer for the sticker's own Copy's Printing", () => {
    show();
    fireEvent.click(within(sheet()).getByRole("button", { name: /\$50\.00/ }));

    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · JA" })).toBeInTheDocument();
  });
});
