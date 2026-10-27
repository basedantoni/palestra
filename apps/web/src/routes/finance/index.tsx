import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { useFinanceToday } from "@/hooks/use-finance-today";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { isBroken } from "@/components/finance/accounts-list";
import { CashFlowTiles } from "@/components/finance/cash-flow";
import { MonthPaceChart } from "@/components/finance/month-pace";
import { NetWorthTile } from "@/components/finance/net-worth";
import { TransactionFeed, UnreviewedDot } from "@/components/finance/transaction-feed";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";
import { SyncNowButton } from "@/components/finance/sync-now-button";

export const Route = createFileRoute("/finance/")({
  component: FinanceOverview,
});

/**
 * Finance briefing (KOI-358): what needs attention, this month's pace, the
 * headline numbers and the latest transactions. Charts and full lists live on
 * the child pages, linked from the sidebar.
 */
function FinanceOverview() {
  const today = useFinanceToday();
  const accounts = useQuery(trpc.plaid.listAccounts.queryOptions());
  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const { data: items } = useQuery(trpc.plaid.listItems.queryOptions());
  const cashFlow = useQuery({ ...trpc.finance.cashFlow.queryOptions({ range: "6M" }), enabled: hasAccounts });
  const netWorth = useQuery({ ...trpc.finance.netWorthHistory.queryOptions({ timeframe: "1M" }), enabled: hasAccounts });
  const { data: unreviewed } = useQuery(trpc.transactions.unreviewedCount.queryOptions());
  const brokenBanks = (items ?? []).filter(isBroken);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finance</h1>
        <div className="flex items-start gap-2">
          <SyncNowButton />
          <PlaidLinkButton />
        </div>
      </div>
      {(!!unreviewed || brokenBanks.length > 0) && (
        <div className="space-y-2">
          {/* The count spans all time, so the queue opens on all time. */}
          {!!unreviewed && (
            <Banner to="/finance/transactions" search={{ reviewed: false, all: true }} action="Review">
              <UnreviewedDot />
              {unreviewed} to review
            </Banner>
          )}
          {brokenBanks.map((bank) => (
            <Banner key={bank.id} to="/finance/accounts" action="Reconnect" danger>
              {bank.institutionName ?? "A bank"} needs reconnecting
            </Banner>
          ))}
        </div>
      )}
      {/* No accounts linked: charts stay hidden; the Connect button above is the CTA. */}
      {hasAccounts && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">This month</h2>
          <MonthPaceChart monthKey={today.slice(0, 7)} />
        </section>
      )}
      {hasAccounts && (netWorth.data || cashFlow.data) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {netWorth.data && (
            <Link to="/finance/accounts" className="hover:opacity-80">
              <NetWorthTile data={netWorth.data} />
            </Link>
          )}
          {cashFlow.data && <CashFlowTiles data={cashFlow.data} />}
        </div>
      )}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent transactions</h2>
          <Link to="/finance/transactions" className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        </div>
        <TransactionFeed pageSize={5} loadMore={false} />
      </section>
    </div>
  );
}

function Banner({
  to,
  search,
  action,
  danger,
  children,
}: {
  to: "/finance/transactions" | "/finance/accounts";
  search?: { reviewed: false; all: true };
  action: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={cn(
        "flex items-center justify-between border border-border px-4 py-3 text-sm hover:bg-muted/50",
        danger && "border-destructive/50 text-destructive",
      )}
    >
      <span className="flex items-center gap-2 font-medium">{children}</span>
      <span className="text-muted-foreground">{action} →</span>
    </Link>
  );
}
