import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { TRANSACTION_PERIOD_PRESETS, type TransactionPeriod } from "@life-tracker/shared";
import { authClient } from "@/lib/auth-client";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc } from "@/utils/trpc";
import { TransactionFeed } from "@/components/finance/transaction-feed";
import { TransactionPeriodPicker } from "@/components/finance/transaction-period-picker";

/** `category` value for transactions with no category (sent to the API as null). */
const UNCATEGORIZED = "uncategorized";

// Filters live in the URL so a filtered view survives reloads and can be shared.
// No period params = the current month.
const transactionsSearchSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().catch(undefined),
  preset: z.enum(TRANSACTION_PERIOD_PRESETS).optional().catch(undefined),
  all: z.boolean().optional().catch(undefined),
  accounts: z.array(z.string().uuid()).optional().catch(undefined),
  category: z.union([z.string().uuid(), z.literal(UNCATEGORIZED)]).optional().catch(undefined),
});
type TransactionsSearch = z.infer<typeof transactionsSearchSchema>;

export const Route = createFileRoute("/finance/transactions")({
  validateSearch: (search) => transactionsSearchSchema.parse(search),
  component: TransactionsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function searchToPeriod(search: TransactionsSearch, today: string): TransactionPeriod {
  if (search.all) return { kind: "all" };
  if (search.preset) return { kind: "preset", preset: search.preset };
  const month = search.month && search.month <= today.slice(0, 7) ? search.month : today.slice(0, 7);
  return { kind: "month", month };
}

function periodToSearch(period: TransactionPeriod, today: string): Partial<TransactionsSearch> {
  const cleared = { month: undefined, preset: undefined, all: undefined };
  if (period.kind === "all") return { ...cleared, all: true };
  if (period.kind === "preset") return { ...cleared, preset: period.preset };
  // The current month is the default, so keep it out of the URL.
  return { ...cleared, month: period.month === today.slice(0, 7) ? undefined : period.month };
}

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
  };
  const { data: summary } = useQuery(trpc.transactions.summary.queryOptions(filters));

  const update = (next: Partial<TransactionsSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  const toggleAccount = (id: string) => {
    const next = accountIds.includes(id) ? accountIds.filter((a) => a !== id) : [...accountIds, id];
    update({ accounts: next.length > 0 ? next : undefined });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Transactions</h1>
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
        <select
          value={search.category ?? ""}
          onChange={(e) => update({ category: e.target.value || undefined })}
          className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All categories</option>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <TransactionFeed filters={filters} />
    </div>
  );
}
