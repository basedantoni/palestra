import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithData } from "@/test/render";
import type { RouterOutputs } from "@/utils/trpc";

import { MonthlyBars } from "./monthly-bars";

const history: RouterOutputs["budgets"]["history"] = [
  { monthKey: "2026-09", spent: 80, limit: 100 },
  { monthKey: "2026-10", spent: 120, limit: 100 },
];

// A recharts chart in jsdom (setup.ts sizes ResponsiveContainer): it renders, geometry is not asserted.
describe("MonthlyBars", () => {
  it("renders the chart and its legend", () => {
    const { container } = renderWithData(<MonthlyBars data={history} color="red" />);

    expect(screen.getByText("Limit")).toBeInTheDocument();
    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
  });
});
