import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { CategorySpendNode } from "@life-tracker/api/lib/category-spend";
import { periodToSearch, type TransactionPeriod } from "@life-tracker/shared";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";

import { CategoryMark, categoryColor } from "./category-icon";
import { usd } from "./currency-tooltip";
import { TransactionPeriodPicker } from "./transaction-period-picker";

/**
 * Where a period's Spend went (KOI-345): a horizontal bar per category, ranked
 * by spend, with no "Other" bucket. A Parent Category's bar is its rolled-up
 * total and expands into its Subcategories, plus an "(X itself)" row when it
 * holds transactions of its own. Bars share one scale, so a Subcategory's
 * bar reads against its parent's. A category's bar opens its detail view
 * (KOI-347).
 */
export function SpendByCategory({
  period,
  today,
  onPeriodChange,
}: {
  period: TransactionPeriod;
  today: string;
  onPeriodChange: (next: TransactionPeriod) => void;
}) {
  const query = useQuery({ ...trpc.finance.spendByCategory.queryOptions({ period }), placeholderData: keepPreviousData });
  // The previous period's bars stay on screen while the new one loads: dim them
  // and make them inert so they don't pass as (or drill into) the new period.
  const loading = query.isPlaceholderData;

  return (
    <div className="space-y-3">
      <TransactionPeriodPicker period={period} today={today} onChange={onPeriodChange} />
      <div
        aria-busy={loading}
        className={cn("space-y-3 transition-opacity", loading && "opacity-50")}
        inert={loading}
      >
        <Link
          to="/finance/transactions"
          search={periodToSearch(period, today)}
          className="block text-right text-sm text-muted-foreground hover:underline"
        >
          View transactions →
        </Link>
        {query.isPending && <Skeleton className="h-64 w-full" />}
        {query.isError && <p className="text-sm text-destructive">Couldn't load spend by category.</p>}
        {query.data && <RankedBars tree={query.data} />}
      </div>
    </div>
  );
}

function RankedBars({ tree }: { tree: CategorySpendNode[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (tree.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">No spend in this period</p>
      </div>
    );
  }

  // A refund can leave a Subcategory (or the parent's own spend) above its parent's total, so every row sets the scale.
  const max = Math.max(0, ...tree.flatMap((n) => [n.total, n.own, ...n.children.map((c) => c.total)]));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul className="space-y-1">
      {tree.map((n) => {
        const id = n.categoryId ?? "uncategorized";
        const open = expanded.has(id);
        // The parent's own spend ranks among its Subcategories, in its own color.
        const itself = { ...n, name: `(${n.name} itself)`, total: n.own, children: [] };
        const rows = [
          ...n.children.map((c) => ({ key: c.categoryId, node: c, itself: false })),
          ...(n.children.length > 0 && n.own !== 0 ? [{ key: `${id}-itself`, node: itself, itself: true }] : []),
        ].toSorted((a, b) => b.node.total - a.node.total);
        return (
          <li key={id}>
            <Bar node={n} max={max} expand={n.children.length > 0 ? { open, onToggle: () => toggle(id) } : undefined} />
            {open && (
              <ul className="pl-6">
                {rows.map((r) => (
                  <li key={r.key}>
                    <Bar node={r.node} max={max} itself={r.itself} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One ranked row; a category's opens its detail view (an "(X itself)" row's
 * narrowed to X's own transactions), and a parent's chevron toggles its
 * Subcategories.
 */
function Bar({
  node,
  max,
  expand,
  itself = false,
}: {
  node: CategorySpendNode;
  max: number;
  expand?: { open: boolean; onToggle: () => void };
  itself?: boolean;
}) {
  const uncategorized = node.categoryId === null;
  const body = (
    <>
      <div className="flex items-center gap-2">
        <CategoryMark category={uncategorized ? null : node} />
        <span className={cn("min-w-0 flex-1 truncate", uncategorized && "italic")}>{node.name}</span>
        {/* A refund-negative category is good news: signed, not red. */}
        <span className="tabular-nums">{usd.format(node.total)}</span>
      </div>
      {/* Grows from a square baseline to a 4px rounded end; a net-refund row has no bar. */}
      <div aria-hidden className="h-2">
        <div
          className="h-full rounded-r-[4px]"
          style={{
            width: `${max > 0 ? (Math.max(node.total, 0) / max) * 100 : 0}%`,
            background: categoryColor(node.color, node.tint),
          }}
        />
      </div>
    </>
  );
  const bodyClass = "min-w-0 flex-1 space-y-1 py-1.5 pr-2 text-sm";

  return (
    <div className="flex rounded-md hover:bg-muted/50">
      {expand ? (
        <button
          type="button"
          aria-expanded={expand.open}
          aria-label={`${expand.open ? "Hide" : "Show"} ${node.name}'s Subcategories`}
          onClick={expand.onToggle}
          className="flex w-8 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight aria-hidden className={cn("size-4 transition-transform", expand.open && "rotate-90")} />
        </button>
      ) : (
        <span aria-hidden className="w-8 shrink-0" />
      )}
      {node.categoryId ? (
        <Link
          to="/finance/categories/$id"
          params={{ id: node.categoryId }}
          search={itself ? { only: node.categoryId } : {}}
          className={bodyClass}
        >
          {body}
        </Link>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}
    </div>
  );
}
