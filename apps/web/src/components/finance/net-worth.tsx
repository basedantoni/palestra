import { useState } from "react";
import { format, parseISO, subMonths, subYears } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type RouterOutputs } from "@/utils/trpc";

import { StatTile } from "./cash-flow";
import { CurrencyTooltip, signedUsd, usd } from "./currency-tooltip";

export type NetWorthHistory = RouterOutputs["finance"]["netWorthHistory"];

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" });

/** Weekly points needed before the line is worth drawing. */
const MIN_POINTS = 2;
/** ~3 months of weekly points; the range switch only appears beyond this. */
const THREE_MONTHS_OF_WEEKS = 13;

const RANGES = {
  "3M": (last: Date) => subMonths(last, 3),
  "1Y": (last: Date) => subYears(last, 1),
  All: null,
} as const;
type Range = keyof typeof RANGES;

export function NetWorthTile({ data }: { data: NetWorthHistory }) {
  return (
    <StatTile
      title="Net worth"
      value={data.current === null ? "—" : usd.format(data.current)}
      hint={data.change30d === null ? undefined : `${signedUsd(data.change30d)} in 30 days`}
      negative={(data.current ?? 0) < 0}
    />
  );
}

/**
 * Weekly Net Worth line. Weeks before every linked account had a snapshot
 * (`partial`) are drawn dashed and faded so linking an account doesn't read as
 * real growth.
 */
export function NetWorthChart({ data }: { data: NetWorthHistory }) {
  const [range, setRange] = useState<Range>("All");

  if (data.points.length < MIN_POINTS) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Building history. Your net worth line appears after two weeks of balances.
        </p>
      </div>
    );
  }

  const showRanges = data.points.length > THREE_MONTHS_OF_WEEKS;
  const cutoffOf = showRanges ? RANGES[range] : null;
  const cutoff = cutoffOf ? format(cutoffOf(parseISO(data.points.at(-1)!.weekStart)), "yyyy-MM-dd") : "";
  // Partial weeks are a prefix (an account stays covered once it has a snapshot);
  // the dashed series also takes the first full week so the two segments join.
  const rows = data.points
    .map((p, i) => ({
      ...p,
      full: p.partial ? null : p.netWorth,
      partialLine: p.partial || data.points[i - 1]?.partial ? p.netWorth : null,
    }))
    .filter((p) => p.weekStart >= cutoff);

  return (
    <div className="space-y-2">
      {showRanges && (
        <Tabs value={range} onValueChange={(next) => setRange(next as Range)}>
          <TabsList>
            {Object.keys(RANGES).map((r) => (
              <TabsTrigger key={r} value={r}>
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="weekStart"
            tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(n: number) => compactUsd.format(n)}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !p) return null;
              return (
                <CurrencyTooltip
                  title={`Week of ${format(parseISO(p.weekStart), "MMM d, yyyy")}`}
                  note={p.partial ? "some accounts not linked yet" : undefined}
                  rows={[
                    { label: "Assets", value: p.assets, color: "var(--chart-income)" },
                    { label: "Liabilities", value: p.liabilities, color: "var(--chart-spend)" },
                    { label: "Net worth", value: p.netWorth, signed: true },
                  ]}
                />
              );
            }}
          />
          <Line
            dataKey="partialLine"
            stroke="var(--muted-foreground)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line dataKey="full" stroke="var(--foreground)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
