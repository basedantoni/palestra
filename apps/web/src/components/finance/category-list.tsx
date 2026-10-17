import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
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
 * transaction count; any category, seeded or custom, can be renamed or deleted
 * (optionally moving its transactions). Below, the Bank Category mapping
 * (KOI-335).
 */
export function CategoryList() {
  const queryClient = useQueryClient();
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [newName, setNewName] = useState("");

  // Category edits change dropdowns, budget cards, transaction rows, rules
  // (renames show in rules; deleting a category deletes its rules) and the
  // Bank Category mapping (deleting a mapped category unmaps it).
  const refresh = () => {
    for (const queryKey of [
      trpc.categories.pathKey(),
      trpc.budgets.pathKey(),
      trpc.transactions.pathKey(),
      trpc.categoryRules.pathKey(),
      trpc.bankCategories.pathKey(),
      trpc.finance.pathKey(),
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
              <span>{c.name}</span>
            )}
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {c.transactionCount} {c.transactionCount === 1 ? "txn" : "txns"}
              <Button size="icon-xs" variant="ghost" onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.name}`}>
                <Pencil />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                <Trash2 />
              </Button>
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
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}

      <BankCategoryMapping categories={categories} onChanged={refresh} />

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

/** FOOD_AND_DRINK → "Food and drink". */
function bankCategoryLabel(pfcPrimary: string): string {
  const words = pfcPrimary.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Bank categories (KOI-335): which category each of the bank's own categories
 * files a new transaction under (its Default Category), or Uncategorized.
 * Changing one re-files that Bank Category's automatic transactions; rules
 * still win and hand-picked categories stay.
 */
function BankCategoryMapping({ categories, onChanged }: { categories: CategoryRow[]; onChanged: () => void }) {
  const { data: mapping } = useQuery(trpc.bankCategories.list.queryOptions());
  const setMapping = useMutation(trpc.bankCategories.setMapping.mutationOptions({ onSuccess: onChanged }));

  return (
    <section className="space-y-2 pt-4" aria-labelledby="bank-categories-heading">
      <div>
        <h3 id="bank-categories-heading" className="text-sm font-medium">
          Bank categories
        </h3>
        <p className="text-xs text-muted-foreground">
          The category each of your bank's categories files transactions under. Rules still win, and categories
          you picked by hand stay.
        </p>
      </div>
      {!mapping ? (
        <div className="text-xs text-muted-foreground">Loading bank categories…</div>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {mapping.map((m) => (
            <li key={m.pfcPrimary} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <label htmlFor={`bank-category-${m.pfcPrimary}`}>{bankCategoryLabel(m.pfcPrimary)}</label>
              <select
                id={`bank-category-${m.pfcPrimary}`}
                value={m.categoryId ?? ""}
                disabled={setMapping.isPending}
                onChange={(e) => setMapping.mutate({ pfcPrimary: m.pfcPrimary, categoryId: e.target.value || null })}
                className="max-w-[55%] rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      {setMapping.error && <p className="text-xs text-destructive">{setMapping.error.message}</p>}
    </section>
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
