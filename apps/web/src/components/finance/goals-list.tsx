import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function GoalsList() {
  const { data: goals, isLoading } = useQuery(trpc.goals.list.queryOptions());

  if (isLoading) return <div className="text-muted-foreground">Loading goals…</div>;
  if (!goals || goals.length === 0) {
    return <div className="text-muted-foreground">No savings goals yet.</div>;
  }

  return (
    <ul className="space-y-4">
      {goals.map((g) => (
        <li key={g.id} className="space-y-1 rounded-md border border-border p-4">
          <div className="flex justify-between">
            <span className="font-medium">{g.name}</span>
            <span className="text-sm tabular-nums">
              {usd.format(g.currentBalance)} / {usd.format(g.targetAmount)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${g.complete ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${Math.round(g.percent)}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {g.complete
              ? "Complete 🎉"
              : g.projectedDate
                ? `Projected ${g.projectedDate}${
                    g.onTrack === false ? " · behind target" : g.onTrack ? " · on track" : ""
                  }`
                : "Not enough history to project"}
          </div>
        </li>
      ))}
    </ul>
  );
}
