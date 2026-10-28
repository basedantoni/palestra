import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import { TilePrice, type TilePrices } from "./tile-price";

const price = (day: string, asOf: boolean, extra: Partial<TilePrices[number]> = {}): TilePrices[number] => ({
  printingId: "00000000-0000-4000-8000-000000000001",
  variantId: "OP05-119_p1",
  language: "en",
  currency: "USD",
  price: 35.9,
  day,
  asOf,
  move7d: null,
  sparkline: [],
  ...extra,
});

const twoWeeks = [
  [
    { day: "2026-10-13", price: 30 },
    { day: "2026-10-20", price: 32 },
  ],
  [{ day: "2026-10-28", price: 35.9 }],
];

describe("TilePrice", () => {
  it("shows the English Printing's NM Market Price in USD", () => {
    renderWithData(<TilePrice language="en" price={price("2026-10-27", false)} />);

    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getByText("$35.90")).toBeInTheDocument();
    expect(screen.queryByText(/as of/)).not.toBeInTheDocument();
  });

  it("shows the Japanese Printing's CardTrader price in USD, and a dash when it has none", () => {
    const { unmount } = renderWithData(<TilePrice language="ja" price={price("2026-10-27", false, { language: "ja", price: 50 })} />);

    expect(screen.getByText("JA")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByTitle(/CardTrader/)).toBeInTheDocument();
    unmount();

    renderWithData(<TilePrice language="ja" price={undefined} />);
    expect(screen.getByText("JA")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("dates a price older than 7 days", () => {
    renderWithData(<TilePrice language="en" price={price("2026-10-02", true)} />);

    expect(screen.getByText("$35.90")).toBeInTheDocument();
    expect(screen.getByText("as of Oct 2")).toBeInTheDocument();
  });

  it("shows a dash, never a number, when there is no Current Market Price", () => {
    renderWithData(<TilePrice language="en" price={undefined} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("shows the 7d Price Move with its sign and a sparkline", () => {
    const { unmount } = renderWithData(<TilePrice language="en" price={price("2026-10-27", false, { move7d: 12.34, sparkline: twoWeeks })} />);

    expect(screen.getByText("+12.3%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "30-day Market Price" })).toBeInTheDocument();
    unmount();

    renderWithData(<TilePrice language="en" price={price("2026-10-27", false, { move7d: -25 })} />);
    expect(screen.getByText("-25%")).toBeInTheDocument();
  });

  it("shows neither when the data doesn't support them", () => {
    renderWithData(<TilePrice language="en" price={price("2026-10-27", false, { sparkline: [[{ day: "2026-10-27", price: 35.9 }]] })} />);

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("opens the Printing drawer when the price is clicked", () => {
    renderWithData(<TilePrice language="en" price={price("2026-10-27", false)} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /\$35\.90/ }));
    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · EN" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the Japanese Printing's drawer from its price", () => {
    const ja = "00000000-0000-4000-8000-000000000002";
    renderWithData(<TilePrice language="ja" price={price("2026-10-27", false, { printingId: ja, language: "ja", price: 50 })} />);

    fireEvent.click(screen.getByRole("button", { name: /\$50\.00/ }));
    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · JA" })).toBeInTheDocument();
  });

  it("opens no drawer when there is no price", () => {
    renderWithData(<TilePrice language="ja" price={undefined} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
