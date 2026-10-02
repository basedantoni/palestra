import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { type CategorySpendRow, donutSlices } from "@life-tracker/api/lib/category-spend";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";

import { monthLabel } from "./month-label";
import { CurrencyTooltip, usd } from "./currency-tooltip";

/** Donut slots in rank order; "Other" is neutral. */
const SLOT_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-cat-${n})`);
const OTHER_COLOR = "var(--chart-cat-other)";

const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);

/**
 * Where the selected Month's Spend went: a donut of the top categories plus
 * "Other", and a ranked list of every category (refund-negative ones too).
 * Rows drill through to the ledger for that category and month.
 */
export function SpendByCategory({ monthKey }: { monthKey: string }) {
  const query = useQuery(trpc.finance.spendByCategory.queryOptions({ monthKey }));
  const month = monthLabel(monthKey, "MMMM");

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{monthLabel(monthKey, "MMMM yyyy")}</span>
        <Link
          to="/finance/transactions"
          search={{ month: monthKey }}
          className="text-sm text-muted-foreground hover:underline"
        >
          View {month} transactions →
        </Link>
      </div>
      {query.isPending && <Skeleton className="h-64 w-full" />}
      {query.isError && <p className="text-sm text-destructive">Couldn't load spend by category.</p>}
      {query.data && <Breakdown rows={query.data} monthKey={monthKey} />}
    </div>
  );
}

function Breakdown({ rows, monthKey }: { rows: CategorySpendRow[]; monthKey: string }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">No spend this month</p>
      </div>
    );
  }

  const slices = donutSlices(rows).map((s, i) => ({
    ...s,
    color: s.key === "other" ? OTHER_COLOR : (SLOT_COLORS[i] ?? OTHER_COLOR),
  }));
  const colorOf = new Map(slices.map((s) => [s.key, s.color]));
  const total = rows.reduce((s, r) => s + r.spend, 0);

  return (
    <div className="space-y-4">
      {slices.length > 0 && (
        <div className="relative mx-auto h-52 w-52">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="spend"
                nameKey="name"
                innerRadius="62%"
                outerRadius="100%"
                stroke="var(--background)"
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const s = payload?.[0]?.payload as (typeof slices)[number] | undefined;
                  if (!active || !s) return null;
                  return <CurrencyTooltip title={s.name} rows={[{ label: "Spend", value: s.spend, color: s.color }]} />;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-muted-foreground">Spend</span>
            <span className="text-lg font-semibold tabular-nums">{usd.format(total)}</span>
          </div>
        </div>
      )}
      <ul className="divide-y rounded-md border">
        {rows.map((r) => {
          const key = r.categoryId ?? "uncategorized";
          // Positive categories past the top slots are in the "Other" slice.
          const color = colorOf.get(key) ?? (r.spend > 0 ? OTHER_COLOR : undefined);
          return (
            <li key={key}>
              <Link
                to="/finance/transactions"
                search={{ month: monthKey, category: key }}
                className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
              >
                <span
                  className={cn("size-2.5 shrink-0 rounded-sm", !color && "border border-dashed border-muted-foreground")}
                  style={color ? { background: color } : undefined}
                />
                <span className={cn("min-w-0 flex-1 truncate", r.categoryId === null && "italic")}>{r.name}</span>
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct(r.share)}</span>
                {/* A refund-negative category is good news: signed, not red. */}
                <span className="w-20 text-right tabular-nums">{usd.format(r.spend)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
