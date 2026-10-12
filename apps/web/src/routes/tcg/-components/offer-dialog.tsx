import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc, type RouterOutputs } from "@/utils/trpc";

type Want = RouterOutputs["tcg"]["wants"]["list"][number];
type Offer = Want["offers"][number];

/** Record an Offer against a Want, or edit one. */
export function OfferDialog({
  want,
  label,
  offer,
  onClose,
}: {
  want: Pick<Want, "id" | "variantId" | "printings">;
  /** Card name shown in the title. */
  label: string;
  offer?: Offer;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const today = useFinanceToday();
  const [printingId, setPrintingId] = useState(offer?.printingId ?? want.printings[0]?.id ?? "");
  const [seller, setSeller] = useState(offer?.seller ?? "");
  const [price, setPrice] = useState(offer ? String(offer.price) : "");
  const [url, setUrl] = useState(offer?.url ?? "");
  const [seenOn, setSeenOn] = useState(offer?.seenOn ?? today);

  const options = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trpc.tcg.wants.pathKey() });
      onClose();
    },
  };
  const create = useMutation(trpc.tcg.offers.create.mutationOptions(options));
  const update = useMutation(trpc.tcg.offers.update.mutationOptions(options));
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const amount = Number(price);
  const valid = printingId !== "" && seller.trim() !== "" && price !== "" && amount > 0 && seenOn !== "";
  const save = () => {
    const terms = { printingId, seller, price: amount, url: url.trim() || null, seenOn };
    if (offer) update.mutate({ id: offer.id, ...terms });
    else create.mutate({ wantId: want.id, ...terms });
  };

  const field = "block space-y-1 text-xs";
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {offer ? "Edit Offer" : "Offer"}: {label}
          </DialogTitle>
          <DialogDescription>{want.variantId}</DialogDescription>
        </DialogHeader>
        {want.printings.length === 0 ? (
          <p className="text-sm text-muted-foreground">This Artwork has no Printing in the Want's accepted languages.</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save();
            }}
          >
            <label className={field}>
              <span className="text-muted-foreground">Printing</span>
              <select
                value={printingId}
                onChange={(e) => setPrintingId(e.target.value)}
                className="block rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                {want.printings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {TCG_LANGUAGE_NAME[p.language]} · {p.setName}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className="text-muted-foreground">Seller</span>
              <Input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Mercari, Card Rush…" required />
            </label>
            <label className={field}>
              <span className="text-muted-foreground">Delivered price (USD, incl. shipping and tax)</span>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-32"
                required
              />
            </label>
            <label className={field}>
              <span className="text-muted-foreground">Link (optional)</span>
              <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </label>
            <label className={field}>
              <span className="text-muted-foreground">Seen on</span>
              <Input
                type="date"
                value={seenOn}
                max={today}
                onChange={(e) => setSeenOn(e.target.value)}
                className="w-40"
                required
              />
            </label>
            {error && <p className="text-xs text-destructive">{error.message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || saving}>
                {saving ? "Saving…" : offer ? "Save" : "Add Offer"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
