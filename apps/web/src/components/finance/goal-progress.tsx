import { AlertTriangle } from "lucide-react";

type GoalLike = {
  accountIds: string[];
  percent: number;
  complete: boolean;
  projectedDate: string | null;
  onTrack: boolean | null;
};

/** Progress bar + projection line, or the paused state when no account is linked. */
export function GoalProgress({ goal }: { goal: GoalLike }) {
  if (goal.accountIds.length === 0) {
    return (
      <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        No linked accounts — progress is paused. Link an account to keep tracking.
      </div>
    );
  }
  return (
    <>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${goal.complete ? "bg-green-500" : "bg-primary"}`}
          style={{ width: `${Math.round(goal.percent)}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {goal.complete
          ? "Complete 🎉"
          : goal.projectedDate
            ? `Projected ${goal.projectedDate}${goal.onTrack === false ? " · behind target" : goal.onTrack ? " · on track" : ""}`
            : "Not enough history to project"}
      </div>
    </>
  );
}
