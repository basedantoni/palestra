import { createFileRoute } from "@tanstack/react-router";

import { GoalsList } from "@/components/finance/goals-list";
import { GoalCreateForm } from "@/components/finance/goal-create-form";

export const Route = createFileRoute("/finance/goals")({
  component: GoalsPage,
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
