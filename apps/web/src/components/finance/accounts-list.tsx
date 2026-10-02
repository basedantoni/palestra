import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { trpc } from "@/utils/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { RECONNECT_MESSAGE, isReconnecting, useReconnectBank } from "./use-reconnect-bank";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Account = {
  id: string;
  plaidItemId: string;
  name: string;
  mask: string | null;
  type: string;
  currentBalance: number | null;
};

type BankItem = { id: string; institutionName: string | null; status: string };

/** A Plaid item is healthy only while active; anything else needs the user's attention. */
function isBroken(status: string): boolean {
  return status !== "active";
}

const STATUS_COPY: Record<string, { short: string; long: string }> = {
  error: {
    short: "Sign-in needed",
    long: "We can't reach your account. Sign in again to resume syncing — transactions since the last sync will catch up automatically.",
  },
  pending_expiration: {
    short: "Expiring soon",
    long: "Your bank's access expires soon. Re-confirm now to avoid a gap in your transactions.",
  },
  revoked: {
    short: "Access revoked",
    // Plaid can't restore revoked access in place — the bank must be linked again.
    long: "Access was turned off from your bank's side. Remove these accounts, then connect the bank again.",
  },
};
const UNKNOWN_STATUS_COPY = STATUS_COPY.error!;

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
  const { data: items } = useQuery(trpc.plaid.listItems.queryOptions());
  const invalidateFinance = useInvalidateFinance();
  const [pendingRemoval, setPendingRemoval] = useState<Account | null>(null);

  const removeAccount = useMutation(
    trpc.plaid.removeAccount.mutationOptions({
      onSuccess: () => {
        // Removal cascades to transactions/goal links and can drop the Plaid item.
        invalidateFinance();
        setPendingRemoval(null);
      },
    }),
  );

  if (isLoading) return <div className="text-muted-foreground">Loading accounts…</div>;
  if (!accounts || accounts.length === 0) {
    return <div className="text-muted-foreground">No accounts connected yet.</div>;
  }

  const groups = groupByBank(accounts, items ?? []);
  const brokenCount = groups.filter((g) => isBroken(g.item.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Net worth</span>
        <span className="text-xl font-semibold tabular-nums">{usd.format(netWorth(accounts))}</span>
      </div>
      {brokenCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-destructive" />
          {brokenCount} {brokenCount === 1 ? "bank needs" : "banks need"} attention
        </div>
      )}
      {groups.map(({ item, accounts: groupAccounts }) => (
        <BankGroup
          key={item.id}
          item={item}
          accounts={groupAccounts}
          onRemove={(a) => {
            removeAccount.reset();
            setPendingRemoval(a);
          }}
        />
      ))}

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

/** Group accounts under their bank, keeping banks in first-seen account order. */
function groupByBank(
  accounts: Account[],
  items: BankItem[],
): Array<{ item: BankItem; accounts: Account[] }> {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, { item: BankItem; accounts: Account[] }>();
  for (const a of accounts) {
    let group = groups.get(a.plaidItemId);
    if (!group) {
      const item = itemById.get(a.plaidItemId) ?? {
        id: a.plaidItemId,
        institutionName: null,
        status: "active",
      };
      group = { item, accounts: [] };
      groups.set(a.plaidItemId, group);
    }
    group.accounts.push(a);
  }
  return [...groups.values()];
}

function BankGroup({
  item,
  accounts,
  onRemove,
}: {
  item: BankItem;
  accounts: Account[];
  onRemove: (account: Account) => void;
}) {
  const reconnect = useReconnectBank(item.id);
  const broken = isBroken(item.status);
  const repairable = broken && item.status !== "revoked";
  const bankName = item.institutionName ?? "Linked bank";
  const copy = STATUS_COPY[item.status] ?? UNKNOWN_STATUS_COPY;
  const message = reconnect.state === "idle" ? null : RECONNECT_MESSAGE[reconnect.state];
  const retry = reconnect.state === "cancelled" || reconnect.state === "failed";

  return (
    <section className={`border ${broken ? "border-destructive/50" : "border-border"}`}>
      <header className="flex items-center justify-between gap-2 bg-muted/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{bankName}</span>
          {broken && (
            <Badge variant="destructive" title={copy.long}>
              {copy.short}
            </Badge>
          )}
        </div>
        {repairable && (
          <Button
            size="xs"
            variant="outline"
            disabled={isReconnecting(reconnect.state)}
            onClick={reconnect.start}
          >
            {isReconnecting(reconnect.state)
              ? "Reconnecting…"
              : retry
                ? "Try again"
                : `Reconnect ${bankName}`}
          </Button>
        )}
      </header>
      {broken && reconnect.state === "idle" && (
        <p className="border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
          {copy.long}
        </p>
      )}
      {message && <p className="border-t border-border px-4 py-1.5 text-xs">{message}</p>}
      <ul className="divide-y divide-border">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between px-4 py-3">
            <div className={`flex flex-col ${broken ? "opacity-60" : ""}`}>
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {a.type}
                {a.mask ? ` ····${a.mask}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`tabular-nums ${broken ? "opacity-60" : ""}`}>
                {a.currentBalance == null ? "—" : usd.format(a.currentBalance)}
                {broken && <span className="ml-1 text-xs text-muted-foreground">(stale)</span>}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemove(a)}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
