import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { AccountsList } from "@/components/finance/accounts-list";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";

export const Route = createFileRoute("/finance/accounts")({
  component: AccountsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function AccountsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <PlaidLinkButton />
      </div>
      <AccountsList />
    </div>
  );
}
