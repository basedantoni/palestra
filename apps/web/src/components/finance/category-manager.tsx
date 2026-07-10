import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

/** List existing categories and create new custom ones. */
export function CategoryManager() {
  const queryClient = useQueryClient();
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [name, setName] = useState("");

  const create = useMutation(
    trpc.categories.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.categories.list.queryOptions().queryKey,
        });
        setName("");
      },
    }),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(categories ?? []).map((c) => (
          <span key={c.id} className="rounded-full border border-border px-3 py-1 text-xs">
            {c.name}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-background px-2 py-1"
          placeholder="New category"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={create.isPending || name.trim() === ""}
          onClick={() => create.mutate({ name: name.trim() })}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
