import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { TransactionFeed } from "@/components/finance/transaction-feed";

export const Route = createFileRoute("/finance/transactions")({
  component: TransactionsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function TransactionsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Transactions</h1>
      <TransactionFeed limit={100} />
    </div>
  );
}
