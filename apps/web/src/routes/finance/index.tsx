import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { AccountsList } from "@/components/finance/accounts-list";
import { BudgetGrid } from "@/components/finance/budget-grid";
import { GoalsList } from "@/components/finance/goals-list";
import { TransactionFeed } from "@/components/finance/transaction-feed";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";

export const Route = createFileRoute("/finance/")({
  component: FinanceOverview,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function Section({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link to={to} className="text-sm text-muted-foreground hover:underline">
          View all
        </Link>
      </div>
      {children}
    </section>
  );
}

function FinanceOverview() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finance</h1>
        <PlaidLinkButton />
      </div>
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
        <TransactionFeed limit={10} />
      </Section>
    </div>
  );
}
