import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { type RouterOutputs } from "@/utils/trpc";

import { compactUsd, tick } from "./balance-line";
import { CurrencyTooltip } from "./currency-tooltip";
import { monthLabel } from "./month-label";

/** A month's Budgeted Spend and limit (null = none), as `finance.categoryMonthly` and `budgets.history` return them. */
type MonthlyBar = RouterOutputs["finance"]["categoryMonthly"][number];

const LIMIT = "var(--foreground)";

/** The month's limit: a dashed tick across its bar's slot. */
function LimitTick({ x, y, width, payload }: { x?: number; y?: number; width?: number; payload?: MonthlyBar }) {
  if (payload?.limit == null || x === undefined || y === undefined || width === undefined) return <g />;
  return <line x1={x} x2={x + width} y1={y} y2={y} stroke={LIMIT} strokeWidth={2} strokeDasharray="4 2" />;
}

/**
 * A category's Budgeted Spend per month (KOI-347), one bar per month in
 * `color`, with the month's limit as a dashed tick where it has one. Used by
 * the category detail view and the budget sheet's history.
 */
export function MonthlyBars({ data, color, height = 200 }: { data: MonthlyBar[]; color: string; height?: number }) {
  const hasLimits = data.some((m) => m.limit !== null);
  // Past 6 bars the names crowd a narrow chart, so use initials.
  const labelPattern = data.length > 6 ? "MMMMM" : "MMM";

  return (
    <div className="space-y-2">
      {hasLimits && (
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color }} />
            Spent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t-2 border-dashed" style={{ borderColor: LIMIT }} />
            Limit
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barCategoryGap="20%" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="monthKey"
            tickFormatter={(m: string) => monthLabel(m, labelPattern)}
            tickLine={false}
            axisLine={false}
            tick={tick}
          />
          {/* The limit ticks sit on their own axis so they overlay the bars instead of sitting beside them. */}
          <XAxis xAxisId="limit" dataKey="monthKey" hide />
          <YAxis
            tickFormatter={(n: number) => compactUsd.format(n)}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={tick}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const m = payload?.[0]?.payload as MonthlyBar | undefined;
              if (!active || !m) return null;
              const rows = [
                { label: "Spent", value: m.spent, color },
                ...(m.limit !== null ? [{ label: "Limit", value: m.limit }] : []),
              ];
              return <CurrencyTooltip title={monthLabel(m.monthKey, "MMMM yyyy")} rows={rows} />;
            }}
          />
          <Bar dataKey="spent" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          {hasLimits && (
            <Bar dataKey="limit" xAxisId="limit" shape={LimitTick} maxBarSize={40} isAnimationActive={false} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
