import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { currentMonthKey } from "./budget-grid";

/**
 * Edit per-category monthly limits for a month. Each category row prefills its
 * existing limit and saves via budgets.upsert, then refreshes spend.
 */
export function BudgetManager({ monthKey = currentMonthKey() }: { monthKey?: string }) {
  const queryClient = useQueryClient();
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const { data: budgetRows } = useQuery(trpc.budgets.forMonth.queryOptions({ monthKey }));

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const upsert = useMutation(
    trpc.budgets.upsert.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.budgets.forMonth.queryOptions({ monthKey }).queryKey,
        });
      },
    }),
  );

  if (!categories) return <div className="text-muted-foreground">Loading…</div>;

  const limitByCategory = new Map((budgetRows ?? []).map((b) => [b.categoryId, b.limit]));

  return (
    <ul className="space-y-2">
      {categories.map((c) => {
        const existing = limitByCategory.get(c.id);
        const value = drafts[c.id] ?? (existing != null ? String(existing) : "");
        return (
          <li key={c.id} className="flex items-center justify-between gap-3">
            <span className="flex-1">{c.name}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              className="w-28 rounded-md border border-border bg-background px-2 py-1 text-right tabular-nums"
              placeholder="0.00"
            />
            <Button
              size="sm"
              disabled={upsert.isPending || value === ""}
              onClick={() =>
                upsert.mutate({
                  categoryId: c.id,
                  monthKey,
                  limitAmount: Number(value),
                })
              }
            >
              Save
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
