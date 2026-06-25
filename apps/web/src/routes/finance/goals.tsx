import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { GoalsList } from "@/components/finance/goals-list";
import { GoalCreateForm } from "@/components/finance/goal-create-form";

export const Route = createFileRoute("/finance/goals")({
  component: GoalsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function GoalsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Goals</h1>
      <GoalCreateForm />
      <GoalsList />
    </div>
  );
}
