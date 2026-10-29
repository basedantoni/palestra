import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { useArtworkCards } from "./artwork-card";
import { CollectionTile, CollectionValue, CopySticker, CopyValue, type CopyRow } from "./copy-value";
import type { TilePrices } from "./tile-price";

const JA = "00000000-0000-4000-8000-0000000000a1";
const EN = "00000000-0000-4000-8000-0000000000a2";

const copy = (extra: Partial<CopyRow> = {}): CopyRow => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  printingId: EN,
  variantId: "OP05-119_p1",
  language: "en",
  setName: "OP-05",
  imageUrl: "https://img.test/en.png",
  nameEn: "Monkey.D.Luffy",
  nameJa: null,
  condition: "LP",
  pricePaid: 20,
  acquiredOn: "2026-10-01",
  createdAt: "2026-10-01T12:00:00.000Z",
  belowMinimum: false,
  value: { usd: 32, pricedAt: "NM", day: "2026-10-27", asOf: false },
  gain: 12,
  sparkline: [
    [
      { day: "2026-10-26", price: 30 },
      { day: "2026-10-27", price: 32 },
    ],
  ],
  ...extra,
});

describe("CopyValue", () => {
  it("shows the value 'priced at NM' when it comes from a better Condition, its Gain and a sparkline", () => {
    renderWithData(<CopyValue copy={copy()} />);

    expect(screen.getByText("$32.00")).toBeInTheDocument();
    expect(screen.getByText("priced at NM")).toBeInTheDocument();
    expect(screen.getByText("+$12.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "30-day Copy Value" })).toBeInTheDocument();
    expect(screen.queryByText(/as of/)).not.toBeInTheDocument();
  });

  it("dates a stale price and shows no flag or Gain when priced at its own Condition with no price paid", () => {
    renderWithData(
      <CopyValue copy={copy({ condition: "NM", pricePaid: null, gain: null, value: { usd: 32, pricedAt: "NM", day: "2026-10-19", asOf: true } })} />,
    );

    expect(screen.getByText("as of Oct 19")).toBeInTheDocument();
    expect(screen.queryByText(/priced at/)).not.toBeInTheDocument();
    expect(screen.queryByTitle("Gain vs price paid")).not.toBeInTheDocument();
  });

  it("says Unpriced, never a number, with no value", () => {
    renderWithData(<CopyValue copy={copy({ value: null, gain: null, sparkline: [] })} />);

    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("opens the Printing drawer when the value is clicked", () => {
    renderWithData(<CopyValue copy={copy()} />);

    fireEvent.click(screen.getByRole("button", { name: /\$32\.00/ }));
    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · EN" })).toBeInTheDocument();
  });
});

describe("CopySticker", () => {
  it("prices the held Copy, dated once stale, with no Gain", () => {
    renderWithData(<CopySticker copy={copy({ value: { usd: 32, pricedAt: "NM", day: "2026-10-19", asOf: true } })} />);

    expect(screen.getByText("$32.00")).toBeInTheDocument();
    expect(screen.getByText("as of Oct 19")).toBeInTheDocument();
    expect(screen.queryByText("+$12.00")).not.toBeInTheDocument();
  });

  it("shows — for an unpriced Copy", () => {
    renderWithData(<CopySticker copy={copy({ value: null, gain: null })} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("opens the drawer for the Copy's Printing", () => {
    renderWithData(<CopySticker copy={copy()} />);

    fireEvent.click(screen.getByRole("button", { name: /\$32\.00/ }));
    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · EN" })).toBeInTheDocument();
  });
});

const seedCollection = (client: QueryClient) =>
  client.setQueryData(trpc.tcg.market.collectionHistory.queryKey({ range: "1M" }), {
    today: "2026-10-27",
    copies: 52,
    value: { day: "2026-10-27", usd: 1240, priced: 38 },
    gain: { usd: 312, percent: 18.2, copies: 30 },
    points: [
      { day: "2026-10-26", usd: 1200, priced: 38 },
      { day: "2026-10-27", usd: 1240, priced: 38 },
    ],
  });

describe("CollectionTile", () => {
  it("shows the Collection Value, its coverage and the total Gain vs paid", () => {
    renderWithData(<CollectionTile />, seedCollection);

    expect(screen.getByText("$1,240.00")).toBeInTheDocument();
    expect(screen.getByText("38 of 52 Copies priced")).toBeInTheDocument();
    expect(screen.getByText("+$312.00 (+18%)")).toBeInTheDocument();
  });
});

describe("CollectionValue", () => {
  it("shows the same value and coverage as My Copies, with no Gain", () => {
    renderWithData(<CollectionValue />, seedCollection);

    expect(screen.getByText("$1,240.00")).toBeInTheDocument();
    expect(screen.getByText("38 of 52 Copies priced")).toBeInTheDocument();
    expect(screen.queryByText(/vs paid/)).not.toBeInTheDocument();
  });
});

describe("owned Artwork tile", () => {
  const artwork: RouterOutputs["tcg"]["artworks"][number] = {
    variantId: "OP05-119_p1",
    cardNumber: "OP05-119",
    nameEn: "Monkey.D.Luffy",
    nameJa: null,
    variantKind: "parallel",
    artist: null,
    artistConflict: false,
    owned: true,
    wanted: false,
    rating: null,
    printings: [
      { id: JA, language: "ja", setName: "OP-05", imageUrl: "https://img.test/p.png" },
      { id: EN, language: "en", setName: "OP-05", imageUrl: "https://img.test/p.png" },
    ],
    themes: [],
  };
  const jaNm: TilePrices[number] = {
    printingId: JA,
    variantId: "OP05-119_p1",
    language: "ja",
    currency: "USD",
    price: 99,
    day: "2026-10-27",
    asOf: false,
    move7d: null,
    sparkline: [],
  };
  function Tile() {
    const { renderCard } = useArtworkCards(() => {});
    return <ul>{renderCard(artwork, [jaNm])}</ul>;
  }

  it("shows the held Copy's value, not the Japanese NM price", () => {
    renderWithData(<Tile />, (client) => {
      client.setQueryData(trpc.tcg.copies.list.queryKey(), [
        copy(),
        copy({ id: "00000000-0000-4000-8000-0000000000c2", variantId: "OP05-120", value: { usd: 7, pricedAt: "NM", day: "2026-10-27", asOf: false } }),
      ]);
    });

    expect(screen.getByText("EN LP")).toBeInTheDocument();
    expect(screen.getByText("$32.00")).toBeInTheDocument();
    expect(screen.queryByText("$99.00")).not.toBeInTheDocument();
    expect(screen.queryByText("$7.00")).not.toBeInTheDocument();
  });
});
