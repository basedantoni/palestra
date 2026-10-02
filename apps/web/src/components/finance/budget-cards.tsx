import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { monthLabel } from "./month-label";

type BudgetRow = RouterOutputs["budgets"]["forMonth"][number];

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
 * Budget cards for one month (KOI-284/285): a card per category, a month
 * total, and a side sheet to set or remove that month's limit. An empty
 * current or future month offers to copy the latest earlier month's limits
 * (with an Undo).
 */
export function BudgetCards({ month, currentMonth }: { month: string; currentMonth: string }) {
  const queryClient = useQueryClient();
  const forMonth = trpc.budgets.forMonth.queryOptions({ monthKey: month });
  const { data: rows, isLoading } = useQuery(forMonth);
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
  const hasLimits = rows?.some((r) => r.limit !== null) ?? true;
  const { data: preview } = useQuery({
    ...trpc.budgets.carryOverPreview.queryOptions({ monthKey: month }),
    enabled: !!rows && !hasLimits && month >= currentMonth,
  });

  if (isLoading || !rows) return <div className="text-muted-foreground">Loading budgets…</div>;

  const budgeted = rows.filter((r): r is BudgetRow & { limit: number } => r.limit !== null);
  const totalLimit = budgeted.reduce((s, r) => s + r.limit, 0);
  const totalSpent = budgeted.reduce((s, r) => s + r.spent, 0);
  const open = rows.find((r) => r.categoryId === openId) ?? null;

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

      {budgeted.length === 0 && preview && (
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

      {budgeted.length > 0 ? (
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

      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <button
            type="button"
            key={r.categoryId}
            onClick={() => setOpenId(r.categoryId)}
            className={`space-y-2 rounded-md border p-3 text-left hover:bg-muted/40 ${
              r.limit === null ? "border-dashed border-border" : r.overspent ? "border-destructive/50" : "border-border"
            }`}
          >
            <div className="text-sm font-medium">{r.categoryName}</div>
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
        ))}
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
  const peak = Math.max(1, ...(history ?? []).flatMap((h) => [h.spent, h.limit ?? 0]));
  const error = upsert.error ?? remove.error;

  return (
    <>
      <SheetHeader className="p-0">
        <SheetTitle className="text-base">{row.categoryName}</SheetTitle>
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
        <div className="flex h-20 items-end gap-1">
          {(history ?? []).map((h) => (
            <div
              key={h.monthKey}
              className="flex flex-1 flex-col items-center gap-0.5"
              title={`${monthLabel(h.monthKey, "MMM yyyy")}: ${usd.format(h.spent)}${h.limit !== null ? ` of ${usd.format(h.limit)}` : ""}`}
            >
              <div
                className={`w-full ${h.limit !== null && h.spent > h.limit ? "bg-destructive" : "bg-primary/70"}`}
                style={{ height: `${Math.round((h.spent / peak) * 64)}px` }}
              />
              <span className="text-[9px] text-muted-foreground">{monthLabel(h.monthKey, "MMMMM")}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
