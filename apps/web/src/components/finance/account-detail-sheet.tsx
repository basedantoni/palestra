import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

import { BalanceLineChart, type Timeframe, TimeframeChips } from "./balance-line";
import { isNegativeUsd, signedUsd } from "./currency-tooltip";

/** Cents, matching the accounts list rows. */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export interface AccountSummary {
  id: string;
  name: string;
  type: string;
  mask: string | null;
}

const isLiability = (type: string) => type === "credit" || type === "loan";

/** An account's daily balance line with the timeframe chips and a change chip. */
export function AccountDetailSheet({ account, onClose }: { account: AccountSummary | null; onClose: () => void }) {
  return (
    <Sheet open={account !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="space-y-4 overflow-y-auto p-5 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {account && <AccountDetail key={account.id} account={account} />}
      </SheetContent>
    </Sheet>
  );
}

function AccountDetail({ account }: { account: AccountSummary }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("3M");
  const query = useQuery({
    ...trpc.accounts.balanceHistory.queryOptions({ accountId: account.id, timeframe }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const owed = isLiability(account.type);

  return (
    <>
      <SheetHeader className="p-0">
        <SheetTitle className="text-base">{account.name}</SheetTitle>
        <SheetDescription>
          {account.type}
          {account.mask ? ` ····${account.mask}` : ""}
          {owed ? " · balance owed" : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{data?.current == null ? "—" : usd.format(data.current)}</span>
        {data?.change != null && (
          <span
            className={cn(
              "rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums",
              // Debt going up is the bad direction.
              isNegativeUsd(owed ? -data.change : data.change) && "text-destructive",
            )}
          >
            {signedUsd(data.change)} · {timeframe}
          </span>
        )}
      </div>
      <TimeframeChips value={timeframe} onChange={setTimeframe} />
      {query.isError ? (
        <p className="text-sm text-destructive">Couldn't load balance history.</p>
      ) : !data ? (
        <Skeleton className="h-60 w-full" />
      ) : data.points.length < 2 ? (
        <p className="text-sm text-muted-foreground">Not enough balance history to chart yet.</p>
      ) : (
        <BalanceLineChart
          rows={data.points}
          series={[
            {
              key: "balance",
              label: owed ? "Owed" : "Balance",
              color: owed ? "var(--chart-liabilities)" : "var(--chart-assets)",
            },
          ]}
          dimmed={query.isPlaceholderData}
        />
      )}
    </>
  );
}
