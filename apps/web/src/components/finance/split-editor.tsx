import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { MIN_SPLIT_PIECES, remainingLabel, remainingToAssign, validateSplit } from "@life-tracker/api/lib/splits";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { CategoryPicker } from "./category-picker";

type Txn = RouterOutputs["transactions"]["list"]["items"][number];

type Row = { key: number; amount: string; categoryId: string; note: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

let nextKey = 0;
const newRow = (amount = "", categoryId = "", note = ""): Row => ({ key: nextKey++, amount, categoryId, note });

/** The txn's Splits, or two rows to start: the whole amount in its category, and an empty one. */
function initialRows(txn: Txn): Row[] {
  if (txn.splits.length > 0) return txn.splits.map((s) => newRow(String(s.amount), s.categoryId ?? "", s.note ?? ""));
  return [newRow(String(txn.amount), txn.categoryId ?? ""), newRow()];
}

/**
 * Split editor (KOI-343): pieces with an amount, category and note each,
 * summing to the transaction to the cent before it saves. Saving replaces any
 * Splits it already has.
 */
export function SplitEditor({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const onSuccess = useInvalidateFinance();
  const split = useMutation(
    trpc.transactions.split.mutationOptions({
      onSuccess: () => {
        onSuccess();
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const [rows, setRows] = useState(() => initialRows(txn));

  const pieces = rows.map((r) => ({
    amount: Number(r.amount),
    categoryId: r.categoryId || null,
    note: r.note.trim() || null,
  }));
  const typed = rows.every((r) => r.amount.trim() !== "" && Number.isFinite(Number(r.amount)));
  const remaining = remainingToAssign(txn.amount, pieces.map((p) => ({ amount: p.amount || 0 })));
  const valid = typed && validateSplit(txn, pieces).ok;

  const update = (key: number, change: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Split {txn.merchantName ?? txn.name} · {usd.format(txn.amount)}
          </DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Amount ${i + 1}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={r.amount}
                onChange={(e) => update(r.key, { amount: e.target.value })}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
              />
              <CategoryPicker
                size="sm"
                aria-label={`Category ${i + 1}`}
                categories={categories}
                value={r.categoryId}
                onChange={(categoryId) => update(r.key, { categoryId })}
                placeholder="Uncategorized"
                extras={[{ value: "", label: "Uncategorized", uncategorized: true }]}
              />
              <input
                aria-label={`Note ${i + 1}`}
                value={r.note}
                maxLength={500}
                placeholder="Note"
                onChange={(e) => update(r.key, { note: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove piece ${i + 1}`}
                disabled={rows.length <= MIN_SPLIT_PIECES}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, newRow(remaining > 0 ? String(remaining) : "")])}>
            <Plus /> Add piece
          </Button>
          <span className={`text-sm tabular-nums ${remaining === 0 ? "text-muted-foreground" : "text-amber-600"}`}>
            {remaining === 0 ? "Fully assigned" : remainingLabel(remaining)}
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || split.isPending} onClick={() => split.mutate({ id: txn.id, pieces })}>
            {split.isPending ? "Saving…" : "Save split"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
