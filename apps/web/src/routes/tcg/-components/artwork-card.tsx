import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { ArtRatingSelect, ThemeTagMenu } from "./art-taste";
import { artworkImage } from "./card-image";
import { CopyDialog } from "./copy-dialog";
import { invalidateBrowse } from "./invalidate-browse";
import { TilePrice, type TilePrices } from "./tile-price";
import { WantDialog } from "./want-dialog";

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];

/**
 * Artwork tiles with their Add Copy and Want actions: `renderCard` draws one tile, `dialogs` must be
 * rendered once alongside them. `onArtist` runs when a tile's artist is clicked.
 */
export function useArtworkCards(onArtist: (artist: string) => void) {
  const [wanting, setWanting] = useState<{ variantId: string; label: string } | null>(null);
  const [adding, setAdding] = useState<ArtworkRow | null>(null);
  const today = useFinanceToday();
  const queryClient = useQueryClient();
  const addCopy = useMutation(
    trpc.tcg.copies.create.mutationOptions({
      onSuccess: () => {
        setAdding(null);
        invalidateBrowse(queryClient);
        queryClient.invalidateQueries({ queryKey: trpc.tcg.copies.list.pathKey() });
      },
    }),
  );

  /** `prices`: the shown Artworks' tile prices, once loaded. */
  const renderCard = (a: ArtworkRow, prices?: TilePrices) => (
    <ArtworkCard
      key={a.variantId}
      artwork={a}
      prices={prices}
      onArtist={onArtist}
      onAdd={() => setAdding(a)}
      onWant={() => setWanting({ variantId: a.variantId, label: a.nameEn ?? a.nameJa ?? a.cardNumber })}
    />
  );

  const dialogs = (
    <>
      {adding && (
        <CopyDialog
          title={`Add a Copy of ${adding.variantId}`}
          initial={{ printingId: adding.printings[0]!.id, condition: "NM", pricePaid: null, acquiredOn: today }}
          printings={adding.printings}
          pending={addCopy.isPending}
          error={addCopy.error?.message}
          onSubmit={(values) => addCopy.mutate(values)}
          onClose={() => {
            addCopy.reset();
            setAdding(null);
          }}
        />
      )}
      {wanting && <WantDialog {...wanting} onClose={() => setWanting(null)} />}
    </>
  );

  return { renderCard, dialogs };
}

/** One Artwork in browse: image, credits, Printings, Market Price, and the buy and taste actions. */
function ArtworkCard({
  artwork: a,
  prices,
  onArtist,
  onAdd,
  onWant,
}: {
  artwork: ArtworkRow;
  prices: TilePrices | undefined;
  onArtist: (artist: string) => void;
  onAdd: () => void;
  onWant: () => void;
}) {
  const image = artworkImage(a.printings);
  const en = a.printings.find((p) => p.language === "en");
  return (
    <li className="space-y-1">
      {image && (
        <img
          src={image}
          alt={`${a.variantId} ${a.nameEn ?? a.nameJa ?? ""}`}
          loading="lazy"
          className="aspect-[63/88] w-full rounded-sm bg-muted object-cover"
        />
      )}
      <div className="text-xs font-medium">{a.nameEn ?? a.nameJa}</div>
      <div className="flex items-center gap-1 text-xs">
        {a.artist ? (
          <button
            type="button"
            className="truncate text-left underline-offset-2 hover:underline"
            title={`Show Artworks by ${a.artist}`}
            onClick={() => onArtist(a.artist!)}
          >
            {a.artist}
          </button>
        ) : (
          <span className="text-muted-foreground italic">uncredited</span>
        )}
        {a.artistConflict && (
          <Badge variant="destructive" title="Japanese and English sources credit different artists">
            conflict
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>{a.variantId}</span>
        <Badge variant="secondary">{a.variantKind}</Badge>
        {a.printings.map((p) => (
          <Badge key={p.language} variant="outline" title={p.setName}>
            {p.language.toUpperCase()}
          </Badge>
        ))}
        {a.owned && <Badge>Owned</Badge>}
      </div>
      {en && prices && <TilePrice price={prices.find((p) => p.printingId === en.id)} />}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {a.wanted && <Badge>Wanted</Badge>}
        <Button size="xs" variant="outline" onClick={onAdd}>
          Add Copy
        </Button>
        <Button size="xs" variant="outline" onClick={onWant}>
          {a.wanted ? "Want another" : "Want"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <ArtRatingSelect variantId={a.variantId} rating={a.rating} />
        <ThemeTagMenu variantId={a.variantId} tagged={a.themes} />
        {a.themes.map((t) => (
          <Badge key={t.id} variant="secondary">
            {t.name}
          </Badge>
        ))}
      </div>
    </li>
  );
}
