import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { TIMEFRAMES, type Timeframe } from "@life-tracker/api/lib/net-worth";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CurrencyTooltip, signedUsd, usd } from "./currency-tooltip";

export type { Timeframe };

export const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" });
export const tick = { fontSize: 11, fill: "var(--muted-foreground)" };

export interface BalanceSeries<K extends string> {
  key: K;
  label: string;
  /** Stroke, e.g. "var(--chart-assets)". */
  color: string;
  /** Tooltip shows +/- (net-like values). */
  signed?: boolean;
}

/** One day: `date` "yyyy-MM-dd", a number per series key, and `partial` for days drawn dashed. */
export type BalanceRow<K extends string> = { date: string; partial?: boolean } & Record<K, number>;

/** The 1M / 3M / YTD / 1Y / All chips shared by the balance charts. */
export function TimeframeChips({ value, onChange }: { value: Timeframe; onChange: (t: Timeframe) => void }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as Timeframe)}>
      <TabsList>
        {TIMEFRAMES.map((t) => (
          <TabsTrigger key={t} value={t}>
            {t}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * Daily balance lines (net worth, an account) on one axis, straight segments.
 * Days flagged `partial` (an account not linked yet) are drawn dashed and faded
 * so linking doesn't read as growth. Two or more series get a legend carrying
 * each latest value; the tooltip lists every series at the hovered day.
 */
export function BalanceLineChart<K extends string>({
  rows,
  series,
  dimmed = false,
}: {
  rows: BalanceRow<K>[];
  series: BalanceSeries<K>[];
  /** Hold the old render faded while another timeframe loads. */
  dimmed?: boolean;
}) {
  // Partial days are a prefix (an account stays covered once snapshotted); the
  // dashed copy also takes the first full day so the two segments join.
  const anyPartial = rows.some((r) => r.partial);
  const data = rows.map((r, i) => {
    const out: Record<string, unknown> = { ...r };
    for (const s of series) {
      out[`${s.key}:full`] = r.partial ? null : r[s.key];
      out[`${s.key}:partial`] = r.partial || rows[i - 1]?.partial ? r[s.key] : null;
    }
    return out;
  });
  const span = rows.length > 1 ? differenceInCalendarDays(parseISO(rows.at(-1)!.date), parseISO(rows[0]!.date)) : 0;
  const tickFormat = span > 180 ? "MMM yyyy" : "MMM d";
  const latest = rows.at(-1);

  return (
    <div className={cn("space-y-2 transition-opacity", dimmed && "opacity-50")}>
      {series.length > 1 && latest && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums">
                {s.signed ? signedUsd(latest[s.key]) : usd.format(latest[s.key])}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), tickFormat)}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            tick={tick}
          />
          <YAxis
            domain={["auto", "auto"]}
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
              const r = payload?.[0]?.payload as BalanceRow<K> | undefined;
              if (!active || !r) return null;
              return (
                <CurrencyTooltip
                  title={format(parseISO(r.date), "MMM d, yyyy")}
                  note={r.partial ? "some accounts not linked yet" : undefined}
                  rows={series.map((s) => ({ label: s.label, value: r[s.key], color: s.color, signed: s.signed }))}
                />
              );
            }}
          />
          {anyPartial &&
            series.map((s) => (
              <Line
                key={`${s.key}:partial`}
                type="linear"
                dataKey={`${s.key}:partial`}
                stroke={s.color}
                strokeOpacity={0.5}
                strokeDasharray="4 3"
                strokeWidth={2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={`${s.key}:full`}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, fill: s.color, stroke: "var(--background)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
