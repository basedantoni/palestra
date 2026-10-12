import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { CopyDialog } from "./-components/copy-dialog";

type CopyRow = RouterOutputs["tcg"]["copies"]["list"][number];

export const Route = createFileRoute("/tcg/copies")({
  component: CopiesPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function CopiesPage() {
  const { data: copies, isLoading } = useQuery(trpc.tcg.copies.list.queryOptions());
  const [editing, setEditing] = useState<CopyRow | null>(null);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.tcg.pathKey() });
  const update = useMutation(
    trpc.tcg.copies.update.mutationOptions({
      onSuccess: () => {
        setEditing(null);
        refresh();
      },
    }),
  );
  const remove = useMutation(trpc.tcg.copies.delete.mutationOptions({ onSuccess: refresh }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Copies</h1>
        <Link to="/tcg" search={{ owned: true }} className="text-sm underline-offset-4 hover:underline">
          Browse collection
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !copies?.length ? (
        <p className="text-sm text-muted-foreground">
          No Copies yet. Add one from an Artwork on <Link to="/tcg" className="underline">browse</Link>.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {copies.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{c.nameEn ?? c.nameJa}</span>
              <span className="text-xs text-muted-foreground">{c.variantId}</span>
              <Badge variant="outline">{c.language.toUpperCase()}</Badge>
              <span className="text-xs text-muted-foreground">{c.setName}</span>
              <Badge variant="secondary">{c.condition}</Badge>
              <span className="text-xs">{c.pricePaid == null ? "No price" : c.pricePaid.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
              <span className="text-xs text-muted-foreground">{c.acquiredOn}</span>
              <span className="ml-auto flex gap-1">
                <Button size="xs" variant="outline" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => window.confirm(`Delete this Copy of ${c.variantId}?`) && remove.mutate({ id: c.id })}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CopyDialog
          title={`Edit Copy of ${editing.variantId} (${editing.language.toUpperCase()})`}
          initial={editing}
          pending={update.isPending}
          error={update.error?.message}
          onSubmit={({ condition, pricePaid, acquiredOn }) =>
            update.mutate({ id: editing.id, condition, pricePaid, acquiredOn })
          }
          onClose={() => {
            update.reset();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
