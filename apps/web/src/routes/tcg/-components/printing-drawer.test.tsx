import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { PriceHistory, PrintingDrawer } from "./printing-drawer";

type Drawer = RouterOutputs["tcg"]["market"]["printing"];

const printing = { printingId: "00000000-0000-4000-8000-000000000001", variantId: "OP05-119_p1", language: "ja" as const };
const only1M = { "1M": true, "3M": false, "1Y": false, All: false };
const none = (marketplace: "tcgplayer" | "cardtrader", condition: Drawer["grid"][number]["condition"]) => ({
  marketplace,
  condition,
  currency: marketplace === "tcgplayer" ? ("USD" as const) : ("EUR" as const),
  current: null,
});

const drawer: Drawer = {
  today: "2026-10-27",
  series: [
    {
      marketplace: "cardtrader",
      condition: "NM",
      currency: "EUR",
      segments: [
        [
          { day: "2026-10-08", price: 9, usd: 9.9 },
          { day: "2026-10-20", price: 10, usd: 12.5 },
        ],
      ],
    },
  ],
  ranges: {
    NM: only1M,
    LP: { "1M": true, "3M": true, "1Y": false, All: false },
    MP: only1M,
    HP: only1M,
    DMG: only1M,
  },
  grid: [
    { marketplace: "tcgplayer", condition: "NM", currency: "USD", current: { price: 35.9, usd: 35.9, day: "2026-10-27", asOf: false, listingCount: null } },
    none("tcgplayer", "LP"),
    none("tcgplayer", "MP"),
    none("tcgplayer", "HP"),
    none("tcgplayer", "DMG"),
    { marketplace: "cardtrader", condition: "NM", currency: "EUR", current: { price: 10, usd: 12.5, day: "2026-10-20", asOf: false, listingCount: 3 } },
    { marketplace: "cardtrader", condition: "LP", currency: "EUR", current: { price: 8, usd: 10, day: "2026-10-19", asOf: true, listingCount: 1 } },
    none("cardtrader", "MP"),
    none("cardtrader", "HP"),
    none("cardtrader", "DMG"),
  ],
  offers: [{ seenOn: "2026-10-20", price: 11 }],
  pricesPaid: [9],
};

const open = () =>
  renderWithData(<PrintingDrawer printing={printing} onClose={() => {}} />, (client) => {
    client.setQueryData(trpc.tcg.market.printing.queryKey({ printingId: printing.printingId, range: "1M" }), drawer);
  });

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
/** A grid cell, by its Marketplace row header and Condition column. */
const cell = (marketplace: string, condition: string) =>
  within(screen.getByRole("row", { name: new RegExp(`^${marketplace}`) })).getAllByRole("cell")[CONDITIONS.indexOf(condition)]!;

const range = (name: string) => within(screen.getByRole("tablist", { name: "Range" })).getByRole("tab", { name });

describe("PrintingDrawer", () => {
  it("titles the drawer with the Printing and draws its Price History", () => {
    open();

    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · JA" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Price History" })).toBeInTheDocument();
  });

  it("disables the range tabs the shown Marketplaces' history doesn't reach, per Condition", () => {
    open();

    expect(range("1M")).not.toHaveAttribute("aria-disabled", "true");
    for (const name of ["3M", "1Y", "All"]) expect(range(name)).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(within(screen.getByRole("tablist", { name: "Condition" })).getByRole("tab", { name: "LP" }));
    expect(range("3M")).not.toHaveAttribute("aria-disabled", "true");
    expect(range("1Y")).toHaveAttribute("aria-disabled", "true");
  });

  it("grids Current Market Prices in native currency plus USD, with Listing counts, 'as of' and '—'", () => {
    open();

    expect(within(cell("CardTrader", "NM")).getByText("€10.00")).toBeInTheDocument();
    expect(within(cell("CardTrader", "NM")).getByText("$12.50")).toBeInTheDocument();
    expect(within(cell("CardTrader", "NM")).getByText("3 listings")).toBeInTheDocument();
    expect(within(cell("CardTrader", "NM")).queryByText(/as of/)).not.toBeInTheDocument();

    expect(within(cell("CardTrader", "LP")).getByText("1 listing")).toBeInTheDocument();
    expect(within(cell("CardTrader", "LP")).getByText("as of Oct 19")).toBeInTheDocument();

    // A USD Marketplace's price is shown once, with no Listing count.
    expect(within(cell("TCGplayer", "NM")).getAllByText("$35.90")).toHaveLength(1);
    expect(within(cell("TCGplayer", "NM")).queryByText(/listing/)).not.toBeInTheDocument();

    expect(within(cell("CardTrader", "HP")).getByText("—")).toBeInTheDocument();
    expect(within(cell("TCGplayer", "LP")).getByText("—")).toBeInTheDocument();
  });

  it("cites the ECB for converted prices", () => {
    open();

    expect(screen.getByRole("link", { name: /European Central Bank/ })).toBeInTheDocument();
  });
});

describe("PriceHistory", () => {
  it("draws a Printing's Price History on its own, with the drawer's range rules and no grid", () => {
    renderWithData(<PriceHistory printingId={printing.printingId} />, (client) => {
      client.setQueryData(trpc.tcg.market.printing.queryKey({ printingId: printing.printingId, range: "1M" }), drawer);
    });

    expect(screen.getByRole("img", { name: "Price History" })).toBeInTheDocument();
    expect(range("1M")).not.toHaveAttribute("aria-disabled", "true");
    expect(range("3M")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
