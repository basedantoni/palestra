import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const FLOW_LABEL: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

export function TransactionFeed({ limit = 50 }: { limit?: number }) {
  const queryClient = useQueryClient();
  const { data: txns, isLoading } = useQuery(
    trpc.transactions.list.queryOptions({ limit }),
  );
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());

  // Matches all `limit` variants of the transactions list.
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.transactions.list.queryOptions({ limit }).queryKey.slice(0, 1),
    });

  const setCategory = useMutation(
    trpc.transactions.setCategory.mutationOptions({ onSuccess: invalidate }),
  );
  const setExcluded = useMutation(
    trpc.transactions.setExcluded.mutationOptions({ onSuccess: invalidate }),
  );

  if (isLoading) return <div className="text-muted-foreground">Loading transactions…</div>;
  if (!txns || txns.length === 0) {
    return <div className="text-muted-foreground">No transactions yet.</div>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {txns.map((t) => (
        <li
          key={t.id}
          className={`flex items-center justify-between gap-3 px-4 py-3 ${
            t.excluded ? "opacity-50" : ""
          }`}
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{t.merchantName ?? t.name}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(t.date).toLocaleDateString()} · {t.accountName}
              {t.flow ? ` · ${FLOW_LABEL[t.flow] ?? t.flow}` : ""}
              {t.pending ? " · pending" : ""}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <select
              value={t.categoryId ?? ""}
              onChange={(e) =>
                setCategory.mutate({ id: t.id, categoryId: e.target.value || null })
              }
              className="rounded-md border border-border bg-background px-1 py-0.5 text-xs"
            >
              <option value="">Uncategorized</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Exclude from budgets">
              <input
                type="checkbox"
                checked={t.excluded}
                onChange={(e) => setExcluded.mutate({ id: t.id, excluded: e.target.checked })}
              />
              excl
            </label>
            <span className="w-20 text-right tabular-nums">{usd.format(t.amount)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
