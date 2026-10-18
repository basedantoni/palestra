import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { type CategorySpendRow, donutSlices } from "@life-tracker/api/lib/category-spend";
import { periodToSearch, type TransactionPeriod, type TransactionPeriodSearch } from "@life-tracker/shared";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";

import { categoryColor } from "./category-color";
import { CategoryMark } from "./category-icon";
import { CurrencyTooltip, usd } from "./currency-tooltip";
import { TransactionPeriodPicker } from "./transaction-period-picker";

const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);

/**
 * Where a period's Spend went: a donut of the top categories plus "Other",
 * and a ranked list of every category (refund-negative ones too). Rows drill
 * through to the ledger for that category and period.
 */
export function SpendByCategory({
  period,
  today,
  onPeriodChange,
}: {
  period: TransactionPeriod;
  today: string;
  onPeriodChange: (next: TransactionPeriod) => void;
}) {
  const query = useQuery({ ...trpc.finance.spendByCategory.queryOptions({ period }), placeholderData: keepPreviousData });
  const periodSearch = periodToSearch(period, today);
  // The previous period's rows stay on screen while the new one loads: dim them
  // and disable the links so they don't pass as (or drill into) the new period.
  const loading = query.isPlaceholderData;

  return (
    <div className="space-y-3">
      <TransactionPeriodPicker period={period} today={today} onChange={onPeriodChange} />
      <div
        aria-busy={loading}
        className={cn("space-y-3 transition-opacity", loading && "opacity-50")}
        inert={loading}
      >
        <Link
          to="/finance/transactions"
          search={periodSearch}
          className="block text-right text-sm text-muted-foreground hover:underline"
        >
          View transactions →
        </Link>
        {query.isPending && <Skeleton className="h-64 w-full" />}
        {query.isError && <p className="text-sm text-destructive">Couldn't load spend by category.</p>}
        {query.data && <Breakdown rows={query.data} periodSearch={periodSearch} />}
      </div>
    </div>
  );
}

function Breakdown({ rows, periodSearch }: { rows: CategorySpendRow[]; periodSearch: TransactionPeriodSearch }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">No spend in this period</p>
      </div>
    );
  }

  // Each slice wears its category's own color (KOI-336); Uncategorized and "Other" are neutral.
  const slices = donutSlices(rows).map((s) => ({ ...s, fill: categoryColor(s.color) }));
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
                  <Cell key={s.key} fill={s.fill} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const s = payload?.[0]?.payload as (typeof slices)[number] | undefined;
                  if (!active || !s) return null;
                  return <CurrencyTooltip title={s.name} rows={[{ label: "Spend", value: s.spend, color: s.fill }]} />;
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
          return (
            <li key={key}>
              <Link
                to="/finance/transactions"
                search={{ ...periodSearch, category: key }}
                className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
              >
                <CategoryMark category={r.categoryId === null ? null : r} />
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
