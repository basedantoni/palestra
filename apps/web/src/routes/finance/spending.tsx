// PROTOTYPE (throwaway): where the overview's cash flow + category charts would move.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import type { CashFlowRange } from "@life-tracker/api/lib/cash-flow";
import type { TransactionPeriod } from "@life-tracker/shared";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc } from "@/utils/trpc";
import { CashFlowChart } from "@/components/finance/cash-flow";
import { SpendByCategory } from "@/components/finance/spend-by-category";

export const Route = createFileRoute("/finance/spending")({ component: Spending });

function Spending() {
  const today = useFinanceToday();
  const [range, setRange] = useState<CashFlowRange>("6M");
  const [picked, setPicked] = useState<TransactionPeriod | null>(null);
  const cashFlow = useQuery({ ...trpc.finance.cashFlow.queryOptions({ range }), placeholderData: keepPreviousData });
  const months = cashFlow.data?.months ?? [];
  const currentMonth = months.at(-1)?.monthKey;
  const period = picked ?? (currentMonth ? { kind: "month" as const, month: currentMonth } : null);
  const selectedMonth = period?.kind === "month" && months.some((m) => m.monthKey === period.month) ? period.month : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      <Link to="/finance" className="text-sm text-muted-foreground hover:underline">
        ← Finance
      </Link>
      <h1 className="text-2xl font-bold">Spending</h1>
      {cashFlow.data && (
        <CashFlowChart
          data={cashFlow.data}
          range={range}
          onRangeChange={setRange}
          selectedMonth={selectedMonth}
          onSelectMonth={(month) => setPicked({ kind: "month", month })}
        />
      )}
      {period && <SpendByCategory period={period} today={today} onPeriodChange={setPicked} />}
    </div>
  );
}
