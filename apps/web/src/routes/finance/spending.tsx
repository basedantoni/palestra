import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CASH_FLOW_RANGES } from "@life-tracker/api/lib/cash-flow";
import { periodToSearch, searchToPeriod, transactionPeriodSearchSchema } from "@life-tracker/shared";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { CashFlowChart } from "@/components/finance/cash-flow";
import { SpendByCategory } from "@/components/finance/spend-by-category";

// Range and period live in the URL so reloads and shared links keep the view.
// No period params = the current month; no range = 6M.
const spendingSearchSchema = transactionPeriodSearchSchema.extend({
  range: z.enum(Object.keys(CASH_FLOW_RANGES) as [keyof typeof CASH_FLOW_RANGES]).optional().catch(undefined),
});

export const Route = createFileRoute("/finance/spending")({
  validateSearch: (search) => spendingSearchSchema.parse(search),
  component: SpendingPage,
});

/**
 * Income vs spend by month, and spend by category for one period (KOI-358).
 * Tapping a month's bar picks that month for the category breakdown; the chart
 * highlights the period's month when it is a month the chart shows.
 */
function SpendingPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = useFinanceToday();
  const range = search.range ?? "6M";
  const period = searchToPeriod(search, today);
  // Keep the old bars on screen while another range loads.
  const cashFlow = useQuery({ ...trpc.finance.cashFlow.queryOptions({ range }), placeholderData: keepPreviousData });
  const months = cashFlow.data?.months ?? [];
  const selectedMonth =
    period.kind === "month" && months.some((m) => m.monthKey === period.month) ? period.month : null;

  const update = (next: z.infer<typeof spendingSearchSchema>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">Spending</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Income vs spend</h2>
        {cashFlow.isError ? (
          <p className="text-sm text-destructive">Couldn't load cash flow.</p>
        ) : !cashFlow.data ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <CashFlowChart
            data={cashFlow.data}
            range={range}
            onRangeChange={(next) => update({ range: next === "6M" ? undefined : next })}
            selectedMonth={selectedMonth}
            onSelectMonth={(month) => update(periodToSearch({ kind: "month", month }, today))}
          />
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Spend by category</h2>
        <SpendByCategory period={period} today={today} onPeriodChange={(next) => update(periodToSearch(next, today))} />
      </section>
    </div>
  );
}
