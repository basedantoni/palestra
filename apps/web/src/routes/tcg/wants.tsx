import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { CardFundPanel, useCardFund } from "./-components/card-fund-panel";
import { cardImage } from "./-components/card-image";
import { OfferDialog } from "./-components/offer-dialog";
import { WantDialog } from "./-components/want-dialog";

type Want = RouterOutputs["tcg"]["wants"]["list"][number];
type Offer = Want["offers"][number];

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

/** How long ago an Offer was seen, so stale prices get re-checked. */
function age(seenOn: string, today: string) {
  const days = Math.round((Date.parse(today) - Date.parse(seenOn)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function WantsPage() {
  const { status = "open" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { data: wants, isLoading } = useQuery(trpc.tcg.wants.list.queryOptions({ status }));
  const [editing, setEditing] = useState<Want | null>(null);
  const [offering, setOffering] = useState<{ want: Want; offer?: Offer } | null>(null);
  const today = useFinanceToday();
  const fund = useCardFund();

  const options = { onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.tcg.pathKey() }) };
  const drop = useMutation(trpc.tcg.wants.drop.mutationOptions(options));
  const reopen = useMutation(trpc.tcg.wants.reopen.mutationOptions(options));
  const deleteOffer = useMutation(trpc.tcg.offers.delete.mutationOptions(options));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Wants</h1>
        <Link to="/tcg" className="text-sm underline underline-offset-4">
          Browse cards
        </Link>
      </div>
      <CardFundPanel />
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
            <li key={w.id} className="space-y-2 p-2">
              <div className="flex items-center gap-3">
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
                  <div className="flex items-center gap-2 text-xs">
                    {w.cheapest ? (
                      <span>
                        Cheapest {price(w.cheapest.price)} ({LANGUAGE_LABEL[w.cheapest.language]}, {w.cheapest.seller})
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No Offers yet</span>
                    )}
                    {w.buyable && <Badge>Buyable</Badge>}
                  </div>
                </div>
                <Button size="xs" variant="outline" onClick={() => setOffering({ want: w })}>
                  Add Offer
                </Button>
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
              </div>
              {w.offers.length > 0 && (
                <ul className="ml-15 divide-y divide-border border border-border text-xs">
                  {w.offers.map((o) => (
                    <li key={o.id} className="flex items-center gap-2 px-2 py-1">
                      <span className="w-6 font-medium">{LANGUAGE_LABEL[o.language]}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {o.url ? (
                          <a href={o.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                            {o.seller}
                          </a>
                        ) : (
                          o.seller
                        )}{" "}
                        <span className="text-muted-foreground">· {o.setName}</span>
                      </span>
                      <span className={o.price <= w.maxPrice ? "font-medium" : undefined}>{price(o.price)}</span>
                      {fund && (
                        <span className={o.price <= fund.balance ? "text-muted-foreground" : "text-destructive"}>
                          {o.price <= fund.balance ? "within fund" : "over fund"}
                        </span>
                      )}
                      <span className="w-20 text-right text-muted-foreground" title={o.seenOn}>
                        {age(o.seenOn, today)}
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => setOffering({ want: w, offer: o })}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={deleteOffer.isPending}
                        onClick={() => deleteOffer.mutate({ id: o.id })}
                      >
                        Delete
                      </Button>
                    </li>
                  ))}
                </ul>
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
      {offering && (
        <OfferDialog
          want={offering.want}
          offer={offering.offer}
          label={offering.want.nameEn ?? offering.want.nameJa ?? offering.want.cardNumber}
          onClose={() => setOffering(null)}
        />
      )}
    </div>
  );
}
