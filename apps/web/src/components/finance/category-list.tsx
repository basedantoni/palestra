import { useState } from "react";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CategoryRow = RouterOutputs["categories"]["list"][number];

/**
 * Categories tab on the budgets page (KOI-287): every category with its
 * transaction count; custom categories can be renamed or deleted (optionally
 * moving their transactions), built-ins are locked.
 */
export function CategoryList() {
  const queryClient = useQueryClient();
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [newName, setNewName] = useState("");

  // Category edits change dropdowns, budget cards, transaction rows, and rules
  // (renames show in rules; deleting a category deletes its rules).
  const refresh = () => {
    for (const queryKey of [
      trpc.categories.pathKey(),
      trpc.budgets.pathKey(),
      trpc.transactions.pathKey(),
      trpc.categoryRules.pathKey(),
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
  const create = useMutation(trpc.categories.create.mutationOptions({ onSuccess: () => (setNewName(""), refresh()) }));
  const rename = useMutation(trpc.categories.rename.mutationOptions({ onSettled: () => setRenaming(null), onSuccess: refresh }));

  if (!categories) return <div className="text-muted-foreground">Loading categories…</div>;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border border border-border">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            {renaming === c.id ? (
              <input
                autoFocus
                aria-label={`New name for ${c.name}`}
                defaultValue={c.name}
                maxLength={60}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== c.name) rename.mutate({ id: c.id, name });
                  else setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="rounded-md border border-border bg-background px-1.5 py-0.5"
              />
            ) : (
              <span className="flex items-center gap-1.5">
                {c.name}
                {c.isSystem && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <Lock className="size-3" /> built-in
                  </span>
                )}
              </span>
            )}
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {c.transactionCount} {c.transactionCount === 1 ? "txn" : "txns"}
              {c.isSystem ? (
                <span className="inline-flex size-6 items-center justify-center" title="Built-in categories can't be renamed or deleted">
                  <Lock className="size-3.5 opacity-50" />
                </span>
              ) : (
                <>
                  <Button size="icon-xs" variant="ghost" onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.name}`}>
                    <Pencil />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {rename.error && <p className="text-xs text-destructive">{rename.error.message}</p>}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate({ name: newName.trim() });
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category"
          maxLength={60}
          aria-label="New category name"
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <Button size="sm" type="submit" disabled={!newName.trim() || create.isPending}>
          Add
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Built-in categories come from your bank's data and are matched by name during sync, so they can't be renamed or deleted.
      </p>

      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          others={categories.filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}

function DeleteCategoryDialog({
  category,
  others,
  onClose,
  onDeleted,
}: {
  category: CategoryRow;
  others: CategoryRow[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [moveTo, setMoveTo] = useState("");
  const remove = useMutation(
    trpc.categories.remove.mutationOptions({
      onSuccess: () => {
        onDeleted();
        onClose();
      },
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !remove.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{category.name}”?</DialogTitle>
          <DialogDescription>
            {category.transactionCount} {category.transactionCount === 1 ? "transaction uses" : "transactions use"} it, and
            its budgets will be removed.
          </DialogDescription>
        </DialogHeader>
        {category.transactionCount > 0 && (
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Move its transactions to</span>
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className="block w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">Uncategorized</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {remove.error && <p className="text-xs text-destructive">{remove.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: category.id, moveToCategoryId: moveTo || undefined })}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
