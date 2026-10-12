import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface CopyValues {
  printingId: string;
  condition: Condition;
  pricePaid: number | null;
  acquiredOn: string;
}

const field = "block w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * Add or edit a Copy. With `printings`, the user picks one (adding from browse);
 * without, the Printing is fixed (editing).
 */
export function CopyDialog({
  title,
  initial,
  printings,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: CopyValues;
  printings?: Array<{ id: string; language: string; setName: string }>;
  pending: boolean;
  error?: string;
  onSubmit: (values: CopyValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [price, setPrice] = useState(initial.pricePaid?.toString() ?? "");
  const set = (next: Partial<CopyValues>) => setValues((v) => ({ ...v, ...next }));

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ ...values, pricePaid: price === "" ? null : Number(price) });
          }}
        >
          {printings && (
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Printing</span>
              <select value={values.printingId} onChange={(e) => set({ printingId: e.target.value })} className={field}>
                {printings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.language.toUpperCase()} · {p.setName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Condition</span>
            <select
              value={values.condition}
              onChange={(e) => set({ condition: e.target.value as Condition })}
              className={field}
              autoFocus
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Price paid (USD, blank for gifts and pulls)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={field}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Acquired</span>
            <input
              type="date"
              required
              value={values.acquiredOn}
              onChange={(e) => set({ acquiredOn: e.target.value })}
              className={field}
            />
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
