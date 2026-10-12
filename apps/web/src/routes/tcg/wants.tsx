import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { cardImage } from "./-components/card-image";
import { WantDialog } from "./-components/want-dialog";

type Want = RouterOutputs["tcg"]["wants"]["list"][number];

const wantsSearchSchema = z.object({
  status: z.enum(["dropped"]).optional().catch(undefined),
});

export const Route = createFileRoute("/tcg/wants")({
  validateSearch: (search) => wantsSearchSchema.parse(search),
  component: WantsPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

const LANGUAGE_LABEL = { ja: "JP", en: "EN" } as const;
const price = (n: number) => `$${n.toFixed(2)}`;

function WantsPage() {
  const { status = "open" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { data: wants, isLoading } = useQuery(trpc.tcg.wants.list.queryOptions({ status }));
  const [editing, setEditing] = useState<Want | null>(null);

  const options = { onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.tcg.pathKey() }) };
  const drop = useMutation(trpc.tcg.wants.drop.mutationOptions(options));
  const reopen = useMutation(trpc.tcg.wants.reopen.mutationOptions(options));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Wants</h1>
        <Link to="/tcg" className="text-sm underline underline-offset-4">
          Browse cards
        </Link>
      </div>
      <Tabs
        value={status}
        onValueChange={(next) =>
          navigate({ search: { status: next === "dropped" ? "dropped" : undefined }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="dropped">Dropped</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !wants?.length ? (
        <p className="text-sm text-muted-foreground">
          {status === "open" ? "No open Wants. Add one from an Artwork on the Cards page." : "No dropped Wants."}
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {wants.map((w) => (
            <li key={w.id} className="flex items-center gap-3 p-2">
              {w.imageUrl && (
                <img
                  src={cardImage(w.imageUrl)}
                  alt={w.variantId}
                  loading="lazy"
                  className="aspect-[63/88] w-12 rounded-sm bg-muted object-cover"
                />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{w.nameEn ?? w.nameJa}</div>
                <div className="text-xs text-muted-foreground">
                  {w.variantId} · {w.languages.map((l) => LANGUAGE_LABEL[l]).join(" / ")} · max {price(w.maxPrice)} ·{" "}
                  {w.minCondition} or better
                </div>
              </div>
              <Button size="xs" variant="outline" onClick={() => setEditing(w)}>
                Edit
              </Button>
              {status === "open" ? (
                <Button size="xs" variant="outline" disabled={drop.isPending} onClick={() => drop.mutate({ id: w.id })}>
                  Drop
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={reopen.isPending}
                  onClick={() => reopen.mutate({ id: w.id })}
                >
                  Reopen
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <WantDialog
          variantId={editing.variantId}
          label={editing.nameEn ?? editing.nameJa ?? editing.cardNumber}
          want={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
