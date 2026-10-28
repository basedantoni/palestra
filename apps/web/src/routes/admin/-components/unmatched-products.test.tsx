import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithData } from "@/test/render";
import type { RouterOutputs } from "@/utils/trpc";

import { UnmatchedProducts } from "./unmatched-products";

const products: RouterOutputs["admin"]["market"]["unmatchedProducts"] = [
  {
    id: 7,
    marketplace: "tcgplayer",
    externalId: "454665",
    name: "Shanks (Parallel)",
    number: "OP01-120",
    set: "OP01",
    reason: "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2",
  },
];

describe("UnmatchedProducts", () => {
  it("lists each product's Marketplace, external id, name, number, set and reason", () => {
    renderWithData(<UnmatchedProducts products={products} onMatch={vi.fn()} />);

    const row = within(screen.getByRole("row", { name: /Shanks \(Parallel\)/ }));
    for (const text of ["TCGplayer", "454665", "OP01-120", "OP01", "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2"]) {
      expect(row.getByText(text)).toBeInTheDocument();
    }
  });

  it("matches a product to the Artwork typed by variant ID", () => {
    const onMatch = vi.fn();
    renderWithData(<UnmatchedProducts products={products} onMatch={onMatch} />);

    fireEvent.change(screen.getByLabelText("Variant ID for 454665"), { target: { value: " OP01-120_p1 " } });
    fireEvent.click(screen.getByRole("button", { name: "Match" }));

    expect(onMatch).toHaveBeenCalledWith(7, "OP01-120_p1");
  });

  it("marks a product 'not an Artwork'", () => {
    const onMatch = vi.fn();
    renderWithData(<UnmatchedProducts products={products} onMatch={onMatch} />);

    fireEvent.click(screen.getByRole("button", { name: "Not an Artwork" }));

    expect(onMatch).toHaveBeenCalledWith(7, null);
  });

  it("says when every product is matched", () => {
    renderWithData(<UnmatchedProducts products={[]} onMatch={vi.fn()} />);

    expect(screen.getByText("Every Marketplace Product is matched.")).toBeInTheDocument();
  });
});
