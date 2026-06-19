import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const FLOW_LABEL: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

export function TransactionFeed({ limit = 50 }: { limit?: number }) {
  const { data: txns, isLoading } = useQuery(
    trpc.transactions.list.queryOptions({ limit }),
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
          className={`flex items-center justify-between px-4 py-3 ${
            t.excluded ? "opacity-50" : ""
          }`}
        >
          <div className="flex flex-col">
            <span className="font-medium">{t.merchantName ?? t.name}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(t.date).toLocaleDateString()} · {t.accountName}
              {t.categoryName ? ` · ${t.categoryName}` : ""}
              {t.flow ? ` · ${FLOW_LABEL[t.flow] ?? t.flow}` : ""}
              {t.pending ? " · pending" : ""}
            </span>
          </div>
          <span className="tabular-nums">{usd.format(t.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
