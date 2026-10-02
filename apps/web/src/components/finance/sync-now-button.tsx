import { useMutation } from "@tanstack/react-query";

import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

/**
 * Pulls the latest transactions and balances from Plaid for every linked bank,
 * instead of waiting on Plaid's webhook. Banks that fail are listed inline with
 * the reason; banks that synced still refresh.
 */
export function SyncNowButton() {
  const invalidateFinance = useInvalidateFinance();
  const syncNow = useMutation(trpc.plaid.syncNow.mutationOptions({ onSettled: invalidateFinance }));

  const failures = (syncNow.data ?? []).filter((r) => !r.ok);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={() => syncNow.mutate({})} disabled={syncNow.isPending}>
        {syncNow.isPending ? "Syncing…" : "Sync now"}
      </Button>
      {syncNow.isError && <span className="text-xs text-destructive">{syncNow.error.message}</span>}
      {failures.map((f) => (
        <span key={f.plaidItemId} className="max-w-xs text-right text-xs text-destructive">
          {f.institutionName ?? "A bank"} failed to sync{"error" in f ? `: ${f.error}` : ""}
        </span>
      ))}
    </div>
  );
}
