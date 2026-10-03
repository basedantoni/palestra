import { useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

/**
 * Refetch everything derived from synced bank data. Account changes and syncs
 * ripple into transactions, budget spend, goal progress, and seeded categories.
 */
export function useInvalidateFinance(): () => void {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      trpc.plaid.pathKey(),
      trpc.transactions.pathKey(),
      trpc.budgets.pathKey(),
      trpc.goals.pathKey(),
      trpc.categories.pathKey(),
      trpc.finance.pathKey(),
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
}
