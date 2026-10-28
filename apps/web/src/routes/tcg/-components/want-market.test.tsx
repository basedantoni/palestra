import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import type { RouterOutputs } from "@/utils/trpc";

import { OfferVsMarket, WantImage, WantMarket } from "./want-market";

type Want = RouterOutputs["tcg"]["wants"]["list"][number];

const EN = "00000000-0000-4000-8000-000000000001";
const JA = "00000000-0000-4000-8000-000000000002";

describe("WantMarket", () => {
  it("shows each accepted language's NM price and 30-day range, '—' where unpriced", () => {
    renderWithData(
      <WantMarket
        market={[
          { language: "en", printingId: EN, current: { price: 25, day: "2026-10-26", asOf: false, low: 20, high: 30 } },
          { language: "ja", printingId: JA, current: null },
        ]}
      />,
    );

    const en = within(screen.getByText("EN").parentElement!);
    expect(en.getByText("$25.00")).toBeInTheDocument();
    expect(en.getByText("30d $20.00–$30.00")).toBeInTheDocument();
    expect(within(screen.getByText("JA").parentElement!).getByText("—")).toBeInTheDocument();
  });

  it("dates an 'as of' price", () => {
    renderWithData(
      <WantMarket
        market={[{ language: "en", printingId: EN, current: { price: 10, day: "2026-10-15", asOf: true, low: 10, high: 10 } }]}
      />,
    );

    expect(screen.getByText("as of Oct 15")).toBeInTheDocument();
  });
});

describe("OfferVsMarket", () => {
  it("badges a fresh Offer's ±% vs market", () => {
    renderWithData(<OfferVsMarket offer={{ seenOn: "2026-10-20", vsMarket: { percent: 20, stale: false } }} />);

    const badge = screen.getByText("+20% vs market");
    expect(badge).not.toHaveAttribute("title");
    expect(badge).not.toHaveClass("text-muted-foreground");
  });

  it("mutes a stale Offer's ±%, saying the market is today's", () => {
    renderWithData(<OfferVsMarket offer={{ seenOn: "2026-10-02", vsMarket: { percent: -12.4, stale: true } }} />);

    const badge = screen.getByText("-12% vs market");
    expect(badge).toHaveAttribute("title", "Seen Oct 2 · market as of today");
    expect(badge).toHaveClass("text-muted-foreground");
  });

  it("shows no badge without a Current Market Price", () => {
    const { container } = renderWithData(<OfferVsMarket offer={{ seenOn: "2026-10-20", vsMarket: null }} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("WantImage", () => {
  it("opens the Printing drawer on the pictured Printing", () => {
    const want = {
      variantId: "OP05-119_p1",
      imageUrl: "https://img.test/en/OP05-119_p1.png",
      pictured: { printingId: EN, language: "en" },
    } satisfies Pick<Want, "variantId" | "imageUrl" | "pictured">;
    renderWithData(<WantImage want={want} />);

    fireEvent.click(screen.getByRole("button", { name: "Price History for OP05-119_p1 · EN" }));

    expect(screen.getByRole("dialog", { name: "OP05-119_p1 · EN" })).toBeInTheDocument();
  });
});
