import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export const Route = createFileRoute("/analytics")({
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
