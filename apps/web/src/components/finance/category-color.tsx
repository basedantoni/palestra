import { cn } from "@/lib/utils";

/** The CSS color of a category's palette token (KOI-336); a category with none is neutral. */
export const categoryColor = (token: string | null) =>
  token ? `var(--chart-cat-${token})` : "var(--chart-cat-other)";

/** "🍔 Food & Drink", or the bare name without an emoji. For `<option>`s, which can't hold a swatch. */
export const categoryLabel = (c: { name: string; emoji: string | null }) => (c.emoji ? `${c.emoji} ${c.name}` : c.name);

/** A category's color chip. Uncategorized (no category) is a dashed outline. */
export function CategorySwatch({
  color,
  uncategorized = false,
  className,
}: {
  color: string | null;
  uncategorized?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-sm",
        uncategorized && "border border-dashed border-muted-foreground",
        className,
      )}
      style={uncategorized ? undefined : { background: categoryColor(color) }}
    />
  );
}
