import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

/** Create a savings goal tied to one or more accounts. */
export function GoalCreateForm() {
  const queryClient = useQueryClient();
  const { data: accounts } = useQuery(trpc.plaid.listAccounts.queryOptions());

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);

  const create = useMutation(
    trpc.goals.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.goals.list.queryOptions().queryKey });
        setName("");
        setTarget("");
        setDate("");
        setAccountIds([]);
      },
    }),
  );

  const toggleAccount = (id: string) =>
    setAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const canSubmit = name.trim() !== "" && Number(target) > 0 && accountIds.length > 0;

  const inputClass = "rounded-md border border-border bg-background px-2 py-1";

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={`${inputClass} flex-1`}
          placeholder="Goal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${inputClass} w-32`}
          type="number"
          min={0}
          step="0.01"
          placeholder="Target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <input
          className={inputClass}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {(accounts ?? []).map((a) => (
          <label key={a.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={accountIds.includes(a.id)}
              onChange={() => toggleAccount(a.id)}
            />
            {a.name}
          </label>
        ))}
      </div>

      <Button
        size="sm"
        disabled={!canSubmit || create.isPending}
        onClick={() =>
          create.mutate({
            name: name.trim(),
            targetAmount: Number(target),
            targetDate: date || undefined,
            accountIds,
          })
        }
      >
        Create goal
      </Button>
    </div>
  );
}
