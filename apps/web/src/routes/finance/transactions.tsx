import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { periodToSearch, searchToPeriod, transactionPeriodSearchSchema } from "@life-tracker/shared";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/finance/category-picker";
import { TransactionFeed } from "@/components/finance/transaction-feed";
import { TransactionPeriodPicker } from "@/components/finance/transaction-period-picker";

/** `category` value for transactions with no category (sent to the API as null). */
const UNCATEGORIZED = "uncategorized";

// Filters live in the URL so a filtered view survives reloads and can be shared.
// No period params = the current month.
const transactionsSearchSchema = transactionPeriodSearchSchema.extend({
  accounts: z.array(z.string().uuid()).optional().catch(undefined),
  category: z.union([z.string().uuid(), z.literal(UNCATEGORIZED)]).optional().catch(undefined),
  /** false = the Unreviewed queue (KOI-342). */
  reviewed: z.boolean().optional().catch(undefined),
});
type TransactionsSearch = z.infer<typeof transactionsSearchSchema>;

export const Route = createFileRoute("/finance/transactions")({
  validateSearch: (search) => transactionsSearchSchema.parse(search),
  component: TransactionsPage,
});

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = useFinanceToday();
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const { data: accounts } = useQuery(trpc.plaid.listAccounts.queryOptions());

  const period = searchToPeriod(search, today);
  // Ignore ids for accounts that no longer exist (e.g. removed since the link
  // was saved) — otherwise the feed filters to nothing with no chip to clear.
  const accountIds = (search.accounts ?? []).filter(
    (id) => !accounts || accounts.some((a) => a.id === id),
  );
  const filters = {
    period,
    accountIds,
    categoryId: search.category === UNCATEGORIZED ? null : search.category,
    reviewed: search.reviewed,
  };
  const { data: summary } = useQuery(trpc.transactions.summary.queryOptions(filters));
  const { data: unreviewed } = useQuery(trpc.transactions.unreviewedCount.queryOptions());
  const markAllReviewed = useMutation(
    trpc.transactions.markAllReviewed.mutationOptions({ onSuccess: useInvalidateFinance() }),
  );

  const update = (next: Partial<TransactionsSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  const toggleAccount = (id: string) => {
    const next = accountIds.includes(id) ? accountIds.filter((a) => a !== id) : [...accountIds, id];
    update({ accounts: next.length > 0 ? next : undefined });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Transactions</h1>
        {!!unreviewed && (
          <Button
            variant="outline"
            size="sm"
            disabled={markAllReviewed.isPending}
            onClick={() => markAllReviewed.mutate()}
          >
            Mark all reviewed
          </Button>
        )}
      </div>
      <TransactionPeriodPicker
        period={period}
        today={today}
        onChange={(next) => update(periodToSearch(next, today))}
      />
      <div className="text-sm text-muted-foreground">
        {summary
          ? `${summary.count} ${summary.count === 1 ? "transaction" : "transactions"} · ${usd.format(summary.spent)} spent`
          : " "}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(search.reviewed === false || !!unreviewed) && (
          <button
            type="button"
            aria-pressed={search.reviewed === false}
            // The queue (and its count) spans all time.
            onClick={() =>
              update(search.reviewed === false ? { reviewed: undefined } : { reviewed: false, ...periodToSearch({ kind: "all" }, today) })
            }
            className={`rounded-full border px-3 py-1 text-xs ${
              search.reviewed === false ? "border-primary bg-primary text-primary-foreground" : "border-border"
            }`}
          >
            To review{unreviewed ? ` (${unreviewed})` : ""}
          </button>
        )}
        {(accounts ?? []).map((a) => {
          const on = accountIds.includes(a.id);
          return (
            <button
              type="button"
              key={a.id}
              aria-pressed={on}
              onClick={() => toggleAccount(a.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border"
              }`}
            >
              {a.name}
              {a.mask ? ` ····${a.mask}` : ""}
            </button>
          );
        })}
        <CategoryPicker
          size="xs"
          aria-label="Filter by category"
          className="ml-auto"
          categories={categories}
          value={search.category ?? ""}
          onChange={(category) => update({ category: category || undefined })}
          extras={[
            { value: "", label: "All categories" },
            { value: UNCATEGORIZED, label: "Uncategorized", uncategorized: true },
          ]}
        />
      </div>
      <TransactionFeed filters={filters} />
    </div>
  );
}
