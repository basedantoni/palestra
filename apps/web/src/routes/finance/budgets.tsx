import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { BudgetGrid } from "@/components/finance/budget-grid";

export const Route = createFileRoute("/finance/budgets")({
  component: BudgetsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function BudgetsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Budgets</h1>
      <BudgetGrid />
    </div>
  );
}
