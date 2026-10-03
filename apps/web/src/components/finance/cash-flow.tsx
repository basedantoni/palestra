import { Bar, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CASH_FLOW_RANGES, type CashFlowRange } from "@life-tracker/api/lib/cash-flow";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type RouterOutputs } from "@/utils/trpc";

import { CurrencyTooltip, isNegativeUsd, signedUsd } from "./currency-tooltip";
import { monthLabel } from "./month-label";

export type CashFlow = RouterOutputs["finance"]["cashFlow"];
type CashFlowMonth = CashFlow["months"][number];

export function StatTile({ title, value, hint, negative }: { title: string; value: string; hint?: string; negative?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className={cn("text-xl font-semibold tabular-nums", negative && "text-destructive")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Net this month + Savings Rate. A fragment, so the parent grid can hold other tiles (Net Worth). */
export function CashFlowTiles({ data }: { data: CashFlow }) {
  const thisMonth = data.months.at(-1);
  const rate = data.summary.savingsRate;
  return (
    <>
      <StatTile
        title="Net this month"
        value={thisMonth ? signedUsd(thisMonth.net) : "—"}
        hint={thisMonth?.isPartial ? "in progress" : undefined}
        negative={thisMonth ? isNegativeUsd(thisMonth.net) : false}
      />
      <StatTile
        title="Savings rate"
        value={rate === null ? "—" : `${Math.round(rate * 100)}%`}
        hint="avg of last 5 full months"
        negative={rate !== null && Math.round(rate * 100) < 0}
      />
    </>
  );
}

/**
 * Selected month full strength, others dimmed; with none selected every bar is
 * full strength. The partial month is faded further.
 */
function barOpacity(m: CashFlowMonth, selected: string | null): number {
  if (selected === null || m.monthKey === selected) return m.isPartial ? 0.7 : 1;
  return m.isPartial ? 0.25 : 0.5;
}

/**
 * Mirrored bars: Income up from zero, Spend down, Net as a line. Tapping a
 * month selects it (no navigation).
 */
export function CashFlowChart({
  data,
  range,
  onRangeChange,
  selectedMonth,
  onSelectMonth,
}: {
  data: CashFlow;
  range: CashFlowRange;
  onRangeChange: (range: CashFlowRange) => void;
  selectedMonth: string | null;
  onSelectMonth: (monthKey: string) => void;
}) {
  if (data.months.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">No transactions yet.</p>
      </div>
    );
  }

  // Past a year a month name repeats, so add the year.
  const labelPattern = data.months.length > 12 ? "MMM yy" : "MMM";
  const rows = data.months.map((m) => ({
    ...m,
    label: monthLabel(m.monthKey, labelPattern),
    spendDown: -Math.max(m.spend, 0),
  }));
  const cells = (color: string) =>
    rows.map((m) => (
      <Cell
        key={m.monthKey}
        fillOpacity={barOpacity(m, selectedMonth)}
        stroke={m.isPartial ? color : undefined}
        strokeDasharray={m.isPartial ? "3 2" : undefined}
      />
    ));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <Legend color="var(--chart-income)" label="Income" />
          <Legend color="var(--chart-spend)" label="Spend" />
          <Legend color="var(--foreground)" label="Net" line />
        </div>
        <Tabs value={range} onValueChange={(next) => onRangeChange(next as CashFlowRange)}>
          <TabsList>
            {Object.keys(CASH_FLOW_RANGES).map((r) => (
              <TabsTrigger key={r} value={r}>
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={rows}
          stackOffset="sign"
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          onClick={(state) => {
            const row = rows[Number(state?.activeTooltipIndex)];
            if (row) onSelectMonth(row.monthKey);
          }}
        >
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={8}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis hide />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              const m = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !m) return null;
              return (
                <CurrencyTooltip
                  title={monthLabel(m.monthKey, "MMMM yyyy")}
                  note={m.isPartial ? "in progress" : undefined}
                  rows={[
                    { label: "Income", value: m.income, color: "var(--chart-income)" },
                    { label: "Spend", value: m.spend, color: "var(--chart-spend)" },
                    { label: "Net", value: m.net, signed: true },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="income" stackId="flow" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {cells("var(--chart-income)")}
          </Bar>
          <Bar dataKey="spendDown" stackId="flow" fill="var(--chart-spend)" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {cells("var(--chart-spend)")}
          </Bar>
          <Line
            dataKey="net"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            dot={{ r: 3, fill: "var(--background)", stroke: "var(--foreground)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={line ? "h-0.5 w-3" : "size-2.5 rounded-sm"} style={{ background: color }} />
      {label}
    </span>
  );
}
