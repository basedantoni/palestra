import { useQuery } from "@tanstack/react-query";

import { trpc, type RouterOutputs } from "@/utils/trpc";

export type TilePrices = RouterOutputs["tcg"]["market"]["tilePrices"];

/** Tile prices for the Artworks on screen, in one request; undefined until loaded. */
export function useTilePrices(artworks: Array<{ variantId: string }> | undefined) {
  const variantIds = artworks?.map((a) => a.variantId) ?? [];
  return useQuery({ ...trpc.tcg.market.tilePrices.queryOptions({ variantIds }), enabled: variantIds.length > 0 }).data;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The English Printing's Current Market Price on a tile (TCGplayer, NM, USD): dated once older than
 * 7 days, a dash when there is none. Never carried forward or estimated.
 */
export function TilePrice({ price }: { price: TilePrices[number] | undefined }) {
  return (
    <div className="flex items-baseline gap-1 text-xs" title="TCGplayer Market Price, NM">
      <span className="text-muted-foreground">EN</span>
      {price ? (
        <>
          <span className="font-medium tabular-nums">{usd.format(price.price)}</span>
          {price.asOf && <span className="text-muted-foreground">as of {shortDay(price.day)}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}
