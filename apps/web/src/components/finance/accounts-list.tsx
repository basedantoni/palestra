import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Account = {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  currentBalance: number | null;
};

/** Liabilities (credit cards, loans) count against net worth. */
function isLiability(type: string): boolean {
  return type === "credit" || type === "loan";
}

export function netWorth(accounts: Account[]): number {
  return accounts.reduce((sum, a) => {
    const bal = a.currentBalance ?? 0;
    return sum + (isLiability(a.type) ? -bal : bal);
  }, 0);
}

export function AccountsList() {
  const { data: accounts, isLoading } = useQuery(trpc.plaid.listAccounts.queryOptions());

  if (isLoading) return <div className="text-muted-foreground">Loading accounts…</div>;
  if (!accounts || accounts.length === 0) {
    return <div className="text-muted-foreground">No accounts connected yet.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Net worth</span>
        <span className="text-xl font-semibold tabular-nums">{usd.format(netWorth(accounts))}</span>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex flex-col">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {a.type}
                {a.mask ? ` ····${a.mask}` : ""}
              </span>
            </div>
            <span className="tabular-nums">
              {a.currentBalance == null ? "—" : usd.format(a.currentBalance)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
