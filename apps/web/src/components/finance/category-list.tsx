import { useState } from "react";
import { ArrowDown, ArrowUp, Check, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { CATEGORY_COLORS, CATEGORY_ICONS, type CategoryIcon } from "@life-tracker/shared";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { CATEGORY_ICON_COMPONENTS, CategoryMark, categoryColor } from "./category-icon";
import { CategoryPicker } from "./category-picker";

type CategoryRow = RouterOutputs["categories"]["list"][number];

/**
 * Categories tab on the budgets page (KOI-287): every category, in its manual
 * order, with its color, icon and transaction count; any category, seeded or
 * custom, can be recolored, renamed, moved up or down among its siblings,
 * filed under a parent (KOI-337), excluded from totals (KOI-338), or deleted
 * (optionally moving its transactions). Subcategories sit indented under their
 * parent in a tint of its color. Below, the Bank Category mapping (KOI-335).
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
  const update = useMutation(trpc.categories.update.mutationOptions({ onSettled: () => setRenaming(null), onSuccess: refresh }));
  const reorder = useMutation(trpc.categories.reorder.mutationOptions({ onSettled: refresh }));
  // Swapping two siblings in the tree-ordered list swaps their sortOrders and
  // leaves every other category's place among its own siblings unchanged.
  const swap = (a: number, b: number) => {
    const ids = categories!.map((c) => c.id);
    [ids[a], ids[b]] = [ids[b]!, ids[a]!];
    reorder.mutate({ ids });
  };

  if (!categories) return <div className="text-muted-foreground">Loading categories…</div>;

  const topLevel = categories.filter((c) => !c.parentId);
  const hasSubcategories = (id: string) => categories.some((c) => c.parentId === id);
  const siblingIndexes = (c: CategoryRow) =>
    categories.flatMap((s, i) => (s.parentId === c.parentId ? [i] : []));

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border border border-border">
        {categories.map((c, i) => {
          const siblings = siblingIndexes(c);
          const at = siblings.indexOf(i);
          const prev = siblings[at - 1];
          const next = siblings[at + 1];
          return (
            <li key={c.id} className={cn("flex items-center gap-2 px-3 py-2 text-sm", c.parentId && "ps-9")}>
              {c.parentId ? (
                <span
                  role="img"
                  aria-label={`Color for ${c.name}: a tint of its parent's`}
                  className="size-5 shrink-0 rounded-md"
                  style={{ background: categoryColor(c.color, c.tint) }}
                />
              ) : (
                <ColorPicker category={c} onPick={(color) => update.mutate({ id: c.id, color })} />
              )}
              <IconPicker category={c} onPick={(icon) => update.mutate({ id: c.id, icon })} />
              {renaming === c.id ? (
                <input
                  autoFocus
                  aria-label={`New name for ${c.name}`}
                  defaultValue={c.name}
                  maxLength={60}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== c.name) update.mutate({ id: c.id, name });
                    else setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-0.5"
                />
              ) : (
                <span className={cn("min-w-0 flex-1 truncate", (c.excluded || c.excludedByParent) && "text-muted-foreground")}>
                  {c.name}
                  {(c.excluded || c.excludedByParent) && <span className="ms-1.5 text-xs">· excluded</span>}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {!hasSubcategories(c.id) && (
                  <CategoryPicker
                    aria-label={`Parent of ${c.name}`}
                    size="xs"
                    categories={topLevel.filter((p) => p.id !== c.id)}
                    value={c.parentId ?? ""}
                    disabled={update.isPending}
                    onChange={(parentId) => update.mutate({ id: c.id, parentId: parentId || null })}
                    extras={[{ value: "", label: "No parent" }]}
                    className="w-28"
                  />
                )}
                <span className="mx-1">
                  {c.transactionCount} {c.transactionCount === 1 ? "txn" : "txns"}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={prev === undefined || reorder.isPending}
                  onClick={() => swap(i, prev!)}
                  aria-label={`Move ${c.name} up`}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={next === undefined || reorder.isPending}
                  onClick={() => swap(i, next!)}
                  aria-label={`Move ${c.name} down`}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant={c.excluded ? "secondary" : "ghost"}
                  aria-pressed={c.excluded || c.excludedByParent}
                  disabled={(c.excludedByParent && !c.excluded) || update.isPending}
                  onClick={() => update.mutate({ id: c.id, excluded: !c.excluded })}
                  aria-label={`Exclude ${c.name} from totals`}
                  title={c.excludedByParent ? "Excluded with its parent" : "Exclude from totals"}
                >
                  <EyeOff />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.name}`}>
                  <Pencil />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                  <Trash2 />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {update.error && <p className="text-xs text-destructive">{update.error.message}</p>}
      {reorder.error && <p className="text-xs text-destructive">{reorder.error.message}</p>}

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

/** A category's color chip, opening the palette to pick another. */
function ColorPicker({ category, onPick }: { category: CategoryRow; onPick: (color: (typeof CATEGORY_COLORS)[number]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Color for ${category.name}: ${category.color ?? "none"}`}
            className="size-5 shrink-0 rounded-md ring-offset-2 ring-offset-background hover:ring-2 hover:ring-ring"
            style={{ background: categoryColor(category.color) }}
          />
        }
      />
      <PopoverContent className="w-auto p-2" align="start">
        <div role="radiogroup" aria-label={`Color for ${category.name}`} className="grid grid-cols-7 gap-1.5">
          {CATEGORY_COLORS.map((token) => (
            <button
              key={token}
              type="button"
              role="radio"
              aria-checked={category.color === token}
              aria-label={token}
              title={token}
              onClick={() => {
                if (token !== category.color) onPick(token);
                setOpen(false);
              }}
              className="flex size-7 items-center justify-center rounded-md text-white hover:ring-2 hover:ring-ring"
              style={{ background: categoryColor(token) }}
            >
              {category.color === token && <Check className="size-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "gamepad-2" → "gamepad 2": a readable name for an icon button. */
const iconLabel = (icon: string) => icon.replaceAll("-", " ");

/**
 * A category's icon, in its color, opening the 7 × 6 grid of `CATEGORY_ICONS`
 * to pick another; "No icon" clears it. With none, the trigger is a dashed plus.
 */
function IconPicker({ category, onPick }: { category: CategoryRow; onPick: (icon: CategoryIcon | null) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (icon: CategoryIcon | null) => {
    if (icon !== category.icon) onPick(icon);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Icon for ${category.name}: ${category.icon ? iconLabel(category.icon) : "none"}`}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted",
              !category.icon && "border border-dashed border-border text-muted-foreground",
            )}
          />
        }
      >
        {category.icon ? <CategoryMark category={category} /> : <Plus aria-hidden className="size-3.5" />}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div role="radiogroup" aria-label={`Icon for ${category.name}`} className="grid grid-cols-7 gap-1">
          {CATEGORY_ICONS.map((icon) => {
            const Icon = CATEGORY_ICON_COMPONENTS[icon];
            const selected = category.icon === icon;
            return (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={iconLabel(icon)}
                title={iconLabel(icon)}
                onClick={() => pick(icon)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md hover:bg-muted",
                  selected && "bg-muted ring-2 ring-ring",
                )}
                style={{ color: categoryColor(category.color, category.tint) }}
              >
                <Icon aria-hidden className="size-4" />
              </button>
            );
          })}
        </div>
        {category.icon && (
          <Button size="xs" variant="ghost" className="mt-2 w-full" onClick={() => pick(null)}>
            No icon
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** FOOD_AND_DRINK → "Food and drink". */
function bankCategoryLabel(bankCategory: string): string {
  const words = bankCategory.toLowerCase().replaceAll("_", " ");
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
            <li key={m.bankCategory} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <label htmlFor={`bank-category-${m.bankCategory}`}>{bankCategoryLabel(m.bankCategory)}</label>
              <CategoryPicker
                id={`bank-category-${m.bankCategory}`}
                categories={categories}
                value={m.categoryId ?? ""}
                disabled={setMapping.isPending}
                onChange={(categoryId) => setMapping.mutate({ bankCategory: m.bankCategory, categoryId: categoryId || null })}
                extras={[{ value: "", label: "Uncategorized", uncategorized: true }]}
                className="max-w-[55%]"
              />
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
  const subcategoryCount = others.filter((c) => c.parentId === category.id).length;
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
            {subcategoryCount > 0 &&
              ` Its ${subcategoryCount === 1 ? "Subcategory moves" : `${subcategoryCount} Subcategories move`} to the top level in its color.`}
          </DialogDescription>
        </DialogHeader>
        {category.transactionCount > 0 && (
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Move its transactions to</span>
            <CategoryPicker
              categories={others}
              value={moveTo}
              onChange={setMoveTo}
              extras={[{ value: "", label: "Uncategorized", uncategorized: true }]}
              className="w-full"
            />
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
