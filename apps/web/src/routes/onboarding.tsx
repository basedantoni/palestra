import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import OnboardingPage from "@/components/onboarding/onboarding-page";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }

    // Check if onboarding already completed
    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions()
    );

    if (isComplete) {
      redirect({ to: "/dashboard", throw: true });
    }

    return { session };
  },
});
