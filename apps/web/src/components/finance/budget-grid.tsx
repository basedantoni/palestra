import { useQuery } from "@tanstack/react-query";

import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc } from "@/utils/trpc";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Compact spend-vs-limit bars for the current month's budgeted categories (finance overview). */
export function BudgetGrid() {
  const monthKey = useFinanceToday().slice(0, 7);
  const { data, isLoading } = useQuery(trpc.budgets.forMonth.queryOptions({ monthKey }));

  if (isLoading) return <div className="text-muted-foreground">Loading budgets…</div>;
  const rows = (data ?? []).filter((r) => r.limit !== null);
  if (rows.length === 0) {
    return <div className="text-muted-foreground">No budgets set for this month.</div>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const limit = row.limit!;
        const pct = limit > 0 ? Math.min(100, (row.spent / limit) * 100) : 0;
        return (
          <li key={row.categoryId} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{row.categoryName}</span>
              <span className={row.overspent ? "text-destructive" : "text-muted-foreground"}>
                {usd.format(row.spent)} / {usd.format(limit)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${row.overspent ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
