import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const queryClient = useQueryClient();
  const [pendingRemoval, setPendingRemoval] = useState<Account | null>(null);

  const removeAccount = useMutation(
    trpc.plaid.removeAccount.mutationOptions({
      onSuccess: () => {
        // Removal cascades to transactions/goal links and can drop the Plaid
        // item, so refresh everything finance-derived.
        for (const queryKey of [
          trpc.plaid.pathKey(),
          trpc.transactions.pathKey(),
          trpc.budgets.pathKey(),
          trpc.goals.pathKey(),
        ]) {
          queryClient.invalidateQueries({ queryKey });
        }
        setPendingRemoval(null);
      },
    }),
  );

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
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {a.currentBalance == null ? "—" : usd.format(a.currentBalance)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${a.name}`}
                onClick={() => {
                  removeAccount.reset();
                  setPendingRemoval(a);
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open && !removeAccount.isPending) setPendingRemoval(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {pendingRemoval?.name}?</DialogTitle>
            <DialogDescription>
              This deletes the account and all of its transactions and balance history. If it's
              the last account from its bank, the bank connection is removed too. Re-connect the
              bank to bring it back.
            </DialogDescription>
          </DialogHeader>
          {removeAccount.isError && (
            <p className="text-xs text-destructive">{removeAccount.error.message}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingRemoval(null)}
              disabled={removeAccount.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingRemoval && removeAccount.mutate({ accountId: pendingRemoval.id })}
              disabled={removeAccount.isPending}
            >
              {removeAccount.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
