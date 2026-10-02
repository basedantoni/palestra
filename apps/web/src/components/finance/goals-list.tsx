import { useState } from "react";
import { X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

import { GoalDetailSheet, type Goal } from "./goal-detail-sheet";
import { GoalProgress } from "./goal-progress";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Savings goals (KOI-286). Clicking a goal opens its detail sheet; deleting
 * removes it straight away with an Undo that re-creates it from a local copy.
 */
export function GoalsList() {
  const queryClient = useQueryClient();
  const { data: goals, isLoading } = useQuery(trpc.goals.list.queryOptions());
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Goal | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.goals.pathKey() });
  const remove = useMutation(trpc.goals.remove.mutationOptions({ onSuccess: refresh }));
  const recreate = useMutation(
    trpc.goals.create.mutationOptions({
      onSuccess: () => {
        setDeleted(null);
        refresh();
      },
    }),
  );

  const deleteGoal = (goal: Goal) => {
    recreate.reset(); // a previous restore's error belongs to a different goal
    setOpenId(null);
    setDeleted(goal);
    remove.mutate({ id: goal.id });
  };
  const undo = () => {
    if (!deleted || deleted.accountIds.length === 0) return;
    recreate.mutate({
      name: deleted.name,
      targetAmount: deleted.targetAmount,
      targetDate: deleted.targetDate ?? undefined,
      accountIds: deleted.accountIds,
    });
  };

  if (isLoading) return <div className="text-muted-foreground">Loading goals…</div>;
  const open = goals?.find((g) => g.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {deleted && (
        <div className="flex items-center justify-between border border-border bg-muted/40 px-3 py-2 text-xs" role="status">
          <span>
            {remove.isError
              ? `Couldn't delete “${deleted.name}”: ${remove.error.message}`
              : recreate.isError
                ? `Couldn't restore “${deleted.name}”: ${recreate.error.message}`
                : `Deleted “${deleted.name}”.`}
          </span>
          <span className="flex items-center gap-2">
            {/* A goal with no linked accounts can't be re-created (a goal needs one). */}
            {/* Undo only once the delete has landed — restoring mid-flight could leave a duplicate if it then fails. */}
            {deleted.accountIds.length > 0 && remove.isSuccess && (
              <button type="button" className="underline disabled:opacity-50" disabled={recreate.isPending} onClick={undo}>
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDeleted(null);
                recreate.reset();
              }}
              aria-label="Dismiss"
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}

      {!goals || goals.length === 0 ? (
        <div className="text-muted-foreground">No savings goals yet.</div>
      ) : (
        <ul className="space-y-4">
          {goals.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => setOpenId(g.id)}
                className={`w-full space-y-1 rounded-md border p-4 text-left hover:bg-muted/40 ${
                  g.accountIds.length === 0 ? "border-amber-500/50" : "border-border"
                }`}
              >
                <div className="flex justify-between">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-sm tabular-nums">
                    {usd.format(g.currentBalance)} / {usd.format(g.targetAmount)}
                  </span>
                </div>
                <GoalProgress goal={g} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <GoalDetailSheet goal={open} onClose={() => setOpenId(null)} onDelete={deleteGoal} />
    </div>
  );
}
