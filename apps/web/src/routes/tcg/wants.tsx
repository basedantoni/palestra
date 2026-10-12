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

import { cardImage } from "./-components/card-image";
import { CopyDialog } from "./-components/copy-dialog";
import { OfferDialog } from "./-components/offer-dialog";
import { WantDialog } from "./-components/want-dialog";

type Want = RouterOutputs["tcg"]["wants"]["list"][number];
type Offer = Want["offers"][number];

const wantsSearchSchema = z.object({
  status: z.enum(["ordered", "fulfilled", "dropped"]).optional().catch(undefined),
});

const EMPTY = {
  open: "No open Wants. Add one from an Artwork on the Cards page.",
  ordered: "Nothing on order. Mark an Offer bought on an open Want.",
  fulfilled: "No fulfilled Wants yet.",
  dropped: "No dropped Wants.",
} as const;

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
  const [receiving, setReceiving] = useState<{ want: Want; offer: Offer } | null>(null);
  const today = useFinanceToday();

  const options = { onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.tcg.pathKey() }) };
  const drop = useMutation(trpc.tcg.wants.drop.mutationOptions(options));
  const reopen = useMutation(trpc.tcg.wants.reopen.mutationOptions(options));
  const buy = useMutation(trpc.tcg.wants.buy.mutationOptions(options));
  const cancelOrder = useMutation(trpc.tcg.wants.cancelOrder.mutationOptions(options));
  const receive = useMutation(
    trpc.tcg.wants.receive.mutationOptions({
      onSuccess: () => {
        setReceiving(null);
        return options.onSuccess();
      },
    }),
  );
  const deleteOffer = useMutation(trpc.tcg.offers.delete.mutationOptions(options));

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
          navigate({ search: { status: next === "open" ? undefined : (next as Exclude<typeof status, "open">) }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="ordered">Ordered</TabsTrigger>
          <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          <TabsTrigger value="dropped">Dropped</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !wants?.length ? (
        <p className="text-sm text-muted-foreground">{EMPTY[status]}</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {wants.map((w) => {
            const bought = w.offers.find((o) => o.id === w.boughtOfferId);
            return (
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
                    {bought ? (
                      <span>
                        Bought {price(bought.price)} ({LANGUAGE_LABEL[bought.language]}, {bought.seller})
                        {w.receivedCondition && <> · received {w.receivedCondition}</>}
                      </span>
                    ) : w.cheapest ? (
                      <span>
                        Cheapest {price(w.cheapest.price)} ({LANGUAGE_LABEL[w.cheapest.language]}, {w.cheapest.seller})
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No Offers yet</span>
                    )}
                    {status === "open" && w.buyable && <Badge>Buyable</Badge>}
                    {w.belowMinimum && <Badge variant="destructive">Below {w.minCondition}</Badge>}
                  </div>
                </div>
                {status !== "fulfilled" && (
                  <>
                    <Button size="xs" variant="outline" onClick={() => setOffering({ want: w })}>
                      Add Offer
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setEditing(w)}>
                      Edit
                    </Button>
                  </>
                )}
                {status === "open" && (
                  <Button size="xs" variant="outline" disabled={drop.isPending} onClick={() => drop.mutate({ id: w.id })}>
                    Drop
                  </Button>
                )}
                {status === "dropped" && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={reopen.isPending}
                    onClick={() => reopen.mutate({ id: w.id })}
                  >
                    Reopen
                  </Button>
                )}
                {status === "ordered" && bought && (
                  <>
                    <Button size="xs" onClick={() => setReceiving({ want: w, offer: bought })}>
                      Received
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={cancelOrder.isPending}
                      onClick={() => cancelOrder.mutate({ id: w.id })}
                    >
                      Cancel order
                    </Button>
                  </>
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
                      <span className="w-20 text-right text-muted-foreground" title={o.seenOn}>
                        {age(o.seenOn, today)}
                      </span>
                      {o.id === w.boughtOfferId && <Badge variant="secondary">Bought</Badge>}
                      {status === "open" && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={buy.isPending}
                          onClick={() => buy.mutate({ id: w.id, offerId: o.id })}
                        >
                          Mark bought
                        </Button>
                      )}
                      {status !== "fulfilled" && (
                        <Button size="xs" variant="ghost" onClick={() => setOffering({ want: w, offer: o })}>
                          Edit
                        </Button>
                      )}
                      {o.id !== w.boughtOfferId && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={deleteOffer.isPending}
                          onClick={() => deleteOffer.mutate({ id: o.id })}
                        >
                          Delete
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
            );
          })}
        </ul>
      )}
      {receiving && (
        <CopyDialog
          title={`Received ${receiving.want.variantId} (${LANGUAGE_LABEL[receiving.offer.language]})`}
          initial={{
            printingId: receiving.offer.printingId,
            condition: receiving.want.minCondition,
            pricePaid: receiving.offer.price,
            acquiredOn: today,
          }}
          pending={receive.isPending}
          error={receive.error?.message}
          onSubmit={({ condition, pricePaid, acquiredOn }) =>
            receive.mutate({ id: receiving.want.id, condition, pricePaid, acquiredOn })
          }
          onClose={() => {
            receive.reset();
            setReceiving(null);
          }}
        />
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
