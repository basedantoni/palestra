import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountsList } from "@/components/finance/accounts-list";
import { BudgetGrid } from "@/components/finance/budget-grid";
import { type CashFlow, CashFlowChart, CashFlowTiles } from "@/components/finance/cash-flow";
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
 * The Month the overview focuses on ("YYYY-MM"): the month tapped on the cash
 * flow chart, else the latest (current, partial) month. Null while cash flow
 * loads or when there are no transactions.
 */
function useSelectedMonth(cashFlow: CashFlow | undefined) {
  const [picked, setPicked] = useState<string | null>(null);
  const selectedMonth = picked ?? cashFlow?.months.at(-1)?.monthKey ?? null;
  return [selectedMonth, setPicked] as const;
}

function FinanceOverview() {
  const accounts = useQuery(trpc.plaid.listAccounts.queryOptions());
  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const cashFlow = useQuery({ ...trpc.finance.cashFlow.queryOptions({ months: 6 }), enabled: hasAccounts });
  const [selectedMonth, setSelectedMonth] = useSelectedMonth(cashFlow.data);
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
      {hasAccounts && cashFlow.isError && (
        <p className="text-sm text-destructive">Couldn't load cash flow.</p>
      )}
      {hasAccounts && cashFlow.isPending && <Skeleton className="h-80 w-full" />}
      {hasAccounts && cashFlow.data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {netWorth.data && <NetWorthTile data={netWorth.data} />}
            <CashFlowTiles data={cashFlow.data} />
          </div>
          <Section title="Income vs spend">
            <CashFlowChart data={cashFlow.data} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />
          </Section>
          {selectedMonth && (
            <Section title="Spend by category">
              <SpendByCategory monthKey={selectedMonth} />
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
