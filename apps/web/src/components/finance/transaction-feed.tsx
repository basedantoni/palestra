import { type ReactNode, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, Split, StickyNote } from "lucide-react";

import { buildFeedDays, type FeedEntry, type TransactionPeriod } from "@life-tracker/shared";
import { flowTakesNoCategory, suggestPattern, validatePattern } from "@life-tracker/api/lib/rules";
import { splitIneligibility } from "@life-tracker/api/lib/splits";
import { TRANSACTION_FLOWS, type TransactionFlow } from "@life-tracker/api/lib/transaction-flow";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { CategoryPicker } from "./category-picker";
import { FLOW_LABELS, RuleForm, type RuleSuggestion } from "./rule-list";
import { SplitEditor } from "./split-editor";

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
  /** false = the Unreviewed queue. */
  reviewed?: boolean;
};

type Txn = RouterOutputs["transactions"]["list"]["items"][number];

/**
 * Day-grouped transaction ledger (KOI-277/278/279). Rows expand in place to
 * edit the note, category and budget exclusion; matched transfer legs collapse
 * into one row; a split transaction lists its Splits, which open its editor
 * (KOI-343); "Load more" pages back through history.
 */
export function TransactionFeed(props: {
  pageSize?: number;
  filters?: TransactionFilters;
  /** Off for compact previews (e.g. the overview's recent transactions). */
  loadMore?: boolean;
}) {
  // The rule offer lives above the list: a recategorized row can leave a
  // filtered feed (e.g. Uncategorized) before the user answers.
  const [offerRule, ruleDialog] = useRuleOffer();
  return (
    <>
      <FeedList {...props} onRecategorized={offerRule} />
      {ruleDialog}
    </>
  );
}

function FeedList({
  pageSize = 50,
  filters = {},
  loadMore = true,
  onRecategorized,
}: {
  pageSize?: number;
  filters?: TransactionFilters;
  loadMore?: boolean;
  onRecategorized: OnRecategorized;
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
              <FeedItem
                key={entryKey(entry)}
                entry={entry}
                expanded={expanded}
                onToggle={toggle}
                onRecategorized={onRecategorized}
              />
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
  onRecategorized,
}: {
  entry: FeedEntry<Txn>;
  expanded: string | null;
  onToggle: (key: string) => void;
  onRecategorized: OnRecategorized;
}) {
  const key = entryKey(entry);
  const open = expanded === key;

  if (entry.kind === "pair") {
    const unreviewedLegs = [entry.out, entry.in].filter((leg) => !leg.reviewed);
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
            {unreviewedLegs.length > 0 && <UnreviewedDot />}
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
            <li className="flex items-center justify-between gap-3 pt-1 text-[10px]">
              Matched transfer — not counted as spending.
              {unreviewedLegs.length > 0 && <MarkReviewedButton ids={unreviewedLegs.map((leg) => leg.id)} />}
            </li>
          </ul>
        )}
      </li>
    );
  }

  const t = entry.txn;
  const isSplit = t.splits.length > 0;
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
            {!t.reviewed && <UnreviewedDot />}
            {t.merchantName ?? t.name}
            {t.note && <StickyNote className="size-3 shrink-0 text-amber-500" aria-label="Has note" />}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {isSplit
              ? `Split in ${t.splits.length}`
              : t.flow && flowTakesNoCategory(t.flow)
                ? FLOW_LABELS[t.flow]
                : (t.categoryName ?? "Uncategorized")}{" "}
            · {t.accountName}
            {t.pending ? " · pending" : ""}
            {t.excluded ? " · excluded" : ""}
          </span>
          {t.note && !open && <span className="truncate text-xs italic text-muted-foreground">“{t.note}”</span>}
        </span>
        <span className={`shrink-0 text-sm tabular-nums ${t.flow === "income" ? "text-green-600" : ""}`}>
          {formatAmount(t.amount)}
        </span>
      </button>
      {isSplit && (
        // Each Split opens its parent's editor: they're edited together.
        <ul className="pb-2 pl-8 pr-4">
          {t.splits.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => !open && onToggle(key)}
                className={`flex w-full items-center justify-between gap-3 py-0.5 text-left text-xs text-muted-foreground ${s.excluded ? "opacity-50" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <Split className="size-3 shrink-0" aria-hidden />
                  {s.categoryName ?? "Uncategorized"}
                  {s.note && <span className="truncate italic">· “{s.note}”</span>}
                </span>
                <span className="shrink-0 tabular-nums">{formatAmount(s.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <TransactionEditor txn={t} onRecategorized={onRecategorized} />
        </div>
      )}
    </li>
  );
}

/** Marks an Unreviewed row in the feed. */
export function UnreviewedDot() {
  return <span role="img" aria-label="Unreviewed" title="Unreviewed" className="size-2 shrink-0 rounded-full bg-primary" />;
}

/** Clear Unreviewed without editing anything: a row, or both legs of a Transfer Pair. */
function MarkReviewedButton({ ids }: { ids: string[] }) {
  const markReviewed = useMutation(
    trpc.transactions.markReviewed.mutationOptions({ onSuccess: useInvalidateFinance() }),
  );
  return (
    <Button size="xs" variant="outline" disabled={markReviewed.isPending} onClick={() => markReviewed.mutate({ ids })}>
      Mark reviewed
    </Button>
  );
}

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
        setFlow.mutate({ id: txn.id, flow: v === "auto" ? null : (v as TransactionFlow) });
      }}
      className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs disabled:opacity-50"
    >
      <option value="auto">
        Automatic{!txn.flowOverridden && txn.flow ? ` (${FLOW_LABELS[txn.flow]})` : ""}
      </option>
      {TRANSACTION_FLOWS.map((f) => (
        <option key={f} value={f}>
          {FLOW_LABELS[f]}
        </option>
      ))}
    </select>
  );
}

/** Note, flow, category and budget-exclusion editing for one transaction. */
function TransactionEditor({ txn, onRecategorized }: { txn: Txn; onRecategorized: OnRecategorized }) {
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const onSuccess = useInvalidateFinance();
  const setCategory = useMutation(
    trpc.transactions.setCategory.mutationOptions({
      onSuccess: (_, { categoryId }) => {
        onSuccess();
        // Uncategorized (null) gets no rule offer.
        if (categoryId) onRecategorized(txn, categoryId);
      },
    }),
  );
  const resetCategory = useMutation(trpc.transactions.resetCategory.mutationOptions({ onSuccess }));
  const setExcluded = useMutation(trpc.transactions.setExcluded.mutationOptions({ onSuccess }));
  const setNote = useMutation(trpc.transactions.setNote.mutationOptions({ onSuccess }));
  const unsplit = useMutation(trpc.transactions.unsplit.mutationOptions({ onSuccess }));
  const [splitting, setSplitting] = useState(false);
  const isSplit = txn.splits.length > 0;
  const canSplit = splitIneligibility(txn) === null;
  const markReviewed = !txn.reviewed && (
    <span className="ml-auto">
      <MarkReviewedButton ids={[txn.id]} />
    </span>
  );

  return (
    <div className="space-y-2">
      {splitting && <SplitEditor txn={txn} onClose={() => setSplitting(false)} />}
      {isSplit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="xs" variant="outline" onClick={() => setSplitting(true)}>
            Edit split
          </Button>
          <Button size="xs" variant="ghost" disabled={unsplit.isPending} onClick={() => unsplit.mutate({ id: txn.id })}>
            Unsplit
          </Button>
          {markReviewed}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <FlowPicker txn={txn} />
          {!flowTakesNoCategory(txn.flow) && (
            <CategoryPicker
              size="xs"
              aria-label="Category"
              categories={categories}
              value={txn.categoryId ?? ""}
              onChange={(categoryId) => setCategory.mutate({ id: txn.id, categoryId: categoryId || null })}
              extras={[{ value: "", label: "Uncategorized", uncategorized: true }]}
            />
          )}
          {txn.categoryOverridden && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              Manual ·
              <button
                type="button"
                disabled={resetCategory.isPending}
                onClick={() => resetCategory.mutate({ id: txn.id })}
                className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              >
                Reset to automatic
              </button>
            </span>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={txn.excludedByHand}
              onChange={(e) => setExcluded.mutate({ id: txn.id, excluded: e.target.checked })}
            />
            Exclude from totals
          </label>
          {txn.excluded && !txn.excludedByHand && (
            <span className="text-xs text-muted-foreground">Excluded with its category</span>
          )}
          {canSplit && (
            <Button size="xs" variant="outline" onClick={() => setSplitting(true)}>
              <Split /> Split
            </Button>
          )}
          {markReviewed}
        </div>
      )}
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

type OnRecategorized = (txn: Txn, categoryId: string) => void;

/**
 * "Always categorize like this?" after a recategorize (KOI-300): a toast
 * offering a contains rule for the suggested Pattern, skipped when that
 * Pattern couldn't be saved (too short, or a rule already has it). Accepting
 * opens the rule form prefilled, its exact toggle offering the whole trimmed
 * description (KOI-339); dismissing leaves just the Manual Category.
 */
function useRuleOffer(): [OnRecategorized, ReactNode] {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RuleSuggestion | null>(null);
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const { data: rules } = useQuery({ ...trpc.rules.list.queryOptions(), enabled: !!draft });

  const offer: OnRecategorized = async (txn, categoryId) => {
    const current = await queryClient.fetchQuery(trpc.rules.list.queryOptions());
    const valid = validatePattern(suggestPattern(txn.name, txn.merchantName), "contains", current);
    if (!valid.ok) return;
    const categoryName = categories?.find((c) => c.id === categoryId)?.name ?? "this category";
    toast(`Always categorize transactions containing “${valid.pattern}” as ${categoryName}?`, {
      id: "rule-offer",
      action: {
        label: "Create rule",
        onClick: () => setDraft({ pattern: valid.pattern, exactPattern: txn.name.trim(), categoryId }),
      },
      cancel: { label: "Dismiss", onClick: () => {} },
    });
  };

  const dialog = (
    <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
        </DialogHeader>
        {draft && rules && categories && (
          <RuleForm rules={rules} categories={categories} suggested={draft} onDone={() => setDraft(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
  return [offer, dialog];
}
