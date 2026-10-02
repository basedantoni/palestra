import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { BudgetCards } from "@/components/finance/budget-cards";
import { BudgetMonthStepper } from "@/components/finance/budget-month-stepper";
import { CategoryList } from "@/components/finance/category-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Month and tab live in the URL so reloads and shared links keep the view.
// No month = the current month (in the user's timezone).
const budgetsSearchSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().catch(undefined),
  tab: z.enum(["budgets", "categories"]).optional().catch(undefined),
});

export const Route = createFileRoute("/finance/budgets")({
  validateSearch: (search) => budgetsSearchSchema.parse(search),
  component: BudgetsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function BudgetsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const currentMonth = useFinanceToday().slice(0, 7);
  const month = search.month ?? currentMonth;
  const tab = search.tab ?? "budgets";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Budgets</h1>
      <Tabs
        value={tab}
        onValueChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, tab: next === "budgets" ? undefined : (next as "categories") }), replace: true })
        }
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="budgets" className="space-y-4">
          <BudgetMonthStepper
            month={month}
            currentMonth={currentMonth}
            onChange={(next) =>
              navigate({ search: (prev) => ({ ...prev, month: next === currentMonth ? undefined : next }), replace: true })
            }
          />
          <BudgetCards month={month} currentMonth={currentMonth} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoryList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
