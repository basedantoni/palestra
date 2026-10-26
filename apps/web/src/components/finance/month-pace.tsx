import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { addMonths } from "@life-tracker/shared";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { compactUsd, tick } from "./balance-line";
import { CurrencyTooltip, usd } from "./currency-tooltip";
import { monthLabel } from "./month-label";

type MonthPace = RouterOutputs["finance"]["monthPace"];


const SPEND = "var(--chart-spend)";
const PACE = "var(--muted-foreground)";

/** "$40 over pace" / "$190 under pace" (over reads destructive). */
function OverUnder({ value }: { value: number }) {
  if (value === 0) return <span className="text-sm font-medium">On pace</span>;
  return (
    <span className={cn("text-sm font-medium tabular-nums", value > 0 && "text-destructive")}>
      {usd.format(Math.abs(value))} {value > 0 ? "over" : "under"} pace
    </span>
  );
}

/**
 * Month-to-date hero chart (KOI-344): cumulative Budgeted Spend for `monthKey`
 * against Pace to its Total Budget, with last month's cumulative faint behind.
 * No budgets: no Pace line and no over/under.
 */
export function MonthPaceChart({ monthKey }: { monthKey: string }) {
  const query = useQuery(trpc.finance.monthPace.queryOptions({ monthKey }));
  if (query.isError) return <p className="text-sm text-destructive">Couldn't load this month's pace.</p>;
  if (!query.data) return <Skeleton className="h-64 w-full" />;
  return <PaceLines data={query.data} monthKey={monthKey} />;
}

function PaceLines({ data, monthKey }: { data: MonthPace; monthKey: string }) {
  const monthName = monthLabel(monthKey, "MMM");
  const lastMonthName = monthLabel(addMonths(monthKey, -1), "MMMM");
  const latest = data.days.findLast((d) => d.cumulative !== null);
  // Last month counts too, so its line isn't clipped.
  const yMax = Math.max(...data.days.map((d) => Math.max(d.cumulative ?? 0, d.lastMonthCumulative ?? 0)), data.totalBudget ?? 0);

  const legend = [
    { label: "This month", color: SPEND, value: latest?.cumulative ?? null },
    ...(data.totalBudget !== null ? [{ label: "Pace to", color: PACE, value: data.totalBudget }] : []),
    { label: lastMonthName, color: SPEND, faint: true, value: null },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {legend.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ background: s.color, opacity: s.faint ? 0.35 : 1 }}
                aria-hidden
              />
              <span className="text-muted-foreground">{s.label}</span>
              {s.value !== null && <span className="font-medium tabular-nums">{usd.format(s.value)}</span>}
            </li>
          ))}
        </ul>
        {data.overUnder !== null && <OverUnder value={data.overUnder} />}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data.days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={16} tick={tick} />
          <YAxis
            domain={[0, yMax || "auto"]}
            tickFormatter={(n: number) => compactUsd.format(n)}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={tick}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as MonthPace["days"][number] | undefined;
              if (!active || !d) return null;
              const rows = [
                d.cumulative !== null && { label: "This month", value: d.cumulative, color: SPEND },
                d.pace !== null && { label: "Pace", value: d.pace, color: PACE },
                d.lastMonthCumulative !== null && { label: lastMonthName, value: d.lastMonthCumulative },
              ].filter((r) => r !== false);
              return <CurrencyTooltip title={`${monthName} ${d.day}`} rows={rows} />;
            }}
          />
          <Line
            type="linear"
            dataKey="lastMonthCumulative"
            stroke={SPEND}
            strokeOpacity={0.3}
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {data.totalBudget !== null && (
            <Line
              type="linear"
              dataKey="pace"
              stroke={PACE}
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            type="linear"
            dataKey="cumulative"
            stroke={SPEND}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4, fill: SPEND, stroke: "var(--background)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
