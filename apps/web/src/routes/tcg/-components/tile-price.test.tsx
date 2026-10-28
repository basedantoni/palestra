import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import type { RouterOutputs } from "@/utils/trpc";

import { TilePrice } from "./tile-price";

const price = (day: string, asOf: boolean): RouterOutputs["tcg"]["market"]["tilePrices"][number] => ({
  printingId: "00000000-0000-4000-8000-000000000001",
  variantId: "OP05-119_p1",
  language: "en",
  currency: "USD",
  price: 35.9,
  day,
  asOf,
});

describe("TilePrice", () => {
  it("shows the English Printing's NM Market Price in USD", () => {
    renderWithData(<TilePrice price={price("2026-10-27", false)} />);

    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getByText("$35.90")).toBeInTheDocument();
    expect(screen.queryByText(/as of/)).not.toBeInTheDocument();
  });

  it("dates a price older than 7 days", () => {
    renderWithData(<TilePrice price={price("2026-10-02", true)} />);

    expect(screen.getByText("$35.90")).toBeInTheDocument();
    expect(screen.getByText("as of Oct 2")).toBeInTheDocument();
  });

  it("shows a dash, never a number, when there is no Current Market Price", () => {
    renderWithData(<TilePrice price={undefined} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
