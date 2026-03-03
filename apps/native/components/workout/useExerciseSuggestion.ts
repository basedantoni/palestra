import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

export function useExerciseSuggestion(exerciseId: string | undefined) {
  const query = useQuery(
    trpc.analytics.exerciseSuggestion.queryOptions(
      { exerciseId: exerciseId! },
      {
        enabled: !!exerciseId,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
    ),
  );

  return {
    suggestion: query.data?.suggestion ?? null,
    trendStatus: query.data?.trendStatus ?? null,
    isLoading: query.isLoading,
  };
}
