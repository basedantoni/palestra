import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc, type RouterOutputs } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { GoalProgress } from "./goal-progress";

export type Goal = RouterOutputs["goals"]["list"][number];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const inputCls = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * Goal detail sheet (KOI-286): balance, progress and trend chart, with the
 * goal's fields saving as you edit them, and Delete at the bottom.
 */
export function GoalDetailSheet({
  goal,
  onClose,
  onDelete,
}: {
  goal: Goal | null;
  onClose: () => void;
  onDelete: (goal: Goal) => void;
}) {
  return (
    <Sheet open={goal !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="space-y-5 overflow-y-auto p-5">
        {goal && (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="text-base">{goal.name}</SheetTitle>
            </SheetHeader>
            <section className="space-y-2">
              <div className="text-2xl font-semibold tabular-nums">
                {usd.format(goal.currentBalance)}{" "}
                <span className="text-sm font-normal text-muted-foreground">of {usd.format(goal.targetAmount)}</span>
              </div>
              <GoalProgress goal={goal} />
              {goal.accountIds.length > 0 && <BalanceChart history={goal.history} target={goal.targetAmount} />}
            </section>
            <section className="space-y-2 border-t border-border pt-4">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Details · changes save automatically</h4>
              <GoalFields key={goal.id} goal={goal} />
            </section>
            <section className="border-t border-border pt-4">
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(goal)}>
                <Trash2 /> Delete goal
              </Button>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Balance line over the snapshot history, with the target as a dashed line. */
function BalanceChart({ history, target }: { history: Goal["history"]; target: number }) {
  if (history.length < 2) {
    return <p className="text-xs text-muted-foreground">Not enough balance history to chart yet.</p>;
  }
  const W = 300;
  const H = 80;
  const peak = Math.max(target, ...history.map((p) => p.balance)) || 1;
  const y = (v: number) => H - (v / peak) * H;
  const points = history.map((p, i) => `${(i / (history.length - 1)) * W},${y(p.balance)}`).join(" ");
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full overflow-visible" role="img" aria-label="Balance trend">
        <line x1={0} x2={W} y1={y(target)} y2={y(target)} className="stroke-green-500" strokeDasharray="4 3" strokeWidth={1} />
        <polyline points={points} fill="none" className="stroke-primary" strokeWidth={1.5} />
      </svg>
      <figcaption className="flex justify-between text-[10px] text-muted-foreground">
        <span>{history[0]!.asOfDate}</span>
        <span>target {usd.format(target)}</span>
        <span>{history.at(-1)!.asOfDate}</span>
      </figcaption>
    </figure>
  );
}

/** Goal fields that save on blur (name, target, date) or on change (accounts). */
function GoalFields({ goal }: { goal: Goal }) {
  const queryClient = useQueryClient();
  const { data: accounts } = useQuery(trpc.plaid.listAccounts.queryOptions());
  const [name, setName] = useState(goal.name);
  const [target, setTarget] = useState(String(goal.targetAmount));
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? "");
  const update = useMutation(
    trpc.goals.update.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.goals.pathKey() }),
    }),
  );
  const save = (fields: Omit<Parameters<typeof update.mutate>[0], "id">) => update.mutate({ id: goal.id, ...fields });

  const targetNum = Number(target);
  const onlyAccount = goal.accountIds.length === 1 ? goal.accountIds[0] : null;

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Name</span>
        <input
          className={inputCls}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!name.trim()) setName(goal.name);
            else if (name.trim() !== goal.name) save({ name: name.trim() });
          }}
        />
      </label>
      <div className="flex gap-2">
        <label className="flex-1 space-y-1 text-xs">
          <span className="text-muted-foreground">Target</span>
          <input
            className={`${inputCls} tabular-nums`}
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => {
              if (!(targetNum > 0)) setTarget(String(goal.targetAmount));
              else if (targetNum !== goal.targetAmount) save({ targetAmount: targetNum });
            }}
          />
        </label>
        <label className="flex-1 space-y-1 text-xs">
          <span className="text-muted-foreground">Target date (optional)</span>
          <input
            className={inputCls}
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            // Save on blur: date inputs report a "complete" date after every typed
            // segment (e.g. year 0002 while typing 2027).
            onBlur={() => {
              const next = targetDate || null;
              if (next !== goal.targetDate) save({ targetDate: next });
            }}
          />
        </label>
      </div>
      <fieldset className="space-y-1 text-xs">
        <legend className="mb-1 text-muted-foreground">Linked accounts</legend>
        {(accounts ?? []).map((a) => {
          const checked = goal.accountIds.includes(a.id);
          return (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                disabled={update.isPending || a.id === onlyAccount}
                onChange={(e) =>
                  save({
                    accountIds: e.target.checked
                      ? [...goal.accountIds, a.id]
                      : goal.accountIds.filter((id) => id !== a.id),
                  })
                }
              />
              {a.name}
              {a.mask && <span className="text-xs text-muted-foreground">····{a.mask}</span>}
            </label>
          );
        })}
        {onlyAccount && <p className="text-muted-foreground">A goal needs at least one linked account.</p>}
      </fieldset>
      <p className="text-[10px] text-muted-foreground" aria-live="polite">
        {update.isPending ? "Saving…" : update.isError ? `Couldn't save: ${update.error.message}` : update.isSuccess ? "Saved." : " "}
      </p>
    </div>
  );
}
