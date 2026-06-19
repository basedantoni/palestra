import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import {
  ANALYTICS_RANGE_PRESETS,
  normalizeAnalyticsRangeSearch,
} from "@life-tracker/shared";

const analyticsSearchSchema = z.object({
  range: z.enum(ANALYTICS_RANGE_PRESETS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const Route = createFileRoute("/analytics")({
  validateSearch: (search) =>
    normalizeAnalyticsRangeSearch(analyticsSearchSchema.parse(search)),
  component: AnalyticsDashboard,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }

    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions(),
    );
    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }

    return { session };
  },
});
