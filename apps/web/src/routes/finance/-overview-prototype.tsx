// PROTOTYPE (throwaway): three trimmed /finance overview layouts, picked via ?variant=A|B|C.
// Question: what stays on /finance once charts/lists move to child routes?
// The "-" prefix keeps TanStack Router from treating this file as a route.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { CashFlowTiles, StatTile } from "@/components/finance/cash-flow";
import { usd } from "@/components/finance/currency-tooltip";
import { MonthPaceChart } from "@/components/finance/month-pace";
import { NetWorthTile } from "@/components/finance/net-worth";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";
import { SyncNowButton } from "@/components/finance/sync-now-button";
import { TransactionFeed, UnreviewedDot } from "@/components/finance/transaction-feed";

export const PROTOTYPE_VARIANTS = [
  { key: "now", name: "Current page" },
  { key: "A", name: "Briefing" },
  { key: "B", name: "Hub" },
  { key: "C", name: "Inbox" },
];

/** Everything the variants read. Read-only; no mutations. */
function useOverviewData() {
  const today = useFinanceToday();
  const monthKey = today.slice(0, 7);
  const accounts = useQuery(trpc.plaid.listAccounts.queryOptions());
  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const items = useQuery(trpc.plaid.listItems.queryOptions());
  const unreviewed = useQuery(trpc.transactions.unreviewedCount.queryOptions()).data ?? 0;
  const cashFlow = useQuery({ ...trpc.finance.cashFlow.queryOptions({ range: "6M" }), enabled: hasAccounts }).data;
  const netWorth = useQuery({ ...trpc.finance.netWorthHistory.queryOptions({ timeframe: "1M" }), enabled: hasAccounts }).data;
  const budgets = useQuery(trpc.budgets.forMonth.queryOptions({ monthKey })).data;
  const pace = useQuery(trpc.finance.monthPace.queryOptions({ monthKey })).data;
  const goals = useQuery(trpc.goals.list.queryOptions()).data ?? [];

  const brokenBanks = (items.data ?? []).filter((i) => !i.foreignEnv && i.status !== "active");
  const budgeted = (budgets?.categories ?? []).filter((c) => c.limit !== null);
  const overBudget = budgeted.filter((c) => c.overspent);
  // "Near" = 85%+ of limit; arbitrary threshold for the prototype.
  const nearBudget = budgeted.filter((c) => !c.overspent && c.spent >= c.limit! * 0.85);
  const behindGoals = goals.filter((g) => g.onTrack === false && !g.complete);
  const spentSoFar = pace?.days.findLast((d) => d.cumulative !== null)?.cumulative ?? null;

  return {
    today, monthKey, hasAccounts, unreviewed, cashFlow, netWorth, budgets, pace, goals,
    brokenBanks, budgeted, overBudget, nearBudget, behindGoals, spentSoFar,
  };
}
type Data = ReturnType<typeof useOverviewData>;

export function OverviewPrototype({ variant }: { variant: string }) {
  const data = useOverviewData();
  if (variant === "B") return <VariantB d={data} />;
  if (variant === "C") return <VariantC d={data} />;
  return <VariantA d={data} />;
}

// Stands in for the proposed finance/route.tsx layout header.
function Header() {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Finance</h1>
      <div className="flex items-start gap-2">
        <SyncNowButton />
        <PlaidLinkButton />
      </div>
    </div>
  );
}

// Finance sub-pages live in the sidebar (app-sidebar.tsx), so no variant carries its own page nav.

// ─── A: Briefing ── banners, pace hero, KPI tiles, 5 recent txns.
function VariantA({ d }: { d: Data }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Header />
      <div className="space-y-2">
        {d.unreviewed > 0 && (
          <Banner to="/finance/transactions" search={{ reviewed: false, all: true }}>
            <UnreviewedDot /> {d.unreviewed} to review
          </Banner>
        )}
        {d.brokenBanks.length > 0 && (
          <Banner to="/finance/accounts" danger>
            {d.brokenBanks.map((b) => b.institutionName).join(", ")} needs reconnecting
          </Banner>
        )}
      </div>
      {d.hasAccounts && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">This month</h2>
          <MonthPaceChart monthKey={d.monthKey} />
        </section>
      )}
      {d.hasAccounts && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {d.netWorth && (
            <Link to="/finance/accounts" className="hover:opacity-80">
              <NetWorthTile data={d.netWorth} />
            </Link>
          )}
          {d.cashFlow && <CashFlowTiles data={d.cashFlow} />}
        </div>
      )}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent</h2>
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
  danger,
  children,
}: {
  to: string;
  search?: Record<string, unknown>;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={cn(
        "flex items-center justify-between border px-4 py-3 text-sm hover:bg-muted/50",
        danger && "border-destructive/50 text-destructive",
      )}
    >
      <span className="flex items-center gap-2 font-medium">{children}</span>
      <span className="text-muted-foreground">→</span>
    </Link>
  );
}

// ─── B: Hub ── pace + budget watchlist on the left, a rail of child routes
// (each with one live number) on the right: a status summary beside the sidebar's links.
function VariantB({ d }: { d: Data }) {
  const topGoal = d.goals.find((g) => !g.complete);
  const rail = [
    {
      to: "/finance/transactions",
      label: "Transactions",
      value: d.unreviewed > 0 ? `${d.unreviewed} to review` : "All reviewed",
      alert: d.unreviewed > 0,
      search: d.unreviewed > 0 ? { reviewed: false, all: true } : undefined,
    },
    {
      to: "/finance/spending",
      label: "Spending",
      value: d.cashFlow?.months.at(-1) ? `${usd.format(d.cashFlow.months.at(-1)!.spend)} this month` : "—",
    },
    {
      to: "/finance/budgets",
      label: "Budgets",
      value: d.overBudget.length > 0 ? `${d.overBudget.length} over` : `${d.budgeted.length} on track`,
      alert: d.overBudget.length > 0,
    },
    {
      to: "/finance/accounts",
      label: "Accounts",
      value: d.netWorth?.current != null ? usd.format(d.netWorth.current) : "—",
      alert: d.brokenBanks.length > 0,
      note: d.brokenBanks.length > 0 ? `${d.brokenBanks.length} need reconnect` : undefined,
    },
    {
      to: "/finance/goals",
      label: "Goals",
      value: topGoal ? `${topGoal.name} · ${Math.round(topGoal.percent)}%` : `${d.goals.length} goals`,
      alert: d.behindGoals.length > 0,
    },
  ];
  const watch = [...d.overBudget, ...d.nearBudget];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Header />
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          {d.hasAccounts && <MonthPaceChart monthKey={d.monthKey} />}
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Budget watchlist</h2>
            {watch.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing over or near its limit.</p>
            ) : (
              <ul className="space-y-3">
                {watch.map((c) => (
                  <li key={c.categoryId}>
                    <Link to="/finance/categories/$id" params={{ id: c.categoryId }} className="block space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{c.categoryName}</span>
                        <span className={c.overspent ? "text-destructive" : "text-muted-foreground"}>
                          {usd.format(c.spent)} / {usd.format(c.limit!)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full", c.overspent ? "bg-destructive" : "bg-amber-500")}
                          style={{ width: `${Math.min(100, (c.spent / c.limit!) * 100)}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <nav className="divide-y border md:self-start">
          {rail.map((r) => (
            <Link key={r.to} to={r.to} search={r.search} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                <div className={cn("text-xs tabular-nums", r.alert ? "text-destructive" : "text-muted-foreground")}>
                  {r.value}
                  {r.note && ` · ${r.note}`}
                </div>
              </div>
              <span className="text-muted-foreground">›</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

// ─── C: Inbox ── one sentence of status, then a to-do list of everything that
// needs you. No charts until you ask.
function VariantC({ d }: { d: Data }) {
  const total = d.budgets?.total;
  const [y, m, day] = d.today.split("-").map(Number) as [number, number, number];
  const monthPct = Math.round((day / new Date(y, m, 0).getDate()) * 100);

  const todos: { key: string; to: string; search?: Record<string, unknown>; params?: Record<string, string>; title: string; detail: string; danger?: boolean }[] = [
    ...d.brokenBanks.map((b) => ({
      key: `bank-${b.id}`,
      to: "/finance/accounts",
      title: `Reconnect ${b.institutionName ?? "bank"}`,
      detail: "Syncing has stopped",
      danger: true,
    })),
    ...(d.unreviewed > 0
      ? [{
          key: "review",
          to: "/finance/transactions",
          search: { reviewed: false, all: true },
          title: `Review ${d.unreviewed} transactions`,
          detail: "Categorize or mark reviewed",
        }]
      : []),
    ...d.overBudget.map((c) => ({
      key: `over-${c.categoryId}`,
      to: "/finance/categories/$id",
      params: { id: c.categoryId },
      title: `${c.categoryName} is over budget`,
      detail: `${usd.format(c.spent - c.limit!)} over ${usd.format(c.limit!)}`,
      danger: true,
    })),
    ...d.nearBudget.map((c) => ({
      key: `near-${c.categoryId}`,
      to: "/finance/categories/$id",
      params: { id: c.categoryId },
      title: `${c.categoryName} is close to its limit`,
      detail: `${usd.format(c.limit! - c.spent)} left`,
    })),
    ...d.behindGoals.map((g) => ({
      key: `goal-${g.id}`,
      to: "/finance/goals",
      title: `${g.name} is behind target`,
      detail: `${Math.round(g.percent)}% saved`,
    })),
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4 sm:p-6">
      <div className="space-y-1">
        <Header />
        <p className="text-lg text-muted-foreground">
          {total && total.limitAmount > 0 ? (
            <>
              <span className="font-semibold text-foreground tabular-nums">{usd.format(total.spent)}</span> of{" "}
              {usd.format(total.limitAmount)} budget spent, {monthPct}% through the month.
            </>
          ) : d.spentSoFar !== null ? (
            <>
              <span className="font-semibold text-foreground tabular-nums">{usd.format(d.spentSoFar)}</span> spent this month.
            </>
          ) : (
            "No spending yet this month."
          )}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Needs you · {todos.length}</h2>
        {todos.length === 0 ? (
          <p className="border px-4 py-8 text-center text-muted-foreground">All clear. Nothing to do.</p>
        ) : (
          <ul className="divide-y border">
            {todos.map((t) => (
              <li key={t.key}>
                <Link to={t.to} search={t.search} params={t.params} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <span className={cn("size-2 shrink-0 rounded-full", t.danger ? "bg-destructive" : "bg-amber-500")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.detail}</div>
                  </div>
                  <span className="text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.hasAccounts && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground">Show this month's pace</summary>
          <div className="pt-3">
            <MonthPaceChart monthKey={d.monthKey} />
          </div>
        </details>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {d.netWorth && <NetWorthTile data={d.netWorth} />}
        {d.cashFlow && <CashFlowTiles data={d.cashFlow} />}
        {!d.netWorth && !d.cashFlow && <StatTile title="Accounts" value="—" hint="connect a bank" />}
      </div>

    </div>
  );
}
