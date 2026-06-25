import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Current month as YYYY-MM (local). */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function BudgetGrid({ monthKey = currentMonthKey() }: { monthKey?: string }) {
  const { data: rows, isLoading } = useQuery(
    trpc.budgets.forMonth.queryOptions({ monthKey }),
  );

  if (isLoading) return <div className="text-muted-foreground">Loading budgets…</div>;
  if (!rows || rows.length === 0) {
    return <div className="text-muted-foreground">No budgets set for {monthKey}.</div>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = row.limit > 0 ? Math.min(100, (row.spent / row.limit) * 100) : 0;
        return (
          <li key={row.categoryId} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{row.categoryName}</span>
              <span className={row.overspent ? "text-destructive" : "text-muted-foreground"}>
                {usd.format(row.spent)} / {usd.format(row.limit)}
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
