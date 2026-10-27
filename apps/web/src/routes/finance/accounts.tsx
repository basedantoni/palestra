import { createFileRoute } from "@tanstack/react-router";

import { AccountsList } from "@/components/finance/accounts-list";
import { NetWorthChart } from "@/components/finance/net-worth";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";
import { SyncNowButton } from "@/components/finance/sync-now-button";

export const Route = createFileRoute("/finance/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <div className="flex items-start gap-2">
          <SyncNowButton />
          <PlaidLinkButton />
        </div>
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Net worth</h2>
        <NetWorthChart />
      </section>
      <AccountsList />
    </div>
  );
}
