import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { CategoryMark, categoryColor } from "./category-icon";
import { monthLabel } from "./month-label";
import { MonthlyBars } from "./monthly-bars";

type BudgetRow = RouterOutputs["budgets"]["forMonth"]["categories"][number];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function SpendBar({ spent, limit }: { spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : spent > 0 ? 100 : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${spent > limit ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Budget cards for one month (KOI-284/285): a card per category, with each
 * Parent Category's Subcategories nested under it (KOI-337), the month's
 * Total Budget, and a side sheet to set or remove that month's limit. An empty
 * current or future month offers to copy the latest earlier month's limits
 * (with an Undo).
 */
export function BudgetCards({ month, currentMonth }: { month: string; currentMonth: string }) {
  const queryClient = useQueryClient();
  const forMonth = trpc.budgets.forMonth.queryOptions({ monthKey: month });
  const { data, isLoading } = useQuery(forMonth);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ month: string; fromMonth: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.budgets.pathKey() });

  const carryOver = useMutation(
    trpc.budgets.carryOver.mutationOptions({
      onSuccess: (result, input) => {
        if (result.fromMonth) {
          setCopied({ month: input.monthKey, fromMonth: result.fromMonth });
          refresh();
        }
      },
    }),
  );
  const clearMonth = useMutation(
    trpc.budgets.clearMonth.mutationOptions({
      onSuccess: () => {
        setCopied(null);
        refresh();
      },
    }),
  );

  // Offer to copy the latest earlier month's limits into an empty current or
  // future month. Explicit, so removing or clearing limits always sticks.
  const hasLimits = data?.categories.some((r) => r.limit !== null) ?? true;
  const { data: preview } = useQuery({
    ...trpc.budgets.carryOverPreview.queryOptions({ monthKey: month }),
    enabled: !!data && !hasLimits && month >= currentMonth,
  });

  if (isLoading || !data) return <div className="text-muted-foreground">Loading budgets…</div>;

  const rows = data.categories;
  const { limitAmount: totalLimit, spent: totalSpent } = data.total;
  const open = rows.find((r) => r.categoryId === openId) ?? null;
  const card = (r: BudgetRow) => <BudgetCard key={r.categoryId} row={r} onOpen={() => setOpenId(r.categoryId)} />;

  return (
    <div className="space-y-4">
      {copied?.month === month && (
        <div className="flex items-center justify-between border border-border bg-muted/40 px-3 py-2 text-xs">
          <span>Limits copied from {monthLabel(copied.fromMonth, "MMMM yyyy")}.</span>
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={clearMonth.isPending}
            onClick={() => clearMonth.mutate({ monthKey: month })}
          >
            Undo
          </button>
        </div>
      )}

      {!hasLimits && preview && (
        <div className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-border px-3 py-3 text-sm">
          <span>No limits for {monthLabel(month, "MMMM yyyy")} yet.</span>
          <Button
            size="sm"
            disabled={carryOver.isPending}
            onClick={() => carryOver.mutate({ monthKey: month })}
          >
            Copy {monthLabel(preview.fromMonth, "MMMM")}'s limits ({preview.count})
          </Button>
        </div>
      )}

      {hasLimits ? (
        <div className="flex items-baseline justify-between border-b border-border pb-2 text-sm">
          <span className="text-muted-foreground">Budgeted</span>
          <span className="tabular-nums">
            <span className={totalSpent > totalLimit ? "text-destructive" : ""}>{usd.format(totalSpent)}</span> /{" "}
            {usd.format(totalLimit)}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Tap a category to set a limit.</p>
      )}

      <div className="grid items-start gap-2 sm:grid-cols-2">
        {rows
          .filter((r) => !r.parentId)
          .map((parent) => {
            const subcategories = rows.filter((r) => r.parentId === parent.categoryId);
            if (subcategories.length === 0) return card(parent);
            return (
              <div key={parent.categoryId} className="space-y-2">
                {card(parent)}
                <div className="ms-4 space-y-2 border-s border-border ps-2">{subcategories.map(card)}</div>
              </div>
            );
          })}
      </div>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="space-y-5 p-5">
          {open && (
            <BudgetSheetBody
              key={`${open.categoryId}:${month}`}
              row={open}
              month={month}
              onDone={() => {
                setCopied(null); // edits supersede the carry-over Undo
                setOpenId(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** One category's card: its spend against its limit, or a prompt to set one. A parent's spend includes its Subcategories'. */
function BudgetCard({ row: r, onOpen }: { row: BudgetRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full space-y-2 rounded-md border p-3 text-left hover:bg-muted/40 ${
        r.limit === null ? "border-dashed border-border" : r.overspent ? "border-destructive/50" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <CategoryMark category={r} />
        <span className="truncate">{r.categoryName}</span>
      </div>
      {r.limit !== null ? (
        <>
          <SpendBar spent={r.spent} limit={r.limit} />
          <div className={`text-xs tabular-nums ${r.overspent ? "text-destructive" : "text-muted-foreground"}`}>
            {usd.format(r.spent)} of {usd.format(r.limit)}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">{usd.format(r.spent)} spent · tap to set a limit</div>
      )}
    </button>
  );
}

function BudgetSheetBody({ row, month, onDone }: { row: BudgetRow; month: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(row.limit !== null ? String(row.limit) : "");
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: trpc.budgets.pathKey() });
    onDone();
  };
  const upsert = useMutation(trpc.budgets.upsert.mutationOptions({ onSuccess }));
  const remove = useMutation(trpc.budgets.remove.mutationOptions({ onSuccess }));
  const { data: history } = useQuery(
    trpc.budgets.history.queryOptions({ categoryId: row.categoryId, monthKey: month, months: 6 }),
  );
  const amount = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(amount) && amount >= 0;
  const error = upsert.error ?? remove.error;

  return (
    <>
      <SheetHeader className="p-0">
        <SheetTitle className="text-base">{row.categoryName}</SheetTitle>
        <Link
          to="/finance/categories/$id"
          params={{ id: row.categoryId }}
          className="text-sm text-muted-foreground hover:underline"
        >
          View category →
        </Link>
      </SheetHeader>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">{monthLabel(month, "MMMM yyyy")} limit</h4>
        <input
          type="number"
          min={0}
          step="1"
          inputMode="decimal"
          aria-label="Monthly limit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="No limit"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
        />
        <p className="text-xs text-muted-foreground">{usd.format(row.spent)} spent so far this month.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!valid || upsert.isPending}
            onClick={() => upsert.mutate({ categoryId: row.categoryId, monthKey: month, limitAmount: amount })}
          >
            Save
          </Button>
          {row.limit !== null && (
            <Button
              size="sm"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ categoryId: row.categoryId, monthKey: month })}
            >
              Remove for {monthLabel(month, "MMMM")}
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error.message}</p>}
      </section>

      <section className="space-y-1">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Last 6 months</h4>
        {history && <MonthlyBars data={history} color={categoryColor(row.color, row.tint)} height={140} />}
      </section>
    </>
  );
}
