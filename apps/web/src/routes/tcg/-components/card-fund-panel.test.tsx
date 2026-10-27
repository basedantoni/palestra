import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { CardFundPanel } from "./card-fund-panel";

const fund: RouterOutputs["tcg"]["fund"]["get"] = {
  settings: { cardsCategoryId: "cat-cards", startMonth: "2026-08" },
  fund: {
    currentMonth: "2026-10",
    balance: 112.5,
    thisMonth: { limit: 150, spent: 37.5 },
    missingMonths: ["2026-09"],
  },
};

describe("CardFundPanel", () => {
  it("shows the fund balance, this month's spend and the months with no budget", async () => {
    renderWithData(<CardFundPanel />, (client) => client.setQueryData(trpc.tcg.fund.get.queryKey(), fund));

    expect(await screen.findByText("$112.50")).toBeInTheDocument();
    expect(screen.getByText(/Oct 2026: \$37\.50 spent of \$150\.00/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No Cards budget for Sep 2026");
  });

  it("asks for a Cards category before there is a fund", async () => {
    renderWithData(<CardFundPanel />, (client) =>
      client.setQueryData(trpc.tcg.fund.get.queryKey(), { settings: null, fund: null }),
    );

    expect(await screen.findByText(/Choose which finance category counts as Cards/)).toBeInTheDocument();
  });
});
