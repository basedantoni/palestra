import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryMark, categoryColor } from "@/components/finance/category-icon";
import { MonthlyBars } from "@/components/finance/monthly-bars";
import { TransactionFeed } from "@/components/finance/transaction-feed";

// Range and the Subcategory filter live in the URL so reloads and shared links keep the view.
const categorySearchSchema = z.object({
  range: z.enum(["6M", "1Y"]).default("6M").catch("6M"),
  /** A Subcategory (or the parent itself) to narrow a parent's transactions to; omitted = all of them. */
  only: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/finance/categories/$id")({
  validateSearch: categorySearchSchema,
  component: CategoryPage,
});

/**
 * Category detail view (KOI-347): monthly Budgeted Spend bars with each
 * month's limit, and the category's transactions. A parent's bars and list
 * include its Subcategories; chips narrow the list to one of them.
 */
function CategoryPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { range } = search;
  const { data: categories, isPending } = useQuery(trpc.categories.list.queryOptions());
  const monthly = useQuery(trpc.budgets.history.queryOptions({ categoryId: id, months: range === "1Y" ? 12 : 6 }));

  const current = categories?.find((c) => c.id === id);
  if (isPending) return <Skeleton className="mx-auto mt-6 h-64 max-w-3xl" />;
  if (!current) {
    return (
      <div className="mx-auto max-w-3xl space-y-2 p-6">
        <p>Category not found.</p>
        <Link to="/finance/budgets" search={{ tab: "categories" }} className="text-sm underline">
          Back to categories
        </Link>
      </div>
    );
  }

  const parent = categories?.find((c) => c.id === current.parentId);
  const subcategories = categories?.filter((c) => c.parentId === id) ?? [];
  const only = subcategories.some((s) => s.id === search.only) || search.only === id ? search.only : undefined;
  const update = (next: Partial<z.infer<typeof categorySearchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  const chips = [
    { id: undefined, label: "All" },
    { id, label: `${current.name} itself` },
    ...subcategories.map((s) => ({ id: s.id, label: s.name })),
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="space-y-1">
        {parent && (
          <Link to="/finance/categories/$id" params={{ id: parent.id }} className="text-sm text-muted-foreground hover:underline">
            ← {parent.name}
          </Link>
        )}
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CategoryMark category={current} className="size-5" />
          {current.name}
        </h1>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Spent per month</h2>
          <Tabs value={range} onValueChange={(next) => update({ range: next as "6M" | "1Y" })}>
            <TabsList>
              {["6M", "1Y"].map((r) => (
                <TabsTrigger key={r} value={r}>
                  {r}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {monthly.isError && <p className="text-sm text-destructive">Couldn't load this category's months.</p>}
        {monthly.data ? (
          <MonthlyBars data={monthly.data} color={categoryColor(current.color, current.tint)} />
        ) : (
          !monthly.isError && <Skeleton className="h-52 w-full" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Transactions</h2>
        {subcategories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                type="button"
                key={chip.id ?? "all"}
                aria-pressed={only === chip.id}
                onClick={() => update({ only: chip.id })}
                className={`rounded-full border px-3 py-1 text-xs ${
                  only === chip.id ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        <TransactionFeed filters={only ? { categoryId: only } : { categoryId: id, subcategories: true }} />
      </section>
    </div>
  );
}
