import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import type { CashFlowRange } from "@life-tracker/api/lib/cash-flow";
import type { TransactionPeriod } from "@life-tracker/shared";
import { authClient } from "@/lib/auth-client";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountsList } from "@/components/finance/accounts-list";
import { BudgetGrid } from "@/components/finance/budget-grid";
import { CashFlowChart, CashFlowTiles } from "@/components/finance/cash-flow";
import { GoalsList } from "@/components/finance/goals-list";
import { NetWorthChart, NetWorthTile } from "@/components/finance/net-worth";
import { SpendByCategory } from "@/components/finance/spend-by-category";
import { TransactionFeed } from "@/components/finance/transaction-feed";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";
import { SyncNowButton } from "@/components/finance/sync-now-button";

export const Route = createFileRoute("/finance/")({
  component: FinanceOverview,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function Section({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {to && (
          <Link to={to} className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The cash flow range and the overview's period: the category donut's
 * TransactionPeriod (the current month until picked in the donut or by tapping
 * a bar; null while cash flow loads or with no transactions). The chart
 * highlights the period's month when it is a month the chart shows, else no bar.
 */
function useOverviewFilters(hasAccounts: boolean) {
  const [range, setRange] = useState<CashFlowRange>("6M");
  const [picked, setPicked] = useState<TransactionPeriod | null>(null);
  // Keep the old bars (and tiles) on screen while another range loads.
  const cashFlow = useQuery({
    ...trpc.finance.cashFlow.queryOptions({ range }),
    enabled: hasAccounts,
    placeholderData: keepPreviousData,
  });
  const months = cashFlow.data?.months ?? [];
  // The server's current month, so the default matches the chart's partial month.
  const currentMonth = months.at(-1)?.monthKey;
  const period: TransactionPeriod | null = picked ?? (currentMonth ? { kind: "month", month: currentMonth } : null);
  const selectedMonth =
    period?.kind === "month" && months.some((m) => m.monthKey === period.month) ? period.month : null;

  return {
    cashFlow,
    range,
    setRange,
    selectedMonth,
    selectMonth: (month: string) => setPicked({ kind: "month", month }),
    period,
    setPeriod: setPicked,
  } as const;
}

function FinanceOverview() {
  const today = useFinanceToday();
  const accounts = useQuery(trpc.plaid.listAccounts.queryOptions());
  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const { cashFlow, range, setRange, selectedMonth, selectMonth, period, setPeriod } = useOverviewFilters(hasAccounts);
  const netWorth = useQuery({ ...trpc.finance.netWorthHistory.queryOptions(), enabled: hasAccounts });

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finance</h1>
        <div className="flex items-start gap-2">
          <SyncNowButton />
          <PlaidLinkButton />
        </div>
      </div>
      {/* No accounts linked: charts stay hidden; the Connect button above is the CTA. */}
      {hasAccounts && (netWorth.data || cashFlow.data) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {netWorth.data && <NetWorthTile data={netWorth.data} />}
          {cashFlow.data && <CashFlowTiles data={cashFlow.data} />}
        </div>
      )}
      {hasAccounts && cashFlow.isError && (
        <p className="text-sm text-destructive">Couldn't load cash flow.</p>
      )}
      {hasAccounts && cashFlow.isPending && <Skeleton className="h-80 w-full" />}
      {hasAccounts && cashFlow.data && (
        <>
          <Section title="Income vs spend">
            <CashFlowChart
              data={cashFlow.data}
              range={range}
              onRangeChange={setRange}
              selectedMonth={selectedMonth}
              onSelectMonth={selectMonth}
            />
          </Section>
          {period && (
            <Section title="Spend by category">
              <SpendByCategory period={period} today={today} onPeriodChange={setPeriod} />
            </Section>
          )}
        </>
      )}
      {hasAccounts && netWorth.data && (
        <Section title="Net worth">
          <NetWorthChart data={netWorth.data} />
        </Section>
      )}
      <Section title="Accounts" to="/finance/accounts">
        <AccountsList />
      </Section>
      <Section title="Budgets" to="/finance/budgets">
        <BudgetGrid />
      </Section>
      <Section title="Goals" to="/finance/goals">
        <GoalsList />
      </Section>
      <Section title="Recent transactions" to="/finance/transactions">
        <TransactionFeed pageSize={10} loadMore={false} />
      </Section>
    </div>
  );
}
