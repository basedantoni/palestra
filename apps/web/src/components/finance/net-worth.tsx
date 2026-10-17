import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { type RouterOutputs, trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";

import { BalanceLineChart, type BalanceSeries, type Timeframe, TimeframeChips } from "./balance-line";
import { StatTile } from "./cash-flow";
import { isNegativeUsd, signedUsd, usd } from "./currency-tooltip";

export type NetWorthHistory = RouterOutputs["finance"]["netWorthHistory"];

const SERIES: BalanceSeries<"netWorth" | "assets" | "liabilities">[] = [
  { key: "netWorth", label: "Net worth", color: "var(--foreground)", signed: true },
  { key: "assets", label: "Assets", color: "var(--chart-assets)" },
  { key: "liabilities", label: "Liabilities", color: "var(--chart-liabilities)" },
];

/** Net worth now, with the change over the 1M window (`finance.netWorthHistory({ timeframe: "1M" })`). */
export function NetWorthTile({ data }: { data: NetWorthHistory }) {
  return (
    <StatTile
      title="Net worth"
      value={data.current === null ? "—" : usd.format(data.current)}
      hint={data.change === null ? undefined : `${signedUsd(data.change)} past month`}
      negative={isNegativeUsd(data.current ?? 0)}
    />
  );
}

/** Daily Net Worth with Assets and Liabilities, over the picked chip's window. */
export function NetWorthChart() {
  const [timeframe, setTimeframe] = useState<Timeframe>("3M");
  const query = useQuery({
    ...trpc.finance.netWorthHistory.queryOptions({ timeframe }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-3">
      <TimeframeChips value={timeframe} onChange={setTimeframe} />
      {query.isError ? (
        <p className="text-sm text-destructive">Couldn't load net worth.</p>
      ) : !query.data ? (
        <Skeleton className="h-60 w-full" />
      ) : query.data.points.length < 2 ? (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Building history. Your net worth line appears after two days of balances.
          </p>
        </div>
      ) : (
        <BalanceLineChart rows={query.data.points} series={SERIES} dimmed={query.isPlaceholderData} />
      )}
    </div>
  );
}
