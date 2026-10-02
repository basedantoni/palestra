import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, StickyNote } from "lucide-react";

import { buildFeedDays, type FeedEntry, type TransactionPeriod } from "@life-tracker/shared";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Plaid sign: positive = money out. Money in is shown as "+$x". */
function formatAmount(amount: number): string {
  return amount < 0 ? `+${usd.format(-amount)}` : usd.format(amount);
}

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export type TransactionFilters = {
  period?: TransactionPeriod;
  accountIds?: string[];
  /** null = Uncategorized. */
  categoryId?: string | null;
};

type Txn = RouterOutputs["transactions"]["list"]["items"][number];

/**
 * Day-grouped transaction ledger (KOI-277/278/279). Rows expand in place to
 * edit the note, category and budget exclusion; matched transfer legs collapse
 * into one row; "Load more" pages back through history.
 */
export function TransactionFeed({
  pageSize = 50,
  filters = {},
  loadMore = true,
}: {
  pageSize?: number;
  filters?: TransactionFilters;
  /** Off for compact previews (e.g. the overview's recent transactions). */
  loadMore?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const feed = useInfiniteQuery(
    trpc.transactions.list.infiniteQueryOptions(
      { limit: pageSize, ...filters },
      { getNextPageParam: (page) => page.nextCursor },
    ),
  );

  if (feed.isLoading) return <div className="text-muted-foreground">Loading transactions…</div>;
  const rows = feed.data?.pages.flatMap((p) => p.items) ?? [];
  if (rows.length === 0) {
    return <div className="text-muted-foreground">No matching transactions.</div>;
  }

  const toggle = (key: string) => setExpanded((k) => (k === key ? null : key));

  return (
    <div className="space-y-4">
      {/* The oldest loaded day may continue on the next page — hide its partial total. */}
      {buildFeedDays(rows, { complete: !feed.hasNextPage }).map((day) => (
        <section key={day.date}>
          <header className="flex justify-between px-1 pb-1 text-xs font-semibold text-muted-foreground">
            <span>{formatDay(day.date)}</span>
            {day.spent !== null && day.spent > 0 && <span className="tabular-nums">{usd.format(day.spent)} spent</span>}
          </header>
          <ul className="divide-y divide-border border border-border">
            {day.entries.map((entry) => (
              <FeedItem key={entryKey(entry)} entry={entry} expanded={expanded} onToggle={toggle} />
            ))}
          </ul>
        </section>
      ))}
      {loadMore &&
        (feed.hasNextPage ? (
          <Button
            variant="outline"
            className="w-full"
            disabled={feed.isFetchingNextPage}
            onClick={() => feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">That's everything.</p>
        ))}
    </div>
  );
}

function entryKey(entry: FeedEntry<Txn>): string {
  return entry.kind === "pair" ? `pair:${entry.out.transferPairId}` : entry.txn.id;
}

function FeedItem({
  entry,
  expanded,
  onToggle,
}: {
  entry: FeedEntry<Txn>;
  expanded: string | null;
  onToggle: (key: string) => void;
}) {
  const key = entryKey(entry);
  const open = expanded === key;

  if (entry.kind === "pair") {
    return (
      <li className="border-l-2 border-l-blue-500">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(key)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
            <span className="truncate font-medium">{entry.out.accountName}</span>
            <ArrowRight className="size-3.5 shrink-0 text-blue-600" aria-label="to" />
            <span className="truncate font-medium">{entry.in.accountName}</span>
          </span>
          <span className="shrink-0 tabular-nums text-blue-600">{usd.format(entry.out.amount)}</span>
        </button>
        {open && (
          <ul className="space-y-1 bg-muted/30 px-10 py-2 text-xs text-muted-foreground">
            {[entry.out, entry.in].map((leg) => (
              <li key={leg.id} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {leg.merchantName ?? leg.name} · {leg.accountName}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <FlowPicker txn={leg} />
                  <span className="tabular-nums">{formatAmount(leg.amount)}</span>
                </span>
              </li>
            ))}
            <li className="pt-1 text-[10px]">Matched transfer — not counted as spending.</li>
          </ul>
        )}
      </li>
    );
  }

  const t = entry.txn;
  const edge =
    t.flow === "income" ? "border-l-green-500" : t.flow === "transfer" ? "border-l-blue-500" : "border-l-transparent";
  return (
    <li className={`border-l-2 ${edge} ${t.excluded ? "opacity-50" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(key)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
            {t.merchantName ?? t.name}
            {t.note && <StickyNote className="size-3 shrink-0 text-amber-500" aria-label="Has note" />}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {t.flow === "transfer" ? "Transfer" : (t.categoryName ?? "Uncategorized")} · {t.accountName}
            {t.pending ? " · pending" : ""}
            {t.excluded ? " · excluded" : ""}
          </span>
          {t.note && !open && <span className="truncate text-xs italic text-muted-foreground">“{t.note}”</span>}
        </span>
        <span className={`shrink-0 text-sm tabular-nums ${t.flow === "income" ? "text-green-600" : ""}`}>
          {formatAmount(t.amount)}
        </span>
      </button>
      {open && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <TransactionEditor txn={t} />
        </div>
      )}
    </li>
  );
}

const FLOW_LABELS = { income: "Income", expense: "Expense", transfer: "Transfer" } as const;
type Flow = keyof typeof FLOW_LABELS;

/**
 * Correct a transaction's flow, or return it to "Automatic" (Plaid-derived).
 * Disabled while pending: posting issues a new Plaid id and would drop it.
 */
function FlowPicker({ txn }: { txn: Txn }) {
  const setFlow = useMutation(
    trpc.transactions.setFlow.mutationOptions({ onSuccess: useInvalidateFinance() }),
  );
  return (
    <select
      aria-label="Flow"
      title={txn.pending ? "Flow can be changed once the transaction posts" : undefined}
      disabled={txn.pending || setFlow.isPending}
      value={txn.flowOverridden && txn.flow ? txn.flow : "auto"}
      onChange={(e) => {
        const v = e.target.value;
        setFlow.mutate({ id: txn.id, flow: v === "auto" ? null : (v as Flow) });
      }}
      className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs disabled:opacity-50"
    >
      <option value="auto">
        Automatic{!txn.flowOverridden && txn.flow ? ` (${FLOW_LABELS[txn.flow]})` : ""}
      </option>
      {(Object.keys(FLOW_LABELS) as Flow[]).map((f) => (
        <option key={f} value={f}>
          {FLOW_LABELS[f]}
        </option>
      ))}
    </select>
  );
}

/** Note, flow, category and budget-exclusion editing for one transaction. */
function TransactionEditor({ txn }: { txn: Txn }) {
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const onSuccess = useInvalidateFinance();
  const setCategory = useMutation(trpc.transactions.setCategory.mutationOptions({ onSuccess }));
  const setExcluded = useMutation(trpc.transactions.setExcluded.mutationOptions({ onSuccess }));
  const setNote = useMutation(trpc.transactions.setNote.mutationOptions({ onSuccess }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <FlowPicker txn={txn} />
        {txn.flow !== "transfer" && (
          <select
            aria-label="Category"
            value={txn.categoryId ?? ""}
            onChange={(e) => setCategory.mutate({ id: txn.id, categoryId: e.target.value || null })}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs"
          >
            <option value="">Uncategorized</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={txn.excluded}
            onChange={(e) => setExcluded.mutate({ id: txn.id, excluded: e.target.checked })}
          />
          Exclude from budgets
        </label>
      </div>
      <textarea
        aria-label="Note"
        defaultValue={txn.note ?? ""}
        onBlur={(e) => {
          const note = e.target.value.trim() || null;
          if (note !== txn.note) setNote.mutate({ id: txn.id, note });
        }}
        placeholder="Add a note…"
        maxLength={500}
        rows={2}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <p className="text-[10px] text-muted-foreground">
        {setNote.isPending ? "Saving…" : setNote.isError ? "Couldn't save the note — try again." : "Saves when you click away."}
      </p>
    </div>
  );
}
