import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { CategoryMark } from "./category-icon";

interface PickerCategory {
  id: string;
  name: string;
  parentId?: string | null;
  color: string | null;
  tint?: number | null;
  icon: string | null;
}

/** A row above the categories, such as "Uncategorized" or "All categories". */
interface Extra {
  value: string;
  label: string;
  /** Draw the dashed Uncategorized mark beside it. */
  uncategorized?: boolean;
}

/**
 * Category dropdown (KOI-336): a popover listing the categories in their
 * manual order, each with its icon or color, under any `extras`. Given in
 * tree order (`categories.list`), Subcategories sit indented under their
 * parent; parents and Subcategories are both pickable (KOI-337). Values are
 * strings like a `<select>`'s: a category id, an extra's value, or "" for
 * nothing picked yet (shown as `placeholder`).
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  extras = [],
  placeholder = "Category",
  id,
  "aria-label": ariaLabel,
  disabled,
  size = "sm",
  className,
}: {
  categories: PickerCategory[] | undefined;
  value: string;
  onChange: (value: string) => void;
  extras?: Extra[];
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
  size?: "xs" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedCategory = categories?.find((c) => c.id === value);
  const selectedExtra = extras.find((e) => e.value === value);
  const pick = (next: string) => {
    if (next !== value) onChange(next);
    setOpen(false);
  };
  const text = size === "xs" ? "text-xs" : "text-sm";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            id={id}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background disabled:opacity-50",
              size === "xs" ? "px-1.5 py-0.5" : "px-2 py-1",
              text,
              className,
            )}
          />
        }
      >
        {selectedCategory ? (
          <>
            <CategoryMark category={selectedCategory} className="size-3.5" />
            <span className="truncate">{selectedCategory.name}</span>
          </>
        ) : selectedExtra ? (
          <>
            {selectedExtra.uncategorized && <CategoryMark category={null} className="size-3.5" />}
            <span className="truncate">{selectedExtra.label}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        )}
        <ChevronsUpDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-56 overflow-y-auto p-1" align="start">
        <ul aria-label={ariaLabel ?? placeholder} className={text}>
          {extras.map((e) => (
            <Option key={e.value} selected={e.value === value} onPick={() => pick(e.value)}>
              {e.uncategorized ? <CategoryMark category={null} /> : <span className="size-4 shrink-0" />}
              <span className={cn("truncate", e.uncategorized && "pe-0.5 italic")}>{e.label}</span>
            </Option>
          ))}
          {categories?.map((c) => (
            <Option key={c.id} selected={c.id === value} onPick={() => pick(c.id)} indent={!!c.parentId}>
              <CategoryMark category={c} />
              <span className="truncate">{c.name}</span>
            </Option>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Option({
  selected,
  onPick,
  indent,
  children,
}: {
  selected: boolean;
  onPick: () => void;
  indent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={onPick}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          indent && "ps-7",
        )}
      >
        {children}
        {selected && <Check aria-hidden className="ml-auto size-3.5 shrink-0" />}
      </button>
    </li>
  );
}
